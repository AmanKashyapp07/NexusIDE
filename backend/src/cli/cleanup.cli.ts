/**
 * CLI Command: On-demand production VM & Database maintenance routine.
 * Usage: npx tsx src/cli/cleanup.cli.ts
 */

import { cleanupCronService } from '../services/cleanupCron.service.js';

async function main() {
  console.log('================================================================');
  console.log('       NEXUS IDE PRODUCTION CLEANUP & MAINTENANCE RUNNER        ');
  console.log('================================================================');
  
  try {
    const report = await cleanupCronService.runFullSystemCleanup();
    console.log('\n[SUCCESS] Cleanup Completed!');
    console.table(report);
    process.exit(0);
  } catch (err) {
    console.error('\n[ERROR] Cleanup execution failed:', err);
    process.exit(1);
  }
}

main();
