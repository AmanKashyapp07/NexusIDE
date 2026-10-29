// Only silence logs in production when explicitly configured with LOG_LEVEL=silent
if (process.env.NODE_ENV === 'production' && process.env.LOG_LEVEL === 'silent') {
  const noop = (): void => {};

  console.log = noop;
  console.error = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
  console.trace = noop;

  // Suppress direct stdout/stderr writes to guarantee zero console log noise
  process.stdout.write = ((): boolean => true) as typeof process.stdout.write;
  process.stderr.write = ((): boolean => true) as typeof process.stderr.write;
}

