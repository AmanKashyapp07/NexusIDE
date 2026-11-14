export class Assertions {
  static assert(condition, message = 'Assertion failed') {
    if (!condition) {
      throw new Error(`[BENCHMARK ASSERTION FAILURE] ${message}`);
    }
  }

  static assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`[BENCHMARK ASSERTION FAILURE] Expected ${expected}, got ${actual}. ${message}`);
    }
  }

  static assertDeepEqual(actual, expected, message = '') {
    const act = JSON.stringify(actual);
    const exp = JSON.stringify(expected);
    if (act !== exp) {
      throw new Error(`[BENCHMARK ASSERTION FAILURE] Deep equality failed.\nExpected: ${exp}\nActual:   ${act}\n${message}`);
    }
  }

  static assertPositiveNumber(val, name = 'value') {
    if (typeof val !== 'number' || isNaN(val) || val < 0) {
      throw new Error(`[BENCHMARK ASSERTION FAILURE] ${name} must be a non-negative number, got ${val}`);
    }
  }
}
