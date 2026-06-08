import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Docker sandbox execution engine
// Executes user-submitted code inside an ephemeral, resource-limited Docker
// container. Supports Python, JavaScript, C, C++, and Bash.
//
// Security properties:
//   - No network access (NetworkMode: 'none')
//   - Read-only code mount (:ro)
//   - Memory cap: 100 MB
//   - CPU cap: 0.5 vCPU
//   - PID limit: 50 (prevents fork bombs)
//   - Hard execution timeout (default 10 s)
//   - Output size cap: 1 MB (prevents OOM from print-loops)
// ---------------------------------------------------------------------------

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Max bytes we will accumulate from stdout + stderr combined.
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024; // 1 MB

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

// ---------------------------------------------------------------------------
// Logging helper — appends structured execution records to a log file.
// Errors here are non-fatal and do not affect the caller.
// ---------------------------------------------------------------------------
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
  } catch (err) {
    console.error('[docker] Failed to write execution log:', err);
  }
}

// ---------------------------------------------------------------------------
// Normalize stdin input.
//
// Users supply input in many formats:
//   "Aman\n25"  → newline-separated           → already correct
//   "Aman 25"   → space-separated on one line → needs splitting
//   "Aman\n\n25"→ blank lines between values  → needs collapsing
//
// Strategy: tokenise on any contiguous whitespace, then join with '\n'.
// This mirrors how competitive-programming judges feed stdin, where each
// token (word or number) is on its own line.
// ---------------------------------------------------------------------------
function normalizeInput(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function executeCode(
  code: string,
  language: string,
  input?: string
): Promise<string> {
  const config = CONFIGS[language];
  if (!config) {
    return `Error: Unsupported language "${language}". Supported: ${Object.keys(CONFIGS).join(', ')}.`;
  }

  // Write code to a temp file that will be bind-mounted into the container.
  const tempSandboxDir = path.join(process.cwd(), 'temp_sandbox');
  await fs.mkdir(tempSandboxDir, { recursive: true });

  const fileId = crypto.randomUUID();
  const filePath = path.join(tempSandboxDir, `${fileId}_${config.filename}`);

  try {
    await fs.writeFile(filePath, code, 'utf8');
    const result = await runInDocker(config.image, config.cmd, filePath, config.filename, input, 10_000);
    await logRequest(language, code, input, result);
    return result;
  } catch (error: any) {
    const errorMsg = error.killed
      ? (error.stdout || '') + '\n[Error] Execution timed out (10 000 ms).'
      : (error.stdout || '') + (error.stderr || error.message || 'Unknown execution error');
    await logRequest(language, code, input, errorMsg);
    return errorMsg;
  } finally {
    // Always clean up the temp file, even if execution threw.
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore — file may not exist if writeFile itself failed.
    }
  }
}

// ---------------------------------------------------------------------------
// Core Docker runner
//
// Kept as a regular async function (not new Promise(async ...)) to avoid the
// silent-swallow anti-pattern where synchronous throws inside an async Promise
// executor are converted to unhandled rejections.
// ---------------------------------------------------------------------------
async function runInDocker(
  image: string,
  cmd: string[],
  hostFilePath: string,
  containerFileName: string,
  input: string | undefined,
  timeoutMs: number
): Promise<string> {
  let container: Docker.Container | null = null;

  try {
    // ------------------------------------------------------------------
    // 1. Create container with security constraints.
    // ------------------------------------------------------------------
    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      HostConfig: {
        Binds: [`${hostFilePath}:/app/${containerFileName}:ro`],
        Memory: 100 * 1024 * 1024,   // 100 MB hard limit
        MemorySwap: 100 * 1024 * 1024, // disable swap (swap = memory limit)
        NanoCpus: 500_000_000,         // 0.5 vCPU
        PidsLimit: 50,                 // prevent fork bombs
        NetworkMode: 'none',           // no outbound network
        ReadonlyRootfs: false,         // allow /tmp writes inside container
      },
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: true,
      Tty: false   // multiplexed stream mode: Docker prepends 8-byte headers
    });

    // ------------------------------------------------------------------
    // 2. Attach to streams BEFORE starting so we don't miss early output.
    // ------------------------------------------------------------------
    const execStream = await container.attach({
      stream: true,
      hijack: true,
      stdin: true,
      stdout: true,
      stderr: true
    });

    // ------------------------------------------------------------------
    // 3. Demultiplex the Docker stream — manual frame parser.
    //
    // With Tty:false, Docker multiplexes stdout and stderr into a single
    // stream using 8-byte frame headers:
    //   Byte 0    → stream type  (1 = stdout, 2 = stderr)
    //   Bytes 1-3 → reserved, always 0x00
    //   Bytes 4-7 → uint32 BE payload byte count
    //
    // A single TCP chunk can contain MULTIPLE frames back-to-back, so we
    // maintain a running Buffer and parse as many complete frames as are
    // available. Frames with an unknown stream type are discarded silently
    // (this also safely ignores any HTTP metadata that arrives before the
    // first real data frame).
    //
    // We do NOT use docker.modem.demuxStream because it incorrectly pipes
    // the raw HTTP attach response metadata (the options JSON object) into
    // the stdout PassThrough stream before the real data arrives.
    // ------------------------------------------------------------------
    let stdoutData = '';
    let stderrData = '';
    let outputBytes = 0;
    let outputCapped = false;
    let frameBuffer = Buffer.alloc(0);

    execStream.on('data', (chunk: Buffer) => {
      // Accumulate incoming bytes.
      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      // Parse as many complete frames as we have buffered.
      while (frameBuffer.length >= 8) {
        const streamType = frameBuffer[0];           // 1=stdout, 2=stderr
        const payloadSize = frameBuffer.readUInt32BE(4); // bytes 4-7

        // Wait for the full payload to arrive.
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
        // Advance past this frame (header + payload).
        frameBuffer = frameBuffer.slice(8 + payloadSize);
      }
    });

    execStream.on('error', (err) => {
      stderrData += err.message;
    });

    // ------------------------------------------------------------------
    // 4. Start the container.
    // ------------------------------------------------------------------
    await container.start();

    // ------------------------------------------------------------------
    // 5. Write normalised stdin, then close stdin (send EOF).
    // ------------------------------------------------------------------
    if (input) {
      execStream.write(normalizeInput(input));
    }
    execStream.end(); // EOF → processes blocked on input() will unblock

    // ------------------------------------------------------------------
    // 6. Race: container.wait() vs hard timeout.
    //
    // container.wait() resolves the moment the container process exits.
    // After that, we flush two setImmediate ticks so any buffered 'data'
    // events already enqueued in the event loop get processed before we
    // read stdoutData / stderrData.
    //
    // NOTE: We do NOT wait on PassThrough 'end' events here because
    // docker.modem.demuxStream does not end() the PassThrough streams
    // when the source execStream closes — waiting on 'end' would hang forever.
    // ------------------------------------------------------------------
    await Promise.race([
      container.wait(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject({ killed: true }), timeoutMs)
      )
    ]);

    // Two event-loop ticks → all queued 'data' callbacks on stdoutStream /
    // stderrStream have had a chance to run before we read the accumulated strings.
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));

    const capNotice = outputCapped
      ? `\n[Warning] Output truncated at ${MAX_OUTPUT_BYTES / 1024} KB.`
      : '';

    // Return stdout first, then any stderr (compiler errors, runtime tracebacks).
    return (stdoutData + (stderrData ? '\n' + stderrData : '') + capNotice).trimEnd();

  } catch (err: any) {
    // Re-throw in a shape the caller (executeCode) already handles.
    if (err && err.killed) {
      throw { killed: true, stdout: '', stderr: '' };
    }
    throw { killed: false, stdout: '', stderr: '', message: err?.message ?? String(err) };
  } finally {
    // Always remove the container, even if we timed out or threw.
    if (container) {
      try {
        await container.remove({ force: true });
      } catch {
        // Ignore — container may already be gone.
      }
    }
  }
}
