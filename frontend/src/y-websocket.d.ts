/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'y-websocket' {
  import * as Y from 'yjs';

  export class WebsocketProvider {
    constructor(
      serverUrl: string,
      roomName: string,
      doc: Y.Doc,
      opts?: {
        connect?: boolean;
        awareness?: any;
        params?: { [key: string]: string };
        maxBackoffTime?: number;
        WebSocketPolyfill?: any;
        resyncInterval?: number;
      }
    );
    doc: Y.Doc;
    awareness: any;
    wsconnected: boolean;
    wsconnecting: boolean;
    bcconnected: boolean;
    shouldConnect: boolean;
    on(event: string, listener: (...args: any[]) => void): void;
    once(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    destroy(): void;
  }
}
