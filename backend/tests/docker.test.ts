import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { getPool } from '../src/db';
import { warmPoolManager } from '../src/sandbox/pool';

describe('Docker Sandbox API', () => {
  const testUser = {
    username: `docker_testuser_${Date.now()}`,
    email: `docker_test_${Date.now()}@example.com`,
    password: 'password123'
  };

  let token: string;
  let workspaceId: string;
  
  // File IDs for various languages
  let pythonFileId: string;
  let jsFileId: string;
  let bashFileId: string;
  let cppFileId: string;
  let javaFileId: string;

  beforeAll(async () => {
    // 1. Create user & get token
    const resAuth = await request(app).post('/api/auth/register').send(testUser);
    token = resAuth.body.token;

    // 2. Create workspace
    const resWs = await request(app)
      .get('/api/workspace/default')
      .set('Authorization', `Bearer ${token}`);
    workspaceId = resWs.body.id;

    // 3. Helper to create files
    const createFile = async (name: string, language: string) => {
      const res = await request(app)
        .post(`/api/workspace/${workspaceId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name, type: 'file', language });
      return res.body.id;
    };

    // 4. Initialize files for multi-language testing
    pythonFileId = await createFile('test.py', 'python');
    jsFileId = await createFile('test.js', 'javascript');
    bashFileId = await createFile('test.sh', 'bash');
    cppFileId = await createFile('main.cpp', 'cpp');
    javaFileId = await createFile('Main.java', 'java');

    // 5. Initialize warm pool for execution tests
    await warmPoolManager.initializePools();
  });

  afterAll(async () => {
    await warmPoolManager.cleanup();
    await getPool().query('DELETE FROM users WHERE email = $1', [testUser.email]);
  });

  // --- STANDARD LANGUAGE EXECUTION TESTS ---

  it('should execute Python code and return output with metrics', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'print("Hello from Docker Python Test!")',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Hello from Docker Python Test!');
    expect(res.body.metrics.exitCode).toBe(0);
    expect(res.body.metrics.oomKilled).toBe(false);
  }, 15000);

  it('should execute JavaScript (Node.js) code', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'console.log("Hello from Docker JS Test!");',
        language: 'javascript',
        input: '',
        fileName: 'test.js',
        fileId: jsFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Hello from Docker JS Test!');
    expect(res.body.metrics.exitCode).toBe(0);
  }, 15000);

  it('should execute Bash scripts', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'echo "Hello from Docker Bash Test!"',
        language: 'bash',
        input: '',
        fileName: 'test.sh',
        fileId: bashFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Hello from Docker Bash Test!');
    expect(res.body.metrics.exitCode).toBe(0);
  }, 15000);

  it('should compile and execute C++ code', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: '#include <iostream>\nusing namespace std;\nint main() { cout << "Hello from C++!"; return 0; }',
        language: 'cpp',
        input: '',
        fileName: 'main.cpp',
        fileId: cppFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Hello from C++!');
    expect(res.body.metrics.exitCode).toBe(0);
  }, 20000); // Compilation might take slightly longer

  it('should compile and execute Java code', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from Java!");\n  }\n}',
        language: 'java',
        input: '',
        fileName: 'Main.java',
        fileId: javaFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Hello from Java!');
    expect(res.body.metrics.exitCode).toBe(0);
  }, 20000);

  // --- STDIN & RUNTIME ERROR TESTS ---

  it('should read multiline STDIN input correctly', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'import sys\ndata = sys.stdin.read().strip()\nprint(f"Input received:\\n{data}")',
        language: 'python',
        input: 'Line 1\nLine 2',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Input received:\nLine 1\nLine 2');
    expect(res.body.metrics.exitCode).toBe(0);
  }, 15000);

  it('should handle code execution that fails with a runtime error (stderr)', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'import sys\nprint("Before crash")\nsys.stderr.write("Custom error\\n")\nsys.exit(42)',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output).toContain('Before crash');
    expect(res.body.output).toContain('Custom error'); // stderr should be merged or accessible
    expect(res.body.metrics.exitCode).toBe(42);
  }, 15000);

  // --- SYSTEM LIMITS & SECURITY TESTS ---

  it('should timeout and terminate an infinite loop gracefully', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'while True:\n    pass',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.output.toLowerCase()).toContain('timed out'); // Expect your sandbox to append a timeout message
    expect(res.body.metrics.exitCode).not.toBe(0);
  }, 25000); // Allow sufficient time for the sandbox timeout trigger to occur

  it('should restrict excessive memory allocation (OOM Kill)', async () => {
    // Attempting to allocate ~1GB of memory in Python
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'a = []\nwhile True:\n    a.append(" " * 10**6)',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    // Depending on the Docker runtime, it might return exit code 137 (OOM) or 139 (Segfault)
    expect(res.body.metrics.exitCode).not.toBe(0);
    // We check for exit code 137 (SIGKILL) because exec processes killed by kernel OOM might not set container's OOMKilled flag.
    expect(res.body.metrics.exitCode).toBe(137);
  }, 20000);

  it('should truncate or handle massive stdout payloads without crashing', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'for i in range(50000):\n    print("This is a very long log line that tests buffer sizes")',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    expect(res.body.metrics.exitCode).toBe(0);
    // Ensure the payload doesn't exceed a reasonable max length (e.g., 1.5MB since limit is 1MB)
    expect(res.body.output.length).toBeLessThan(1.5 * 1024 * 1024); 
  }, 15000);

  it('should not have network access (Network Isolation)', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'import urllib.request\ntry:\n    urllib.request.urlopen("https://1.1.1.1", timeout=3)\n    print("NETWORK_EXPOSED")\nexcept Exception as e:\n    print("NETWORK_ISOLATED")',
        language: 'python',
        input: '',
        fileName: 'test.py',
        fileId: pythonFileId
      });

    expect(res.status).toBe(200);
    // Assumes your sandbox runs with --network none or isolated networks
    expect(res.body.output).toContain('NETWORK_ISOLATED');
    expect(res.body.output).not.toContain('NETWORK_EXPOSED');
  }, 15000);

  it('should deny writing to root filesystem directories (Permissions)', async () => {
    const res = await request(app)
      .post(`/api/workspace/${workspaceId}/execute`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'echo "hack" > /etc/hacked.txt && echo "VULNERABLE" || echo "SECURE"',
        language: 'bash',
        input: '',
        fileName: 'test.sh',
        fileId: bashFileId
      });

    expect(res.status).toBe(200);
    // Assumes the container user is non-root
    expect(res.body.output).toContain('SECURE');
    expect(res.body.output).not.toContain('VULNERABLE');
  }, 15000);
});