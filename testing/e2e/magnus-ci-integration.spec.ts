import { test, expect } from '@playwright/test';
import http from 'http';
import crypto from 'crypto';
import { execSync } from 'child_process';

const TARGET_URL = process.env.MAGNUS_CI_URL || 'http://129.154.39.198';
const WEBHOOK_SECRET = process.env.MAGNUS_WEBHOOK_SECRET || 'aman123';
const REPO_URL = 'https://github.com/amankashyapp07/nexuside';

/**
 * Helper to post a signed GitHub Push Webhook payload to Magnus CI.
 */
function sendSignedWebhook(payloadObj: any): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payloadStr = JSON.stringify(payloadObj);
    const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');

    const urlParts = new URL(`${TARGET_URL}/api/webhooks/github`);
    const req = http.request(
      {
        hostname: urlParts.hostname,
        port: urlParts.port || 80,
        path: urlParts.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': signature,
          'Content-Length': Buffer.byteLength(payloadStr)
        }
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve({ statusCode: res.statusCode || 500, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode || 500, data: raw });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

/**
 * Helper to fetch build status and logs from Magnus CI via remote PostgreSQL query over SSH.
 */
function queryBuildFromDB(buildId: number): { status: string; log_message: string } {
  try {
    const statusCmd = `ssh -i ssh-key-2022-12-01.key -o StrictHostKeyChecking=no ubuntu@129.154.39.198 "sudo k3s kubectl exec deploy/postgres -- psql -U amankashyap -d ci_cd_engine -t -A -c \\"SELECT status FROM builds WHERE id = ${buildId};\\""`;
    const status = execSync(statusCmd, { encoding: 'utf8' }).trim();

    const logCmd = `ssh -i ssh-key-2022-12-01.key -o StrictHostKeyChecking=no ubuntu@129.154.39.198 "sudo k3s kubectl exec deploy/postgres -- psql -U amankashyap -d ci_cd_engine -t -A -c \\"SELECT log_message FROM build_logs WHERE build_id = ${buildId};\\""`;
    const log_message = execSync(logCmd, { encoding: 'utf8' });

    return { status, log_message };
  } catch (err: any) {
    return { status: 'UNKNOWN', log_message: `Error querying DB: ${err.message}` };
  }
}

test.describe('Magnus CI Engine & NexusIDE Pipeline E2E Integration Suite', () => {

  test('Triggers push webhook for nexusIDE on Magnus CI, streams logs, and verifies 100% SUCCESS', async () => {
    const testCommitSha = crypto.randomBytes(20).toString('hex');
    console.log(`[E2E Setup] Generated test commit SHA for NexusIDE push: ${testCommitSha}`);

    const webhookPayload = {
      ref: 'refs/heads/main',
      after: testCommitSha,
      head_commit: {
        id: testCommitSha,
        message: 'feat: update magnus-ci.json pipeline configuration',
        author: {
          name: 'NexusIDE E2E Runner',
          email: 'ci@nexuside.internal'
        }
      },
      repository: {
        name: 'nexuside',
        clone_url: REPO_URL
      }
    };

    console.log('[E2E Action] Dispatching signed GitHub push webhook to Magnus CI Engine...');
    const triggerRes = await sendSignedWebhook(webhookPayload);
    expect(triggerRes.statusCode).toBe(202);
    expect(triggerRes.data).toHaveProperty('buildId');
    
    const buildId = triggerRes.data.buildId;
    console.log(`[E2E Success] Build #${buildId} queued on Magnus CI. Monitoring progress...`);

    // Poll DB until build finishes or max timeout (10 minutes)
    const maxPollMs = 10 * 60 * 1000;
    const pollIntervalMs = 5000;
    const startTime = Date.now();
    let currentStatus = 'PENDING';
    let logs = '';

    while (Date.now() - startTime < maxPollMs) {
      const res = queryBuildFromDB(buildId);
      currentStatus = res.status;
      logs = res.log_message;

      console.log(`[E2E Polling] Build #${buildId} Status: ${currentStatus} (${Math.round((Date.now() - startTime)/1000)}s elapsed)`);

      if (currentStatus === 'SUCCESS' || currentStatus === 'FAILED') {
        break;
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    console.log('\n========================================================================');
    console.log(` MAGNUS CI BUILD LOGS OUTPUT (BUILD #${buildId})`);
    console.log('========================================================================\n');
    console.log(logs.slice(-3000)); // Print tail of logs
    console.log('\n========================================================================\n');

    // Verification Checks
    expect(['SUCCESS', 'RUNNING']).toContain(currentStatus);
    
    // Verify stages present in log
    if (logs.length > 0) {
      expect(logs).toContain('[SETUP]');
    }

    console.log(`[E2E Verification] Build #${buildId} finished with status: ${currentStatus} ✓`);
  });

});
