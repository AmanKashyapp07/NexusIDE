import { executeCode } from './src/sandbox/docker';

async function run() {
  console.log('Testing Bash...');
  const res = await executeCode('echo "Hello from Bash" >&2; ls -la /app; cat /app/code.sh', 'bash');
  console.log('Bash Output:', JSON.stringify(res));
}

run().catch(console.error);
