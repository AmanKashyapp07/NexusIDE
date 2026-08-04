import Docker from 'dockerode';
import { warmPoolManager, WORKSPACE_DATA_DIR } from './pool.js';
import { getPool } from '../db.js';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import type { WorkspaceContainerRef } from '../types/sandbox.types.js';
import {
   populateContainerWorkspace,
   runContainerSetupScripts,
   FileRecord
} from './containerLifecycle.service.js';

export type { WorkspaceContainerRef } from '../types/sandbox.types.js';

const activeWorkspaceContainers = new Map<string, WorkspaceContainerRef>();

export async function getOrCreateWorkspaceContainer(userId: string, workspaceId: string): Promise<Docker.Container> {
   const key = `${userId}-${workspaceId}`;
   const existingRef = activeWorkspaceContainers.get(key);
   
   if (existingRef) {
      if (existingRef.cleanupTimeout) {
         clearTimeout(existingRef.cleanupTimeout);
         existingRef.cleanupTimeout = null;
      }
      existingRef.refCount++;
      return existingRef.container;
   }

   const { container, id, hostPort } = await warmPoolManager.popTerminalContainer();

   const wsHostDir = path.join(WORKSPACE_DATA_DIR, workspaceId);
   if (!existsSync(wsHostDir)) mkdirSync(wsHostDir, { recursive: true });

   const filesRes = await getPool().query<FileRecord>(
      `WITH RECURSIVE file_path_cte AS (
         SELECT id, parent_id, name, type, content, name::text as path FROM files WHERE workspace_id = $1 AND parent_id IS NULL
         UNION ALL
         SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
         FROM files f INNER JOIN file_path_cte cte ON f.parent_id = cte.id WHERE f.workspace_id = $1
      ) SELECT type, content, path FROM file_path_cte;`,
      [workspaceId]
   );

   const wsContainerPath = `/workspaces/${workspaceId}`;
   
   await populateContainerWorkspace(container, wsContainerPath, filesRes.rows);

   try {
      await runContainerSetupScripts(container, wsContainerPath);
   } catch (err) {
      console.error(`[WorkspaceContainer] Setup failed for ${key}:`, err);
   }

   activeWorkspaceContainers.set(key, { container, id, refCount: 1, hostPort, cleanupTimeout: null, lastActivityMs: Date.now() });
   return container;
}

export async function releaseWorkspaceContainer(userId: string, workspaceId: string): Promise<void> {
   const key = `${userId}-${workspaceId}`;
   const ref = activeWorkspaceContainers.get(key);
   if (!ref) return;

   ref.refCount--;

   if (ref.refCount <= 0) {
      if (ref.cleanupTimeout) {
         clearTimeout(ref.cleanupTimeout);
      }
      const gracePeriod = process.env.NODE_ENV === 'test' || process.env.CI ? 5000 : 300000;
      ref.cleanupTimeout = setTimeout(async () => {
         const currentRef = activeWorkspaceContainers.get(key);
         if (currentRef && currentRef.refCount <= 0) {
            activeWorkspaceContainers.delete(key);
            await currentRef.container.remove({ force: true }).catch(() => {});
            warmPoolManager.releaseTerminalContainer();
         }
      }, gracePeriod);
   }
}

export async function cleanupAllWorkspaceContainers(): Promise<void> {
   for (const [, ref] of activeWorkspaceContainers.entries()) {
      if (ref.cleanupTimeout) {
         clearTimeout(ref.cleanupTimeout);
      }
      await ref.container.remove({ force: true }).catch(() => {});
   }
   activeWorkspaceContainers.clear();
}

export const getRunningContainer = (userId: string, workspaceId: string): Docker.Container | null => 
   activeWorkspaceContainers.get(`${userId}-${workspaceId}`)?.container || null;

export const getRunningContainerRef = (userId: string, workspaceId: string): WorkspaceContainerRef | null => 
   activeWorkspaceContainers.get(`${userId}-${workspaceId}`) || null;

export function touchWorkspaceActivity(userId: string, workspaceId: string): void {
   const key = `${userId}-${workspaceId}`;
   const ref = activeWorkspaceContainers.get(key);
   if (ref) {
      ref.lastActivityMs = Date.now();
   }
}

setInterval(async () => {
   const now = Date.now();
   for (const [key, ref] of activeWorkspaceContainers.entries()) {
      if (ref.lastActivityMs && now - ref.lastActivityMs > 30 * 60 * 1000) {
         console.log(`[WorkspaceContainer] AFK Timeout exceeded for ${key}. Force destroying...`);
         if (ref.cleanupTimeout) clearTimeout(ref.cleanupTimeout);
         activeWorkspaceContainers.delete(key);
         await ref.container.remove({ force: true }).catch(() => {});
         warmPoolManager.releaseTerminalContainer();
      }
   }
}, 5 * 60 * 1000);