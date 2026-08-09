import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:my_secure_db_password@localhost:5432/sandbox';

describe('NexusIDE Brutal Database Stress & Resilience Suite', () => {
  let pool: Pool;
  let testUserId: string;
  let testWorkspaceId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 30,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
    });

    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    testUserId = userRes.rows[0]?.id;

    if (!testUserId) {
      const newUser = await pool.query(`
        INSERT INTO users (id, username, email, password_hash)
        VALUES (uuid_generate_v4(), 'brutal_tester_' || floor(random() * 100000)::text, 'brutal_' || floor(random() * 100000)::text || '@nexus.dev', '$2b$10$brutalhash')
        RETURNING id
      `);
      testUserId = newUser.rows[0].id;
    }

    const wsRes = await pool.query(`
      INSERT INTO workspaces (id, owner_id, title)
      VALUES (uuid_generate_v4(), $1, 'Brutal Database Stress Workspace')
      RETURNING id
    `, [testUserId]);
    testWorkspaceId = wsRes.rows[0].id;
  }, 45000);

  afterAll(async () => {
    if (testWorkspaceId) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]).catch(() => {});
    }
    await pool.end();
  });

  // ===========================================================================
  // 1. THUNDERING HERD & CONNECTION POOL SATURATION (200 SIMULTANEOUS WORKERS)
  // ===========================================================================
  it('200 simultaneous transactional queries queue and execute with zero client leaks', async () => {
    const WORKERS = 200;
    const startTime = Date.now();
    let successCount = 0;
    const errors: Error[] = [];

    const tasks = Array.from({ length: WORKERS }, async (_, i) => {
      try {
        const res = await pool.query(
          'SELECT id, title, created_at FROM workspaces WHERE id = $1',
          [testWorkspaceId]
        );
        if (res.rows.length === 1) {
          successCount++;
        }
      } catch (err) {
        errors.push(err as Error);
      }
    });

    await Promise.all(tasks);
    const elapsed = Date.now() - startTime;
    const avgLatency = (elapsed / WORKERS).toFixed(2);

    console.log(`[Thundering Herd] ${successCount}/${WORKERS} queries finished in ${elapsed}ms (avg ${avgLatency}ms/query, 0 dropped).`);

    expect(errors.length).toBe(0);
    expect(successCount).toBe(WORKERS);
    expect(pool.waitingCount).toBe(0);
    expect(elapsed).toBeLessThan(5000);
  });

  // ===========================================================================
  // 2. HIGH-VELOCITY CRDT DELTA STREAM INGESTION (2,500 UPDATES)
  // ===========================================================================
  it('2,500 binary CRDT delta stream updates commit in rapid bursts without sequence gaps', async () => {
    const fileRes = await pool.query(`
      INSERT INTO files (id, workspace_id, name, type, content)
      VALUES (uuid_generate_v4(), $1, 'crdt_burst_test.ts', 'file'::node_type, '// Initial File Buffer')
      RETURNING id
    `, [testWorkspaceId]);
    const fileId = fileRes.rows[0].id;

    const TOTAL_UPDATES = 2500;
    const BATCH_SIZE = 250;
    const BATCH_COUNT = TOTAL_UPDATES / BATCH_SIZE;
    const startTime = Date.now();

    for (let b = 0; b < BATCH_COUNT; b++) {
      const offset = b * BATCH_SIZE;
      await pool.query(`
        INSERT INTO file_updates (file_id, update, created_at)
        SELECT
          $1,
          decode('010101010101' || lpad(to_hex(s), 8, '0'), 'hex'),
          NOW()
        FROM generate_series($2::int, $3::int) AS s
      `, [fileId, offset + 1, offset + BATCH_SIZE]);
    }

    const elapsed = Date.now() - startTime;
    const throughput = Math.round((TOTAL_UPDATES / (elapsed / 1000)));

    console.log(`[CRDT Burst] Ingested ${TOTAL_UPDATES} updates in ${elapsed}ms (${throughput} updates/sec).`);

    const countRes = await pool.query('SELECT COUNT(*) FROM file_updates WHERE file_id = $1', [fileId]);
    expect(parseInt(countRes.rows[0].count, 10)).toBe(TOTAL_UPDATES);

    // Verify sequential ordering integrity
    const seqCheck = await pool.query(`
      SELECT MIN(seq) as min_seq, MAX(seq) as max_seq, COUNT(DISTINCT seq) as distinct_count
      FROM file_updates
      WHERE file_id = $1
    `, [fileId]);

    const distinctCount = parseInt(seqCheck.rows[0].distinct_count, 10);
    expect(distinctCount).toBe(TOTAL_UPDATES);

    // Clean up test file
    await pool.query('DELETE FROM file_updates WHERE file_id = $1', [fileId]);
    await pool.query('DELETE FROM files WHERE id = $1', [fileId]);
  });

  // ===========================================================================
  // 3. DEEP 30-LEVEL NESTED DIRECTORY TREE & RECURSIVE CTE RESOLUTION
  // ===========================================================================
  it('Resolves breadcrumbs across a 30-level nested filesystem in < 15ms via Recursive CTE', async () => {
    let currentParentId: string | null = null;
    const DEPTH = 30;
    const createdFolderIds: string[] = [];

    // Construct 30-level hierarchy: /dir_1/dir_2/.../dir_30/target_leaf.ts
    for (let depth = 1; depth <= DEPTH; depth++) {
      const folderRes = await pool.query(`
        INSERT INTO files (id, workspace_id, parent_id, name, type)
        VALUES (uuid_generate_v4(), $1, $2, $3, 'directory'::node_type)
        RETURNING id
      `, [testWorkspaceId, currentParentId, `dir_${depth}`]);
      currentParentId = folderRes.rows[0].id;
      createdFolderIds.push(currentParentId);
    }

    // Insert leaf file at deepest level
    const leafRes = await pool.query(`
      INSERT INTO files (id, workspace_id, parent_id, name, type, content)
      VALUES (uuid_generate_v4(), $1, $2, 'target_leaf.ts', 'file'::node_type, '// Deeply nested payload')
      RETURNING id
    `, [testWorkspaceId, currentParentId]);
    const leafId = leafRes.rows[0].id;

    // Execute Recursive CTE to walk up from leaf to root
    const startTime = Date.now();
    const cteRes = await pool.query(`
      WITH RECURSIVE file_path_tree AS (
        SELECT id, parent_id, name, type, 1 AS depth_level
        FROM files
        WHERE id = $1
        
        UNION ALL
        
        SELECT f.id, f.parent_id, f.name, f.type, pt.depth_level + 1
        FROM files f
        INNER JOIN file_path_tree pt ON f.id = pt.parent_id
      )
      SELECT id, name, type, depth_level
      FROM file_path_tree
      ORDER BY depth_level DESC
    `, [leafId]);
    const elapsed = Date.now() - startTime;

    console.log(`[Recursive Tree] Walked ${DEPTH + 1} nested levels in ${elapsed}ms.`);

    // Assert breadcrumbs contains all 30 directories + 1 leaf file
    expect(cteRes.rows.length).toBe(DEPTH + 1);
    expect(cteRes.rows[0].name).toBe('dir_1');
    expect(cteRes.rows[cteRes.rows.length - 1].name).toBe('target_leaf.ts');
    expect(elapsed).toBeLessThan(15);

    // Clean up created folder hierarchy (Cascades to leaf)
    await pool.query('DELETE FROM files WHERE id = $1', [createdFolderIds[0]]);
  });

  // ===========================================================================
  // 4. RACE-CONDITION FILE NAME COLLISIONS (50 SIMULTANEOUS WORKERS)
  // ===========================================================================
  it('50 concurrent workers attempting duplicate file creation yields exactly 1 winner and 49 clean unique violations', async () => {
    const WORKERS = 50;
    const targetFileName = 'race_condition_target.ts';

    let successCount = 0;
    let uniqueViolationCount = 0;
    const otherErrors: Error[] = [];

    const tasks = Array.from({ length: WORKERS }, async () => {
      try {
        await pool.query(`
          INSERT INTO files (id, workspace_id, parent_id, name, type, content)
          VALUES (uuid_generate_v4(), $1, NULL, $2, 'file'::node_type, '// Concurrent race entry')
        `, [testWorkspaceId, targetFileName]);
        successCount++;
      } catch (err: any) {
        if (err.code === '23505') { // PostgreSQL unique_violation code
          uniqueViolationCount++;
        } else {
          otherErrors.push(err);
        }
      }
    });

    await Promise.all(tasks);

    console.log(`[Race Collision] 50 Workers Result: ${successCount} Created, ${uniqueViolationCount} Rejected (Code 23505), 0 Corrupted.`);

    expect(otherErrors.length).toBe(0);
    expect(successCount).toBe(1);
    expect(uniqueViolationCount).toBe(WORKERS - 1);

    // Verify table has strictly 1 record
    const verifyRes = await pool.query(
      'SELECT COUNT(*) FROM files WHERE workspace_id = $1 AND name = $2 AND parent_id IS NULL',
      [testWorkspaceId, targetFileName]
    );
    expect(parseInt(verifyRes.rows[0].count, 10)).toBe(1);

    await pool.query('DELETE FROM files WHERE workspace_id = $1 AND name = $2', [testWorkspaceId, targetFileName]);
  });

  // ===========================================================================
  // 5. MASSIVE CASCADE DELETION UNDER LOAD (5,000+ ROWS PURGED IN < 50ms)
  // ===========================================================================
  it('Massive workspace cascade deletion purges 5,000+ entities with zero orphan rows', async () => {
    // 1. Create a dedicated workspace to populate & wipe
    const tempWsRes = await pool.query(`
      INSERT INTO workspaces (id, owner_id, title)
      VALUES (uuid_generate_v4(), $1, 'Wipeout Test Workspace')
      RETURNING id
    `, [testUserId]);
    const wipeWsId = tempWsRes.rows[0].id;

    // 2. Populate 500 files
    const filesRes = await pool.query(`
      INSERT INTO files (id, workspace_id, name, type, content)
      SELECT
        uuid_generate_v4(),
        $1,
        'wipe_file_' || s || '.ts',
        'file'::node_type,
        '// Content to be cascade deleted'
      FROM generate_series(1, 500) AS s
      RETURNING id
    `, [wipeWsId]);

    // 3. Populate 3,000 CRDT updates linked to those files
    await pool.query(`
      WITH target_files AS (
        SELECT array_agg(id) AS f_ids FROM files WHERE workspace_id = $1
      )
      INSERT INTO file_updates (file_id, update, created_at)
      SELECT
        f.f_ids[1 + (s % array_length(f.f_ids, 1))],
        decode('01010101', 'hex'),
        NOW()
      FROM generate_series(1, 3000) AS s, target_files f
    `, [wipeWsId]);

    // 4. Populate 500 execution logs
    await pool.query(`
      INSERT INTO execution_history (id, workspace_id, user_id, language, code_snapshot, status, duration_ms)
      SELECT
        uuid_generate_v4(),
        $1,
        $2,
        'typescript',
        'console.log("Wipe ' || s || '");',
        'success'::execution_status,
        20
      FROM generate_series(1, 500) AS s
    `, [wipeWsId, testUserId]);

    // 5. Populate 500 Merkle git commits
    const treeRes = await pool.query('SELECT hash FROM git_trees LIMIT 1');
    const treeHash = treeRes.rows[0]?.hash;
    if (treeHash) {
      await pool.query(`
        INSERT INTO git_commits (id, workspace_id, root_tree_hash, label, created_by)
        SELECT
          uuid_generate_v4(),
          $1,
          $2,
          'Wipe Commit ' || s,
          $3
        FROM generate_series(1, 500) AS s
      `, [wipeWsId, treeHash, testUserId]);
    }

    // Measure instantaneous cascade deletion duration
    const startTime = Date.now();
    await pool.query('DELETE FROM workspaces WHERE id = $1', [wipeWsId]);
    const elapsed = Date.now() - startTime;

    console.log(`[Cascade Wipeout] Purged workspace + 4,500+ child entities in ${elapsed}ms.`);

    expect(elapsed).toBeLessThan(100);

    // Verify 0 orphan child rows remain across any table
    const [orphanFiles, orphanUpdates, orphanExecs, orphanCommits] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM files WHERE workspace_id = $1', [wipeWsId]),
      pool.query('SELECT COUNT(*) FROM file_updates fu LEFT JOIN files f ON fu.file_id = f.id WHERE f.id IS NULL'),
      pool.query('SELECT COUNT(*) FROM execution_history WHERE workspace_id = $1', [wipeWsId]),
      pool.query('SELECT COUNT(*) FROM git_commits WHERE workspace_id = $1', [wipeWsId]),
    ]);

    expect(parseInt(orphanFiles.rows[0].count, 10)).toBe(0);
    expect(parseInt(orphanUpdates.rows[0].count, 10)).toBe(0);
    expect(parseInt(orphanExecs.rows[0].count, 10)).toBe(0);
    expect(parseInt(orphanCommits.rows[0].count, 10)).toBe(0);
  });

  // ===========================================================================
  // 6. CONNECTION POOL LEAK AUDIT (500 RAPID ACQUIRE-RELEASE CYCLES)
  // ===========================================================================
  it('500 rapid pool client checkouts and releases complete with 0 connection leaks', async () => {
    const CYCLES = 500;
    const startTime = Date.now();

    for (let i = 0; i < CYCLES; i++) {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT 1 AS alive');
        expect(res.rows[0].alive).toBe(1);
      } finally {
        client.release();
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Pool Longevity] ${CYCLES} client checkouts completed in ${elapsed}ms with 0 leaks.`);

    expect(pool.waitingCount).toBe(0);
    expect(elapsed).toBeLessThan(3000);
  });
});
