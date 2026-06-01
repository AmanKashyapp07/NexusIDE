-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- useful for hashing or random gen if needed

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
    password_hash VARCHAR(255) NOT NULL,
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
-- Supports nested directory structures
CREATE TYPE node_type AS ENUM ('file', 'directory');

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES files(id) ON DELETE CASCADE, -- NULL means root level
    name VARCHAR(255) NOT NULL,
    type node_type NOT NULL,
    content TEXT, -- Null for directories
    language VARCHAR(50), -- Only relevant for files
    size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Ensure no duplicate file names in the same folder
    CONSTRAINT unique_name_per_parent UNIQUE NULLS NOT DISTINCT (workspace_id, parent_id, name)
);

CREATE INDEX idx_files_workspace ON files(workspace_id);
CREATE INDEX idx_files_parent ON files(parent_id);

CREATE TRIGGER set_timestamp_files
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- 5. EXECUTION HISTORY LOGS
-- Audit trail for secure code execution metrics
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
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_executions_workspace ON execution_history(workspace_id);
CREATE INDEX idx_executions_user ON execution_history(user_id);
