import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { getPool } from '../db.js';
import { getIO } from '../socket.js';
import { syncFileToTerminal } from '../terminal/terminalHandler.js';
import { getDocsMap } from '../docsRegistry.js';
import { log } from './logger.service.js';
import type { AuthorInfo } from '../types/cache.types.js';

export class WSSharedDoc extends Y.Doc {
   name: string;
   workspaceId: string;
   fileId: string;
   awareness: awarenessProtocol.Awareness;
   conns: Map<WebSocket, Set<number>>;
   dbLoaded: boolean;
   saveTimeout: NodeJS.Timeout | null;
   isSaving: boolean;
   authorMap: Map<number, AuthorInfo>;
   private updateQueue: Array<Buffer> = [];
   private isProcessingQueue = false;

   constructor(name: string, workspaceId: string, fileId: string) {
      super({ gc: false });
      this.name = name;
      this.workspaceId = workspaceId;
      this.fileId = fileId;
      this.awareness = new awarenessProtocol.Awareness(this);
      this.awareness.setLocalState(null);
      this.conns = new Map();
      this.dbLoaded = false;
      this.saveTimeout = null;
      this.isSaving = false;
      this.authorMap = new Map();

      this.on('update', this.handleDocumentUpdate.bind(this));
      
      this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, conn: WebSocket | null) => {
         const changedClients = added.concat(updated, removed);
         if (conn !== null) {
            const connControlledIDs = this.conns.get(conn);
            if (connControlledIDs !== undefined) {
               added.forEach((clientID: number) => { connControlledIDs.add(clientID); });
               removed.forEach((clientID: number) => { connControlledIDs.delete(clientID); });
            }
         }

         [...added, ...updated].forEach((clientID: number) => {
            const state = this.awareness.getStates().get(clientID) as { user?: { id?: string; name?: string; color?: string } } | undefined;
            if (state?.user?.id && state?.user?.name) {
               this.authorMap.set(clientID, {
                  userId: state.user.id,
                  username: state.user.name,
                  color: state.user.color || '#6366f1',
               });
            }
         });

         const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
         const encoder = encoding.createEncoder();
         encoding.writeVarUint(encoder, 1);
         encoding.writeVarUint8Array(encoder, awarenessUpdate);
         const buff = encoding.toUint8Array(encoder);
         this.conns.forEach((_, c) => this.send(c, buff));
      });
   }

   send(conn: WebSocket, m: Uint8Array): void {
      if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) return;
      try {
         conn.send(m);
      } catch {
         conn.close();
      }
   }

   private async processUpdateQueue(): Promise<void> {
      if (this.isProcessingQueue) return;
      this.isProcessingQueue = true;
      try {
         while (this.updateQueue.length > 0) {
            const buf = this.updateQueue.shift()!;
            try {
               await getPool().query(
                  'INSERT INTO file_updates (file_id, update) VALUES ($1, $2)',
                  [this.fileId, buf]
               );
            } catch {
            }
         }
      } finally {
         this.isProcessingQueue = false;
      }
   }

   handleDocumentUpdate(update: Uint8Array): void {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => this.send(conn, message));

      if (!this.dbLoaded) return;

      this.updateQueue.push(Buffer.from(update));
      this.processUpdateQueue();

      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(async () => {
         if (this.isSaving) return;
         this.isSaving = true;
         try {
            const state = Buffer.from(Y.encodeStateAsUpdate(this));
            const content = this.getText('monaco').toString();
            const authorMapJson = Object.fromEntries(
               Array.from(this.authorMap.entries()).map(([k, v]) => [String(k), v])
            );
            log('💾 SAVE', `Debounced save doc=${this.name} (${content.length} chars, ${this.authorMap.size} authors)`);
            await getPool().query(
               'UPDATE files SET yjs_state = $1, content = $2, author_map = $3 WHERE id = $4',
               [state, content, JSON.stringify(authorMapJson), this.fileId]
            );
            
            try {
               const [redisCache, yjsCache] = await Promise.all([
                  import('../utils/redisCache.js'),
                  import('../utils/yjsCache.js')
               ]);
               
               await Promise.all([
                  redisCache.fileContentCache.delete(`${this.fileId}`),
                  redisCache.yjsStateCache.delete(`${this.fileId}:history`),
                  yjsCache.deleteYjsStateFromCache(this.fileId)
               ]);
            } catch (err: unknown) {
               const msg = err instanceof Error ? err.message : String(err);
               log('💾 SAVE', `⚠️  Cache invalidation failed: ${msg}`);
            }
            
            syncFileToTerminal(this.workspaceId, this.fileId, content).catch(() => {});
            getIO()?.to(`presence-${this.workspaceId}`).emit('file-saved', { fileId: this.fileId });
         } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log('💾 SAVE', `❌ DB save error: ${msg}`);
         } finally {
            this.isSaving = false;
         }
      }, 800);
   }

   async performFinalSave(): Promise<void> {
      if (this.saveTimeout) clearTimeout(this.saveTimeout);
      try {
         const state = Buffer.from(Y.encodeStateAsUpdate(this));
         const content = this.getText('monaco').toString();
         const authorMapJson = Object.fromEntries(
            Array.from(this.authorMap.entries()).map(([k, v]) => [String(k), v])
         );
         log('🔒 CLOSE', `Final save doc=${this.name} (${content.length} chars)`);
         await getPool().query(
            'UPDATE files SET yjs_state = $1, content = $2, author_map = $3 WHERE id = $4',
            [state, content, JSON.stringify(authorMapJson), this.fileId]
         );
         
         try {
            const [redisCache, yjsCache] = await Promise.all([
               import('../utils/redisCache.js'),
               import('../utils/yjsCache.js')
            ]);
            
            await Promise.all([
               redisCache.fileContentCache.delete(`${this.fileId}`),
               redisCache.yjsStateCache.delete(`${this.fileId}:history`),
               yjsCache.deleteYjsStateFromCache(this.fileId)
            ]);
         } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log('🔒 CLOSE', `⚠️  Cache invalidation failed: ${msg}`);
         }
         
         syncFileToTerminal(this.workspaceId, this.fileId, content).catch(() => {});
      } catch (err: unknown) {
         const msg = err instanceof Error ? err.message : String(err);
         log('🔒 CLOSE', `❌ Final save error: ${msg}`);
      }
   }
}

const docs = getDocsMap();

export async function getOrCreateDoc(docName: string): Promise<WSSharedDoc> {
   if (docs.has(docName)) {
      return docs.get(docName)!;
   }

   const loadPromise = (async () => {
      const match = docName.match(/^([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
      if (!match || !match[1] || !match[2]) throw new Error("Invalid doc name");
      
      const doc = new WSSharedDoc(docName, match[1], match[2]);
      
      try {
         let cacheHit = false;
         
         try {
            const { getYjsStateFromCache } = await import('../utils/yjsCache.js');
            const cached = await getYjsStateFromCache(doc.fileId);
            
            if (cached) {
               if (cached.yjsState) {
                  Y.applyUpdate(doc, cached.yjsState);
                  cacheHit = true;
               }
               
               doc.authorMap = cached.authorMap;
               
               log('[YJS-CACHE]', `Redis cache HIT for doc=${docName} (${cached.yjsState?.length || 0} bytes)`);
            }
         } catch (cacheErr: unknown) {
            const msg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
            log('[YJS-CACHE]', `Redis unavailable, using DB: ${msg}`);
         }
         
         if (!cacheHit) {
            const res = await getPool().query<{ content: string; yjs_state: Buffer; author_map: Record<string, AuthorInfo> }>(
               'SELECT content, yjs_state, author_map FROM files WHERE id = $1', 
               [doc.fileId]
            );
            
            if (res.rows.length > 0) {
               if (res.rows[0]!.yjs_state) {
                  Y.applyUpdate(doc, res.rows[0]!.yjs_state);
               } else if (res.rows[0]!.content) {
                  doc.getText('monaco').insert(0, res.rows[0]!.content);
               }
               
               const storedMap = res.rows[0]!.author_map;
               if (storedMap && typeof storedMap === 'object') {
                  for (const [clientIdStr, info] of Object.entries(storedMap)) {
                     const clientId = Number(clientIdStr);
                     if (!isNaN(clientId) && info && typeof info === 'object') {
                        doc.authorMap.set(clientId, info);
                     }
                  }
               }
               
               if (res.rows[0]!.yjs_state) {
                  import('../utils/yjsCache.js')
                     .then(({ setYjsStateToCache }) => setYjsStateToCache(doc.fileId, res.rows[0]!.yjs_state, doc.authorMap))
                     .catch(() => {});
               }
               
               log('📄 BIND', `Database loaded for doc=${docName} (cache MISS)`);
            }
         }
         
         doc.dbLoaded = true;
      } catch (err: unknown) {
         const msg = err instanceof Error ? err.message : String(err);
         log('📄 BIND', `❌ DB error loading file: ${msg}`);
      }
      return doc;
   })();

   docs.set(docName, loadPromise);
   return loadPromise;
}
