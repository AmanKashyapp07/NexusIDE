// Disable all console operations globally in the project
const noop = () => {};
console.log = noop;
console.error = noop;
console.warn = noop;
console.info = noop;
console.debug = noop;
console.trace = noop;
console.table = noop;

