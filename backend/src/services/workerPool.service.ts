/**
 * Purpose: Worker Thread Pool for CPU-heavy background computations.
 * High-Level Architecture: Offloads synchronous CPU-bound operations (SHA-256 Merkle tree hashing,
 * canonical JSON serialization, and Yjs update merging) away from Node.js single-threaded main loop.
 */

import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import type { MerkleDAG } from './cas.service.js';

export type WorkerTaskType = 'BUILD_MERKLE_TREE' | 'MERGE_YJS_UPDATES';

export interface WorkerTaskPayload {
  taskId: string;
  type: WorkerTaskType;
  files?: { path: string; content: string; language?: string | null }[];
  updates?: Uint8Array[];
  baseState?: Uint8Array | null;
}

export interface WorkerTaskResult {
  taskId: string;
  success: boolean;
  merkleDag?: MerkleDAG;
  mergedState?: Uint8Array;
  error?: string;
}

export interface WorkerPoolOptions {
  poolSize?: number;
}

export class WorkerPoolService {
  private workers: Worker[] = [];
  private idleWorkerIndices: number[] = [];
  private taskQueue: Array<{
    payload: WorkerTaskPayload;
    resolve: (result: WorkerTaskResult) => void;
    reject: (reason?: any) => void;
  }> = [];
  private taskMap = new Map<string, { resolve: (result: WorkerTaskResult) => void; reject: (reason?: any) => void; workerIndex: number }>();
  private nextTaskId = 1;
  private poolSize: number;
  private workerScriptPath: string;

  constructor(options: WorkerPoolOptions = {}) {
    const numCpus = os.cpus().length || 2;
    this.poolSize = options.poolSize || Math.min(Math.max(numCpus - 1, 2), 4);

    const dir = typeof __dirname !== 'undefined' ? __dirname : path.resolve('./src/services');
    this.workerScriptPath = path.join(dir, '../workers/casWorker.js');

    this.initializePool();
  }

  private initializePool(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker(i);
    }
  }

  private createWorker(index: number): void {
    try {
      const worker = new Worker(this.workerScriptPath);

      worker.on('message', (result: WorkerTaskResult) => {
        const entry = this.taskMap.get(result.taskId);
        if (entry) {
          this.taskMap.delete(result.taskId);
          this.idleWorkerIndices.push(entry.workerIndex);
          if (result.success) {
            entry.resolve(result);
          } else {
            entry.reject(new Error(result.error || 'Worker task failed'));
          }
          this.processNextTask();
        }
      });

      worker.on('error', (err) => {
        console.error(`[WorkerPool] Worker ${index} error:`, err);
        for (const [taskId, entry] of this.taskMap.entries()) {
          if (entry.workerIndex === index) {
            this.taskMap.delete(taskId);
            entry.reject(err);
          }
        }
        this.recreateWorker(index);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(`[WorkerPool] Worker ${index} exited with code ${code}`);
          this.recreateWorker(index);
        }
      });

      this.workers[index] = worker;
      this.idleWorkerIndices.push(index);
    } catch (err) {
      console.error(`[WorkerPool] Failed to instantiate worker thread ${index}:`, err);
    }
  }

  private recreateWorker(index: number): void {
    const idleIdx = this.idleWorkerIndices.indexOf(index);
    if (idleIdx !== -1) {
      this.idleWorkerIndices.splice(idleIdx, 1);
    }
    try {
      this.workers[index]?.terminate();
    } catch {}
    this.createWorker(index);
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0 || this.idleWorkerIndices.length === 0) {
      return;
    }

    const workerIndex = this.idleWorkerIndices.shift()!;
    const task = this.taskQueue.shift()!;
    const worker = this.workers[workerIndex];

    if (!worker) {
      this.taskQueue.unshift(task);
      return;
    }

    this.taskMap.set(task.payload.taskId, {
      resolve: task.resolve,
      reject: task.reject,
      workerIndex,
    });

    worker.postMessage(task.payload);
  }

  public runTask(payload: Omit<WorkerTaskPayload, 'taskId'>): Promise<WorkerTaskResult> {
    return new Promise((resolve, reject) => {
      const taskId = `task_${this.nextTaskId++}_${Date.now()}`;
      const fullPayload: WorkerTaskPayload = { taskId, ...payload };

      this.taskQueue.push({ payload: fullPayload, resolve, reject });
      this.processNextTask();
    });
  }

  public async buildMerkleTreeOffloaded(
    files: { path: string; content: string; language?: string | null }[]
  ): Promise<MerkleDAG> {
    try {
      const result = await this.runTask({
        type: 'BUILD_MERKLE_TREE',
        files,
      });
      if (result.merkleDag) {
        return result.merkleDag;
      }
      throw new Error('No Merkle DAG returned from worker thread');
    } catch (err) {
      console.warn(`[WorkerPool] Offloaded buildMerkleTree failed, falling back to inline:`, err);
      const { CASService } = await import('./cas.service.js');
      return CASService.buildMerkleTreeInline(files);
    }
  }

  public async mergeYjsUpdatesOffloaded(
    updates: Uint8Array[],
    baseState?: Uint8Array | null
  ): Promise<Uint8Array> {
    try {
      const result = await this.runTask({
        type: 'MERGE_YJS_UPDATES',
        updates,
        baseState: baseState ?? null,
      });
      if (result.mergedState) {
        return result.mergedState;
      }
      throw new Error('No merged state returned from worker thread');
    } catch (err) {
      console.warn(`[WorkerPool] Offloaded mergeYjsUpdates failed, falling back to inline:`, err);
      const Y = await import('yjs');
      const doc = new Y.Doc({ gc: false });
      if (baseState && baseState.length > 0) {
        Y.applyUpdate(doc, baseState);
      }
      for (const u of updates) {
        if (u && u.length > 0) {
          Y.applyUpdate(doc, u);
        }
      }
      const res = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      return res;
    }
  }

  public terminate(): void {
    for (const worker of this.workers) {
      worker.terminate().catch(() => {});
    }
    this.workers = [];
    this.idleWorkerIndices = [];
    this.taskQueue = [];
    this.taskMap.clear();
  }
}

export const workerPoolService = new WorkerPoolService();
