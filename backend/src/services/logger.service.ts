const LOG_ENABLED = process.env.LOG_LEVEL !== 'silent';

export function log(prefix: string, ...args: unknown[]): void {
   if (!LOG_ENABLED) return;
   const ts = new Date().toISOString().slice(11, 23);
   console.log(`[${ts}] ${prefix}`, ...args);
}
