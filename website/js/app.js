/**
 * NexusIDE — Interactive Engine
 * Anthropic-styled minimalist research demonstrations & telemetry simulations.
 */

// ============================================================================
// 1. Subtle Sound FX (Restrained Web Audio synthesizer)
// ============================================================================
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
  }

  playTone(freq = 440, type = 'sine', duration = 0.06, gainVal = 0.03) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio context restricted until user gesture
    }
  }

  click() { this.playTone(520, 'sine', 0.04, 0.025); }
  type() { this.playTone(750 + Math.random() * 200, 'triangle', 0.025, 0.015); }
  success() {
    this.playTone(440, 'sine', 0.06, 0.03);
    setTimeout(() => this.playTone(554.37, 'sine', 0.08, 0.03), 50);
  }
}

const sfx = new SoundFX();

// ============================================================================
// 2. Hero Live IDE Multi-User Collaboration Simulation
// ============================================================================
const heroFiles = {
  'main.py': [
    '<span class="token-kw">import</span> asyncio',
    '<span class="token-kw">from</span> nexus.crdt <span class="token-kw">import</span> YDocSync, RedisMesh',
    '<span class="token-kw">from</span> nexus.pty <span class="token-kw">import</span> DockerPTYSession',
    '',
    '<span class="token-comment"># Initialize collaborative workspace container</span>',
    '<span class="token-kw">async def</span> <span class="token-fn">bootstrap_workspace</span>(workspace_id: <span class="token-type">str</span>):',
    '    mesh = <span class="token-fn">RedisMesh</span>(cluster_nodes=[<span class="token-str">"redis://node-1:6379"</span>])',
    '    doc_sync = <span class="token-fn">YDocSync</span>(workspace_id, mesh)',
    '    pty = <span class="token-kw">await</span> DockerPTYSession.<span class="token-fn">claim_prewarmed</span>(workspace_id)',
    '    <span class="token-fn">print</span>(f<span class="token-str">"Container /dev/pts/1 ready on {pty.cgroup_id}"</span>)',
    '    <span class="token-kw">return</span> doc_sync.<span class="token-fn">listen_events</span>()'
  ],
  'yjsSyncEngine.ts': [
    '<span class="token-kw">import</span> * <span class="token-kw">as</span> Y <span class="token-kw">from</span> <span class="token-str">"yjs"</span>;',
    '<span class="token-kw">import</span> { redisAdapter } <span class="token-kw">from</span> <span class="token-str">"./redisAdapter.service"</span>;',
    '',
    '<span class="token-kw">export class</span> <span class="token-type">YjsSyncEngine</span> {',
    '  <span class="token-kw">public</span> <span class="token-fn">applyBinaryUpdate</span>(doc: Y.Doc, update: Uint8Array, origin: string) {',
    '    <span class="token-comment">// Defensive Uint8Array offset slicing from shared Node buffer pool</span>',
    '    Y.<span class="token-fn">applyUpdate</span>(doc, update, origin);',
    '    <span class="token-kw">if</span> (origin !== <span class="token-str">"redis"</span>) {',
    '      redisAdapter.<span class="token-fn">publishDelta</span>(doc.guid, update);',
    '    }',
    '  }',
    '}'
  ],
  'redisAdapter.ts': [
    '<span class="token-kw">import</span> { Redis } <span class="token-kw">from</span> <span class="token-str">"ioredis"</span>;',
    '<span class="token-kw">import</span> { Redlock } <span class="token-kw">from</span> <span class="token-str">"./distributedLock.service"</span>;',
    '',
    '<span class="token-kw">export const</span> redisClient = <span class="token-kw">new</span> <span class="token-type">Redis</span>(process.env.REDIS_URL);',
    '<span class="token-kw">export async function</span> <span class="token-fn">acquireFileSaveLock</span>(fileId: string) {',
    '  <span class="token-comment">// Atomic SET NX PX via Redlock Lua script</span>',
    '  <span class="token-kw">return</span> <span class="token-kw">await</span> Redlock.<span class="token-fn">acquire</span>(`lock:files:${fileId}`, 3000);',
    '}'
  ]
};

function initHeroIDE() {
  const codeLinesEl = document.getElementById('heroCodeLines');
  const lineNumbersEl = document.getElementById('heroLineNumbers');
  const fileTabs = document.querySelectorAll('.file-tab');
  const cursorAman = document.getElementById('cursorAman');
  const cursorSarah = document.getElementById('cursorSarah');
  const terminalStream = document.getElementById('heroTerminalStream');

  let currentFile = 'main.py';

  function renderFile(fileName) {
    if (!codeLinesEl || !lineNumbersEl) return;
    const lines = heroFiles[fileName] || heroFiles['main.py'];
    
    // Line numbers
    lineNumbersEl.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
    // Lines
    codeLinesEl.innerHTML = lines.map(line => `<div>${line || '&nbsp;'}</div>`).join('');
  }

  renderFile(currentFile);

  fileTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sfx.click();
      fileTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFile = tab.dataset.file;
      renderFile(currentFile);
    });
  });

  // Subtle animated cursor drift
  let step = 0;
  setInterval(() => {
    step++;
    if (cursorAman) {
      const topPos = 16 + ((step * 24) % 200);
      const leftPos = 70 + Math.sin(step * 0.7) * 120;
      cursorAman.style.top = `${topPos}px`;
      cursorAman.style.left = `${Math.max(50, leftPos)}px`;
    }
    if (cursorSarah) {
      const topPos = 36 + (((step + 2) * 26) % 220);
      const leftPos = 110 + Math.cos(step * 0.5) * 140;
      cursorSarah.style.top = `${topPos}px`;
      cursorSarah.style.left = `${Math.max(70, leftPos)}px`;
    }
  }, 2200);

  // Streaming Docked PTY Terminal Logs
  const ptyLogs = [
    '<span class="term-cyan">[dockerode]</span> Bound session to PTY /dev/pts/1 (UID=1001, cgroups=active)',
    '<span class="term-green">[yjs:sync]</span> Binary update vector received: 84 bytes applied with origin="client"',
    '<span class="term-purple">[redis:mesh]</span> Fan-out message dispatched on channel yjs:update:main.py',
    '<span class="term-yellow">[redlock]</span> Acquired distributed save lock: lock:files:main.py (TTL=3000ms)',
    '<span class="term-cyan">[postgres]</span> Byte-packed BYTEA CRDT state saved via UNNEST (0.64ms)',
    '<span class="term-green">[lsp:pyright]</span> Diagnostics clean: 0 errors, 0 warnings (JSON-RPC 2.0 streaming)'
  ];

  let logIndex = 0;
  setInterval(() => {
    if (!terminalStream) return;
    const logLine = document.createElement('div');
    logLine.innerHTML = ptyLogs[logIndex % ptyLogs.length];
    terminalStream.appendChild(logLine);
    logIndex++;
    if (terminalStream.children.length > 5) {
      terminalStream.removeChild(terminalStream.children[0]);
    }
  }, 2600);
}

// ============================================================================
// 3. Lab 1: Real-Time CRDT & Redis Mesh Simulator
// ============================================================================
function initCrdtSimulator() {
  const peerA = document.getElementById('peerAText');
  const peerB = document.getElementById('peerBText');
  const simBurstBtn = document.getElementById('simBurstBtn');
  const simLatencyBtn = document.getElementById('simLatencyBtn');
  const syncStatusPill = document.getElementById('syncStatusPill');

  let simLatency = 40; // ms

  function triggerSync(sourceText, targetTextarea, originName) {
    sfx.type();
    if (syncStatusPill) {
      syncStatusPill.innerHTML = `Mesh fan-out: ${originName} &rarr; Redis &rarr; Peer`;
      syncStatusPill.style.color = 'var(--accent)';
    }

    setTimeout(() => {
      targetTextarea.value = sourceText;
      if (syncStatusPill) {
        syncStatusPill.innerHTML = `&bull; Convergence Guaranteed (S_A &sqcup; S_B)`;
        syncStatusPill.style.color = '#16A34A';
      }
    }, simLatency);
  }

  if (peerA && peerB) {
    peerA.addEventListener('input', (e) => {
      triggerSync(e.target.value, peerB, 'User A (Pod 1)');
    });

    peerB.addEventListener('input', (e) => {
      triggerSync(e.target.value, peerA, 'User B (Pod 2)');
    });
  }

  if (simBurstBtn) {
    simBurstBtn.addEventListener('click', () => {
      sfx.click();
      const current = peerA.value;
      const additionA = "\n# User A appended concurrently";
      const additionB = "\n# User B appended concurrently";
      peerA.value = current + additionA;
      peerB.value = current + additionB;

      setTimeout(() => {
        const converged = current + additionA + additionB;
        peerA.value = converged;
        peerB.value = converged;
        sfx.success();
        if (syncStatusPill) {
          syncStatusPill.innerHTML = `&bull; Yjs CRDT merged concurrent edits deterministically`;
          syncStatusPill.style.color = '#16A34A';
        }
      }, 350);
    });
  }

  if (simLatencyBtn) {
    simLatencyBtn.addEventListener('click', () => {
      sfx.click();
      simLatency = simLatency === 40 ? 250 : 40;
      simLatencyBtn.textContent = `Toggle Latency (${simLatency}ms)`;
    });
  }
}

// ============================================================================
// 4. Lab 2: Interactive Terminal & Fault Runner
// ============================================================================
const terminalCommandOutputs = {
  'bash test.sh --chaos': [
    '<span class="term-yellow">[Chaos-Runner]</span> Initializing Netflix-standard chaos fault injector...',
    '<span class="term-yellow">[Step 1]</span> Killing active Redis TCP connection mid-transaction...',
    '<span class="term-green">[Recovery]</span> Pod 1 seamlessly pivoted to local inMemoryCache fallback buffer.',
    '<span class="term-yellow">[Step 2]</span> Simulating Docker PTY process termination (SIGKILL 9)...',
    '<span class="term-green">[Recovery]</span> RefCounter auto-spawned fresh PTY exec within 18ms without lost buffer.',
    '<span class="term-green">====================================================</span>',
    '<span class="term-green">Chaos resilience suite passed (0 dropped edits, 100% convergence)</span>'
  ],
  'bash test.sh --property': [
    '<span class="term-cyan">[Property-Fuzzer]</span> Running fast-check randomized CRDT property tests...',
    '<span class="term-gray">  - Associativity: (A ⊔ B) ⊔ C === A ⊔ (B ⊔ C)...</span> <span class="term-green">PASSED [1,000 runs]</span>',
    '<span class="term-gray">  - Commutativity: A ⊔ B === B ⊔ A...</span> <span class="term-green">PASSED [1,000 runs]</span>',
    '<span class="term-gray">  - Idempotency: A ⊔ A === A...</span> <span class="term-green">PASSED [1,000 runs]</span>',
    '<span class="term-green">3,000 randomized state vectors mathematically validated in 412ms.</span>'
  ],
  'bash test.sh --security': [
    '<span class="term-purple">[Security-Audit]</span> Verifying Docker cgroups v2 boundaries...',
    '<span class="term-gray">  - Memory limit ceiling: 1,073,741,824 bytes (1.0 GB) -> </span><span class="term-green">ENFORCED</span>',
    '<span class="term-gray">  - Fork-bomb defense: PidsLimit=500 -> </span><span class="term-green">ENFORCED</span>',
    '<span class="term-gray">  - Unprivileged user execution: UID=1001 (non-root) -> </span><span class="term-green">VERIFIED</span>',
    '<span class="term-gray">  - Bridge network egress restrict: isolated container subnet -> </span><span class="term-green">SECURE</span>',
    '<span class="term-green">Zero privilege escalation or host kernel escape paths detected.</span>'
  ],
  'docker ps': [
    'CONTAINER ID   IMAGE                COMMAND                  STATUS         PORTS                   NAMES',
    '<span class="term-cyan">8f2a1b9c3e4d</span>   nexus-sandbox:latest <span class="term-gray">"/bin/bash --init"</span>       Up 4 hours     /dev/pts/1 (User A)     ws-8f2a1b',
    '<span class="term-cyan">5d9e2c1a8b7f</span>   nexus-sandbox:latest <span class="term-gray">"idle-prewarmed-daemon"</span> Up 12 minutes  standing-pool-1         warm-pool-01',
    '<span class="term-cyan">1c4a7e9b2f3d</span>   redis:7.2-alpine     <span class="term-gray">"redis-server"</span>           Up 14 days     0.0.0.0:6379->6379/tcp  nexus-redis',
    '<span class="term-cyan">3b8e4f1a2c9d</span>   postgres:16-alpine   <span class="term-gray">"postgres"</span>               Up 14 days     0.0.0.0:5432->5432/tcp  nexus-postgres'
  ],
  'curl /api/metrics': [
    '<span class="term-green"># HELP nodejs_eventloop_lag_p99 Event loop delay 99th percentile</span>',
    '<span class="term-cyan">nodejs_eventloop_lag_p99_milliseconds 0.74</span>',
    '<span class="term-green"># HELP active_websocket_connections Current live client sockets</span>',
    '<span class="term-cyan">active_websocket_connections 148</span>',
    '<span class="term-green"># HELP redis_pubsub_channel_lag Redis fan-out propagation latency</span>',
    '<span class="term-cyan">redis_pubsub_channel_lag_ms 1.12</span>',
    '<span class="term-green"># HELP workerpool_threads_active Active CPU compute threads</span>',
    '<span class="term-cyan">workerpool_threads_active 4</span>'
  ]
};

function initTerminalLab() {
  const termView = document.getElementById('termOutputView');
  const cmdPills = document.querySelectorAll('.cmd-pill');
  const clearBtn = document.getElementById('termClearBtn');

  function printCommand(cmd) {
    if (!termView) return;
    sfx.type();
    const promptLine = document.createElement('div');
    promptLine.innerHTML = `<span class="term-cyan">developer@nexus-vm:~$</span> ${cmd}`;
    termView.appendChild(promptLine);

    const outputs = terminalCommandOutputs[cmd] || [`Command executed: ${cmd}`];
    
    outputs.forEach((line, index) => {
      setTimeout(() => {
        const outLine = document.createElement('div');
        outLine.innerHTML = line;
        termView.appendChild(outLine);
        termView.scrollTop = termView.scrollHeight;
        if (index === outputs.length - 1) {
          sfx.success();
        }
      }, (index + 1) * 120);
    });
  }

  cmdPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const cmd = pill.dataset.cmd;
      printCommand(cmd);
    });
  });

  if (clearBtn && termView) {
    clearBtn.addEventListener('click', () => {
      sfx.click();
      termView.innerHTML = '<span class="term-gray">Terminal buffer cleared. Select an automated verification command above.</span>';
    });
  }
}

// ============================================================================
// 5. Lab 3: Merkle DAG & Timelapse Replayer
// ============================================================================
const timelapseKeyframes = [
  {
    step: 0,
    commit: 'c3a9f1b (Initial Setup)',
    author: 'Aman Kashyap (Owner)',
    code: '# Workspace initialized\nprint("Hello World")'
  },
  {
    step: 25,
    commit: 'e8d2a4c (Add WebSocket Gateway)',
    author: 'Aman Kashyap (Owner)',
    code: '# Added WebSocket upgrade handler\nimport socket\nws = socket.create_server(port=3000)'
  },
  {
    step: 50,
    commit: '9b1f7e3 (Integrate Yjs CRDTs)',
    author: 'Sarah Chen (Collaborator)',
    code: 'from nexus.crdt import YDocSync\n# Synchronized document initialized\ndoc = YDocSync("ws-alpha")'
  },
  {
    step: 75,
    commit: '4a6c8d2 (Redis Pub/Sub Mesh)',
    author: 'Aman Kashyap (Owner)',
    code: 'from nexus.redis import RedisMesh\nmesh = RedisMesh()\nmesh.publish_delta(doc.guid, delta)'
  },
  {
    step: 100,
    commit: 'f7e2c9a (Docker PTY Exec /dev/pts/1)',
    author: 'Aman Kashyap (Owner)',
    code: 'from nexus.pty import DockerPTYSession\npty = DockerPTYSession.claim_prewarmed("ws-alpha")\nprint("Production Ready!")'
  }
];

function initTimelapseLab() {
  const slider = document.getElementById('timelapseSlider');
  const editor = document.getElementById('timelapseEditor');
  const commitLabel = document.getElementById('timelapseCommit');
  const authorLabel = document.getElementById('timelapseAuthor');

  if (!slider || !editor) return;

  function updateFrame(val) {
    let closest = timelapseKeyframes[0];
    for (const frame of timelapseKeyframes) {
      if (Math.abs(frame.step - val) <= Math.abs(closest.step - val)) {
        closest = frame;
      }
    }

    editor.textContent = closest.code;
    if (commitLabel) commitLabel.textContent = closest.commit;
    if (authorLabel) authorLabel.textContent = closest.author;
    sfx.type();
  }

  slider.addEventListener('input', (e) => {
    updateFrame(parseInt(e.target.value, 10));
  });

  updateFrame(0);
}

// ============================================================================
// 6. Systems Architecture Explorer
// ============================================================================
const archViews = {
  topology: `
    <div class="topology-grid">
      <div class="topology-layer">
        <div class="layer-heading">01 &middot; Client Layer</div>
        <div class="node-box">
          <div class="node-icon">&bull; Client</div>
          <div class="node-name">Monaco + xterm.js</div>
          <div class="node-spec">Yjs CRDTs &middot; 60fps Batching</div>
        </div>
      </div>
      <div class="topology-layer">
        <div class="layer-heading">02 &middot; Edge &amp; Gateway</div>
        <div class="node-box">
          <div class="node-icon">&bull; Proxy</div>
          <div class="node-name">Nginx Proxy</div>
          <div class="node-spec">Gzip &middot; WS Upgrades</div>
        </div>
        <div class="node-box">
          <div class="node-icon">&bull; Auth</div>
          <div class="node-name">Express Gateway</div>
          <div class="node-spec">JWT &middot; RBAC Gatekeeper</div>
        </div>
      </div>
      <div class="topology-layer">
        <div class="layer-heading">03 &middot; Backend Engine</div>
        <div class="node-box">
          <div class="node-icon">&bull; Sync</div>
          <div class="node-name">Yjs Sync Engine</div>
          <div class="node-spec">Backpressure &middot; StructStore</div>
        </div>
        <div class="node-box">
          <div class="node-icon">&bull; Threads</div>
          <div class="node-name">Worker Threads</div>
          <div class="node-spec">SHA-256 CAS &middot; Compaction</div>
        </div>
        <div class="node-box">
          <div class="node-icon">&bull; Lock</div>
          <div class="node-name">Redlock Manager</div>
          <div class="node-spec">Atomic Lua SET NX PX</div>
        </div>
      </div>
      <div class="topology-layer">
        <div class="layer-heading">04 &middot; Sandboxes &amp; DB</div>
        <div class="node-box">
          <div class="node-icon">&bull; Sandbox</div>
          <div class="node-name">Docker Containers</div>
          <div class="node-spec">PTY /dev/pts/X &middot; cgroups v2</div>
        </div>
        <div class="node-box">
          <div class="node-icon">&bull; Database</div>
          <div class="node-name">PostgreSQL 16</div>
          <div class="node-spec">BYTEA Blobs &middot; Covering B-Tree</div>
        </div>
        <div class="node-box">
          <div class="node-icon">&bull; Cache</div>
          <div class="node-name">Redis 7 Mesh</div>
          <div class="node-spec">Pub/Sub Fan-out &middot; L2 Cache</div>
        </div>
      </div>
    </div>
  `,
  mesh: `
    <div style="display:flex; flex-direction:column; gap:16px; width:100%; max-width:800px; margin:0 auto;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="node-box">
          <div class="node-name">Peer A (Connected to Pod 1)</div>
          <div class="node-spec">Generates binary Yjs update vector (48 bytes)</div>
        </div>
        <div class="node-box">
          <div class="node-name">Peer B (Connected to Pod 2)</div>
          <div class="node-spec">Receives delta via WebSocket with origin="redis"</div>
        </div>
      </div>
      <div class="node-box" style="border-color:var(--accent-border); background:var(--accent-subtle);">
        <div class="node-name">Redis Pub/Sub Mesh Core (Channel: yjs:update:docId)</div>
        <div class="node-spec">Stateless cross-pod fan-out with explicit 'redis' origin isolation preventing recursive feedback storms.</div>
      </div>
      <div class="node-box" style="border-color:var(--border-medium); background:var(--bg-card);">
        <div class="node-name">Redlock Distributed Persistence (PostgreSQL 16)</div>
        <div class="node-spec">Velocity debouncer writes consolidated state vector under distributed lock (eliminating SQL write amplification).</div>
      </div>
    </div>
  `,
  container: `
    <div style="display:flex; flex-direction:column; gap:16px; width:100%; max-width:800px; margin:0 auto;">
      <div class="node-box" style="border-color:var(--accent-border); background:var(--accent-subtle);">
        <div class="node-name">1 Container per Workspace (${'workspaceId'})</div>
        <div class="node-spec">Single shared Docker container consumes 4x less host RAM than spinning up per-user containers.</div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="node-box">
          <div class="node-name">PTY Exec Session 1 (/dev/pts/1)</div>
          <div class="node-spec">User A (Owner) &middot; Private bash history &amp; GIT_AUTHOR="Aman"</div>
        </div>
        <div class="node-box">
          <div class="node-name">PTY Exec Session 2 (/dev/pts/2)</div>
          <div class="node-spec">User B (Editor) &middot; Private bash history &amp; GIT_AUTHOR="Sarah"</div>
        </div>
      </div>
      <div class="node-box" style="background:var(--bg-card);">
        <div class="node-name">Shared Volume Disk Mount (/workspaces/id) + Linux cgroups Hibernation</div>
        <div class="node-spec">Both users execute commands on the same shared disk. Idle workspaces paused via container.pause() (0% CPU).</div>
      </div>
    </div>
  `
};

function initArchitectureExplorer() {
  const frame = document.getElementById('archFrame');
  const navBtns = document.querySelectorAll('.arch-nav-btn');

  function setView(viewName) {
    if (!frame) return;
    frame.innerHTML = archViews[viewName] || archViews.topology;
    sfx.click();
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setView(btn.dataset.view);
    });
  });

  setView('topology');
}

// ============================================================================
// 7. Deep-Dive Postmortems & Tab Switcher
// ============================================================================
function initPostmortems() {
  const pmBtns = document.querySelectorAll('.pm-nav-btn');
  const pmPanels = document.querySelectorAll('.pm-panel');

  pmBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.click();
      pmBtns.forEach(b => b.classList.remove('active'));
      pmPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(btn.dataset.target);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });
}

// ============================================================================
// 8. 20-Tier Automated Testing Suite Simulation
// ============================================================================
function initTestingMatrix() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const testCards = document.querySelectorAll('.test-card');
  const runMasterBtn = document.getElementById('runMasterTestBtn');
  const progressBar = document.getElementById('testProgressBar');
  const progressText = document.getElementById('testProgressText');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sfx.click();
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;
      testCards.forEach(card => {
        if (filter === 'all' || card.dataset.cat === filter) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  if (runMasterBtn && progressBar) {
    runMasterBtn.addEventListener('click', () => {
      sfx.click();
      runMasterBtn.disabled = true;
      runMasterBtn.textContent = 'Executing 20 Verification Suites...';
      let progress = 0;

      const interval = setInterval(() => {
        progress += 5;
        progressBar.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${Math.floor((progress / 100) * 20)} / 20 Suites Verified (${progress}%)`;

        if (progress >= 100) {
          clearInterval(interval);
          sfx.success();
          runMasterBtn.disabled = false;
          runMasterBtn.textContent = 'All 20 Verification Suites Passed';
        }
      }, 90);
    });
  }
}

// ============================================================================
// 9. Quickstart Setup Tabs & Snippet Copy
// ============================================================================
const setupSnippets = {
  local: `# 1. Clone NexusIDE repository
git clone https://github.com/AmanKashyapp07/NexusIDE.git
cd NexusIDE

# 2. Install backend and frontend dependencies
npm --prefix backend install
npm --prefix frontend install

# 3. Initialize PostgreSQL schema
psql -U postgres -d sandbox -f database/schema.sql

# 4. Start local development servers
npm --prefix backend run dev    # Express & WebSocket Gateway on port 3000
npm --prefix frontend run dev   # Vite Client on port 5173`,

  docker: `# 1. Pull base developer sandbox image
docker pull ubuntu:22.04

# 2. Start PostgreSQL 16 & Redis 7 containers
docker run -d --name nexus-postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sandbox postgres:16-alpine
docker run -d --name nexus-redis -p 6379:6379 redis:7.2-alpine

# 3. Launch NexusIDE production backend orchestrator
cd backend && npm start`,

  tests: `# 1. Run all default Unit, Security, & Integration test suites
bash test.sh

# 2. Execute specialized test categories:
bash test.sh --property      # Fast-check property-based CRDT fuzzing
bash test.sh --chaos         # Netflix-standard fault injection & Redis kills
bash test.sh --security      # Docker cgroup PID limits & socket RBAC
bash test.sh --all           # Complete 20-tier end-to-end master suite`
};

function initSetupSnippets() {
  const setupTabs = document.querySelectorAll('.setup-tab-btn');
  const snippetPre = document.getElementById('setupSnippet');
  const copyBtn = document.getElementById('copySnippetBtn');

  let currentTab = 'local';

  setupTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sfx.click();
      setupTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      if (snippetPre) snippetPre.textContent = setupSnippets[currentTab];
    });
  });

  if (copyBtn && snippetPre) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(snippetPre.textContent).then(() => {
        sfx.click();
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = orig; }, 1800);
      });
    });
  }
}

// ============================================================================
// 10. Navigation Scroll Spy
// ============================================================================
function initNavigation() {
  const navbar = document.getElementById('navbar');
  const navLinks = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    if (navbar) {
      if (window.scrollY > 20) {
        navbar.classList.add('navbar-scrolled');
      } else {
        navbar.classList.remove('navbar-scrolled');
      }
    }

    const fromTop = window.scrollY + 100;
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const target = document.querySelector(href);
        if (target) {
          if (target.offsetTop <= fromTop && target.offsetTop + target.offsetHeight > fromTop) {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
          }
        }
      }
    });
  });
}

// ============================================================================
// Master DOM Ready Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initHeroIDE();
  initCrdtSimulator();
  initTerminalLab();
  initTimelapseLab();
  initArchitectureExplorer();
  initPostmortems();
  initTestingMatrix();
  initSetupSnippets();
  initNavigation();
});
