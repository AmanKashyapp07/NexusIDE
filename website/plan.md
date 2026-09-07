# NexusIDE Presentation SPA — Merged Plan v3 (Restrained Editorial Index)

A presentation single-page application in `./website`, deployed via GitHub Pages (`deploy-showcase.yml` / `deploy-showcase.sh`), used as a live on-screen visual companion during a 10-minute NexusIDE presentation and Microsoft SWE interview.

This plan synthesizes the **restrained editorial index pattern** (inspired by Stripe and Vercel engineering blogs) with the **full technical depth of NexusIDE**. It eliminates all dashboard chrome, card borders, nested boxes, and all-caps labels, relying on **type hierarchy, generous whitespace, and unboxed centerpieces** sitting directly on the canvas.

> **Local Testing Constraint:** We will **NOT deploy to GitHub Pages or push to remote branches** until you have reviewed and approved the result locally on `http://localhost:3456`.

---

## 1. The Design System: Restrained Editorial Index

| Design Token | Specification | Rule |
| :--- | :--- | :--- |
| **Canvas** | `#161B1E` flat graphite | Completely flat neutral dark canvas. Zero gradient, zero texture. |
| **Text — Headline** | `#EDEEF0`, large, bold, one weight jump above body | Carries the visual hierarchy. Replaces all header badges and chips. |
| **Text — Category Label** | `#7D848B`, small, regular weight, **normal sentence case** | Quiet wayfinding (e.g. *Infrastructure dilemma*, *Architecture*). **No all-caps.** |
| **Text — Body** | `#B8BDC2`, exactly **one restrained sentence per section** | If it takes more than one sentence, it belongs in the spoken presentation, not on screen. |
| **Signal — Fixed / Healthy** | `#3FA37A`, applied to a **word or number only** | e.g. the word `Fixed` or `0.00% CPU`. Never used as a container border. |
| **Signal — Naive / Broken** | `#D6533F`, applied to a **word or number only** | e.g. the word `Naive` or `$1.80/hr`. Never used as a container border. |
| **Structure & Borders** | **Zero default borders, zero card backgrounds, zero drop shadows** | The only permitted rule: a single subtle hairline divider (`1px solid #232B32`) between two items in direct comparison. |
| **Typography — Primary** | `IBM Plex Sans` / System Sans | Used for headlines, labels, and narrative context. |
| **Typography — Code / Data** | `JetBrains Mono` | Used *strictly* for literal code tokens, packet traces, byte offsets, and metrics. |

**Total boxed elements on the entire site: zero.** All diagrams, simulations, and data sit directly on the `#161B1E` canvas.

---

## 2. Layout: Stacked Entries Anatomy

Each of the 5 sections follows the identical restrained anatomy:

```
   [ small label: "The Problem" (quiet grey, normal case) ]

   Big headline stating the core idea in plain language
   One line of supporting context, restrained.

   [ The centerpiece — diagram, simulation, or number list —
     sitting directly on the canvas with no frame or card background ]
```

### Navigation & Chromeless Controls
- **Header:** A quiet, transparent/flat header: `NexusIDE` in `#EDEEF0` followed by a quiet slash and `Architecture`, `Topology`, `Internals`, `Benchmarks`, `Shipped`. Clicking any link smooth-scrolls to that section.
- **Keyboard Navigation:** `1`–`5` or `ArrowLeft`/`ArrowRight` jumps instantly to that section.
- **Speaker Cues (`P` Key):** Hidden by default. Pressing `P` slides out a clean, distraction-free side drawer containing the verbatim 10-minute talk track and interview answers from `presentation1.md` and `questions3.md`.

---

## 3. The 5 Sections Detailed

### Section 1: The Problem
- **Category Label:** *Infrastructure dilemma.*
- **Headline:** *"10 collaborators. 10 dedicated VMs. Cost climbs linearly."*
- **Supporting Line:** *"Naive architectures provision isolated virtual machines per seat, hitting an unsustainable $1.80/hr resource wall."*
- **Centerpiece (Direct Comparison sitting on Canvas):**
  - Left column: `Naive: 10 Dedicated VMs` · `$1.80 / hour` (in `#D6533F`) · 4.2 GB RAM idle · 45s cold boot.
  - Subtle hairline vertical separator (`1px solid #232B32`).
  - Right column: `Fixed: 1 Shared Multi-Tenant Container` · `$0.0033 / hour` (in `#3FA37A`) · 140 MB total · 1.2s cold boot.
  - Interactive Dilemma Switcher: Plain text links (`Compute Density` · `State Sync` · `Write Thrashing`) to toggle between the 3 core dilemmas without any card wrappers.

### Section 2: Topology
- **Category Label:** *Architecture.*
- **Headline:** *"Four tiers, no sticky sessions."*
- **Supporting Line:** *"Stateless Node.js daemon workers communicate over a shared Redis Pub/Sub mesh with zero cross-instance coupling."*
- **Centerpiece (Unframed Topology Flow):**
  - Plain SVG / text node layout sitting directly on `#161B1E`:
    `Browser Client (xterm.js)` $\rightarrow$ `Nginx Ingress (SSL / WS)` $\rightarrow$ `Stateless Pods (Daemon)` $\rightarrow$ `Redis Mesh & Docker Engine`.
  - Connecting lines are subtle `#2E3842`.
  - Click any node $\rightarrow$ a single quiet sentence appears directly below the diagram explaining protocol, wire format, and latency invariant. No popovers, no cards.

### Section 3: Systems Lab (The Centerpiece Demos)
- **Category Label:** *Systems lab.*
- **Headline:** *"Redis Pub/Sub mesh & container lifecycle."*
- **Supporting Line:** *"Interactive packet verification of origin tagging and cgroups v2 hibernation."*
- **Centerpiece 1: Redis Pub/Sub Loop-Breaker (Full Width, Canvas Native):**
  - Text toggle: `Naive (Echo Storm)` (in `#D6533F`) vs `Fixed (Origin-Gated)` (in `#3FA37A`). No bordered pills.
  - Terminal stream: Real-time telemetry showing packet hop `User A -> Pod 1 -> Redis -> Pod 2 -> User B`.
  - When `Fixed`: Origin UUID tag (`origin !== currentInstanceId`) silently drops echo in `< 0.1ms`.
  - When `Naive`: Infinite recursive echo storm animation shows Redis CPU spike.
- **Centerpiece 2: Container Hibernation Lifecycle:**
  - Plain text trigger: `Pause Workspace` / `Resume Workspace`.
  - Large animated metric: `15.4% CPU` $\rightarrow$ `0.00% CPU` (in `#3FA37A`) via Linux cgroups `SIGSTOP` (`container.pause()`), retaining full DRAM state with zero background compute.
- **Centerpiece 3: V8 8KB Buffer Offset Postmortem:**
  - Unframed memory layout graphic showing Node.js 8192-byte slab allocation, the 2048-byte payload, and why `Buffer.from(arrayBuffer, byteOffset, length)` eliminated cross-tenant memory bleed.

### Section 4: Verified Metrics
- **Category Label:** *Benchmarks.*
- **Headline:** *"Measured under 20-tier automated test harness."*
- **Supporting Line:** *"All benchmarks collected across 200 concurrent PTY sessions on a single 4GB droplet without OOM."*
- **Centerpiece (Stacked Typographic Data List):**
  - Simple stacked list with zero boxes or borders:
    - **1.2s** (was 4.8s) · Cold start latency via pre-warmed Alpine container pool (`-75%`).
    - **18 MB** (was 85 MB) · Memory per idle tenant via shared PTY process multiplexing (`-78%`).
    - **0.8 ms** (was 320 ms) · Merkle file tree sync p99 latency via worker thread hashing.
    - **200** (was 12) · Max concurrent collaborative workspaces on a 4GB droplet.

### Section 5: Shipped
- **Category Label:** *Shipped.*
- **Headline:** *"Live on cloud infrastructure."*
- **Supporting Line:** *"Deployed across DigitalOcean and Oracle Cloud with automated multi-tier health probes."*
- **Centerpiece:**
  - Status statement: `Live VM • 104.248.118.99 • Reachable (34ms ping)` with quiet green indicator.
  - Plain understated text links: `Launch Live IDE ↗` · `Source Code on GitHub ↗`.
  - Two roadmap items following the identical `Headline / One-line context` anatomy:
    - *AWS Firecracker microVMs:* Upgrading from Linux container namespaces to dedicated micro-kernels for hardware isolation.
    - *Browser WebAssembly LSP:* Compiling language servers to WebAssembly client workers to eliminate server-side CPU spikes.

---

## 4. Execution Scope & Zero-Box Compliance

1. **Zero Box Rule:** No cards, borders, rounded containers, or shadows. Whitespace and vertical rhythm (`80px`–`120px` spacing) do all separation.
2. **Signal Color Rule:** Applied only to the word or number itself (e.g. `Fixed` in `#3FA37A`, `Naive` in `#D6533F`).
3. **Restrained Text Rule:** Exactly one quiet label (sentence-case), one large bold headline, one context sentence, and one centerpiece per section.
4. **Speaker Cues:** Hidden slide-out drawer accessible only via `P` key.
