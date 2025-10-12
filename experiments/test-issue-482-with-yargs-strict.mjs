#!/usr/bin/env node

// Test case for issue #482 using yargs .strict() mode
// This test validates that option values are NOT incorrectly flagged as unknown options

console.log('Testing issue #482 fix with yargs .strict() mode...\n');

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const solveConfigLib = await import('../src/solve.config.lib.mjs');
const { initializeConfig, createYargsConfig } = solveConfigLib;

// Test 1: Original failing command from #482
console.log('Test 1: Original command from #482');
try {
  const args1 = [
    'https://github.com/test/repo/issues/1',
    '--auto-continue',
    '--attach-logs'
  ];
  const testYargs1 = createYargsConfig(yargs(args1));
  testYargs1.exitProcess(false); // Don't exit on parse errors
  const parsed1 = await testYargs1.parseAsync();
  console.log('✅ PASS: Original command parsed successfully');
  console.log(`   Parsed options: autoContinue=${parsed1.autoContinue}, attachLogs=${parsed1.attachLogs}\n`);
} catch (error) {
  console.log('❌ FAIL: Original command failed');
  console.log(`   Error: ${error.message}\n`);
}

// Test 2: Command with option values that might be confused for options
console.log('Test 2: Token with special characters');
try {
  const args2 = [
    'https://github.com/test/repo/issues/1',
    '--model',
    'sonnet'
  ];
  const testYargs2 = createYargsConfig(yargs(args2));
  testYargs2.exitProcess(false);
  const parsed2 = await testYargs2.parseAsync();
  console.log('✅ PASS: Token value parsed successfully');
  console.log(`   Parsed options: model=${parsed2.model}\n`);
} catch (error) {
  console.log('❌ FAIL: Token value failed');
  console.log(`   Error: ${error.message}\n`);
}

// Test 3: Invalid option should fail
console.log('Test 3: Invalid option (should FAIL)');
try {
  const args3 = [
    'https://github.com/test/repo/issues/1',
    '--invalid-option'
  ];
  const testYargs3 = createYargsConfig(yargs(args3));
  testYargs3.exitProcess(false);
  const parsed3 = await testYargs3.parseAsync();
  console.log('❌ FAIL: Invalid option was NOT rejected (this is wrong!)');
  console.log(`   This means yargs .strict() is not working\n`);
} catch (error) {
  console.log('✅ PASS: Invalid option correctly rejected');
  console.log(`   Error: ${error.message}\n`);
}

// Test 4: Em-dash option (should fail)
console.log('Test 4: Em-dash option —fork (should FAIL)');
try {
  const args4 = [
    'https://github.com/test/repo/issues/1',
    '—fork'  // em-dash, not double-dash
  ];
  const testYargs4 = createYargsConfig(yargs(args4));
  testYargs4.exitProcess(false);
  const parsed4 = await testYargs4.parseAsync();
  console.log('⚠️  WARNING: Em-dash option was NOT rejected');
  console.log('   Note: yargs might not catch em-dash by default, this may need special handling\n');
} catch (error) {
  console.log('✅ PASS: Em-dash option correctly rejected');
  console.log(`   Error: ${error.message}\n`);
}

console.log('Test complete!');
