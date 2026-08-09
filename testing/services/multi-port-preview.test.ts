import { describe, it, expect } from 'vitest';

describe('Multi-Port Live Preview Proxy Engine Suite', () => {
  function parseTargetPort(reqUrl: string, refererHeader?: string): number {
    const portMatch = reqUrl.match(/\/preview[\/:\-](port[\/:\-])?(\d{2,5})/i) || reqUrl.match(/[\?&]port=(\d{2,5})/i);
    if (portMatch) {
      return parseInt(portMatch[2] || portMatch[1], 10);
    }
    if (refererHeader) {
      const refPortMatch = refererHeader.match(/\/preview[\/:\-](port[\/:\-])?(\d{2,5})/i) || refererHeader.match(/[\?&]port=(\d{2,5})/i);
      if (refPortMatch) {
        return parseInt(refPortMatch[2] || refPortMatch[1], 10);
      }
    }
    return 3000;
  }

  function rewritePreviewPath(reqUrl: string, wsId: string): string {
    const rewritten = reqUrl
      .replace(new RegExp(`^.*\\/api\\/workspace\\/${wsId}\\/preview([\\/:-](port[\\/:-])?\\d{2,5})?`), '')
      .replace(/[\?&]port=\d{2,5}/i, '');
    return rewritten === '' ? '/' : rewritten;
  }

  function computeRefererRedirect(path: string, referer: string): string | null {
    const match = referer.match(/\/api\/workspace\/([^\/]+)\/preview([\/:-](port[\/:-])?\d{2,5})?/i);
    if (match) {
      const wsId = match[1];
      const portToken = match[2] || '';
      const prefix = referer.includes('/ide/') ? '/ide' : '';
      return `${prefix}/api/workspace/${wsId}/preview${portToken}${path}`;
    }
    return null;
  }

  it('1. extracts target ports 3000, 5000, 8000, 5173, and 8080 accurately from URL syntaxes', () => {
    expect(parseTargetPort('/api/workspace/ws-1/preview/')).toBe(3000);
    expect(parseTargetPort('/api/workspace/ws-1/preview/5000/api/v1')).toBe(5000);
    expect(parseTargetPort('/api/workspace/ws-1/preview/port/8000/docs')).toBe(8000);
    expect(parseTargetPort('/api/workspace/ws-1/preview:5173/src/App.tsx')).toBe(5173);
    expect(parseTargetPort('/api/workspace/ws-1/preview/?port=8080')).toBe(8080);
  });

  it('2. inherits target port 5173 from Referer header on relative subresource requests', () => {
    const subresourcePath = '/src/main.ts';
    const refererHeader = 'http://localhost:4000/api/workspace/ws-101/preview/5173/';
    
    expect(parseTargetPort(subresourcePath, refererHeader)).toBe(5173);
    const redirectUrl = computeRefererRedirect(subresourcePath, refererHeader);
    expect(redirectUrl).toBe('/api/workspace/ws-101/preview/5173/src/main.ts');
  });

  it('3. rewrites proxied path to clean root-relative upstream container request', () => {
    expect(rewritePreviewPath('/api/workspace/ws-99/preview/5000/dashboard/users', 'ws-99')).toBe('/dashboard/users');
    expect(rewritePreviewPath('/api/workspace/ws-99/preview/?port=8080', 'ws-99')).toBe('/');
    expect(rewritePreviewPath('/api/workspace/ws-99/preview:5173/assets/index.js', 'ws-99')).toBe('/assets/index.js');
  });

  it('4. preserves /ide route prefix when executing inside subpath deployments', () => {
    const referer = 'http://129.154.39.198/ide/api/workspace/ws-prod/preview/8080/app';
    const redirect = computeRefererRedirect('/static/css/styles.css', referer);
    expect(redirect).toBe('/ide/api/workspace/ws-prod/preview/8080/static/css/styles.css');
  });
});
