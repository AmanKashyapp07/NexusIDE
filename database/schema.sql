-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables to ensure a clean slate (Idempotent)
DROP TABLE IF EXISTS execution_history CASCADE;
DROP TABLE IF EXISTS snapshot_files CASCADE;
DROP TABLE IF EXISTS workspace_snapshots CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS workspace_collaborators CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS node_type CASCADE;
DROP TYPE IF EXISTS collaborator_role CASCADE;
DROP TYPE IF EXISTS execution_status CASCADE;

-- Function to automatically update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. USERS TABLE
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
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Project',
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

CREATE TRIGGER set_timestamp_workspaces
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 3. WORKSPACE COLLABORATORS (Role-based access)
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
CREATE TYPE node_type AS ENUM ('file', 'directory');

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES files(id) ON DELETE CASCADE, -- NULL means root level
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    content TEXT, 
    yjs_state BYTEA, -- CRDT state persistence for Yjs
    language VARCHAR(50), 
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX unique_name_root ON files (workspace_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX unique_name_child ON files (workspace_id, parent_id, name) WHERE parent_id IS NOT NULL;

CREATE INDEX idx_files_workspace ON files(workspace_id);
CREATE INDEX idx_files_parent ON files(parent_id);

CREATE TRIGGER set_timestamp_files
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 5. EXECUTION HISTORY LOGS
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

-- 6. WORKSPACE SNAPSHOTS
-- Stores point-in-time snapshots of a workspace (max 10 per workspace).
-- Each snapshot captures a label, who created it, and when.
-- snapshot_files stores the flattened file content at snapshot time (no parent_id
-- hierarchy needed — just path + content for fast diff rendering).
CREATE TABLE workspace_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL DEFAULT 'Snapshot',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_snapshots_workspace ON workspace_snapshots(workspace_id);

CREATE TABLE snapshot_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_id UUID NOT NULL REFERENCES workspace_snapshots(id) ON DELETE CASCADE,
    path TEXT NOT NULL,       -- e.g. "src/index.js" (relative, using / separator)
    content TEXT,
    language VARCHAR(50)
);

CREATE INDEX idx_snapshot_files_snapshot ON snapshot_files(snapshot_id);

-- Trigger: enforce max 10 snapshots per workspace (oldest evicted automatically)
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
