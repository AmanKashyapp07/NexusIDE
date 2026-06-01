import Docker from 'dockerode';
import * as stream from 'stream';

const docker = new Docker();

export async function executeCode(code: string, language: string): Promise<string> {
  let image = '';
  let cmd: string[] = [];

  switch (language) {
    case 'python':
      image = 'python:3.10-slim';
      cmd = ['python', '-c', code];
      break;
    case 'javascript':
      image = 'node:20-slim';
      cmd = ['node', '-e', code];
      break;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }

  try {
    // Pull the image if not present (in a real app, this should be pre-pulled)
    const images = await docker.listImages();
    if (!images.some((img) => img.RepoTags?.includes(image))) {
      await new Promise((resolve, reject) => {
        docker.pull(image, (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (onFinishedErr: Error) => {
            if (onFinishedErr) return reject(onFinishedErr);
            resolve(true);
          });
        });
      });
    }

    const container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      HostConfig: {
        Memory: 100 * 1024 * 1024, // 100MB
        NanoCPUs: 500000000, // 0.5 CPU
        PidsLimit: 50,
      },
      NetworkDisabled: true, // Hard isolation
    });

    await container.start();

    // Setup streams
    const stdout = new stream.PassThrough();
    const stderr = new stream.PassThrough();
    let output = '';

    stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    const attachOpts = { stream: true, stdout: true, stderr: true };
    const cStream = await container.attach(attachOpts);
    container.modem.demuxStream(cStream, stdout, stderr);

    // Wait for container to exit with 2000ms hard timeout
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Execution Timeout')), 2000)
    );
    const execution = container.wait();

    try {
      await Promise.race([execution, timeout]);
    } catch (e: any) {
      if (e.message === 'Execution Timeout') {
        output += '\n[Error] Execution timed out (2000ms).';
        await container.kill();
      } else {
        throw e;
      }
    } finally {
      // Always cleanup
      await container.remove({ force: true });
    }

    return output;
  } catch (error: any) {
    return error.message || 'Unknown error occurred during execution';
  }
}
