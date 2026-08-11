import { describe, it, expect } from 'vitest';
import { CASService } from '../../backend/src/services/cas.service.js';

describe('Phase 4: CAS Storage Deduplication Ratio SLA', () => {
  it('1. Computes SHA-256 Merkle tree block deduplication across 100 snapshot revisions', () => {
    const fileCount = 50;
    const revisionCount = 100;

    // Generate base workspace snapshot files
    const baseFiles: Array<{ path: string; content: string }> = [];
    for (let f = 1; f <= fileCount; f++) {
      baseFiles.push({
        path: `src/module_${f}.ts`,
        content: `export function fn_${f}() { return "constant_payload_${'x'.repeat(500)}_${f}"; }`
      });
    }

    let unDeduplicatedBytes = 0;
    const uniqueBlobsMap = new Map<string, number>();

    const tStart = Date.now();

    for (let rev = 1; rev <= revisionCount; rev++) {
      // Simulate typical developer diff: 48 files identical, 2 files edited per snapshot
      const currentFiles = baseFiles.map((file, idx) => {
        if (idx === rev % fileCount) {
          return {
            path: file.path,
            content: `${file.content}\n// Revision edit ${rev}`
          };
        }
        return file;
      });

      const dag = CASService.buildMerkleTreeInline(currentFiles);

      for (const record of dag.blobsToInsert) {
        unDeduplicatedBytes += record.sizeBytes;
        if (!uniqueBlobsMap.has(record.hash)) {
          uniqueBlobsMap.set(record.hash, record.sizeBytes);
        }
      }
    }

    let deduplicatedBytes = 0;
    for (const size of uniqueBlobsMap.values()) {
      deduplicatedBytes += size;
    }

    const durationMs = Date.now() - tStart;
    const savingsRatio = 1 - (deduplicatedBytes / unDeduplicatedBytes);
    const savingsPercent = (savingsRatio * 100).toFixed(2);

    console.log(`[CAS Dedup SLA] Raw Un-deduplicated Volume: ${(unDeduplicatedBytes / 1024).toFixed(2)} KB`);
    console.log(`[CAS Dedup SLA] Deduplicated CAS Blob Volume: ${(deduplicatedBytes / 1024).toFixed(2)} KB`);
    console.log(`[CAS Dedup SLA] Storage Savings Ratio: ${savingsPercent}%`);
    console.log(`[CAS Dedup SLA] 100 Revisions Execution Time: ${durationMs}ms`);

    // HARD SLA ENFORCEMENT: Deduplication storage savings must be > 90%
    expect(savingsRatio, `HARD SLA VIOLATION: CAS Deduplication ratio (${savingsPercent}%) fell below 90% cap`).toBeGreaterThanOrEqual(0.90);
  });
});
