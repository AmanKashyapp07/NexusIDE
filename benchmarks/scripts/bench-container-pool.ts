import { performance } from 'perf_hooks';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as net from 'net';
import Docker from 'dockerode';

// Direct production import
import { warmPoolManager, docker, WORKSPACE_DATA_DIR } from '../../backend/src/sandbox/pool.js';

import { Statistics } from '../common/statistics.mjs';
import { CleanupManager } from '../common/cleanup.mjs';
import { Assertions } from '../common/assertions.mjs';
import { BenchmarkLogger } from '../common/logger.mjs';
import { detectEnvironment } from '../common/environment.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TERMINAL_IMAGE = 'sandbox-dev-env:latest';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Helper to provision container using exact production pool parameters
async function createExactProductionContainer(namePrefix: string) {
  const hostPort = await getFreePort();
  const HISTORY_DIR = path.join(WORKSPACE_DATA_DIR, '..', 'terminal_history');
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  if (!fs.existsSync(WORKSPACE_DATA_DIR)) fs.mkdirSync(WORKSPACE_DATA_DIR, { recursive: true });

  const container = await docker.createContainer({
    Image: TERMINAL_IMAGE,
    Cmd: ['sh', '-c', 'sleep infinity'],
    name: `${namePrefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      PortBindings: { '3000/tcp': [{ HostPort: String(hostPort) }] },
      Memory: 1024 * 1024 * 1024,
      MemorySwap: 1024 * 1024 * 1024,
      NanoCpus: 1_500_000_000,
      PidsLimit: 500,
      ReadonlyRootfs: false,
      Tmpfs: { '/tmp': 'rw,exec,size=256m' },
      Binds: [
        `${HISTORY_DIR}:/history`,
        `${WORKSPACE_DATA_DIR}:/workspaces`
      ]
    },
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: true
  });

  await container.start();
  return container;
}

// Helper to wait until background replenishment finishes
async function waitForReplenishmentComplete(manager: any, timeoutMs = 15000) {
  const start = performance.now();
  while (manager.replenishingTerminal) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for pool replenishment to complete (${timeoutMs} ms)`);
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

async function run() {
  BenchmarkLogger.header('Benchmark 7: Docker Container Pool (Production Lifecycle Audit)');
  const env = await detectEnvironment();

  if (!env.services.docker.available) {
    BenchmarkLogger.error('SKIPPED: REQUIRED INFRASTRUCTURE UNAVAILABLE (Docker daemon unreachable)');
    process.exit(1);
  }

  BenchmarkLogger.info(`Connected to Docker Engine v${env.services.docker.version} at ${env.services.docker.socket}`);

  const trackedContainerIds: string[] = [];
  const results: any = {};

  try {
    // Verify base image exists
    const imageInfo = await docker.getImage(TERMINAL_IMAGE).inspect();
    BenchmarkLogger.success(`Docker image verified: ${TERMINAL_IMAGE} (ID: ${imageInfo.Id.slice(7, 19)})`);

    // =========================================================================
    // 1. COLD PROVISIONING: Measure 5 separate cold container starts
    // =========================================================================
    BenchmarkLogger.section('1. Cold Container Provisioning (5 Trials)');
    const coldSamples: number[] = [];

    for (let trial = 0; trial < 5; trial++) {
      const t0 = performance.now();
      const container = await createExactProductionContainer(`bench-cold-${trial}`);
      trackedContainerIds.push(container.id);

      const inspect = await container.inspect();
      Assertions.assertEqual(inspect.State.Running, true, 'Cold container must be running');
      const elapsed = performance.now() - t0;
      coldSamples.push(Number(elapsed.toFixed(2)));
      console.log(`  Trial ${trial + 1}: Cold container created and started in ${elapsed.toFixed(2)} ms`);
    }

    const coldStats = Statistics.summarize(coldSamples);
    results['coldProvisioning'] = {
      samplesMs: coldSamples,
      stats: coldStats
    };
    console.log(`  Cold Provisioning (n=5): Median ${coldStats.median.toFixed(2)} ms | Mean ${coldStats.mean.toFixed(2)} ms | p95 ${coldStats.p95.toFixed(2)} ms`);

    // =========================================================================
    // 2. WARM ALLOCATION: Measure 5 repeated warm checkouts with state verification
    // =========================================================================
    BenchmarkLogger.section('2. True Warm Pool Allocation (5 Repeated Checkouts)');

    // Ensure pool is initialized
    await warmPoolManager.initializePools();
    await waitForReplenishmentComplete(warmPoolManager);

    const warmCheckoutSamples: number[] = [];
    const checkedOutWarmContainers: any[] = [];

    for (let trial = 0; trial < 5; trial++) {
      // Ensure pool has at least 1 warm container
      await waitForReplenishmentComplete(warmPoolManager);
      if ((warmPoolManager as any).terminalPool.length === 0) {
        await (warmPoolManager as any).fillTerminalPool();
        await waitForReplenishmentComplete(warmPoolManager);
      }

      const poolLengthBefore = (warmPoolManager as any).terminalPool.length;
      Assertions.assert(poolLengthBefore > 0, `Pool must contain a warm container (was ${poolLengthBefore})`);

      const t0 = performance.now();
      const warmContainer = await warmPoolManager.popTerminalContainer();
      const elapsed = performance.now() - t0;

      // Verify checkout was genuinely warm (< 15ms)
      Assertions.assert(elapsed < 15, `Warm checkout must be < 15ms, took ${elapsed}ms`);

      warmCheckoutSamples.push(Number(elapsed.toFixed(4)));
      checkedOutWarmContainers.push(warmContainer);
      trackedContainerIds.push(warmContainer.id);

      console.log(`  Warm Trial ${trial + 1} (pool depth was ${poolLengthBefore}): Checked out in ${elapsed.toFixed(4)} ms (ID: ${warmContainer.id.slice(0, 12)})`);

      // Wait for background refill triggered by pop to finish before next trial
      await waitForReplenishmentComplete(warmPoolManager);
    }

    const warmStats = Statistics.summarize(warmCheckoutSamples);
    results['warmCheckout'] = {
      samplesMs: warmCheckoutSamples,
      stats: warmStats,
      verifiedPrewarmed: true
    };
    console.log(`  Warm Checkout Summary (n=5): Median ${warmStats.median.toFixed(4)} ms | Mean ${warmStats.mean.toFixed(4)} ms | Min ${warmStats.min.toFixed(4)} ms | Max ${warmStats.max.toFixed(4)} ms`);

    // =========================================================================
    // 3. POOL EXHAUSTION & FALLBACK: 5 Repeated On-Demand Trials with Pool Drain
    // =========================================================================
    BenchmarkLogger.section('3. Pool Exhaustion & On-Demand Fallback (5 Verified Trials)');

    const fallbackSamples: number[] = [];

    for (let trial = 0; trial < 5; trial++) {
      // 1. Wait for any in-flight background replenishment to complete
      await waitForReplenishmentComplete(warmPoolManager);

      // 2. Explicitly drain every container in terminalPool to guarantee depth 0
      while ((warmPoolManager as any).terminalPool.length > 0) {
        const c = (warmPoolManager as any).terminalPool.pop();
        if (c) {
          checkedOutWarmContainers.push(c);
          trackedContainerIds.push(c.id);
        }
      }

      Assertions.assertEqual((warmPoolManager as any).terminalPool.length, 0, 'Pool must be strictly empty before fallback measurement');
      Assertions.assertEqual((warmPoolManager as any).replenishingTerminal, false, 'No background replenishment should be in progress');

      // 3. Measure on-demand fallback allocation
      const t0 = performance.now();
      const fallbackContainer = await warmPoolManager.popTerminalContainer();
      const elapsed = performance.now() - t0;

      // Verify allocation was a genuine fresh container start (> 30ms)
      Assertions.assert(elapsed > 30, `On-demand fallback must be a real Docker container creation (>30ms), took ${elapsed}ms`);

      fallbackSamples.push(Number(elapsed.toFixed(2)));
      checkedOutWarmContainers.push(fallbackContainer);
      trackedContainerIds.push(fallbackContainer.id);

      console.log(`  Fallback Trial ${trial + 1} (verified pool depth: 0): Created fresh container in ${elapsed.toFixed(2)} ms (ID: ${fallbackContainer.id.slice(0, 12)})`);

      // 4. Wait for background replenishment triggered by this pop to complete before next trial
      await waitForReplenishmentComplete(warmPoolManager);
    }

    const fallbackStats = Statistics.summarize(fallbackSamples);
    results['onDemandFallback'] = {
      samplesMs: fallbackSamples,
      stats: fallbackStats,
      verifiedEmptyPoolBeforeEachPop: true
    };
    console.log(`  On-Demand Fallback Summary (n=5): Median ${fallbackStats.median.toFixed(2)} ms | Mean ${fallbackStats.mean.toFixed(2)} ms | Min ${fallbackStats.min.toFixed(2)} ms | Max ${fallbackStats.max.toFixed(2)} ms`);

    // =========================================================================
    // 4. COMPARISON ANALYSIS (Statistically Defensible)
    // =========================================================================
    BenchmarkLogger.section('4. Honest Allocation Comparison');
    const warmVsColdRatio = Number((coldStats.median / warmStats.median).toFixed(1));
    const warmVsColdReductionPct = Number(((1 - (warmStats.median / coldStats.median)) * 100).toFixed(2));
    const onDemandVsColdDiffPct = Number(((Math.abs(fallbackStats.median - coldStats.median) / coldStats.median) * 100).toFixed(2));

    results['comparison'] = {
      coldMedianMs: coldStats.median,
      warmCheckoutMedianMs: warmStats.median,
      onDemandFallbackMedianMs: fallbackStats.median,
      warmCheckoutSpeedupVsCold: warmVsColdRatio,
      warmCheckoutLatencyReductionPct: warmVsColdReductionPct,
      onDemandMatchesColdProvisioning: onDemandVsColdDiffPct < 30
    };

    console.log(`  • Cold Provisioning (n=5):  ${coldStats.median.toFixed(2)} ms median`);
    console.log(`  • On-Demand Fallback (n=5): ${fallbackStats.median.toFixed(2)} ms median`);
    console.log(`  • Warm Checkout (n=5):      ${warmStats.median.toFixed(4)} ms median`);
    console.log(`  • Measured Speedup: Warm checkout is ${warmVsColdRatio}x faster than cold provisioning (${warmVsColdReductionPct}% latency eliminated).`);
    console.log(`  • Degradation finding: When pool is depleted, allocation falls back to ~${fallbackStats.median.toFixed(0)} ms on-demand container boot without throwing or deadlocking.`);

  } finally {
    // Teardown and deterministic cleanup
    BenchmarkLogger.section('Teardown & Deterministic Cleanup');
    
    // 1. Permanently deactivate pool replenishment to prevent async spawns during teardown
    (warmPoolManager as any).fillTerminalPool = async () => {};
    (warmPoolManager as any).replenishingTerminal = false;

    // 2. Collect any remaining warm containers in terminalPool
    while ((warmPoolManager as any).terminalPool && (warmPoolManager as any).terminalPool.length > 0) {
      const c = (warmPoolManager as any).terminalPool.pop();
      if (c && c.id) trackedContainerIds.push(c.id);
    }

    // 3. Force-remove all explicitly tracked container IDs
    let removedCount = 0;
    const uniqueIds = Array.from(new Set(trackedContainerIds));

    for (const cid of uniqueIds) {
      try {
        const c = docker.getContainer(cid);
        await c.remove({ force: true, v: true });
        removedCount++;
      } catch (err: any) {
        if (!err.message?.includes('404')) {
          console.warn(`  Warning: failed to remove container ${cid.slice(0, 12)}: ${err.message}`);
        }
      }
    }

    // 4. Daemon-level verification: inspect all containers on host
    const allContainersOnHost = await docker.listContainers({ all: true });
    const remainingBenchContainers = allContainersOnHost.filter(c =>
      c.Names.some(name => name.includes('bench-cold') || name.includes('bench-')) ||
      (c.Image === TERMINAL_IMAGE && c.Created * 1000 > Date.now() - 300000)
    );

    for (const orphan of remainingBenchContainers) {
      try {
        const c = docker.getContainer(orphan.Id);
        await c.remove({ force: true, v: true });
        removedCount++;
      } catch {}
    }

    // 5. Final assertion verifying 0 benchmark containers exist on Docker daemon
    const finalScan = await docker.listContainers({ all: true });
    const finalBenchOrphans = finalScan.filter(c =>
      c.Names.some(name => name.includes('bench-cold') || name.includes('bench-'))
    );
    Assertions.assertEqual(finalBenchOrphans.length, 0, 'No benchmark containers must remain on host');
    
    BenchmarkLogger.success(`Cleaned up ${removedCount} benchmark Docker containers. Docker daemon verified: ZERO orphans remain.`);
    results['cleanupVerification'] = {
      removedContainersCount: removedCount,
      zeroOrphansVerified: true,
      remainingBenchmarkContainers: finalBenchOrphans.length
    };
  }

  // Save raw results
  const outputData = {
    benchmark: 'Docker Container Pool Lifecycle & Exhaustion Audit',
    timestamp: new Date().toISOString(),
    environment: {
      platform: env.os.platform,
      arch: env.os.arch,
      nodeVersion: env.runtime.nodeVersion,
      dockerVersion: env.services.docker.version,
      dockerSocket: env.services.docker.socket
    },
    results
  };

  const resultsPath = path.resolve(__dirname, '../results/raw/container-pool-production.json');
  fs.writeFileSync(resultsPath, JSON.stringify(outputData, null, 2));
  BenchmarkLogger.success(`Results written to ${resultsPath}`);
}

run().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
