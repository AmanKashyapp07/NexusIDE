# AI-Assisted Development Guide: Placement Interview Edition

Practical playbook for using AI tools strategically during coding rounds, system design interviews, and project question defense.

- Target Context: Campus and off-campus placement technical rounds, October 2026 to June 2027
- Primary Projects: NexusIDE and MagnusCI
- Core Principle: AI accelerates thinking, not replaces it — every AI output must be internalized before it leaves your mouth or keyboard

---

## Contents

- Section 1: The Mental Model — How to Use AI During Interviews
- Section 2: AI for Coding Rounds — Strategy, Prompting, and Verification
- Section 3: AI for System Design Questions — Framing, Diagramming, and Defense
- Section 4: AI for Project Question Prep (NexusIDE and MagnusCI)
- Section 5: Pre-Interview AI Warm-Up Routines
- Section 6: Prompt Playbook — Ready-to-Use Templates
- Section 7: AI Tool Landscape — When to Use What
- Section 8: Anti-Patterns and Red Flags to Avoid
- Section 9: Interview-Day Execution Tracker

---

### The Core Principle

AI tools are your thought accelerator, not your answer machine. In coding rounds and interviews, AI outputs that you paste without internalizing will collapse the moment the interviewer asks a follow-up question.

Every AI interaction during preparation should follow this loop:

1. **Prompt** — Ask a specific, well-scoped question, not a vague dump.
2. **Critically evaluate** — Does the output match what you actually know? Flag every assumption.
3. **Verify** — Trace the logic yourself, or run the code and check test cases edge by edge.
4. **Internalize** — Restate the solution in your own words. Can you reproduce it without AI in 5 minutes?
5. **Synthesize** — Build the pattern into long-term memory, not clipboard memory.

---

## Section 1: The Mental Model — How to Use AI During Interviews

### The Three Legitimate AI Roles in Placement Preparation

- **Role 1: Socratic Tutor**
  - Use Case: Ask AI to probe your understanding of your own projects. Simulate the interviewer's grilling role.
  - Example: "Act as a senior backend engineer and grill me on NexusIDE's distributed lock implementation."
  - Value: Surfaces gaps before the interviewer does.

- **Role 2: Solution Explainer (not Generator)**
  - Use Case: After attempting a problem, use AI to explain the optimal approach and why your approach was suboptimal.
  - Example: "I solved this with BFS, but the editorial uses a monotonic deque. Explain why the deque is superior with this input."
  - Value: Builds conceptual depth around patterns, not just the answer.

- **Role 3: Edge Case and Failure Mode Generator**
  - Use Case: After solving a problem or designing a system, ask AI to enumerate failure modes, edge cases, and adversarial inputs you may have missed.
  - Example: "Given this DAG scheduler design, what are the 5 most likely failure modes under high concurrency?"
  - Value: Builds robustness of thought under pressure.

---

### The Interview-Day Reality Check

Most placement coding rounds do not permit AI assistance. System design interviews reward structured, independent thinking.

AI's value for interviews is entirely in the preparation phase:
- Compressing the time to internalize patterns (not to avoid internalizing them).
- Stress-testing your understanding through adversarial prompting.
- Generating realistic grilling scenarios tied to your specific projects.

The goal is to show up to every interview needing zero AI — because you already absorbed what AI helped you build.

---

### The Three Forbidden Uses

- **Forbidden 1: Copying AI code into interviews without tracing it.**
  - Why dangerous: Your explanation will collapse the moment the interviewer modifies the input or asks for complexity analysis.

- **Forbidden 2: Using AI to draft system design diagrams you cannot redraw freehand.**
  - Why dangerous: Whiteboard sessions require real-time explanation. A diagram you cannot reproduce signals lack of ownership.

- **Forbidden 3: Using AI answers verbatim to describe your own projects.**
  - Why dangerous: Interviewers quickly detect generic responses about your own work. Every answer about NexusIDE or MagnusCI must be grounded in the actual source code.

---

## Section 2: AI for Coding Rounds — Strategy, Prompting, and Verification

### The Problem-First Rule

Never prompt AI before you have spent at least 10 minutes on the problem independently. This is non-negotiable for two reasons:

1. Without your own attempt, you have no basis to evaluate whether the AI solution is correct or optimal.
2. Placement interviewers reward structured thought over correct output. The ability to narrate your reasoning under pressure is the actual signal.

The 10-minute rule for coding rounds:
- 0 to 2 min: Read the problem, identify the data structure category (graph, DP, heap, sliding window, etc.).
- 2 to 5 min: Sketch a brute force approach and its time complexity.
- 5 to 8 min: Identify the optimizable bottleneck and attempt the efficient approach.
- 8 to 10 min: If genuinely stuck, write what you know and what you are missing, then prompt AI with that specific gap.

---

### Problem Category Recognition (AI Acceleration)

AI is most valuable as a pattern-matcher accelerator before you attempt a new category. Use it to build a mental index:

- **Dynamic Programming**
  - Prompt: "Explain the state definition and recurrence relation for this DP problem, then show me 3 structurally similar problems."
  - Goal: Internalize the state design pattern, not the code.

- **Graph Algorithms**
  - Prompt: "I know BFS and DFS. Explain when to use Dijkstra, Bellman-Ford, and Floyd-Warshall with a concrete decision tree."
  - Goal: Build a fast algorithm-selection heuristic.

- **Sliding Window / Two Pointers**
  - Prompt: "Given this problem, identify whether it maps to a fixed or variable sliding window and explain the invariant being maintained."
  - Goal: Spot the invariant before writing code.

- **Heaps / Priority Queues**
  - Prompt: "Explain the K-way merge pattern using a min-heap with a concrete example and pseudocode."
  - Goal: Understand heap-as-scheduler mental model.

- **Segment Trees / Binary Indexed Trees**
  - Prompt: "Explain when a segment tree is necessary vs when a simple prefix sum suffices. Build intuition with this range query problem."
  - Goal: Know the threshold where a simpler structure breaks.

---

### AI-Assisted Code Review (Post-Solve)

After solving a problem yourself, use AI as a code reviewer, not a solution provider:

1. Paste your solution and say: "Review this for correctness, edge case coverage, and time/space complexity."
2. Ask: "What is the simplest input that breaks this solution?"
3. Ask: "Rewrite this more idiomatically without changing the algorithm."
4. Ask: "What is the next difficulty level of this problem and how would it change the approach?"

This turns every solved problem into a progressive depth-building session.

---

### Verifying AI-Generated Code: The 5-Gate Check

Never accept AI code without passing all 5 gates:

1. **Read it line by line.** Can you explain every line's purpose without referencing the AI prompt?
2. **Trace it on the given example.** Run it manually step by step on the sample input.
3. **Generate your own edge cases.** Empty array, single element, all duplicates, negative numbers, maximum constraint values.
4. **Calculate the complexity yourself.** State the time and space complexity from the code structure, not from what the AI claimed.
5. **Delete it and rewrite from scratch.** If you cannot reproduce the logic in 5 minutes without the AI output, it is not yours yet.

---

### Language-Specific Prompting Tips

- **TypeScript / JavaScript (relevant to your stack)**
  - Prompt: "Explain why this async/await chain creates a memory leak under this specific condition."
  - Prompt: "Show me how to implement this LRU cache using a doubly linked list and a Map in JavaScript with full edge case coverage."

- **Problem Constraints Interpretation**
  - Prompt: "Given n up to 10^5 and k up to 10^9, which algorithms are ruled out by time complexity and why?"
  - This forces you to see AI as a complexity-budget calculator.

---

## Section 3: AI for System Design Questions — Framing, Diagramming, and Defense

### The System Design Preparation Loop

System design questions are not about memorizing architectures — they are about structured, first-principles reasoning. AI accelerates preparation through realistic simulation.

Weekly prep loop (30 minutes):
- 10 min: Pick a design question (URL shortener, notification service, CI pipeline, collaborative editor).
- 10 min: Design independently. Draw boxes, write capacity estimates, pick data stores.
- 10 min: Prompt AI with your design and ask for gaps, better alternatives, and trade-off analysis.

This preserves the independent reasoning muscle while using AI to compress the feedback loop from days (waiting for a mentor) to minutes.

---

### Framing System Design Questions with AI

When you are unsure how to approach a system design problem, use this structured prompt formula:

Initial framing prompt:

    I need to design [system]. My current understanding of the requirements is [requirements].
    I want to reason about this from first principles. Before showing me an architecture:
    1. What are the 3 most critical clarifying questions I should ask?
    2. What is the realistic scale I should design for (DAU, QPS, storage growth)?
    3. What are the 2 to 3 most common failure modes in systems like this?

Then design yourself. Then ask AI to critique your design against those failure modes.

---

### Capacity Estimation with AI

AI is excellent at stress-testing your capacity estimates. Use this pattern:

1. Produce your own estimate first (storage/day, peak QPS, bandwidth).
2. Show AI your math and say: "Find the error in my assumptions or arithmetic."
3. Ask: "What scale does this need to reach before this bottleneck becomes the primary constraint?"

This trains a rigorous estimation habit while using AI to catch errors.

Example prompts for your projects:
- "NexusIDE has 500 concurrent collaborative editing sessions. Each session emits ~50 cursor events per second. Calculate the peak Redis Pub/Sub throughput, and at what scale does a single Redis instance become the bottleneck?"
- "MagnusCI processes 1,000 webhook builds per hour. Each build runs 6 parallel DAG stages, each averaging 3 minutes. Calculate worker count, queue depth, and tmpfs RAM allocation required."

---

### Generating and Answering Probing Questions

Use AI to simulate the interviewer for your system design responses. After drawing your architecture, prompt:

    Act as a senior distributed systems engineer. I have just proposed this architecture: [your architecture].
    Generate the 10 most difficult probing questions a grilling interviewer would ask, in order from surface-level to adversarial.

Then answer each question yourself without AI. After answering, use AI to evaluate your response quality against the Four-Step Defense:
1. Direct Answer (1 sentence)
2. Technical Rationale (2 sentences)
3. Trade-off Acknowledgment (1 sentence)
4. Next-Generation Evolution (1 sentence)

---

### Common System Design Patterns to Master via AI

For each pattern, use AI to understand mechanics, failure modes, and the specific trade-off that led to choosing it:

- **Event-Driven Architecture (relevant: MagnusCI BullMQ)**
  - Probe: "Under what conditions does BullMQ at-least-once delivery cause data corruption instead of just duplication?"

- **CRDT Synchronization (relevant: NexusIDE Yjs)**
  - Probe: "Explain how Yjs handles a network partition where two clients make concurrent edits to the same list. What is the merge order guarantee?"

- **Content-Addressable Storage (relevant: NexusIDE Merkle DAG)**
  - Probe: "How do you garbage-collect unreferenced SHA-256 blobs in a live system without a full scan?"

- **Rate Limiting and Backpressure**
  - Probe: "What is the difference between token bucket and leaky bucket rate limiting? Which is more appropriate for webhook ingestion, and why?"

- **Distributed Locking**
  - Probe: "Why is a single-instance Redis SET NX lock safer to reason about than multi-node Redlock in most practical deployments?"

- **DAG Execution Scheduling**
  - Probe: "Compare Kahn's topological sort algorithm to a dynamic readiness frontier for parallel DAG execution. When is one superior?"

---

## Section 4: AI for Project Question Prep (NexusIDE and MagnusCI)

### The Interview Simulation Protocol

Before any interview that may involve your projects, run this 30-minute AI warm-up session:

1. Open a fresh AI conversation. Paste the project architecture summary (draw from guide.md Section 4 or 5).
2. Say: "Act as a senior engineer interviewing me about this project. Ask me 15 grilling questions across architecture, failure modes, security, and scalability. Ask one at a time and wait for me to respond."
3. Answer each question out loud (verbally, not by typing) before you type any response to AI.
4. After answering all 15, ask AI: "Evaluate my answers for precision, hedging, and gap coverage."

This simulates the psychological pressure of real interviews while providing rapid feedback on accuracy.

---

### NexusIDE: AI-Assisted Deep Dive Probes

Use AI to grill yourself on these specific areas. For each area, the prompt format is: "Grill me on [topic] in NexusIDE until I can answer without hedging."

- **CRDT Merge Semantics**
  - Probe target: Explain Yjs YATA model, state vector exchange protocol, tombstone memory management.
  - Failure mode to defend: Pod crash during editing — exact recovery sequence for surviving clients.

- **Adaptive Debouncer**
  - Probe target: Explain the 4-tier velocity thresholds (300 ms / 800 ms / 2,500 ms / 5,000 ms ceiling) and why each tier exists.
  - Failure mode to defend: What if the 5,000 ms ceiling is hit and the database is unavailable? What is the exact data loss window?

- **Distributed Lock Safety**
  - Probe target: Explain why this is a single-instance mutex and not Redlock. Explain the TTL expiration race condition.
  - Failure mode to defend: Pod 1 takes 9 seconds on a DB write while the lock TTL is 8 seconds. Trace the exact failure path.

- **Container Pool Allocator**
  - Probe target: Explain the warm pool sizing formula and the pre-warm trigger heuristic (user authentication event).
  - Failure mode to defend: Peak arrival rate exceeds the pool. What is the fallback path and the exact latency regression?

- **Binary Cursor Codec**
  - Probe target: Explain the 8-byte frame encoding: [uint16 userHash, line, col, selectionLength]. State the collision rate at 50 users (~1.88%).
  - Failure mode to defend: Line 65,536 in a generated file exceeds uint16. What happens and how would you extend the codec?

- **Merkle DAG CAS**
  - Probe target: Trace the full snapshot creation path from dirty file detection to PostgreSQL write.
  - Failure mode to defend: Two simultaneous snapshots from two users. Is there a write conflict? Where?

---

### MagnusCI: AI-Assisted Deep Dive Probes

- **HMAC Webhook Verification**
  - Probe target: Explain why HMAC verification runs against the raw body buffer before JSON parsing. Explain `timingSafeEqual`.
  - Failure mode to defend: GitHub retransmits a webhook with the same delivery ID. Trace the exact deduplication path.

- **BullMQ Queue Semantics**
  - Probe target: Explain at-least-once delivery, stalled-job detection, and the heartbeat mechanism.
  - Failure mode to defend: Worker receives job, begins executing, then crashes at 90% completion. What happens to the build state?

- **Dynamic DAG Execution**
  - Probe target: Trace `executeDAG` in `backend/src/utils/dag.js` — explain DFS cycle detection and the `Promise.race` readiness frontier.
  - Failure mode to defend: Stage B depends on A, and A hangs indefinitely without exiting. Does the DAG scheduler deadlock?

- **tmpfs Build Sandboxes**
  - Probe target: Explain why `/dev/shm` is faster than ext4 for build compilation. Explain the fallback to `/tmp`.
  - Failure mode to defend: A Rust build generates a 4 GB binary in a container with 2 GB of tmpfs. What is the exact kernel response?

- **Supply Chain Security**
  - Probe target: Explain the risk of secrets exposure in fork pull requests. Explain build preview origin isolation.
  - Failure mode to defend: An external contributor's PR submits a pipeline stage that runs `curl http://169.254.169.254`. Is it blocked? How?

- **Log Streaming Offset**
  - Probe target: Explain how monotonic sequence IDs prevent duplicate or missing log lines on client reconnect.
  - Failure mode to defend: Client disconnects at log line 4,500 of a 10,000-line test run. Reconnects after 30 seconds. Trace the exact log stitching path.

---

### Building Interview-Ready Verbal Answers with AI

For any project question you struggle to answer fluently, use this drilling protocol:

1. Attempt a verbal answer. Type it out exactly as you would say it.
2. Paste it into AI and say: "Evaluate this answer on: technical precision, absence of hedging words (e.g. sort of, kind of, I think), structure (direct statement to rationale to trade-off to evolution), and duration (should be under 2 minutes at normal speaking pace)."
3. Revise based on feedback.
4. Repeat until AI evaluates it as crisp, direct, and precise.
5. Then delete the AI-refined answer and rewrite it from scratch. Only your reconstruction matters.

---

## Section 5: Pre-Interview AI Warm-Up Routines

### The 48-Hour-Before Routine (60 Minutes Total)

Run this 48 hours before any technical interview:

- **20 Minutes: Coding Pattern Review**
  - Prompt: "Give me 3 medium-difficulty problems spanning DP, graphs, and sliding window. Do not show solutions. Give me problem statements only."
  - Solve each for 5 minutes independently. Check solutions after.
  - Identify which pattern felt rusty — spend the remaining time on that one.

- **20 Minutes: Project Grilling Simulation**
  - Prompt: "Grill me on NexusIDE and MagnusCI with 10 hard questions mixing architecture, failure modes, and security. Ask one at a time."
  - Answer every question verbally before reading the next.

- **20 Minutes: System Design Speed Round**
  - Prompt: "Give me a system design question at the difficulty of a mid-level backend interview. Do not give hints."
  - Design for 15 minutes using a blank document as a whiteboard.
  - Spend 5 minutes asking AI to identify the 3 weakest parts of your design.

---

### The Morning-Of Routine (20 Minutes)

Do not grind problems the morning of an interview. Run a lightweight confidence-building session:

- **5 Minutes: Recall Activation**
  - Prompt: "Ask me 5 verbal warm-up questions about distributed systems fundamentals: consistency models, consensus, CAP theorem, distributed locks, and event-driven queues."
  - Answer each out loud without reading or typing.

- **5 Minutes: Pitch Rehearsal**
  - Say both the NexusIDE and MagnusCI 2-minute pitches out loud without reading them. (See guide.md Section 8.)

- **10 Minutes: Calm Scan**
  - Skim your quick-reference metrics card (latency numbers, test suite sizes, algorithm complexity).
  - Read the Definition of Done checklist from guide.md Section 9 once.

---

### The Post-Interview Debrief Routine (30 Minutes)

Run this within 2 hours of completing any interview:

1. Prompt: "I just answered the following questions in a technical interview: [list questions and your approximate answers]. Identify where my answers likely had gaps or inaccuracies."
2. For every flagged gap, trace it back to the specific code or design in NexusIDE or MagnusCI.
3. Write a 3-bullet correction note for each gap and add it to this file under the Interview Debrief Log section at the bottom.
4. Schedule 15 minutes within 72 hours to practice that specific topic verbally until it is fluent.

This turns every interview — successful or unsuccessful — into a compounding improvement cycle.

---

## Section 6: Prompt Playbook — Ready-to-Use Templates

A catalogue of high-leverage prompts organized by use case. Copy, fill in the brackets, and run.

---

### For Coding Problem Preparation

    I am preparing for placement coding rounds. I have solved [problem name / type].
    My solution uses [approach]. I want to:
    1. Understand why [alternative approach] would be faster or more elegant.
    2. See the 3 most adversarial edge cases I am likely to have missed.
    3. Understand the time complexity of both approaches step by step.
    Do not show me code until I have answered your first clarifying question.

---

### For System Design Grilling

    Act as a skeptical senior engineer interviewing me for a backend role.
    I will describe my system design for [system name].
    For each component I describe, ask me the hardest single follow-up question
    before I move to the next component. Start when I begin describing.

---

### For Project Defense Simulation

    Act as a technical interviewer. I will describe my project [NexusIDE / MagnusCI].
    After my description, ask me 10 questions in order from surface to adversarial,
    covering: architecture, concurrency, failure modes, security, and scaling.
    After I answer each one, rate my answer: Crisp / Hedging / Inaccurate.
    Do not give me the correct answer until I have given 3 attempts.

---

### For Failure Mode Discovery

    Here is the architecture of [NexusIDE / MagnusCI component]:
    [paste component description]
    Generate 7 realistic failure scenarios ranked by likelihood in a production deployment.
    For each, state: the trigger, the exact system behavior, and the detection mechanism.
    Do not include anything I would need to validate against my actual codebase.

---

### For Verbal Answer Refinement

    I am preparing to answer this interview question verbally:
    [question]
    Here is my current answer: [your drafted answer]
    Evaluate it on:
    1. Technical precision — is every claim accurate?
    2. Structure — does it follow: direct statement, rationale, trade-off, evolution?
    3. Hedging — flag every instance of uncertain language.
    4. Duration — estimate speaking time at 130 words per minute.
    Then give me a revised version that corrects only the structural and hedging problems,
    without changing any technical claims (those are mine to verify).

---

### For Complexity Analysis Verification

    I solved this problem with [algorithm]. I believe the time complexity is O(X)
    and space complexity is O(Y).
    Walk me through whether my analysis is correct by examining:
    1. The outer loop structure.
    2. The inner operation cost.
    3. Any auxiliary data structures I allocated.
    Point out only the error in my reasoning if there is one.

---

### For ADR (Architectural Decision Record) Drafting

    I need to write an Architectural Decision Record (ADR) for this decision in my project:
    [decision made, e.g., "using a single-instance Redis mutex instead of Redlock"]
    Use this structure: Context, Decision, Alternatives Considered, Consequences and Trade-offs.
    Generate a draft that includes only what I provide. Do not invent benchmarks or claims
    I have not stated. Flag [VERIFY] wherever you make an assumption I need to confirm.

---

## Section 7: AI Tool Landscape — When to Use What

### Tool Selection Matrix

- **Grilling simulation and mock interview:** Claude (extended thinking) or GPT-4o — adversarial reasoning quality.
- **Explaining algorithm intuition:** Claude or Gemini 1.5 Pro — long context, nuanced explanation.
- **Edge case generation for code:** GPT-4o or Claude — reliable enumeration.
- **Capacity estimation math checking:** Any capable model — arithmetic verification.
- **ADR drafting:** Claude — structured document generation.
- **Verbal answer evaluation:** Claude with explicit evaluation instructions — structured critique output.
- **Code complexity analysis:** GPT-4o or Claude — step-by-step reasoning on loop structure.
- **GitHub Copilot in editor:** Only during preparation, never during a timed exam — autocomplete is not understanding.

---

### GitHub Copilot Discipline Rules

Copilot is valuable during preparation, not during an interview. Apply these rules:

- **Rule 1:** Accept a Copilot suggestion only if you can explain every token of its output without re-reading it.
- **Rule 2:** Before accepting, say the next line of code out loud first. If Copilot confirms it, you understood it. If it diverges, reconsider.
- **Rule 3:** During mock timed problems, disable Copilot for the first 10 minutes of every session. Build the muscle before using the crutch.
- **Rule 4:** Every Copilot-accepted suggestion in a non-trivial component of NexusIDE or MagnusCI must be traced back to its algorithmic justification in the relevant guide document.

---

### Model Context Management for Long Sessions

When running long AI preparation sessions (30+ minutes), maintain context quality:

- Open each session with a brief context anchor: "I am preparing for placement interviews. My main projects are NexusIDE (collaborative IDE with Yjs CRDTs and Redis) and MagnusCI (CI engine with BullMQ and DAG scheduling). Keep all questions and feedback grounded in these projects."
- Every 15 minutes, if the conversation drifts, paste a 3-line architecture summary to re-anchor.
- Use separate AI sessions for coding prep and project defense prep — mixed context reduces precision.

---

## Section 8: Anti-Patterns and Red Flags to Avoid

### Anti-Pattern 1: The Transcript Learner

- Behavior: Reading AI-generated answers to project questions, nodding, and moving on.
- Why it fails: The interviewer will ask a level-3 follow-up. You will have no depth to draw on because you consumed the answer without constructing it.
- Correction: Close the AI output. Restate the answer in your own words into a blank document. If you cannot, the answer is not yours yet.

---

### Anti-Pattern 2: The Template Pitcher

- Behavior: Using an AI-generated system design template for every question (always starting with load balancer, then CDN, then cache, then database sharding).
- Why it fails: Senior interviewers recognize the template immediately. It signals that you are pattern-matching buzzwords, not reasoning about the specific problem.
- Correction: Start every design with the specific bottleneck of the given problem, not with infrastructure. Ask AI: "What is the single hardest technical problem in designing [X]?" Design to solve that first.

---

### Anti-Pattern 3: The Complexity Truster

- Behavior: Accepting AI's stated time complexity without verifying from the code structure.
- Why it fails: AI makes complexity errors under novel problem structures. Interviewers who ask "why is this O(n log n)?" expect a derivation, not a recitation.
- Correction: Run the 5-Gate Code Verification check (Section 2) for every AI-generated solution. Derive complexity from loop structure yourself.

---

### Anti-Pattern 4: The False Claim Amplifier

- Behavior: Asking AI to "make your project description sound more impressive" or asking it to inflate benchmarks.
- Why it fails: Every claim about NexusIDE and MagnusCI must be reproducible from source code. An interviewer who asks you to run the benchmark live will immediately expose inflation.
- Correction: Use AI only to improve the structure and precision of your descriptions, never the claims. The claims are owned by the codebase — see guide.md Section 2.

---

### Anti-Pattern 5: The Pre-Prompt Rusher

- Behavior: Prompting AI with the full problem statement within 60 seconds of reading it.
- Why it fails: Placement tests often have time-limited problem sets. Dependence on AI before developing independent first-contact reflexes is a skill regression.
- Correction: Enforce the 10-minute independent rule (Section 2) as a hard constraint during every practice session.

---

### Anti-Pattern 6: The Verbal Bypass

- Behavior: Typing all answers during AI grilling sessions instead of answering out loud.
- Why it fails: Interviews are verbal. Typing answers during preparation builds a completely different cognitive pathway than speaking under pressure.
- Correction: All project grilling and system design simulation answers must be spoken aloud first. Type only to capture the summary after speaking.

---

## Section 9: Interview-Day Execution Tracker

### Per-Interview Preparation Checklist

Complete this before every technical interview:

- [ ] 1. Ran the 48-hour-before AI warm-up routine (60 min).
- [ ] 2. Ran the morning-of routine without opening the projects or notes (20 min).
- [ ] 3. Can state both 2-minute pitches (NexusIDE, MagnusCI) verbally without reading.
- [ ] 4. Can recall p50/p95 latency numbers and key metrics without notes.
- [ ] 5. Completed at least 1 adversarial project grilling session this week.
- [ ] 6. Solved at least 2 coding problems in the last 48 hours (one medium, one hard).
- [ ] 7. Reviewed the Four-Step Defense structure (direct answer, rationale, trade-off, evolution).
- [ ] 8. Know which version of each project is deployed, and can state the deployment platform (OCI Ampere A1).

---

### Monthly AI Preparation Milestone Tracker

- [ ] October 2026: Run 4 full grilling simulation sessions on NexusIDE and MagnusCI ground truth. Target: 31 October 2026.
- [ ] November 2026: Build and internalize AI-assisted ADR drafts for 5 core decisions per project. Target: 30 November 2026.
- [ ] December 2026: Run 3 timed system design sessions (45 min each) with AI critique; no templates. Target: 31 December 2026.
- [ ] January 2027: Achieve zero AI corrections in grilling session for NexusIDE failure mode questions. Target: 31 January 2027.
- [ ] February 2027: Achieve zero AI corrections in grilling session for MagnusCI DAG and queue questions. Target: 28 February 2027.
- [ ] March 2027: Complete a full mock interview with AI as adversarial interviewer; record and self-evaluate. Target: 31 March 2027.
- [ ] April 2027: Can answer all 15 core probes from Section 4 in under 2 minutes each without notes. Target: 30 April 2027.
- [ ] May 2027: All verbal answers score "Crisp" on AI evaluation rubric. No hedging words remain. Target: 31 May 2027.
- [ ] June 2027: Feature freeze on AI preparation — no new patterns, only fluency reinforcement. Target: 30 June 2027.

---

### Interview Debrief Log

Use this section to record gaps discovered after each interview. Add new entries at the top.

    --- [DATE] | [COMPANY] | [ROUND TYPE] ---
    Questions that exposed gaps:
    - [Question 1]: [What you said] -> [What was missing]
    - [Question 2]: [What you said] -> [What was missing]
    Correction actions:
    - [Action 1]: Review [specific code file or guide section], re-run grilling on this topic.
    - [Action 2]: Add AI grilling session within 72 hours.
