# NexusIDE

<div align="center">

### Production-Ready Collaborative Cloud IDE

Real-time collaboration • Docker Sandboxing • Persistent Terminals • AI Autocomplete • Language Server Protocol • GitHub Integration

<p align="center">
  <a href="https://github.com/AmanKashyapp07/sandbox-ide"><strong>View Repository</strong></a>
  ·
  <a href="https://github.com/AmanKashyapp07/sandbox-ide">Live Demo</a>
  ·
  <a href="https://github.com/AmanKashyapp07/sandbox-ide/issues">Report Issue</a>
</p>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

> **Inspired by GitHub Codespaces and Replit, NexusIDE is a production-oriented cloud IDE that focuses on real-world infrastructure challenges such as collaborative editing, secure code execution, container lifecycle management, language intelligence, and distributed synchronization.**

</div>

---

# Table of Contents

- Features
- Architecture
- Engineering Highlights
- Technology Stack
- Security
- Performance Optimizations
- Getting Started
- Engineering Learnings
- Future Improvements
- License

---

# Features

| Feature | Description |
|----------|-------------|
| Real-time Collaboration | Conflict-free collaborative editing using Yjs CRDTs |
| Persistent Workspaces | Long-lived Docker development environments |
| Interactive Terminal | xterm.js connected directly to Docker PTY |
| AI Autocomplete | Gemini Fill-in-the-Middle completion |
| Language Intelligence | Pyright & TypeScript LSP integration |
| GitHub Import | Import repositories through OAuth |
| Live Collaboration | Presence indicators and multi-user editing |
| Voice Collaboration | WebRTC signaling via Socket.IO |
| File Synchronization | Editor ↔ Docker bidirectional synchronization |
| Role Based Access | Secure Admin / Editor / Viewer permissions |

---

# Interview Summary

> **NexusIDE is a browser-based collaborative development environment that securely executes user code inside isolated Docker containers while supporting real-time CRDT editing, persistent terminals, language servers, GitHub integration, and AI-powered code completion.**
>
> **The backend focuses on production engineering problems including container pooling, workspace multiplexing, binary CRDT persistence, PTY streaming, JSON-RPC language server bridging, and aggressive resource optimization.**

---

# Architecture

```mermaid
graph TD
    %% Browser Layer
    A1[Monaco Editor]
    A2[xterm.js Terminal]
    A3[Yjs CRDT Client]
    A4[Socket.IO Client]

    %% Gateway Layer
    B1[Express HTTP Server]
    B2[Raw WebSockets Upgrade Handler]
    B3[Socket.IO Event Gateway]

    %% Business Logic
    C1[GitHub Auth & OAuth Manager]
    C2[Workspace Lifecycle Coordinator]
    C3[LSP Stream Bridge]
    C4[AI Autocomplete Engine]
    C5[CRDT Sync Engine]

    %% Resource Layer
    D1[PostgreSQL Database]
    D2[Docker Pool Manager]
    D3[Active Workspace Containers]
    D4[Gemini AI Endpoint]

    %% Client to Gateway Connections
    A1 <-->|JSON-RPC| B2
    A2 <-->|PTY Stream| B2
    A3 <-->|CRDT Sync Messages| B2
    A4 <-->|Voice Signaling / Presence / Tree Events| B3

    %% Gateway to Logic Routing
    B1 -->|Import / Setup| C1
    B1 -->|REST Actions| C2
    B2 -->|Raw WebSocket Streams| C3 & C5
    B1 -->|Autocomplete Prompting| C4

    %% Logic to Infrastructure / Resource Connections
    C1 & C2 <-->|Schema Operations| D1
    C2 -->|Control Loop / Provision| D2
    D2 -->|Pre-warmed Containers| D3
    C3 <-->|Docker Stream Bindings| D3
    C4 <-->|Prompt Completion| D4
    C5 <-->|Binary Blob Updates| D1
```

---

# Engineering Highlights

## Persistent Docker Workspaces

Unlike traditional online compilers, every workspace owns a persistent development container.

### Implemented

- Interactive PTY bridge using xterm.js
- Persistent shell sessions
- Dynamic workspace allocation
- Automatic workspace restoration

### Optimization

- Warm Docker container pools
- Zero-latency terminal startup
- Workspace reference counting
- Multiple browser tabs share one container
- Automatic idle hibernation after 30 minutes

---

## Real-Time Collaboration

Built on **Yjs CRDTs** for conflict-free concurrent editing.

### Features

- Binary CRDT persistence
- State-vector synchronization
- Incremental update propagation
- Debounced database persistence
- Presence synchronization

Result:

- No merge conflicts
- Offline editing support
- Eventual consistency
- Low bandwidth synchronization

---

## Docker Sandboxing

The execution environment is heavily isolated.

### Resource Isolation

- 1 GB RAM
- 1.5 CPU cores
- PID limits
- Container networking isolation

### File Hydration & Persistent Storage

Workspace files are physically persisted on the host server's disk and mapped into the container using **Docker Bind Mounts**. This simulates enterprise Persistent Block Storage (like AWS EBS), eliminating the need to repeatedly stream tarballs from the database into a temporary RAM filesystem. This results in instant container hydration and native SSD speeds for massive operations like `npm install`.

---

## Language Server Bridge

Instead of embedding language servers inside the frontend, NexusIDE launches language servers inside the user's Docker workspace.

Supported:

- Pyright
- TypeScript Language Server

Communication uses JSON-RPC packets streamed through Raw WebSockets into Docker exec streams.

---

## Bidirectional File Synchronization

Editor changes automatically synchronize with Docker while terminal-created files immediately appear inside the frontend explorer.

Synchronization includes

- File creation
- File deletion
- Rename detection
- Live explorer updates

---

# Technology Stack

| Layer | Technologies |
|--------|--------------|
| Frontend | React, TypeScript, Tailwind CSS, Monaco Editor, xterm.js |
| Backend | Node.js, Express, Socket.IO, ws, Dockerode |
| Database | PostgreSQL |
| Collaboration | Yjs CRDT |
| AI | Gemini API |
| Language Intelligence | Pyright, TypeScript Language Server |
| Authentication | JWT, GitHub OAuth |
| Infrastructure | Docker Engine API |

---

# Security

- Docker container isolation
- JWT authentication
- Workspace authorization
- Role-based permissions
- Environment variable secret management
- Resource limiting
- Dynamic port exposure
- Network isolation
- Protected REST endpoints
- Protected WebSocket handlers

---

# Performance Optimizations

| Optimization | Purpose |
|--------------|---------|
| Warm Docker Pool | Eliminate container startup latency |
| Workspace Multiplexing | One container shared across multiple tabs |
| Docker Bind Mounts | Instant zero-hydration startup & native SSD speeds |
| Binary CRDT Storage | Reduce synchronization overhead |
| Debounced Database Writes | Prevent excessive writes |
| AFK Heartbeat | Automatic idle cleanup |
| State Vector Sync | Transfer only missing CRDT operations |

---

# Repository Structure

```
frontend/
│
├── components/
├── pages/
├── hooks/
├── services/

backend/
│
├── routes/
├── websocket/
├── docker/
├── lsp/
├── github/
├── collaboration/

database/
│
├── schema.sql

shared/
│
├── types/
├── utils/
```

---

# Getting Started

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Docker Engine
- GitHub OAuth Application

---

## Installation

Clone repository

```bash
git clone https://github.com/AmanKashyapp07/sandbox-ide.git
cd sandbox-ide
```

Initialize database

```bash
createdb sandbox

psql -d sandbox -f database/schema.sql
```

Configure environment

```env
PORT=4000

DATABASE_URL=postgresql://username@localhost:5432/sandbox

JWT_SECRET=...

GITHUB_CLIENT_ID=...

GITHUB_CLIENT_SECRET=...

GEMINI_API_KEY=...
```

Install dependencies

```bash
cd backend
npm install

cd ../frontend
npm install
```

Start backend

```bash
cd backend

npm run dev
```

Start frontend

```bash
cd frontend

npm run dev
```

---

# Engineering Learnings

- CRDTs simplify distributed collaborative editing compared to Operational Transform.
- Warm container pools dramatically reduce perceived startup latency.
- Reference-counted container reuse significantly lowers infrastructure cost.
- Language servers should execute inside the same filesystem visible to users.
- Binary persistence minimizes storage and synchronization overhead.
- Proper lifecycle management and graceful cleanup are essential for long-running container workloads.

---

# Future Improvements

- Kubernetes deployment
- Horizontal container scaling
- Redis Pub/Sub for distributed collaboration
- Collaborative debugging
- Workspace snapshots
- Version history
- Distributed LSP workers
- Multi-region deployment

---

# License

Distributed under the MIT License.

---

# Author

**Aman Kashyap**

IIIT Allahabad

GitHub:
https://github.com/AmanKashyapp07

Repository:
https://github.com/AmanKashyapp07/sandbox-ide

---

### Project Goal

NexusIDE was built to explore the systems engineering challenges behind modern cloud development environments. Rather than wrapping existing services, the project implements the underlying infrastructure—from collaborative synchronization and container orchestration to language intelligence and resource management—to demonstrate production-oriented backend and distributed systems design.