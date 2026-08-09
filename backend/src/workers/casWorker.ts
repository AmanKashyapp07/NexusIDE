import { parentPort } from 'worker_threads';
import crypto from 'crypto';
import * as Y from 'yjs';

export interface WorkerTreeEntry {
  name: string;
  type: 'blob' | 'tree';
  hash: string;
  path: string;
  language?: string | null;
  sizeBytes?: number;
}

export interface WorkerBlobRecord {
  hash: string;
  content: string;
  sizeBytes: number;
}

export interface WorkerTreeRecord {
  hash: string;
  entries: WorkerTreeEntry[];
}

export interface WorkerMerkleDAG {
  rootTreeHash: string;
  blobsToInsert: WorkerBlobRecord[];
  treesToInsert: WorkerTreeRecord[];
}

function hashContent(content: string): { hash: string; sizeBytes: number } {
  const normalized = content ?? '';
  const hash = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  const sizeBytes = Buffer.byteLength(normalized, 'utf8');
  return { hash, sizeBytes };
}

function hashTreeEntries(entries: WorkerTreeEntry[]): { hash: string; canonicalEntries: WorkerTreeEntry[] } {
  const sorted = [...entries].sort((a, b) =>
    a.name.localeCompare(b.name) || (a.path || '').localeCompare(b.path || '')
  );
  const serialized = JSON.stringify(sorted);
  const hash = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
  return { hash, canonicalEntries: sorted };
}

function executeBuildMerkleTree(
  files: { path: string; content: string; language?: string | null }[]
): WorkerMerkleDAG {
  const blobsMap = new Map<string, WorkerBlobRecord>();
  const rootEntries: WorkerTreeEntry[] = [];

  for (const file of files) {
    const content = file.content ?? '';
    const { hash, sizeBytes } = hashContent(content);

    if (!blobsMap.has(hash)) {
      blobsMap.set(hash, { hash, content, sizeBytes });
    }

    const name = file.path.split('/').pop() || file.path;

    rootEntries.push({
      name,
      type: 'blob',
      hash,
      path: file.path,
      language: file.language ?? null,
      sizeBytes,
    });
  }

  const { hash: rootTreeHash, canonicalEntries } = hashTreeEntries(rootEntries);
  const treesToInsert: WorkerTreeRecord[] = [{ hash: rootTreeHash, entries: canonicalEntries }];
  const blobsToInsert = Array.from(blobsMap.values());

  return { rootTreeHash, blobsToInsert, treesToInsert };
}

function executeMergeYjsUpdates(updates: Uint8Array[], baseState?: Uint8Array | null): Uint8Array {
  const doc = new Y.Doc({ gc: false });
  try {
    if (baseState && baseState.length > 0) {
      Y.applyUpdate(doc, baseState);
    }
    for (const update of updates) {
      if (update && update.length > 0) {
        Y.applyUpdate(doc, update);
      }
    }
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

if (parentPort) {
  parentPort.on('message', (payload: any) => {
    const { taskId, type, files, updates, baseState } = payload;
    try {
      if (type === 'BUILD_MERKLE_TREE' && files) {
        const merkleDag = executeBuildMerkleTree(files);
        parentPort?.postMessage({ taskId, success: true, merkleDag });
      } else if (type === 'MERGE_YJS_UPDATES' && updates) {
        const mergedState = executeMergeYjsUpdates(updates, baseState);
        parentPort?.postMessage({ taskId, success: true, mergedState });
      } else {
        parentPort?.postMessage({ taskId, success: false, error: `Invalid task type or payload` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({ taskId, success: false, error: msg });
    }
  });
}
