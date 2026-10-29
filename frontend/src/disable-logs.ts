// Only disable console operations in production if explicitly configured
if (import.meta.env.PROD && (import.meta.env as Record<string, unknown>).VITE_LOG_LEVEL === 'silent') {
  const noop = () => {};
  console.log = noop;
  console.error = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
  console.trace = noop;
  console.table = noop;
}


