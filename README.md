# Collaborative Cloud IDE & Sandbox

A production-oriented collaborative cloud IDE and sandbox built with React, Vite, Express, PostgreSQL, Yjs, and WebSockets. The project is being developed in weekly milestones, and **Week 1 is complete**.

## Current Status

Week 1 delivered the core foundation:

- Auth flow for login and registration
- Polished IDE and auth UI
- Workspace shell with file explorer, editor, and terminal panels
- PostgreSQL schema for users, workspaces, files, and execution history
- Local code execution support for multiple languages
- Yjs collaboration groundwork and WebSocket integration

This README is a living document and will be updated as the project moves through later weeks.

## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS
- Editor: Monaco Editor
- Collaboration: Yjs, y-websocket, WebSockets
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- Sandbox: Local execution for now, with Docker-based isolation planned next

## Project Structure

- `frontend/` - React client application
- `backend/` - Express API, auth, workspace routes, and execution logic
- `database/` - PostgreSQL schema and initialization scripts
- `reports/` - Architecture notes, week summaries, and roadmap documents

## Week 1 Highlights

- Built the base UI for the auth page and IDE page
- Added a workspace layout with sidebar, editor, and terminal areas
- Defined the relational database schema for core entities
- Set up backend routes for authentication and workspace management
- Added the first working code execution flow

## Next Milestones

- Week 2: Real-time collaboration and durable Yjs persistence
- Week 3: Docker-based sandbox isolation and execution hardening
- Week 4: Polish, deployment, and interview prep

## Local Development

The exact setup may evolve, but the project is currently split into frontend and backend services.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npm run dev
```

### Database

Use the SQL in `database/schema.sql` and the docker setup in `docker-compose.yml` to bring up PostgreSQL locally.

## Notes

- The IDE route is available at `/ide`.
- The login page redirects authenticated users to the IDE.
- The reports in `reports/` document the design decisions and the Week 1 foundation.
