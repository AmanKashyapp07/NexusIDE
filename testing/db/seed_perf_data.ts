import { Pool } from 'pg';

export interface SeedOptions {
  usersCount?: number;
  workspacesCount?: number;
  filesPerWorkspace?: number;
  totalFileUpdates?: number;
  gitBlobsCount?: number;
  executionsCount?: number;
  connectionString?: string;
  silent?: boolean;
}

export interface SeedResult {
  usersCount: number;
  workspacesCount: number;
  collaboratorsCount: number;
  filesCount: number;
  fileUpdatesCount: number;
  gitBlobsCount: number;
  gitTreesCount: number;
  gitCommitsCount: number;
  executionsCount: number;
  elapsedMs: number;
}

export async function seedPerformanceDatabase(pool: Pool, options: SeedOptions = {}): Promise<SeedResult> {
  const usersCount = options.usersCount ?? 10000;
  const workspacesCount = options.workspacesCount ?? 1000;
  const totalFileUpdates = options.totalFileUpdates ?? 100000;
  const gitBlobsCount = options.gitBlobsCount ?? 10000;
  const executionsCount = options.executionsCount ?? 5000;
  const silent = options.silent ?? false;

  const log = (msg: string) => {
    if (!silent) console.log(`[DB Seeder] ${msg}`);
  };

  const startTime = Date.now();

  // 1. Check existing dataset size
  const userCheck = await pool.query('SELECT count(*) AS count FROM users');
  const existingUsers = parseInt(userCheck.rows[0].count, 10);

  const wsCheck = await pool.query('SELECT count(*) AS count FROM workspaces');
  const existingWorkspaces = parseInt(wsCheck.rows[0].count, 10);

  if (existingUsers >= 5000 && existingWorkspaces >= 1000) {
    log(`Database already seeded with ${existingUsers.toLocaleString()} users & ${existingWorkspaces.toLocaleString()} workspaces. Updating planner statistics...`);
    await pool.query(`
      ANALYZE users;
      ANALYZE workspaces;
      ANALYZE workspace_collaborators;
      ANALYZE files;
      ANALYZE file_updates;
      ANALYZE git_blobs;
      ANALYZE git_trees;
      ANALYZE git_commits;
      ANALYZE execution_history;
    `).catch(() => {});

    const fileCheck = await pool.query('SELECT count(*) AS count FROM files');
    const updateCheck = await pool.query('SELECT count(*) AS count FROM file_updates');
    const collabCheck = await pool.query('SELECT count(*) AS count FROM workspace_collaborators');
    const commitCheck = await pool.query('SELECT count(*) AS count FROM git_commits');

    return {
      usersCount: existingUsers,
      workspacesCount: existingWorkspaces,
      collaboratorsCount: parseInt(collabCheck.rows[0]?.count || '0', 10),
      filesCount: parseInt(fileCheck.rows[0]?.count || '0', 10),
      fileUpdatesCount: parseInt(updateCheck.rows[0]?.count || '0', 10),
      gitBlobsCount: gitBlobsCount,
      gitTreesCount: 1000,
      gitCommitsCount: parseInt(commitCheck.rows[0]?.count || '0', 10),
      executionsCount: executionsCount,
      elapsedMs: Date.now() - startTime,
    };
  }

  log(`Starting high-speed database seed (10K+ users, 1K+ workspaces, 100K+ updates)...`);

  // Ensure necessary schema extensions and tables exist
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  `);

  // Ensure required database indexes are created
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);
    CREATE INDEX IF NOT EXISTS idx_collaborators_user ON workspace_collaborators(user_id);
    CREATE INDEX IF NOT EXISTS idx_collab_auth ON workspace_collaborators (workspace_id, user_id) INCLUDE (role);
    CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_id);
    CREATE INDEX IF NOT EXISTS idx_files_tree ON files (workspace_id, parent_id, type DESC, name ASC) INCLUDE (id, language);
    CREATE INDEX IF NOT EXISTS idx_files_id_workspace ON files (id, workspace_id) INCLUDE (content, yjs_state, author_map);
    CREATE INDEX IF NOT EXISTS idx_executions_workspace ON execution_history(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_executions_user ON execution_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_file_updates_file ON file_updates(file_id);
    CREATE INDEX IF NOT EXISTS idx_file_updates_ordered ON file_updates(file_id, seq ASC) INCLUDE (update);
    CREATE INDEX IF NOT EXISTS idx_git_commits_workspace ON git_commits(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_git_commits_created ON git_commits(workspace_id, created_at DESC);
  `);

  // 2. Ultra-fast array batch seed for Users (10,000+ rows)
  log(`Seeding ${usersCount.toLocaleString()} users...`);
  await pool.query(`
    INSERT INTO users (id, username, email, password_hash, github_id, created_at, updated_at)
    SELECT
      uuid_generate_v4(),
      'perf_user_' || s || '_' || floor(random() * 1000000)::text,
      'perf_user_' || s || '_' || floor(random() * 1000000)::text || '@nexuside.test',
      '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789perfhash',
      'gh_perf_' || s || '_' || floor(random() * 1000000)::text,
      NOW() - (random() * interval '90 days'),
      NOW()
    FROM generate_series(1, $1) AS s
    ON CONFLICT (username) DO NOTHING;
  `, [usersCount]);

  // 3. Fast Workspace Seeding with Pre-fetched User IDs
  log(`Seeding ${workspacesCount.toLocaleString()} collaborative workspaces...`);
  await pool.query(`
    WITH user_ids AS (
      SELECT array_agg(id) AS ids FROM (SELECT id FROM users LIMIT 1000) sub
    )
    INSERT INTO workspaces (id, owner_id, title, description, is_public, created_at, updated_at)
    SELECT
      uuid_generate_v4(),
      u.ids[1 + (s % array_length(u.ids, 1))],
      'Project ' || s || ' - Realtime IDE Workspace',
      'High-throughput collaborative workspace with CRDT and Monaco editor.',
      (random() > 0.3),
      NOW() - (random() * interval '60 days'),
      NOW() - (random() * interval '10 days')
    FROM generate_series(1, $1) AS s, user_ids u;
  `, [workspacesCount]);

  // 4. Batch Seed Workspace Collaborators
  log(`Seeding workspace collaborators (RBAC roles)...`);
  await pool.query(`
    WITH ws AS (
      SELECT array_agg(id) AS ws_ids FROM (SELECT id FROM workspaces LIMIT 1000) sub
    ),
    usr AS (
      SELECT array_agg(id) AS u_ids FROM (SELECT id FROM users LIMIT 2000) sub
    )
    INSERT INTO workspace_collaborators (workspace_id, user_id, role, joined_at)
    SELECT
      w.ws_ids[1 + (s % array_length(w.ws_ids, 1))],
      u.u_ids[1 + ((s * 7) % array_length(u.u_ids, 1))],
      (ARRAY['viewer', 'editor', 'admin']::collaborator_role[])[1 + (s % 3)],
      NOW() - (random() * interval '30 days')
    FROM generate_series(1, 4000) AS s, ws w, usr u
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  `);

  // 5. Batch Seed Files and Directories
  log(`Seeding 25,000+ files and directory structures...`);
  await pool.query(`
    INSERT INTO files (id, workspace_id, parent_id, name, type, content, language, size_bytes, created_at, updated_at)
    SELECT
      uuid_generate_v4(),
      w.id,
      NULL,
      'src',
      'directory'::node_type,
      NULL,
      NULL,
      0,
      NOW() - interval '20 days',
      NOW() - interval '20 days'
    FROM (SELECT id FROM workspaces LIMIT 1000) w;
  `);

  await pool.query(`
    WITH src_dirs AS (
      SELECT id AS src_id, workspace_id FROM files WHERE type = 'directory' AND name = 'src' LIMIT 1000
    )
    INSERT INTO files (id, workspace_id, parent_id, name, type, content, language, size_bytes, author_map, created_at, updated_at)
    SELECT
      uuid_generate_v4(),
      d.workspace_id,
      d.src_id,
      (ARRAY['index.ts', 'app.tsx', 'utils.ts', 'server.ts', 'schema.ts', 'main.go', 'Cargo.toml', 'styles.css', 'README.md', 'config.json'])[s],
      'file'::node_type,
      '// Performance Benchmark Sample Code File ' || s || E'\\nexport function run() { return true; }',
      (ARRAY['typescript', 'typescript', 'typescript', 'typescript', 'typescript', 'go', 'toml', 'css', 'markdown', 'json'])[s],
      128 + s * 32,
      '{"1": {"userId": "perf_user", "username": "Alice", "color": "#6366f1"}}'::jsonb,
      NOW() - (random() * interval '15 days'),
      NOW()
    FROM src_dirs d
    CROSS JOIN generate_series(1, 10) AS s;
  `);

  // 6. Batch Seed File Updates / CRDT Deltas (100,000+ rows)
  log(`Seeding ${totalFileUpdates.toLocaleString()}+ CRDT file updates (binary deltas)...`);
  await pool.query(`
    WITH target_files AS (
      SELECT array_agg(id) AS f_ids FROM (SELECT id FROM files WHERE type = 'file' LIMIT 1000) sub
    )
    INSERT INTO file_updates (file_id, seq, update, created_at)
    SELECT
      f.f_ids[1 + (s % array_length(f.f_ids, 1))],
      1 + (s / array_length(f.f_ids, 1)),
      decode('010101010101' || lpad(to_hex(s), 8, '0'), 'hex'),
      NOW() - ((100 - (s % 100)) * interval '1 second')
    FROM generate_series(1, $1) AS s, target_files f
    ON CONFLICT (file_id, seq) DO NOTHING;
  `, [totalFileUpdates]);

  // 7. Batch Seed Merkle DAG (Git Blobs, Trees, Commits)
  log(`Seeding Git Blobs, Trees, and Commits...`);
  await pool.query(`
    INSERT INTO git_blobs (hash, content, size_bytes, created_at)
    SELECT
      encode(digest('blob_content_' || s, 'sha256'), 'hex'),
      '// Deduplicated Content Addressable Storage Chunk ' || s,
      64 + (s % 512),
      NOW() - (random() * interval '30 days')
    FROM generate_series(1, $1) AS s
    ON CONFLICT (hash) DO NOTHING;
  `, [gitBlobsCount]);

  await pool.query(`
    WITH sample_blobs AS (
      SELECT array_agg(hash) AS b_hashes FROM (SELECT hash FROM git_blobs LIMIT 1000) sub
    )
    INSERT INTO git_trees (hash, entries, created_at)
    SELECT
      encode(digest('tree_content_' || s, 'sha256'), 'hex'),
      jsonb_build_array(
        jsonb_build_object('name', 'index.ts', 'type', 'blob', 'hash', b.b_hashes[1 + (s % array_length(b.b_hashes, 1))], 'path', 'src/index.ts', 'sizeBytes', 128)
      ),
      NOW() - (random() * interval '30 days')
    FROM generate_series(1, 1000) AS s, sample_blobs b
    ON CONFLICT (hash) DO NOTHING;
  `);

  await pool.query(`
    WITH ws AS (
      SELECT array_agg(id) AS ws_ids, array_agg(owner_id) AS owners FROM (SELECT id, owner_id FROM workspaces LIMIT 1000) sub
    ),
    trees AS (
      SELECT array_agg(hash) AS t_hashes FROM (SELECT hash FROM git_trees LIMIT 1000) sub
    )
    INSERT INTO git_commits (id, workspace_id, parent_commit_id, root_tree_hash, label, created_by, created_at)
    SELECT
      uuid_generate_v4(),
      w.ws_ids[1 + (s % array_length(w.ws_ids, 1))],
      NULL,
      t.t_hashes[1 + (s % array_length(t.t_hashes, 1))],
      'Checkpoint ' || s,
      w.owners[1 + (s % array_length(w.owners, 1))],
      NOW() - (random() * interval '14 days')
    FROM generate_series(1, 3000) AS s, ws w, trees t;
  `);

  // 8. Batch Seed Execution History
  log(`Seeding Execution History logs...`);
  await pool.query(`
    WITH ws AS (
      SELECT array_agg(id) AS ws_ids, array_agg(owner_id) AS owners FROM (SELECT id, owner_id FROM workspaces LIMIT 1000) sub
    )
    INSERT INTO execution_history (id, workspace_id, user_id, language, code_snapshot, output, status, duration_ms, memory_usage_bytes, cpu_usage_percent, file_name, executed_at)
    SELECT
      uuid_generate_v4(),
      w.ws_ids[1 + (s % array_length(w.ws_ids, 1))],
      w.owners[1 + (s % array_length(w.owners, 1))],
      'typescript',
      'console.log("Execution Test ' || s || '");',
      'Execution Test ' || s || ' completed with status 0\n',
      'success'::execution_status,
      45 + (s % 150),
      1024 * 1024 * 32 + (s % (1024 * 1024 * 64)),
      12.5 + (s % 30),
      'index.ts',
      NOW() - (random() * interval '10 days')
    FROM generate_series(1, $1) AS s, ws w;
  `, [executionsCount]);

  // Update PostgreSQL query planner statistics
  log(`Updating PostgreSQL query planner statistics...`);
  await pool.query(`
    ANALYZE users;
    ANALYZE workspaces;
    ANALYZE workspace_collaborators;
    ANALYZE files;
    ANALYZE file_updates;
    ANALYZE git_blobs;
    ANALYZE git_trees;
    ANALYZE git_commits;
    ANALYZE execution_history;
  `);

  const elapsedMs = Date.now() - startTime;
  log(`Database Seeding Completed in ${(elapsedMs / 1000).toFixed(2)}s!`);

  const userRes = await pool.query('SELECT count(*) AS count FROM users');
  const wsRes = await pool.query('SELECT count(*) AS count FROM workspaces');
  const fileRes = await pool.query('SELECT count(*) AS count FROM files');
  const updateRes = await pool.query('SELECT count(*) AS count FROM file_updates');

  return {
    usersCount: parseInt(userRes.rows[0].count, 10),
    workspacesCount: parseInt(wsRes.rows[0].count, 10),
    collaboratorsCount: 4000,
    filesCount: parseInt(fileRes.rows[0].count, 10),
    fileUpdatesCount: parseInt(updateRes.rows[0].count, 10),
    gitBlobsCount: gitBlobsCount,
    gitTreesCount: 1000,
    gitCommitsCount: 3000,
    executionsCount: executionsCount,
    elapsedMs,
  };
}
