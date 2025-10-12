#!/usr/bin/env node

// Simple test to verify yargs .strict() mode works correctly

console.log('Testing yargs .strict() mode...\n');

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

// Test 1: Valid options
console.log('Test 1: Valid options --verbose --fork');
try {
  const result1 = yargs(['https://github.com/test/repo/issues/1', '--verbose', '--fork'])
    .positional('url', { type: 'string' })
    .option('verbose', { type: 'boolean' })
    .option('fork', { type: 'boolean' })
    .strict()
    .exitProcess(false)
    .parseSync();

  console.log('✅ PASS: Valid options accepted');
  console.log(`   Parsed: verbose=${result1.verbose}, fork=${result1.fork}\n`);
} catch (error) {
  console.log('❌ FAIL: Valid options rejected');
  console.log(`   Error: ${error.message}\n`);
}

// Test 2: Invalid option
console.log('Test 2: Invalid option --unknown');
try {
  const result2 = yargs(['https://github.com/test/repo/issues/1', '--unknown'])
    .positional('url', { type: 'string' })
    .option('verbose', { type: 'boolean' })
    .option('fork', { type: 'boolean' })
    .strict()
    .exitProcess(false)
    .parseSync();

  console.log('❌ FAIL: Invalid option NOT rejected (yargs .strict() not working!)');
  console.log(`   Parsed: ${JSON.stringify(result2)}\n`);
} catch (error) {
  console.log('✅ PASS: Invalid option correctly rejected');
  console.log(`   Error: ${error.message}\n`);
}

// Test 3: Option with value (should NOT be confused with an option)
console.log('Test 3: Option with value --model sonnet');
try {
  const result3 = yargs(['https://github.com/test/repo/issues/1', '--model', 'sonnet'])
    .positional('url', { type: 'string' })
    .option('model', { type: 'string' })
    .strict()
    .exitProcess(false)
    .parseSync();

  console.log('✅ PASS: Option value correctly parsed');
  console.log(`   Parsed: model=${result3.model}\n`);
} catch (error) {
  console.log('❌ FAIL: Option value incorrectly rejected');
  console.log(`   Error: ${error.message}\n`);
}

console.log('Test complete!');
