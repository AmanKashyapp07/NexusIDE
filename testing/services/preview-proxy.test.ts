import { describe, it, expect } from 'vitest';

describe('Multi-Port Live Preview URL & Routing Parsing', () => {
   function parseTargetPort(reqUrl: string): number {
      const portMatch = reqUrl.match(/\/preview[\/:\-](port[\/:\-])?(\d{2,5})/i) || reqUrl.match(/[\?&]port=(\d{2,5})/i);
      return portMatch ? parseInt(portMatch[2] || portMatch[1], 10) : 3000;
   }

   function rewritePreviewPath(reqUrl: string, wsId: string): string {
      const rewritten = reqUrl
         .replace(new RegExp(`^.*\\/api\\/workspace\\/${wsId}\\/preview([\\/:-](port[\\/:-])?\\d{2,5})?`), '')
         .replace(/^[\/:-]?(port[\/:-])?\d{2,5}/i, '')
         .replace(/[\?&]port=\d{2,5}/i, '');
      return rewritten === '' ? '/' : (rewritten.startsWith('/') ? rewritten : `/${rewritten}`);
   }

   it('defaults to port 3000 when no port is specified', () => {
      const url = '/api/workspace/ws-123/preview/';
      expect(parseTargetPort(url)).toBe(3000);
      expect(rewritePreviewPath(url, 'ws-123')).toBe('/');
   });

   it('parses target port 5000 from query parameter', () => {
      const url = '/api/workspace/ws-123/preview/?port=5000';
      expect(parseTargetPort(url)).toBe(5000);
      expect(rewritePreviewPath(url, 'ws-123')).toBe('/');
   });

   it('parses target port 8080 from URL path segment', () => {
      const url = '/api/workspace/ws-123/preview/8080/api/v1/users';
      expect(parseTargetPort(url)).toBe(8080);
      expect(rewritePreviewPath(url, 'ws-123')).toBe('/api/v1/users');
   });

   it('parses target port 5173 from hyphen/colon syntax', () => {
      const url = '/api/workspace/ws-123/preview:5173/dashboard';
      expect(parseTargetPort(url)).toBe(5173);
      expect(rewritePreviewPath(url, 'ws-123')).toBe('/dashboard');
   });
});
