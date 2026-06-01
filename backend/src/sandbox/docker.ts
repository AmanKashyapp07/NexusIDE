import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import crypto from 'crypto';

const execAsync = promisify(exec);

export async function executeCode(code: string, language: string): Promise<string> {
  const tempDir = os.tmpdir();
  const fileId = crypto.randomUUID();
  
  let filePath = '';
  let command = '';

  try {
    if (language === 'python') {
      filePath = path.join(tempDir, `${fileId}.py`);
      await fs.writeFile(filePath, code);
      // Use python3 (standard on Mac/Linux)
      command = `python3 ${filePath}`;
    } else if (language === 'javascript') {
      filePath = path.join(tempDir, `${fileId}.js`);
      await fs.writeFile(filePath, code);
      command = `node ${filePath}`;
    } else if (language === 'cpp') {
      filePath = path.join(tempDir, `${fileId}.cpp`);
      const exePath = path.join(tempDir, `${fileId}.out`);
      await fs.writeFile(filePath, code);
      // Compile and then run
      command = `g++ ${filePath} -o ${exePath} && ${exePath}`;
    } else if (language === 'bash') {
      filePath = path.join(tempDir, `${fileId}.sh`);
      await fs.writeFile(filePath, code);
      command = `bash ${filePath}`;
    } else {
      return `Error: Unsupported language ${language}`;
    }

    // Execute locally with a 2000ms timeout
    const { stdout, stderr } = await execAsync(command, { timeout: 2000 });
    
    return stdout + (stderr || '');
  } catch (error: any) {
    // Check if the process was killed due to the timeout
    if (error.killed && error.signal === 'SIGTERM') {
      return (error.stdout || '') + '\n[Error] Execution timed out (2000ms).';
    }
    return (error.stdout || '') + (error.stderr || error.message || 'Unknown execution error');
  } finally {
    // Always clean up the temporary file
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}
