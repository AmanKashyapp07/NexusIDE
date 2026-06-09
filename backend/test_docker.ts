import { executeCode } from './src/sandbox/docker';

async function run() {
  console.log('Testing Python...');
  const pyRes = await executeCode('print("Hello from Docker Python!")', 'python');
  console.log('Python Output:', pyRes.output, '| Metrics:', pyRes.durationMs, 'ms, exitCode:', pyRes.exitCode);

  console.log('Testing Node...');
  const jsRes = await executeCode('console.log("Hello from Docker Node!")', 'javascript');
  console.log('Node Output:', jsRes.output, '| Metrics:', jsRes.durationMs, 'ms, exitCode:', jsRes.exitCode);

  console.log('Testing C++...');
  const cppRes = await executeCode('#include <iostream>\nint main() { std::cout << "Hello from Docker C++!\\n"; return 0; }', 'cpp');
  console.log('C++ Output:', cppRes.output, '| Metrics:', cppRes.durationMs, 'ms, exitCode:', cppRes.exitCode);
}

run().catch(console.error);
