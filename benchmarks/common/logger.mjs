export class BenchmarkLogger {
  static header(title) {
    console.log('\n' + '='.repeat(80));
    console.log(`  ${title.toUpperCase()}`);
    console.log('='.repeat(80));
  }

  static section(name) {
    console.log(`\n─── ${name} ${'─'.repeat(Math.max(5, 74 - name.length))}`);
  }

  static info(msg) {
    console.log(`ℹ️  ${msg}`);
  }

  static success(msg) {
    console.log(`✅ ${msg}`);
  }

  static warn(msg) {
    console.warn(`⚠️  ${msg}`);
  }

  static error(msg) {
    console.error(`❌ ${msg}`);
  }

  static table(rows) {
    console.table(rows);
  }
}
