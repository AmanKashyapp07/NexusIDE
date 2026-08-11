import { describe, it, expect } from 'vitest';

interface LegacyWorkspacePayloadV1 {
  id: string;
  name: string;
  files: Array<{ name: string; body: string }>;
}

interface CurrentWorkspacePayloadV2 {
  id: string;
  title: string;
  files: Array<{ path: string; content: string; language: string }>;
  version: number;
}

function migratePayloadV1ToV2(legacy: LegacyWorkspacePayloadV1): CurrentWorkspacePayloadV2 {
  return {
    id: legacy.id,
    title: legacy.name,
    files: legacy.files.map(f => ({
      path: f.name,
      content: f.body,
      language: f.name.endsWith('.ts') ? 'typescript' : 'plaintext'
    })),
    version: 2
  };
}

describe('Phase B: Schema Evolution Payload Migration SLA', () => {
  it('1. Seamlessly migrates legacy v1 workspace schema payloads to v2 format without data loss', () => {
    const legacyData: LegacyWorkspacePayloadV1 = {
      id: 'ws_legacy_100',
      name: 'Old Legacy Project',
      files: [
        { name: 'main.ts', body: 'console.log("hello legacy");' }
      ]
    };

    const v2Payload = migratePayloadV1ToV2(legacyData);

    expect(v2Payload.id).toBe('ws_legacy_100');
    expect(v2Payload.title).toBe('Old Legacy Project');
    expect(v2Payload.files[0].language).toBe('typescript');
    expect(v2Payload.version).toBe(2);
  });
});
