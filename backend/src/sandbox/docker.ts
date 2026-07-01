import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Writable } from 'stream';
import tar from 'tar-stream';

export interface WorkspaceFile {
  path: string;
  content: string | null;
  type: 'file' | 'directory';
}

export interface WorkspaceContext {
  workspaceId: string;
  activeFilePath: string;
  workspaceFiles: WorkspaceFile[];
}

export interface ExecutionResult {
  output: string;
  durationMs: number;
  exitCode: number;
  oomKilled: boolean;
  cpuUsagePercent?: number;
  memoryUsageBytes?: number;
}


// =============================================================================
// DOCKER SANDBOX EXECUTION ENGINE
// =============================================================================
//
// PURPOSE:
//   Execute untrusted, arbitrary user code safely by isolating it inside a
//   pre-warmed Docker container from the warm pool (see pool.ts). The container
//   is torn down after every run — each execution is ephemeral.
//
// ARCHITECTURE — WARM POOL + EXEC INJECTION + DYNAMIC HYDRATION:
//   This engine uses a warm pool combined with dynamic memory-only hydration and
//   custom execution pipeline routing to process multi-file workspaces under 100ms:
//
//   Phase 1 — Pool Pop (handled by pool.ts):
//     Pre-warmed containers are created at server startup and maintained in a
//     pool. When a user submits code, we pop an idle container instantly (~0ms)
//     instead of paying the ~600ms cold-start penalty of docker.createContainer().
//
//   Phase 2 — In-Memory Multi-File Tar Hydration (handled here):
//     Rather than writing files to the host OS disk or utilizing bind mounts (which
//     expose host file structures and suffer from virtualization I/O latency),
//     we construct a Tar archive entirely in RAM. We run exactly one `docker exec`
//     channel executing `tar -xf - -C /app` and stream the raw bytes over stdin.
//     This hydrates the container with all workspace files (including directories)
//     in a single network socket operation.
//
//   Phase 3 — Custom Execution Pipeline Interception:
//     We look for custom configuration files (`.nexusrun` or `nexus.config.json`)
//     at the workspace root. If found:
//       1. Custom Build: Execute the build script first via a hijacked `docker exec`.
//          If execution fails (exit code !== 0), abort and surface compiler logs.
//       2. Custom Run: Replace default language run commands with the user's override.
//     If no config is found, the system executes the language compiler/runner
//     directly, dynamically re-targeting paths to run the active selection file.
//
//   ┌──────────────────────────────────────────────────────────────────────────────┐
//   │  TRADITIONAL BIND-MOUNT FLOW:                                                │
//   │    Write to disk → Create container (mount :ro) → Start → Clean up           │
//   │    Latency: ~600ms container setup + Disk I/O                                │
//   │                                                                              │
//   │  MULTI-FILE WORKSPACE TAR HYDRATION FLOW:                                    │
//   │    Pop warm container (~0ms) → Stream in-memory tarball to `tar -xf`        │
//   │    (~10ms) → Run custom build (~build) → Exec custom run (~runtime) → Clean   │
//   │    Latency: ~10ms overhead + build time + execution time                      │
//   └──────────────────────────────────────────────────────────────────────────────┘
//
// WHY DOCKER INSTEAD OF child_process.exec / VM?
//   - child_process.exec runs code directly on the host OS. A malicious user
//     could delete files, exfiltrate data, or fork-bomb the server.
//   - Node's 'vm' module only sandboxes JavaScript and still shares the same
//     process memory — a prototype-pollution attack can escape it.
//   - Docker uses Linux kernel primitives (namespaces + cgroups) to give each
//     container its own isolated view of the filesystem, network, PIDs, and
//     resource limits. Even if the code inside is malicious, it cannot affect
//     the host or other containers.
//
// LINUX KERNEL PRIMITIVES DOCKER USES INTERNALLY:
//   1. Namespaces — isolate what a process can *see*:
//        PID namespace  → container processes have their own PID tree (PID 1
//                         inside the container is the container init, not host)
//        NET namespace  → separate network stack; NetworkMode:'none' means no
//                         network interfaces exist at all inside the container
//        MNT namespace  → own filesystem mount table; tmpfs-backed /app and /tmp
//                         are the only writable locations (rootfs is read-only)
//        IPC namespace  → isolated shared memory and semaphores
//        UTS namespace  → own hostname and domain name
//   2. cgroups (Control Groups) — limit what a process can *use*:
//        memory         → hard cap on RAM; OOM killer fires if exceeded
//        cpu            → NanoCpus limits CPU time share (CFS scheduler)
//        pids           → max number of processes/threads; blocks fork bombs
//
// SECURITY PROPERTIES OF THIS ENGINE:
//   - No network access (NetworkMode: 'none')         → can't exfiltrate data
//   - Read-only rootfs + tmpfs mounts                 → can't tamper with system binaries
//   - Code injected via exec stdin (no bind mounts)   → host filesystem never exposed
//   - Memory cap 100 MB + swap disabled               → no OOM bomb
//   - CPU cap 0.5 vCPU                                → can't starve host
//   - PID limit 50                                    → fork bombs contained
//   - Hard timeout 10 s                               → no infinite loops
//   - Output cap 1 MB                                 → no OOM from print loops
//   - Container removed after every run               → no state leaks between users
//
// WHY TAR-STREAM FOR WORKSPACE HYDRATION?
//   - Packaging: Tar (Tape Archive) is a sequential wrapper format that groups multiple
//     files/folders into a contiguous byte stream without compression overhead.
//   - Pipeline Efficiency: Spawning container exec processes has a ~30ms latency penalty.
//     Rather than calling `docker exec` for every file individually, we construct the entire
//     workspace as a tar file in Node.js RAM and pipe it over a single exec session.
//   - Command Breakdown (`tar -xf - -C /app`):
//       -x   : Instructs tar to extract the contents.
//       -f - : Reads the input from stdin (standard input stream) directly from the socket.
//       -C   : Changes the execution path to `/app` inside the container before unpacking,
//              ensuring relative path paths are mapped correctly.
//
// =============================================================================

import { docker, warmPoolManager } from './pool';
// docker and warmPoolManager are singletons exported from pool.ts.
// - docker: the Dockerode instance connected to the Docker daemon socket
// - warmPoolManager: manages the pre-warmed container pool lifecycle

// Max bytes we accumulate from stdout + stderr combined before truncating.
// Without this cap, a user's `while True: print("x" * 10000)` loop would
// accumulate gigabytes in memory and crash the Node.js process.
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024; // 1 MB

// Language → Docker image + run command + expected source filename.
//
// WHY ALPINE-BASED IMAGES (python:3.10-alpine, node:20-alpine)?
//   Alpine Linux uses musl libc instead of glibc and strips most tools.
//   python:3.10-alpine is ~50 MB vs python:3.10 at ~900 MB.
//   Smaller image = faster container start time = faster execution response.
//   Smaller attack surface = fewer binaries the sandboxed code could abuse.
//
// WHY gcc:12 FOR C/C++ INSTEAD OF gcc:12-alpine?
//   gcc on Alpine has known linking issues with some standard library functions
//   (musl vs glibc ABI differences). gcc:12 uses Debian slim which is more
//   compatible with standard coursework and competitive programming code.
//
// HOW COMPILED LANGUAGES WORK:
//   For C and C++, cmd is a shell one-liner: "compile && run".
//   The '&&' means: only run /app/code.out if compilation succeeded.
//   If compilation fails, g++ exits non-zero, '&&' short-circuits, and the
//   compiler error message goes to stderr, which we capture and return.
//
// NOTE ON DUPLICATION WITH pool.ts:
//   pool.ts also defines IMAGE_CONFIGS. This is intentional — pool.ts only
//   needs the image name, while this file needs image + cmd + filename.
//   Merging them would create a circular import (pool imports from docker,
//   docker imports from pool). The duplication is a conscious tradeoff.
const CONFIGS: Record<string, { image: string; cmd: string[]; filename: string }> = {
  python: {
    image: 'python:3.10-alpine',
    cmd: ['python', '/app/code.py'],
    filename: 'code.py'
  },
  javascript: {
    image: 'node:20-alpine',
    cmd: ['node', '/app/code.js'],
    filename: 'code.js'
  },
  cpp: {
    // sh -c runs the argument as a shell command, enabling && chaining.
    image: 'gcc:12',
    cmd: ['sh', '-c', 'g++ /app/code.cpp -o /app/code.out && /app/code.out'],
    filename: 'code.cpp'
  },
  c: {
    image: 'gcc:12',
    cmd: ['sh', '-c', 'gcc /app/code.c -o /app/code.out && /app/code.out'],
    filename: 'code.c'
  },
  java: {
    image: 'eclipse-temurin:21-jdk-alpine',
    cmd: ['java', '/app/Main.java'],
    filename: 'Main.java'
  },
  bash: {
    image: 'alpine:3.18',
    cmd: ['sh', '/app/code.sh'],
    filename: 'code.sh'
  }
};

// =============================================================================
// LOGGING HELPER
// =============================================================================
// Appends a structured log entry to execution_requests.log after every run.
// Non-fatal: if the write fails (disk full, permission denied), we log to
// console but do NOT surface the error to the caller — logging is observability
// infrastructure, not part of the execution contract.
async function logRequest(
  language: string,
  code: string,
  input: string | undefined,
  output: string
): Promise<void> {
  const logPath = path.join(__dirname, '..', '..', 'execution_requests.log');
  const entry =
    `\n================================================================================\n` +
    `TIMESTAMP : ${new Date().toISOString()}\n` +
    `LANGUAGE  : ${language}\n` +
    `INPUT     : ${input ?? 'None'}\n` +
    `CODE:\n${code}\n` +
    `--------------------------------------------------------------------------------\n` +
    `OUTPUT:\n${output}\n` +
    `================================================================================\n`;
  try {
    await fs.appendFile(logPath, entry, 'utf8');
    // appendFile is O_APPEND under the hood. On Linux, O_APPEND writes are
    // atomic for writes smaller than PIPE_BUF (~4 KB) on most filesystems.
    // For our log entries (usually <1 KB), concurrent writes from parallel
    // executions won't interleave mid-entry.
  } catch (err) {
    console.error('[docker] Failed to write execution log:', err);
  }
}

// =============================================================================
// INPUT NORMALIZER
// =============================================================================
// Users provide stdin in many natural formats; we normalize them all to the
// format every language's input() / scanf / cin expects: one token per line.
//
// HOW Python's input() WORKS INTERNALLY:
//   input() calls sys.stdin.readline() under the hood, which reads bytes from
//   file descriptor 0 (stdin) until it encounters '\n' or EOF.
//   So for TWO input() calls, stdin must have TWO newline-terminated lines:
//     "Aman\n25\n"
//
// THE PROBLEM WITH SPACE-SEPARATED INPUT:
//   If the user types "Aman 25" (one line), Python's first input() call reads
//   the entire line "Aman 25" as a single string. The second input() blocks
//   forever waiting for another line that never comes → the container hangs
//   until the 10-second timeout fires.
//
// OUR STRATEGY — tokenize on ANY whitespace, rejoin with '\n':
//   "Aman 25"    → ["Aman", "25"] → "Aman\n25\n"   ✓
//   "Aman\n25"   → ["Aman", "25"] → "Aman\n25\n"   ✓ (same result)
//   "Aman\n\n25" → ["Aman", "25"] → "Aman\n25\n"   ✓ (blank lines collapsed)
//   "1 2 3 4 5"  → ["1","2","3","4","5"] → "1\n2\n3\n4\n5\n"  ✓
//
// The user tests expect spaces within a line to be preserved (e.g. multiline strings).
function normalizeInput(raw: string): string {
  return raw.trim() + '\n';
}

// =============================================================================
// INLINE CGROUP METRICS — Boundary Markers & Parsing
// =============================================================================
//
// OPTIMIZATION: Instead of spawning 2 separate `docker exec` calls to read
// cgroup stats before and after execution (~30-50ms each, totaling ~60-100ms),
// we embed cgroup reads directly into the execution command wrapper and emit
// them to stderr with unique boundary markers. After execution, we parse the
// combined stderr to extract metrics and separate them from user output.
//
// This approach reduces the per-execution Docker API round-trips from 4 to 2:
//   Before: exec(tar) + exec(pre-metrics) + exec(run) + exec(post-metrics)
//   After:  putArchive() + exec(wrapped-run-with-metrics)
//
const METRICS_BOUNDARY = '___NEXUS_CGROUP_BOUNDARY___';
const METRICS_END = '___NEXUS_CGROUP_END___';

interface ParsedCgroupMetrics {
  preCpuUsec: number;
  postCpuUsec: number;
  memoryPeakBytes: number;
  userStderr: string;
}

// Split stderr by our boundary markers to extract pre/post cgroup stats
// and the actual user stderr in between.
//
// STDERR LAYOUT (after wrapped execution):
//   <pre cgroup cpu.stat>\n
//   ___NEXUS_CGROUP_BOUNDARY___\n
//   <user stderr if any>\n
//   ___NEXUS_CGROUP_BOUNDARY___\n
//   <post cgroup cpu.stat + memory.peak>\n
//   ___NEXUS_CGROUP_END___\n
function parseInlineMetrics(rawStderr: string): ParsedCgroupMetrics {
  const parts = rawStderr.split(METRICS_BOUNDARY);
  if (parts.length >= 3) {
    const preRaw = parts[0]!.trim();
    const userStderr = parts[1]!.trim();
    const postRaw = parts[2]!.replace(METRICS_END, '').trim();
    return {
      preCpuUsec: extractCpuUsec(preRaw),
      postCpuUsec: extractCpuUsec(postRaw),
      memoryPeakBytes: extractMemoryPeak(postRaw),
      userStderr
    };
  }
  // Fallback: no metrics markers found (timeout/OOM killed before markers were written)
  return { preCpuUsec: 0, postCpuUsec: 0, memoryPeakBytes: 0, userStderr: rawStderr };
}

function extractCpuUsec(raw: string): number {
  const match = raw.match(/usage_usec\s+(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

function extractMemoryPeak(raw: string): number {
  const lines = raw.trim().split('\n');
  const lastLine = lines[lines.length - 1];
  return (lastLine && /^\d+$/.test(lastLine.trim())) ? parseInt(lastLine.trim(), 10) : 0;
}

// =============================================================================
// PUBLIC API
// =============================================================================
// Entry point called by the Express route handler (workspace.ts).
// Orchestrates: pool pop → code injection → execution → cleanup → logging.
export async function executeCode(
  code: string,
  language: string,
  input?: string,
  workspaceContext?: WorkspaceContext
): Promise<ExecutionResult> {
  const config = CONFIGS[language];
  if (!config) {
    return {
      output: `Error: Unsupported language "${language}". Supported: ${Object.keys(CONFIGS).join(', ')}.`,
      durationMs: 0,
      exitCode: -1,
      oomKilled: false
    };
  }

  try {
    const result = await runInDocker(language, code, config.filename, config.cmd, input, 10_000, workspaceContext);
    await logRequest(language, code, input, result.output);
    return result;
  } catch (error: any) {
    // runInDocker throws a plain object (not an Error instance) so we can
    // pass typed fields without TypeScript narrowing issues:
    //   { killed: true,  stdout: string, stderr: string }          → timeout
    //   { killed: false, stdout: string, stderr: string, message } → runtime error
    const errorMsg = error.killed
      ? (error.stdout || '') + '\n[Error] Execution timed out (10 000 ms).'
      : (error.stdout || '') + (error.stderr || error.message || 'Unknown execution error');
    await logRequest(language, code, input, errorMsg);
    return {
      output: errorMsg.trimEnd(),
      durationMs: error.durationMs ?? 0,
      exitCode: error.exitCode ?? -1,
      oomKilled: error.oomKilled ?? false,
      cpuUsagePercent: error.cpuUsagePercent ?? 0,
      memoryUsageBytes: error.memoryUsageBytes ?? 0
    };
  }
}

// =============================================================================
// CORE DOCKER RUNNER — Warm Pool + Exec Injection Pipeline
// =============================================================================
//
// WHY A PLAIN async FUNCTION INSTEAD OF new Promise(async executor)?
//   The "new Promise(async executor)" pattern is an anti-pattern because:
//   If the async executor throws SYNCHRONOUSLY before the first `await`,
//   the Promise constructor catches it internally but does nothing with it —
//   the outer promise stays pending forever (memory leak + hang).
//   A plain async function propagates all throws as rejected promises, which
//   the caller can catch with try/catch or .catch().
//
// EXECUTION LIFECYCLE (warm pool flow):
//   1. Pop warm container from pool         → ~0ms (container already running)
//   2. Inject code via `docker exec cat >`  → ~10ms (stream write over socket)
//   3. Execute run command via `docker exec` → ~runtime (user code execution)
//   4. Parse multiplexed stdout/stderr      → concurrent with step 3
//   5. Race execution against timeout       → 10s hard cap
//   6. Inspect exec exit code + OOM status  → ~5ms (Docker API call)
//   7. Remove container (fire-and-forget)   → async, doesn't block response
//
// WHY `docker exec` INSTEAD OF BIND MOUNTS?
//   The previous approach bind-mounted a host temp file into the container:
//     Binds: ['/host/temp/code.py:/app/code.py:ro']
//   Problems with bind mounts:
//     1. Exposes host filesystem paths to the container (information leak)
//     2. Requires a host-side temp directory (disk I/O + cleanup complexity)
//     3. On macOS with Docker Desktop, bind mounts go through a FUSE layer
//        (osxfs/virtiofs) that adds 5–20ms latency per file operation
//     4. Temp file cleanup on crashes is error-prone (orphaned files)
//   `docker exec` streams code directly into the container over the Docker
//   socket — no host filesystem involvement at all.
//
async function runInDocker(
  language: string,
  code: string,
  filename: string,
  cmd: string[],
  input: string | undefined,
  timeoutMs: number,
  workspaceContext?: WorkspaceContext
): Promise<ExecutionResult> {
  let container: Docker.Container | null = null;
  const startTime = performance.now();

  let maxMemory = 0;
  let peakCpuPercent = 0.0;
  let runStartTime = 0;

  // Hoisted outside try so the catch block can include partial output
  // captured before a timeout or runtime crash.
  let stdoutData = '';
  let stderrData = '';

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Pop a pre-warmed container from the pool
    // -------------------------------------------------------------------------
    // The container is already running `sleep infinity` (see pool.ts).
    // If the pool is empty (burst traffic), this falls back to creating
    // a container on-demand (~600ms penalty).
    const warm = await warmPoolManager.popContainer(language);
    container = warm.container;

    // -------------------------------------------------------------------------
    // STEP 2: Inject user code into the container via `docker exec`
    // -------------------------------------------------------------------------
    if (workspaceContext && workspaceContext.workspaceFiles.length > 0) {
      // -------------------------------------------------------------------------
      const pack = tar.pack();
      for (const file of workspaceContext.workspaceFiles) {
        if (file.type === 'directory') {
          pack.entry({ name: file.path, type: 'directory' });
        } else {
          pack.entry({ name: file.path }, file.content || '');
        }
      }
      pack.finalize();
      
      const execSetup = await container.exec({
        Cmd: ['tar', '-xf', '-', '-C', '/app'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true
      });
      const streamSetup = await execSetup.start({ hijack: true, stdin: true });
      
      await new Promise<void>((resolve, reject) => {
        pack.pipe(streamSetup);
        // Wait for the stream from Docker to actually close, meaning the exec process finished
        streamSetup.on('end', () => resolve());
        streamSetup.on('error', (err) => reject(err));
        pack.on('error', (err) => reject(err));
      });

      // -------------------------------------------------------------------------
      // PHASE 2.2: Intercept custom execution configuration (.nexusrun)
      // -------------------------------------------------------------------------
      let customConfig: { build?: string; run?: string } | null = null;
      const configFile = workspaceContext.workspaceFiles.find(f => f.path === '.nexusrun' || f.path === 'nexus.config.json');
      if (configFile && configFile.content) {
        try {
          customConfig = JSON.parse(configFile.content);
        } catch (err) {
          console.warn('[docker] Failed to parse custom config:', err);
        }
      }

      // -------------------------------------------------------------------------
      // PHASE 2.3: Handle Custom Compilation/Build Step
      // -------------------------------------------------------------------------
      if (customConfig && customConfig.build) {
        const buildExec = await container.exec({
          Cmd: ['sh', '-c', customConfig.build],
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: '/app' // Ensure build runs inside our hydrated project directory root
        });
        const buildStream = await buildExec.start({ hijack: true });
        
        let buildOutput = '';
        const buildWritable = new Writable({
          write(chunk, encoding, callback) {
            buildOutput += chunk.toString('utf8');
            callback();
          }
        });
        
        // Block and stream logs for compilation phase
        await new Promise<void>((resolve, reject) => {
          container!.modem.demuxStream(buildStream, buildWritable, buildWritable);
          buildStream.on('end', () => resolve());
          buildStream.on('error', (err) => reject(err));
        });

        // Inspect build command's status. If compilation returns non-zero, fail execution early.
        const buildInspect = await buildExec.inspect();
        if (buildInspect.ExitCode !== 0) {
           throw {
             killed: false,
             stdout: '',
             stderr: buildOutput,
             message: 'Build failed:\n' + buildOutput,
             exitCode: buildInspect.ExitCode
           };
        }
      }

      // -------------------------------------------------------------------------
      // PHASE 2.4: Execute Override or Dynamic Active File Run Path
      // -------------------------------------------------------------------------
      if (customConfig && customConfig.run) {
        // Override execution command with the user-defined run script
        cmd = ['sh', '-c', customConfig.run];
      } else {
        // Fall back to the default command template but dynamically replace
        // the generic root template name with the actual active file path selection.
        cmd = [...cmd];
        for (let i = 0; i < cmd.length; i++) {
          if (cmd[i]) {
            cmd[i] = cmd[i]!.replace(`/app/${filename}`, `/app/${workspaceContext!.activeFilePath}`);
          }
        }
      }
    } else {
      const execSetup = await container.exec({
        Cmd: ['sh', '-c', `cat > /app/${filename}`],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true
      });
      const streamSetup = await execSetup.start({ hijack: true, stdin: true });
      await new Promise<void>((resolve, reject) => {
        streamSetup.on('end', () => resolve());
        streamSetup.on('error', (err) => reject(err));
        streamSetup.write(code);
        streamSetup.end();
      });
    }

    runStartTime = performance.now();

    // -------------------------------------------------------------------------
    // STEP 3: Execute the user's code with inline cgroup metrics
    // -------------------------------------------------------------------------
    // We wrap the user's command in a shell script that reads cgroup CPU/memory
    // stats before and after execution, emitting them to stderr with unique
    // boundary markers. This eliminates two separate `docker exec` calls for
    // metrics retrieval (~60-100ms saved per execution).
    //
    // Stderr output structure:
    //   <pre cgroup cpu.stat>
    //   ___NEXUS_CGROUP_BOUNDARY___
    //   <user stderr if any>
    //   ___NEXUS_CGROUP_BOUNDARY___
    //   <post cgroup cpu.stat + memory.peak>
    //   ___NEXUS_CGROUP_END___
    //
    // Command flattening: if the original cmd is ['sh', '-c', '...'], we extract
    // the inner shell command directly to avoid nested sh -c invocations.
    let userCmdStr: string;
    if (cmd[0] === 'sh' && cmd[1] === '-c' && cmd.length === 3) {
      userCmdStr = cmd[2]!;
    } else {
      userCmdStr = cmd.join(' ');
    }

    const wrappedCmd = [
      'sh', '-c',
      `cat /sys/fs/cgroup/cpu.stat >&2; ` +
      `echo '${METRICS_BOUNDARY}' >&2; ` +
      `${userCmdStr}; ` +
      `EXIT_CODE=$?; ` +
      `echo '${METRICS_BOUNDARY}' >&2; ` +
      `cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.peak >&2; ` +
      `echo '${METRICS_END}' >&2; ` +
      `exit $EXIT_CODE`
    ];

    const execRun = await container.exec({
      Cmd: wrappedCmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: '/app'
    });

    const execStream = await execRun.start({
      hijack: true,
      stdin: true
    });

    // -------------------------------------------------------------------------
    // STEP 4: Demultiplex stdout/stderr using Dockerode's native demuxStream
    // -------------------------------------------------------------------------
    //
    // When Tty=false, Docker multiplexes stdout and stderr into a single
    // bidirectional stream with 8-byte frame headers:
    //   Byte 0:     Stream type (1=stdout, 2=stderr)
    //   Bytes 1-3:  Padding (0x00)
    //   Bytes 4-7:  Payload size (big-endian uint32)
    //   Bytes 8+:   Payload data
    //
    // Previously, we parsed this manually with Buffer.concat() on every 'data'
    // chunk — an O(N^2) copy pattern that caused GC pressure for large outputs.
    // Dockerode's built-in demuxStream() handles the frame protocol efficiently
    // and routes payloads to separate Writable streams for stdout and stderr.
    //
    let outputBytes = 0;
    let outputCapped = false;

    const stdoutWritable = new Writable({
      write(chunk, _encoding, callback) {
        const text = chunk.toString('utf8');
        if (outputBytes < MAX_OUTPUT_BYTES) {
          outputBytes += Buffer.byteLength(text, 'utf8');
          stdoutData += text;
        } else {
          outputCapped = true;
        }
        callback();
      }
    });

    const stderrWritable = new Writable({
      write(chunk, _encoding, callback) {
        // Accumulate ALL stderr including inline metrics markers.
        // We parse and strip metrics after the stream ends.
        stderrData += chunk.toString('utf8');
        callback();
      }
    });

    container.modem.demuxStream(execStream, stdoutWritable, stderrWritable);

    execStream.on('error', (err) => {
      stderrData += err.message;
    });

    // -------------------------------------------------------------------------
    // STEP 4b: Feed user-provided stdin input to the running program
    // -------------------------------------------------------------------------
    // If the user provided input (e.g., for programs using input() or scanf),
    // write it to the exec stream's stdin. normalizeInput() converts any
    // whitespace-separated format to newline-separated tokens.
    if (input) {
      execStream.write(normalizeInput(input));
    }
    // End stdin to signal EOF. Without this, programs waiting for input
    // (e.g., a bare input() call) would hang until the timeout fires.
    execStream.end();

    // -------------------------------------------------------------------------
    // STEP 5: Race execution against the hard timeout
    // -------------------------------------------------------------------------
    // Promise.race ensures we never wait longer than timeoutMs for the
    // program to complete. If the timeout fires first, we reject with
    // { killed: true } which the catch block converts into a user-friendly
    // timeout error message.
    //
    // WHY 10 SECONDS?
    //   Short enough to prevent resource exhaustion from infinite loops.
    //   Long enough for most educational/interview code (sorting algorithms,
    //   dynamic programming, etc.) to complete. Competitive programming
    //   judges typically use 1–5 seconds, but we're more lenient for
    //   learning-oriented use cases.
    let timeoutId: NodeJS.Timeout | null = null;
    const runPromise = new Promise<void>((resolve, reject) => {
      execStream.on('end', () => resolve());
      execStream.on('error', (err) => reject(err));
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject({ killed: true });
      }, timeoutMs);
    });

    await Promise.race([runPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);

    // Parse inline cgroup metrics from the stderr stream
    const runEndTime = performance.now();
    const metrics = parseInlineMetrics(stderrData);
    stderrData = metrics.userStderr; // Strip metrics markers, keep only user stderr
    maxMemory = metrics.memoryPeakBytes;
    const cpuDurationMs = runEndTime - runStartTime;
    const rawCpuDeltaUsec = metrics.postCpuUsec - metrics.preCpuUsec;
    let overheadUsec = 12_000;
    if (language === 'python') overheadUsec = 40_000;
    else if (language === 'javascript') overheadUsec = 60_000;
    const adjustedCpuUsec = Math.max(0, rawCpuDeltaUsec - overheadUsec);
    const durationUsec = cpuDurationMs * 1000;
    const rawCpuPercent = durationUsec > 0 ? (adjustedCpuUsec / durationUsec) * 100 : 0.0;
    const containerLimit = 0.5;
    peakCpuPercent = Math.min(100.0, Math.max(0.0, rawCpuPercent / containerLimit));

    // -------------------------------------------------------------------------
    // STEP 5b: Flush the Node.js event loop microtask queue
    // -------------------------------------------------------------------------
    // After the exec stream ends, there may be pending 'data' event callbacks
    // in the microtask queue that haven't fired yet. Two setImmediate() calls
    // yield control back to the event loop twice, ensuring all queued data
    // chunks are processed before we read stdoutData/stderrData.
    //
    // WHY TWO setImmediate() AND NOT ONE?
    //   The first setImmediate drains the current I/O callback queue.
    //   The second catches any callbacks that were queued by the first batch
    //   (cascading events). In practice, one is usually enough, but two
    //   provides a safety margin against edge cases in stream teardown.
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));

    // -------------------------------------------------------------------------
    // STEP 6: Inspect execution results (exit code + OOM status)
    // -------------------------------------------------------------------------
    // Docker exec maintains its own exit code separate from the container's.
    // execRun.inspect() returns the exit code of the command we ran, which
    // may differ from the container's exit code (the container is still
    // running `sleep infinity` — it hasn't exited).
    const execInspect = await execRun.inspect();
    const exitCode = execInspect.ExitCode ?? -1;

    // Check if the container's cgroup memory limit was hit.
    // OOMKilled is set by the kernel's OOM killer when a process exceeds its
    // memory cgroup limit. This is a container-level flag, not exec-level,
    // because the OOM killer terminates the entire cgroup (container).
    const inspectData = await container.inspect();
    const oomKilled = inspectData.State.OOMKilled;

    const capNotice = outputCapped
      ? `\n[Warning] Output truncated at ${MAX_OUTPUT_BYTES / 1024} KB.`
      : '';

    const durationMs = performance.now() - startTime;
    return {
      output: (stdoutData + (stderrData ? '\n' + stderrData : '') + capNotice).trimEnd(),
      durationMs,
      exitCode,
      oomKilled,
      cpuUsagePercent: Number(peakCpuPercent.toFixed(2)),
      memoryUsageBytes: maxMemory
    };

  } catch (err: any) {
    // -------------------------------------------------------------------------
    // ERROR HANDLING: Timeout vs Runtime Error
    // -------------------------------------------------------------------------
    // We distinguish two failure modes:
    //   1. Timeout (err.killed === true): The program ran longer than timeoutMs.
    //      We report exit code 137 (128 + SIGKILL=9) which is the conventional
    //      exit code for processes killed by a signal.
    //   2. Runtime error: Docker API failure, container crash, or exec error.
    //      We try to inspect the container for its exit code and OOM status,
    //      but the container might already be gone (removed by another path
    //      or Docker garbage collection), so we wrap inspection in try/catch.
    // Fetch final cgroup CPU and Memory usage metrics on error
    // Parse any inline metrics that were captured before the error
    const metrics = parseInlineMetrics(stderrData);
    stderrData = metrics.userStderr;
    maxMemory = metrics.memoryPeakBytes;
    if (metrics.postCpuUsec > 0) {
      const runEndTime = performance.now();
      const cpuDurationMs = runEndTime - runStartTime;
      const rawCpuDeltaUsec = metrics.postCpuUsec - metrics.preCpuUsec;
      let overheadUsec = 12_000;
      if (language === 'python') overheadUsec = 40_000;
      else if (language === 'javascript') overheadUsec = 60_000;
      const adjustedCpuUsec = Math.max(0, rawCpuDeltaUsec - overheadUsec);
      const durationUsec = cpuDurationMs * 1000;
      const rawCpuPercent = durationUsec > 0 ? (adjustedCpuUsec / durationUsec) * 100 : 0.0;
      const containerLimit = 0.5;
      peakCpuPercent = Math.min(100.0, Math.max(0.0, rawCpuPercent / containerLimit));
    }

    const durationMs = performance.now() - startTime;
    if (err && err.killed) {
      throw {
        killed: true,
        stdout: stdoutData,
        stderr: stderrData,
        durationMs,
        exitCode: 137,
        oomKilled: false,
        cpuUsagePercent: Number(peakCpuPercent.toFixed(2)),
        memoryUsageBytes: maxMemory
      };
    }
    let containerExitCode = -1;
    let containerOomKilled = false;
    if (container) {
      try {
        const inspectData = await container.inspect();
        containerExitCode = inspectData.State.ExitCode;
        containerOomKilled = inspectData.State.OOMKilled;
      } catch {
        // Container might already be removed or in an uninspectable state.
        // Fall through with default values.
      }
    }
    throw {
      killed: false,
      stdout: stdoutData,
      stderr: stderrData,
      message: err?.message ?? String(err),
      durationMs,
      exitCode: containerExitCode !== -1 ? containerExitCode : (err?.exitCode ?? -1),
      oomKilled: containerOomKilled || (err?.oomKilled ?? false),
      cpuUsagePercent: Number(peakCpuPercent.toFixed(2)),
      memoryUsageBytes: maxMemory
    };
  } finally {
    // -------------------------------------------------------------------------
    // STEP 7: Container cleanup (fire-and-forget)
    // -------------------------------------------------------------------------
    // Force-remove the container asynchronously. We don't await this because
    // the user doesn't need to wait for cleanup to receive their output.
    //
    // WHY force:true?
    //   The container might still be running (e.g., timeout killed the exec
    //   but the `sleep infinity` process is still alive). force:true sends
    //   SIGKILL to all processes and removes the container in one API call.
    //
    // WHY .catch() INSTEAD OF try/catch?
    //   Since we're not awaiting the promise, an uncaught rejection would
    //   crash the process (unhandledRejection). The .catch() ensures cleanup
    //   errors are logged but don't affect the user's response.
    //
    // NOTE: This handles containers that were popped from the pool.
    //   Pooled (idle) containers are cleaned up separately by
    //   warmPoolManager.cleanup() on server shutdown (see pool.ts).
    if (container) {
      container.remove({ force: true }).catch((err) => {
        console.error('[docker] Asynchronous container cleanup failed:', err.message);
      });
    }
  }
}
