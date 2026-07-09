// Disable all console operations globally in the project except during tests
if (process.env.NODE_ENV !== 'test') {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}
