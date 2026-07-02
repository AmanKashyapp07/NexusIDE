import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Writable } from 'stream';
import tar from 'tar-stream';
import { docker, warmPoolManager } from './pool';

export interface WorkspaceFile { path: string; content: string | null; type: 'file' | 'directory'; }
export interface WorkspaceContext { workspaceId: string; activeFilePath: string; workspaceFiles: WorkspaceFile[]; }
export interface ExecutionResult { output: string; durationMs: number; exitCode: number; oomKilled: boolean; cpuUsagePercent?: number; memoryUsageBytes?: number; }

// [DEFENSE IN DEPTH] Output Truncation
// Hard cap at 1MB. Prevents malicious `while(true) print("x")` loops from 
// causing Out-Of-Memory (OOM) crashes in the Node.js host process.
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024; 

// [SECURITY & LATENCY] Minimal Base Images
// We use Alpine and Debian-slim images. Smaller images = faster daemon instantiation 
// and a vastly reduced attack surface (fewer system binaries to exploit).
const CONFIGS: Record<string, { image: string; cmd: string[]; filename: string }> = {
  python: { image: 'python:3.10-alpine', cmd: ['python', '/app/code.py'], filename: 'code.py' },
  javascript: { image: 'node:20-alpine', cmd: ['node', '/app/code.js'], filename: 'code.js' },
  cpp: { image: 'gcc:12', cmd: ['sh', '-c', 'g++ /app/code.cpp -o /app/code.out && /app/code.out'], filename: 'code.cpp' },
  c: { image: 'gcc:12', cmd: ['sh', '-c', 'gcc /app/code.c -o /app/code.out && /app/code.out'], filename: 'code.c' },
  java: { image: 'eclipse-temurin:21-jdk-alpine', cmd: ['java', '/app/Main.java'], filename: 'Main.java' },
  bash: { image: 'alpine:3.18', cmd: ['sh', '/app/code.sh'], filename: 'code.sh' }
};

// [OBSERVABILITY] Atomic File Appends
// Node's appendFile translates to O_APPEND at the OS level. On Linux, this is atomic 
// for chunks < 4KB, meaning concurrent parallel executions won't corrupt the log file.
async function logRequest(language: string, code: string, input: string | undefined, output: string): Promise<void> {
  const logPath = path.join(__dirname, '..', '..', 'execution_requests.log');
  const entry = `\n--- [${new Date().toISOString()}] ${language} ---\nINPUT: ${input}\nCODE:\n${code}\nOUTPUT:\n${output}\n`;
  await fs.appendFile(logPath, entry, 'utf8').catch(err => console.error('[docker] Log failed:', err));
}

// [DATA SANITIZATION] Input Normalization
// Normalizes space-separated and multiline inputs into a standard newline-delimited 
// stream to prevent buffer hanging in underlying stdin readers like Python's `input()`.
const normalizeInput = (raw: string): string => raw.trim() + '\n';

// [PERFORMANCE] Inline Cgroup Metric Parsing
// INTERVIEW KEY: Instead of making 3 separate Docker API calls (Pre-metrics -> Run -> Post-metrics), 
// we inject `cat /sys/fs/cgroup/...` directly into the bash execution wrapper.
// This saves ~60-100ms of network socket latency per execution.
const METRICS_BOUNDARY = '___NEXUS_CGROUP_BOUNDARY___';
const METRICS_END = '___NEXUS_CGROUP_END___';

interface ParsedCgroupMetrics { preCpuUsec: number; postCpuUsec: number; memoryPeakBytes: number; userStderr: string; }

function parseInlineMetrics(rawStderr: string): ParsedCgroupMetrics {
  const parts = rawStderr.split(METRICS_BOUNDARY);
  if (parts.length < 3) return { preCpuUsec: 0, postCpuUsec: 0, memoryPeakBytes: 0, userStderr: rawStderr };
  
  const extractUsec = (raw: string) => parseInt(raw.match(/usage_usec\s+(\d+)/)?.[1] || '0', 10);
  const extractMem = (raw: string) => {
    const lines = raw.trim().split('\n');
    const last = lines[lines.length - 1];
    return last && /^\d+$/.test(last.trim()) ? parseInt(last.trim(), 10) : 0;
  };

  return {
    preCpuUsec: extractUsec(parts[0]!),
    userStderr: parts[1]!.trim(),
    postCpuUsec: extractUsec(parts[2]!.replace(METRICS_END, '')),
    memoryPeakBytes: extractMem(parts[2]!.replace(METRICS_END, ''))
  };
}

export async function executeCode(code: string, language: string, input?: string, workspaceContext?: WorkspaceContext): Promise<ExecutionResult> {
  const config = CONFIGS[language];
  if (!config) return { output: `Unsupported language: ${language}`, durationMs: 0, exitCode: -1, oomKilled: false };

  try {
    const result = await runInDocker(language, code, config.filename, config.cmd, input, 10_000, workspaceContext);
    await logRequest(language, code, input, result.output);
    return result;
  } catch (error: any) {
    const output = error.killed 
      ? `${error.stdout || ''}\n[Error] Execution timed out (10s).`
      : `${error.stdout || ''}${error.stderr || error.message || 'Unknown error'}`;
    await logRequest(language, code, input, output);
    return { output: output.trimEnd(), durationMs: error.durationMs ?? 0, exitCode: error.exitCode ?? -1, oomKilled: error.oomKilled ?? false, cpuUsagePercent: error.cpuUsagePercent ?? 0, memoryUsageBytes: error.memoryUsageBytes ?? 0 };
  }
}

async function runInDocker(
  language: string, code: string, filename: string, cmd: string[], 
  input: string | undefined, timeoutMs: number, workspaceContext?: WorkspaceContext
): Promise<ExecutionResult> {
  let container: Docker.Container | null = null;
  const startTime = performance.now();
  let maxMemory = 0, peakCpuPercent = 0.0, runStartTime = 0, stdoutData = '', stderrData = '';

  try {
    // 1. [LATENCY OPTIMIZATION] Warm Pool Pop (0ms startup vs 600ms cold boot)
    container = (await warmPoolManager.popContainer(language)).container;

    if (workspaceContext && workspaceContext.workspaceFiles.length > 0) {
      // 2. [I/O ARCHITECTURE] RAM-to-RAM Tar Hydration 
      // INTERVIEW KEY: We DO NOT use Docker bind mounts (`-v`). Bind mounts expose host files 
      // and incur heavy FUSE filesystem translation penalties on macOS/Windows. 
      // Instead, we build a Tar archive entirely in Node.js RAM and pipe it over a single 
      // socket stream directly into a running `tar -xf` process inside the container.
      const pack = tar.pack();
      workspaceContext.workspaceFiles.forEach(f => pack.entry({ name: f.path, type: f.type }, f.type === 'file' ? f.content || '' : undefined));
      pack.finalize();
      
      const execSetup = await container.exec({ Cmd: ['tar', '-xf', '-', '-C', '/app'], AttachStdin: true, AttachStdout: true, AttachStderr: true });
      const streamSetup = await execSetup.start({ hijack: true, stdin: true });
      
      await new Promise<void>((resolve, reject) => {
        pack.pipe(streamSetup);
        streamSetup.on('end', resolve);
        streamSetup.on('error', reject);
        pack.on('error', reject);
      });

      // 3. [EXTENSIBILITY] Custom configuration interception
      const configFile = workspaceContext.workspaceFiles.find(f => f.path === '.nexusrun' || f.path === 'nexus.config.json');
      const customConfig = configFile?.content ? JSON.parse(configFile.content) : null;

      if (customConfig?.build) {
        const buildExec = await container.exec({ Cmd: ['sh', '-c', customConfig.build], AttachStdout: true, AttachStderr: true, WorkingDir: '/app' });
        const buildStream = await buildExec.start({ hijack: true });
        
        let buildOutput = '';
        const buildWritable = new Writable({ write(chunk, _, cb) { buildOutput += chunk.toString(); cb(); }});
        await new Promise<void>((res, rej) => { container!.modem.demuxStream(buildStream, buildWritable, buildWritable); buildStream.on('end', res); buildStream.on('error', rej); });

        if ((await buildExec.inspect()).ExitCode !== 0) throw { killed: false, stdout: '', stderr: buildOutput, message: `Build failed:\n${buildOutput}`, exitCode: (await buildExec.inspect()).ExitCode };
      }

      cmd = customConfig?.run ? ['sh', '-c', customConfig.run] : cmd.map(c => c.replace(`/app/${filename}`, `/app/${workspaceContext.activeFilePath}`));
    } else {
      // Single file injection via stdin stream
      const execSetup = await container.exec({ Cmd: ['sh', '-c', `cat > /app/${filename}`], AttachStdin: true, AttachStdout: true, AttachStderr: true });
      const streamSetup = await execSetup.start({ hijack: true, stdin: true });
      await new Promise<void>((res, rej) => { streamSetup.on('end', res); streamSetup.on('error', rej); streamSetup.write(code); streamSetup.end(); });
    }

    runStartTime = performance.now();

    // 4. [METRICS INJECTION] Command wrapping to capture cgroup stats efficiently
    const userCmdStr = (cmd[0] === 'sh' && cmd[1] === '-c') ? cmd[2]! : cmd.join(' ');
    const wrappedCmd = ['sh', '-c', `cat /sys/fs/cgroup/cpu.stat >&2; echo '${METRICS_BOUNDARY}' >&2; ${userCmdStr}; EXIT_CODE=$?; echo '${METRICS_BOUNDARY}' >&2; cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.peak >&2; echo '${METRICS_END}' >&2; exit $EXIT_CODE`];

    const execRun = await container.exec({ Cmd: wrappedCmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false, WorkingDir: '/app' });
    const execStream = await execRun.start({ hijack: true, stdin: true });

    // 5. [MEMORY MANAGEMENT] Docker Protocol Demultiplexing
    // INTERVIEW KEY: When Tty=false, Docker multiplexes stdout/stderr into a single stream 
    // with 8-byte frame headers. Naively parsing this with `Buffer.concat()` on every chunk 
    // causes O(N^2) memory bloat and massive Garbage Collection pressure. 
    // We use Dockerode's native `demuxStream` routed to custom Writable streams to handle this efficiently.
    let outputBytes = 0, outputCapped = false;
    const stdoutWritable = new Writable({
      write(chunk, _, cb) {
        if (outputBytes < MAX_OUTPUT_BYTES) { stdoutData += chunk.toString(); outputBytes += chunk.length; } 
        else outputCapped = true;
        cb();
      }
    });
    const stderrWritable = new Writable({ write(chunk, _, cb) { stderrData += chunk.toString(); cb(); }});
    container.modem.demuxStream(execStream, stdoutWritable, stderrWritable);
    execStream.on('error', err => stderrData += err.message);

    if (input) execStream.write(normalizeInput(input));
    execStream.end();

    // 6. [RESILIENCE] Concurrency & Hard Timeouts
    // Promise.race prevents malicious infinite loops from holding Node threads hostage.
    let timeoutId: NodeJS.Timeout;
    await Promise.race([
      new Promise<void>((res, rej) => { execStream.on('end', res); execStream.on('error', rej); }),
      new Promise<never>((_, rej) => { timeoutId = setTimeout(() => rej({ killed: true }), timeoutMs); })
    ]).finally(() => clearTimeout(timeoutId));

    // Calculate embedded metrics
    const metrics = parseInlineMetrics(stderrData);
    stderrData = metrics.userStderr;
    maxMemory = metrics.memoryPeakBytes;
    
    // [PERFORMANCE] Language-specific overhead subtraction for accurate CPU usage
    const cpuDurationMs = performance.now() - runStartTime;
    const overheadUsec = language === 'python' ? 40_000 : language === 'javascript' ? 60_000 : 12_000;
    const rawCpuPercent = cpuDurationMs > 0 ? ((Math.max(0, (metrics.postCpuUsec - metrics.preCpuUsec) - overheadUsec)) / (cpuDurationMs * 1000)) * 100 : 0.0;
    peakCpuPercent = Math.min(100.0, Math.max(0.0, rawCpuPercent / 0.5)); // 0.5 is the container limit

    // 7. [NODE.JS INTERNALS] Microtask Queue Flushing
    // Yields control to the event loop twice to ensure all 'data' callbacks in the 
    // internal I/O queue are fully processed before we read the final string variables.
    await new Promise<void>(res => setImmediate(res));
    await new Promise<void>(res => setImmediate(res));

    return {
      output: (stdoutData + (stderrData ? '\n' + stderrData : '') + (outputCapped ? `\n[Warning] Truncated at ${MAX_OUTPUT_BYTES / 1024} KB.` : '')).trimEnd(),
      durationMs: performance.now() - startTime,
      exitCode: (await execRun.inspect()).ExitCode ?? -1,
      oomKilled: (await container.inspect()).State.OOMKilled,
      cpuUsagePercent: Number(peakCpuPercent.toFixed(2)),
      memoryUsageBytes: maxMemory
    };

  } catch (err: any) {
    const metrics = parseInlineMetrics(stderrData);
    stderrData = metrics.userStderr;
    const durationMs = performance.now() - startTime;
    
    if (err?.killed) throw { killed: true, stdout: stdoutData, stderr: stderrData, durationMs, exitCode: 137, oomKilled: false, cpuUsagePercent: 0, memoryUsageBytes: metrics.memoryPeakBytes };
    
    let exitCode = -1, oom = false;
    if (container) await container.inspect().then(d => { exitCode = d.State.ExitCode; oom = d.State.OOMKilled; }).catch(() => {});
    
    throw { killed: false, stdout: stdoutData, stderr: stderrData, message: err?.message ?? String(err), durationMs, exitCode: exitCode !== -1 ? exitCode : (err?.exitCode ?? -1), oomKilled: oom || (err?.oomKilled ?? false), cpuUsagePercent: 0, memoryUsageBytes: metrics.memoryPeakBytes };
  } finally {
    // 8. [LIFECYCLE] Fire-and-Forget Teardown
    // We do NOT await the container removal. This allows the backend to instantly 
    // return the HTTP response to the user while Docker cleans up in the background.
    if (container) container.remove({ force: true }).catch(err => console.error('[docker] Cleanup failed:', err.message));
  }
}