import Docker from 'dockerode';
import * as fs from 'fs/promises';
import * as path from 'path';
import crypto from 'crypto';
import stream from 'stream';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

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

export async function executeCode(code: string, language: string, input?: string): Promise<string> {
  const config = CONFIGS[language];
  if (!config) {
    return `Error: Unsupported language ${language}`;
  }

  // Create temp sandbox dir if not exists
  const tempSandboxDir = path.join(process.cwd(), 'temp_sandbox');
  await fs.mkdir(tempSandboxDir, { recursive: true });

  const fileId = crypto.randomUUID();
  const filePath = path.join(tempSandboxDir, `${fileId}_${config.filename}`);
  
  try {
    await fs.writeFile(filePath, code);

    const result = await runInDocker(config.image, config.cmd, filePath, config.filename, input, 2000);
    return result;
  } catch (error: any) {
    if (error.killed) {
      return (error.stdout || '') + '\n[Error] Execution timed out (2000ms).';
    }
    return (error.stdout || '') + (error.stderr || error.message || 'Unknown execution error');
  } finally {
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

function runInDocker(
  image: string,
  cmd: string[],
  hostFilePath: string,
  containerFileName: string,
  input: string | undefined,
  timeoutMs: number
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let container: Docker.Container | null = null;
    let isFinished = false;
    let stdoutData = '';
    let stderrData = '';

    try {
      container = await docker.createContainer({
        Image: image,
        Cmd: cmd,
        HostConfig: {
          Binds: [`${hostFilePath}:/app/${containerFileName}:ro`],
          Memory: 100 * 1024 * 1024, // 100MB
          NanoCpus: 500000000, // 0.5 CPU
          PidsLimit: 50,
          NetworkMode: 'none'
        },
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: true,
        Tty: false
      });

      const execStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true
      });

      // Pass input
      if (input) {
        execStream.write(input);
      }

      // Capture stdout and stderr
      execStream.on('data', (chunk: Buffer) => {
        if (chunk.length > 8) {
          stdoutData += chunk.slice(8).toString('utf8');
        } else {
          stdoutData += chunk.toString('utf8');
        }
      });

      await container.start();

      let timeoutHandle: NodeJS.Timeout;

      const waitPromise = container.wait();

      timeoutHandle = setTimeout(async () => {
        if (!isFinished && container) {
          isFinished = true;
          try {
            await container.kill();
          } catch (e) {}
          reject({ killed: true, stdout: stdoutData, stderr: stderrData });
        }
      }, timeoutMs);

      await waitPromise;
      clearTimeout(timeoutHandle);

      if (!isFinished) {
        isFinished = true;
        resolve(stdoutData + (stderrData || ''));
      }

    } catch (err: any) {
      if (!isFinished) {
        isFinished = true;
        reject({ killed: false, stdout: stdoutData, stderr: stderrData, message: err.message });
      }
    } finally {
      if (container) {
        try {
          await container.remove({ force: true });
        } catch (e) {}
      }
    }
  });
}
