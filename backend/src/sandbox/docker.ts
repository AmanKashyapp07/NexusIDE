import Docker from 'dockerode';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import crypto from 'crypto';

export interface ExecutionResult {
  output: string;
  durationMs: number;
  exitCode: number;
  oomKilled: boolean;
}


// =============================================================================
// DOCKER SANDBOX EXECUTION ENGINE
// =============================================================================
//
// PURPOSE:
//   Execute untrusted, arbitrary user code safely by isolating it inside an
//   ephemeral Docker container. The container is torn down after every run.
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
//        MNT namespace  → own filesystem mount table; only bind-mounted files
//                         are visible (our code file at /app/code.py)
//        IPC namespace  → isolated shared memory and semaphores
//        UTS namespace  → own hostname and domain name
//   2. cgroups (Control Groups) — limit what a process can *use*:
//        memory         → hard cap on RAM; OOM killer fires if exceeded
//        cpu            → NanoCpus limits CPU time share (CFS scheduler)
//        pids           → max number of processes/threads; blocks fork bombs
//
// SECURITY PROPERTIES OF THIS ENGINE:
//   - No network access (NetworkMode: 'none')         → can't exfiltrate data
//   - Code file mounted read-only (:ro)               → can't self-modify
//   - Memory cap 100 MB + swap disabled               → no OOM bomb
//   - CPU cap 0.5 vCPU                                → can't starve host
//   - PID limit 50                                    → fork bombs contained
//   - Hard timeout 10 s                               → no infinite loops
//   - Output cap 1 MB                                 → no OOM from print loops
//   - Container removed after every run               → no state leaks between users
//
// =============================================================================

const homeDir = process.env.HOME || '';
const defaultMacSocket = path.join(homeDir, '.docker/run/docker.sock');
const finalSocketPath = process.platform === 'darwin' && existsSync(defaultMacSocket)
  ? defaultMacSocket
  : '/var/run/docker.sock';

const docker = new Docker({ socketPath: finalSocketPath });
// The Docker daemon (dockerd) is a long-running background process that manages
// containers on the host. It exposes a REST API over a Unix domain socket at
// /var/run/docker.sock. Unix domain sockets are like TCP sockets but stay
// entirely within the kernel — no network stack overhead, no TCP handshake.
//
// Dockerode communicates with dockerd by sending HTTP requests over this socket.
// For example, creating a container sends:
//   POST /containers/create  { Image: "python:3.10-alpine", Cmd: [...], ... }
//
// Why a socket instead of a TCP port?
//   Security: the socket file is owned by root and the docker group. Access to
//   it grants full control over Docker, equivalent to root on the host. A TCP
//   port would need firewall rules to protect it; a socket file uses Unix
//   permissions natively.

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
// This matches how competitive programming judges (Codeforces, LeetCode) feed
// stdin — all whitespace (spaces, tabs, newlines) is treated equivalently as
// a token separator.
function normalizeInput(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.join('\n') + '\n';
}

// =============================================================================
// PUBLIC API
// =============================================================================
// Entry point called by the Express route handler.
// Orchestrates: temp file creation → container execution → cleanup → logging.
export async function executeCode(
  code: string,
  language: string,
  input?: string
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

  // Write the user's code to a uniquely named temp file.
  //
  // WHY A TEMP FILE INSTEAD OF PASSING CODE VIA ENVIRONMENT VARIABLE OR STDIN?
  //   - Environment variables have a size limit (~128 KB on Linux).
  //   - Passing code via stdin conflicts with the program's own stdin (for input()).
  //   - A file on disk is the cleanest contract: Docker bind-mounts it into the
  //     container at a known path (/app/code.py) read-only (:ro).
  //
  // WHY crypto.randomUUID() IN THE FILENAME?
  //   Concurrent requests could run at the same time. Without a unique prefix,
  //   two Python submissions would both write to "code.py", causing a race
  //   condition where one overwrites the other before the container reads it.
  //   UUID4 gives 122 bits of randomness — collision probability is negligible.
  const tempSandboxDir = path.join(process.cwd(), 'temp_sandbox');
  await fs.mkdir(tempSandboxDir, { recursive: true });
  // { recursive: true } is a no-op if the directory already exists — it does NOT
  // throw EEXIST. Equivalent to `mkdir -p` in shell.

  const fileId = crypto.randomUUID();
  const filePath = path.join(tempSandboxDir, `${fileId}_${config.filename}`);

  try {
    await fs.writeFile(filePath, code, 'utf8');
    const result = await runInDocker(config.image, config.cmd, filePath, config.filename, input, 10_000);
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
      oomKilled: error.oomKilled ?? false
    };
  } finally {
    // The finally block runs whether the try succeeded or threw.
    // This guarantees temp files are always cleaned up — no orphaned files
    // accumulate in temp_sandbox/ even if the container fails to start.
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore — file may not exist if fs.writeFile itself failed above.
    }
  }
}

// =============================================================================
// CORE DOCKER RUNNER
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
// EXECUTION LIFECYCLE:
//   createContainer → attach (get stream handles) → start → write stdin →
//   wait for exit (race vs timeout) → flush event loop → return output
//
async function runInDocker(
  image: string,
  cmd: string[],
  hostFilePath: string,
  containerFileName: string,
  input: string | undefined,
  timeoutMs: number
): Promise<ExecutionResult> {
  let container: Docker.Container | null = null;
  const startTime = performance.now();

  // Hoisted outside try so the catch block can include partial output
  // captured before a timeout or runtime crash.
  let stdoutData = '';
  let stderrData = '';

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Create the container (does NOT start it yet).
    // -------------------------------------------------------------------------
    // docker.createContainer sends: POST /containers/create
    // Docker allocates a container on disk (writable layer on top of the image's
    // read-only layers via overlay2 filesystem) but the process hasn't started.
    //
    // KEY CONFIG FIELDS EXPLAINED:
    //
    // Binds: ["<hostPath>:/app/<file>:ro"]
    //   Bind mount — maps a host filesystem path into the container namespace.
    //   :ro (read-only) means the container process gets EROFS if it tries to
    //   write to /app/code.py, even as root inside the container.
    //   Why read-only? Prevents the code from modifying itself (self-modifying
    //   code attacks, persistence attempts).
    //
    // Memory: 100 MB, MemorySwap: 100 MB
    //   Memory sets the RAM limit. MemorySwap = Memory + swap limit.
    //   Setting both equal → swap = 0 (MemorySwap - Memory = 0).
    //   Without setting MemorySwap, the container could use Memory * 2 of swap,
    //   completely defeating the RAM cap. A code that allocates 100 MB RAM
    //   would spill to swap, surviving past the limit and slowing the host.
    //
    // NanoCpus: 500_000_000 (= 0.5 CPU)
    //   The Linux CFS (Completely Fair Scheduler) allocates CPU time in
    //   100ms periods. 0.5 CPU means the container gets at most 50ms of CPU
    //   per 100ms period. This prevents one container from monopolizing a core.
    //   Unit: 1 CPU = 1,000,000,000 NanoCpus.
    //
    // PidsLimit: 50
    //   Limits the total number of processes + threads in the container's PID
    //   namespace. A fork bomb (`:(){:|:&};:` in bash) works by recursively
    //   forking until the system runs out of PIDs. With PidsLimit=50, it can
    //   only create 50 processes before the kernel refuses fork() with EAGAIN.
    //
    // NetworkMode: 'none'
    //   Creates the container with only a loopback interface (127.0.0.1).
    //   No eth0, no internet routing. connect(), socket() to external IPs fail
    //   with ENETUNREACH. Prevents data exfiltration, outbound HTTP, etc.
    //
    // Tty: false
    //   By default (Tty:true), Docker allocates a pseudo-terminal (PTY) which
    //   merges stdout and stderr into one stream and adds terminal control codes.
    //   Tty:false keeps stdout and stderr separate and uses Docker's multiplexed
    //   stream protocol (8-byte frame headers) — essential for separating
    //   compiler errors (stderr) from program output (stdout).
    //
    // AttachStdin/AttachStdout/AttachStderr + OpenStdin + StdinOnce:
    //   These flags tell Docker to keep the container's stdin pipe open so we
    //   can write input to it after the container starts.
    //   StdinOnce: true → stdin is closed (EOF sent) after the first client
    //   disconnects, which is what we want: write input, call execStream.end(),
    //   and the process receives EOF cleanly.
    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      HostConfig: {
        Binds: [`${hostFilePath}:/app/${containerFileName}:ro`],
        Memory: 100 * 1024 * 1024,     // 100 MB RAM hard limit
        MemorySwap: 100 * 1024 * 1024, // swap = 0 (swap cap = RAM cap → no swap)
        NanoCpus: 500_000_000,         // 0.5 vCPU via Linux CFS scheduler
        PidsLimit: 50,                 // blocks fork bombs at kernel level
        NetworkMode: 'none',           // no network interfaces except loopback
        ReadonlyRootfs: false,         // allow writes to /tmp inside container
      },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,   // keep stdin pipe open so we can write to it
      StdinOnce: true,   // send EOF to process when we call execStream.end()
      Tty: false         // multiplexed stream mode (separate stdout and stderr)
    });

    // -------------------------------------------------------------------------
    // STEP 2: Attach to the container's I/O streams BEFORE starting.
    // -------------------------------------------------------------------------
    // container.attach sends: POST /containers/{id}/attach?stream=1&stdin=1&...
    //
    // WHY ATTACH BEFORE START?
    //   If we started first, the container process could produce output before
    //   our attach call completes. That output would be buffered by Docker but
    //   we might miss it in a race condition. Attaching first guarantees we
    //   have a listener before any data flows.
    //
    // hijack: true — What does it mean?
    //   Normally, HTTP is request/response: client sends request, server replies,
    //   connection closes. "Hijacking" upgrades the HTTP connection to a raw
    //   persistent TCP socket (similar to the WebSocket upgrade mechanism).
    //   After the HTTP upgrade, the socket becomes a bidirectional pipe where
    //   we write to the container's stdin and read its stdout/stderr.
    //
    //   The returned `execStream` IS that raw TCP socket. It is NOT an HTTP
    //   response body — it is a full-duplex stream that stays open until the
    //   container process exits.
    //
    // IMPORTANT: The first bytes on the hijacked socket are NOT real data —
    //   Docker sends its internal metadata JSON ({"stream":true,...}) as part
    //   of the HTTP upgrade. Our frame parser below discards these bytes.
    const execStream = await container.attach({
      stream: true,
      hijack: true,   // upgrade HTTP → raw bidirectional TCP socket
      stdin: true,
      stdout: true,
      stderr: true
    });

    // -------------------------------------------------------------------------
    // STEP 3: Demultiplex Docker's binary stream protocol — manual frame parser.
    // -------------------------------------------------------------------------
    //
    // THE DOCKER STREAM MULTIPLEXING PROTOCOL (Tty:false mode):
    //   When Tty is false, Docker cannot send stdout and stderr as raw bytes on
    //   the same socket (they'd be indistinguishable). Instead it wraps each
    //   write in an 8-byte binary frame header:
    //
    //   ┌──────────┬──────────────────────┬────────────────────────────┐
    //   │ Byte 0   │ Bytes 1-3            │ Bytes 4-7                  │
    //   │ Stream   │ Reserved (0x00 x3)   │ Payload length (uint32 BE) │
    //   │ 1=stdout │                      │                            │
    //   │ 2=stderr │                      │                            │
    //   └──────────┴──────────────────────┴────────────────────────────┘
    //   [payload bytes follow immediately after the 8-byte header]
    //
    //   A single TCP chunk can contain MULTIPLE frames back-to-back:
    //   [header1][payload1][header2][payload2]...
    //
    // WHY NOT USE docker.modem.demuxStream?
    //   Dockerode provides a helper, but with hijack:true it incorrectly pipes
    //   the HTTP upgrade metadata JSON as if it were stdout data — resulting in
    //   the string {"stream":true,...} appearing at the start of program output.
    //
    // OUR MANUAL PARSER STRATEGY:
    //   1. Buffer all incoming chunks into frameBuffer.
    //   2. Scan forward byte-by-byte to find the first valid frame header
    //      signature: [0x01 or 0x02] [0x00] [0x00] [0x00]
    //      → This discards the HTTP metadata bytes at the front.
    //   3. Once aligned, extract frames: read streamType, read payloadSize,
    //      wait for payloadSize bytes, extract payload, route to stdout/stderr.
    //   4. Repeat from step 2 (in case a frame's payload itself starts with
    //      bytes that look like non-frames — step 2 is safe because it only
    //      runs when the buffer is misaligned).
    let outputBytes = 0;
    let outputCapped = false;
    let frameBuffer = Buffer.alloc(0);

    execStream.on('data', (chunk: Buffer) => {
      // Accumulate — TCP is a stream protocol, a single 'data' event may
      // contain a partial frame or multiple complete frames.
      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      // --- Phase A: Skip leading garbage (HTTP upgrade metadata) ---
      // A valid Docker frame starts with [0x01 or 0x02, 0x00, 0x00, 0x00].
      // The JSON metadata starts with '{' (0x7B) which is neither 0x01 nor 0x02,
      // so we scan until we hit the first valid header pattern.
      while (frameBuffer.length >= 4) {
        const b0 = frameBuffer[0];
        if ((b0 === 1 || b0 === 2) &&
            frameBuffer[1] === 0 &&
            frameBuffer[2] === 0 &&
            frameBuffer[3] === 0) {
          break; // Aligned on a valid frame — proceed to Phase B
        }
        frameBuffer = frameBuffer.slice(1); // Discard one garbage byte, retry
      }

      // --- Phase B: Extract complete frames ---
      while (frameBuffer.length >= 8) {
        const streamType  = frameBuffer[0];           // 1=stdout, 2=stderr
        const payloadSize = frameBuffer.readUInt32BE(4); // big-endian uint32

        // Don't try to extract the payload if it hasn't fully arrived yet.
        // TCP segments can be fragmented; wait for next 'data' event.
        if (frameBuffer.length < 8 + payloadSize) break;

        if (streamType === 1 || streamType === 2) {
          const payload = frameBuffer.slice(8, 8 + payloadSize).toString('utf8');
          if (outputBytes < MAX_OUTPUT_BYTES) {
            outputBytes += Buffer.byteLength(payload, 'utf8');
            if (streamType === 1) stdoutData += payload;
            else                  stderrData += payload;
          } else {
            outputCapped = true;
          }
        }
        // Advance past this complete frame (header=8 bytes + payload).
        frameBuffer = frameBuffer.slice(8 + payloadSize);
      }
    });

    execStream.on('error', (err) => {
      // Stream-level errors (e.g. Docker daemon closed the socket unexpectedly).
      // Append to stderr so the user sees what happened.
      stderrData += err.message;
    });

    // -------------------------------------------------------------------------
    // STEP 4: Start the container (this spawns the process).
    // -------------------------------------------------------------------------
    // Sends: POST /containers/{id}/start
    // Docker's containerd shim forks the container init process, which then
    // exec()s into the language runtime (python, node, sh, etc.).
    // At this point the process is running and may immediately produce output.
    await container.start();

    // -------------------------------------------------------------------------
    // STEP 5: Write stdin, then send EOF.
    // -------------------------------------------------------------------------
    // Write normalised input to the container's stdin via the hijacked socket.
    // The container process reads from /dev/stdin (fd 0), which is connected
    // to this socket by Docker.
    //
    // WHY execStream.end() IS CRITICAL:
    //   Python's input() blocks on read(fd=0, ...) until it gets a '\n' OR EOF.
    //   If we never send EOF, a program with N input() calls waits for the
    //   (N+1)th line forever → container hangs until the 10s timeout kills it.
    //   execStream.end() closes the write side of the socket (sends TCP FIN),
    //   which the kernel delivers to the container process as EOF on fd 0.
    if (input) {
      execStream.write(normalizeInput(input));
    }
    execStream.end(); // Send EOF → unblocks any pending input() / scanf / cin

    // -------------------------------------------------------------------------
    // STEP 6: Wait for the container to exit, race vs hard timeout.
    // -------------------------------------------------------------------------
    // container.wait() sends: POST /containers/{id}/wait
    // It is a long-poll HTTP request that blocks until the container's main
    // process exits (returns its exit code). Dockerode resolves the Promise
    // when the HTTP response arrives (i.e., the container exited).
    //
    // TIMEOUT MECHANISM:
    //   We race container.wait() against a setTimeout-backed Promise that
    //   rejects after timeoutMs. Whichever settles first wins:
    //     - container.wait() wins → normal execution
    //     - setTimeout wins      → reject({ killed: true }) → catch block runs
    //       → we throw with accumulated stdoutData (partial output preserved)
    //
    // WHY PRESERVE PARTIAL OUTPUT ON TIMEOUT?
    //   If a program prints "Step 1 done\nStep 2 done\n" then enters an infinite
    //   loop, we still want to return those two lines so the user can debug.
    await Promise.race([
      container.wait(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject({ killed: true }), timeoutMs)
      )
    ]);

    // Inspect container to check exit status code and whether it was OOM killed
    const inspectData = await container.inspect();
    const exitCode = inspectData.State.ExitCode;
    const oomKilled = inspectData.State.OOMKilled;

    // -------------------------------------------------------------------------
    // STEP 7: Flush the Node.js event loop before reading output.
    // -------------------------------------------------------------------------
    // container.wait() resolves when the container PROCESS exits, but the
    // 'data' event callbacks we registered on execStream may still be queued
    // in the Node.js microtask/macrotask queue — not yet executed.
    //
    // Node.js event loop phases (simplified):
    //   timers → I/O callbacks → [poll: wait for I/O] → setImmediate → close
    //
    // setImmediate schedules work in the "check" phase, AFTER all I/O callbacks
    // for the current iteration have run. Two setImmediate ticks ensure:
    //   Tick 1: any pending 'data' callbacks fire (I/O callbacks phase).
    //   Tick 2: any callbacks those triggered also fire.
    // After this, stdoutData and stderrData are fully populated.
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));

    const capNotice = outputCapped
      ? `\n[Warning] Output truncated at ${MAX_OUTPUT_BYTES / 1024} KB.`
      : '';

    const durationMs = performance.now() - startTime;
    return {
      output: (stdoutData + (stderrData ? '\n' + stderrData : '') + capNotice).trimEnd(),
      durationMs,
      exitCode,
      oomKilled
    };

  } catch (err: any) {
    const durationMs = performance.now() - startTime;
    if (err && err.killed) {
      throw { killed: true, stdout: stdoutData, stderr: stderrData, durationMs, exitCode: 137, oomKilled: false };
    }
    let containerExitCode = -1;
    let containerOomKilled = false;
    if (container) {
      try {
        const inspectData = await container.inspect();
        containerExitCode = inspectData.State.ExitCode;
        containerOomKilled = inspectData.State.OOMKilled;
      } catch {
        // Container might not be inspectable
      }
    }
    throw {
      killed: false,
      stdout: stdoutData,
      stderr: stderrData,
      message: err?.message ?? String(err),
      durationMs,
      exitCode: containerExitCode !== -1 ? containerExitCode : (err?.exitCode ?? -1),
      oomKilled: containerOomKilled || (err?.oomKilled ?? false)
    };
  } finally {
    // -----------------------------------------------------------------------
    // CLEANUP: Force-remove the container regardless of outcome.
    // -----------------------------------------------------------------------
    // { force: true } is equivalent to `docker rm -f` — it stops a running
    // container AND removes it. Without force:true, removing a running
    // container would fail with "container still running" error.
    //
    // WHY IN finally AND NOT IN try?
    //   try runs on success, catch runs on error — neither runs if the other
    //   throws. Only finally is guaranteed to execute in ALL cases (success,
    //   timeout, crash, thrown error from catch itself).
    //   Without this, timed-out containers would accumulate on the host,
    //   consuming disk space (overlay2 layers) and eventually exhausting
    //   Docker's container limit.
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Ignore — container may already be gone if Docker killed it itself
        // (e.g. OOM killer fired inside the container).
      }
    }
  }
}
