-- Purpose: Enables uuid generation and encryption extensions inside the database registry.
-- Design Decisions: Using uuid-ossp for distributed primary key generation avoids auto-increment ID leaks.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables to ensure a clean state (Idempotent schema migration)
DROP TABLE IF EXISTS execution_history CASCADE;
DROP TABLE IF EXISTS file_updates CASCADE;
DROP TABLE IF EXISTS snapshot_files CASCADE;
DROP TABLE IF EXISTS workspace_snapshots CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS workspace_collaborators CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS node_type CASCADE;
DROP TYPE IF EXISTS collaborator_role CASCADE;
DROP TYPE IF EXISTS execution_status CASCADE;

-- Purpose: Updates the updated_at timestamp attribute before any row update query commits.
-- Under the Hood: Intercepts the row payload update and sets NEW.updated_at to current timestamp.
-- Complexity: Time Complexity O(1), Space Complexity O(1).
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. USERS TABLE
-- Purpose: Persists developer accounts, emails, encrypted passwords, and optional GitHub OAuth tokens.
-- Design Decisions: github_token is stored with length 1024 to support secure scoped API key headers.
-- Security: email and username are marked UNIQUE to block duplicate record allocations.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    github_id VARCHAR(255) UNIQUE,
    github_token VARCHAR(1024),
    avatar_url VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER set_timestamp_users
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 2. WORKSPACES TABLE
-- Purpose: Stores active developer projects, directories, metadata, and visibility flags.
-- Under the Hood: ON DELETE CASCADE forces deletion of child files and collaborators when a workspace is deleted.
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Project',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Purpose: Speeds up filter scans matching owner_id.
-- Complexity: Search query index search O(log W).
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

CREATE TRIGGER set_timestamp_workspaces
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 3. WORKSPACE COLLABORATORS (Role-based access controls)
-- Purpose: Enforces weights-based access hierarchies (viewer, editor, admin) per user per workspace.
-- Design Decisions: Uses a composite primary key (workspace_id, user_id) to prevent duplicate user mappings.
CREATE TYPE collaborator_role AS ENUM ('viewer', 'editor', 'admin');

CREATE TABLE workspace_collaborators (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role collaborator_role NOT NULL DEFAULT 'viewer',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_collaborators_user ON workspace_collaborators(user_id);

-- 4. FILES & DIRECTORIES TABLE
-- Purpose: Models virtual filesystem directory trees for sandboxes.
-- Design Decisions: parent_id self-references the files table. A NULL value represents a root-level file.
--                   yjs_state stores binary CRDT vectors. author_map persists cursor identity keys.
CREATE TYPE node_type AS ENUM ('file', 'directory');

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES files(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    content TEXT, 
    yjs_state BYTEA, 
    author_map JSONB DEFAULT '{}'::jsonb, 
    language VARCHAR(50), 
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Purpose: Prevents folder path duplication.
-- Under the Hood: Enforces name uniqueness within the same parent folder (parent_id) or root scope.
CREATE UNIQUE INDEX unique_name_root ON files (workspace_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX unique_name_child ON files (workspace_id, parent_id, name) WHERE parent_id IS NOT NULL;

CREATE INDEX idx_files_workspace ON files(workspace_id);
CREATE INDEX idx_files_parent ON files(parent_id);

CREATE TRIGGER set_timestamp_files
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 5. EXECUTION HISTORY LOGS
-- Purpose: Logs compiler execution histories, duration metrics, and resource footprints.
CREATE TYPE execution_status AS ENUM ('success', 'failed', 'timeout', 'error');

CREATE TABLE execution_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    language VARCHAR(50) NOT NULL,
    code_snapshot TEXT NOT NULL,
    output TEXT,
    status execution_status NOT NULL,
    duration_ms INTEGER,
    memory_usage_bytes BIGINT,
    cpu_usage_percent NUMERIC(5, 2),
    file_name VARCHAR(255),
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_executions_workspace ON execution_history(workspace_id);
CREATE INDEX idx_executions_user ON execution_history(user_id);

-- 5b. FILE UPDATE STREAM (Timelapse replay buffers)
-- Purpose: Logs incremental binary Yjs character modifications.
-- Under the Hood: Stores raw update vectors in sequence. The timelapse replayer reads these 
--               ordered by seq to reconstruct editing history.
-- Design Decisions: Using BYTEA for update payloads stores raw binary streams efficiently.
CREATE TABLE file_updates (
    file_id    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    seq        BIGSERIAL,
    update     BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (file_id, seq)
);

CREATE INDEX idx_file_updates_file ON file_updates(file_id);

-- 6. WORKSPACE SNAPSHOTS
-- Purpose: Persists points-in-time workspace metadata milestones.
-- Design Decisions: Flat snapshot directory path lookup tables enable fast checkout actions.
CREATE TABLE workspace_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL DEFAULT 'Snapshot',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshots_workspace ON workspace_snapshots(workspace_id);

-- 6b. SNAPSHOT FILES TABLE
-- Purpose: Stores individual file records belonging to workspace snapshots.
-- Under the Hood: Flattens directory structures to single path columns for fast rendering and diff calculations.
CREATE TABLE snapshot_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_id UUID NOT NULL REFERENCES workspace_snapshots(id) ON DELETE CASCADE,
    path TEXT NOT NULL, 
    content TEXT,
    language VARCHAR(50)
);

CREATE INDEX idx_snapshot_files_snapshot ON snapshot_files(snapshot_id);

-- 7. SNAPSHOT EVICTION TRIGGER
-- Purpose: Limits workspaces to a maximum of 10 snapshots to prevent database bloat.
-- Under the Hood:
 *   1. Counts active snapshots for a workspace.
 *   2. If the count exceeds 10, queries the oldest snapshot IDs sorted by created_at.
 *   3. Deletes excess oldest rows, cascades file removals automatically.
-- Complexity: Time Complexity O(S log S) where S is the snapshot count, Space Complexity O(1).
CREATE OR REPLACE FUNCTION evict_old_snapshots()
RETURNS TRIGGER AS $$
DECLARE
  excess_count INTEGER;
BEGIN
  SELECT COUNT(*) - 10 INTO excess_count
  FROM workspace_snapshots
  WHERE workspace_id = NEW.workspace_id;

  IF excess_count > 0 THEN
    DELETE FROM workspace_snapshots
    WHERE id IN (
      SELECT id FROM workspace_snapshots
      WHERE workspace_id = NEW.workspace_id
      ORDER BY created_at ASC
      LIMIT excess_count
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_snapshot_limit
AFTER INSERT ON workspace_snapshots
FOR EACH ROW EXECUTE PROCEDURE evict_old_snapshots();
