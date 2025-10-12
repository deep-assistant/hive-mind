#!/usr/bin/env node

// Test that we still catch invalid options

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { validateStrictOptions } = yargsStrictLib;

const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  '_', '$0'
]);

console.log('Testing that we still catch invalid options...\n');

// Test 1: Invalid option with dashes
console.log('Test 1: --invalid-option should be caught');
try {
  const argv1 = yargs(['--invalid-option', 'value'])
    .option('token', { type: 'string' })
    .parse();
  validateStrictOptions(argv1, DEFINED_OPTIONS);
  console.log('❌ FAILED: Should have thrown error\n');
} catch (error) {
  if (error.message.includes('invalid-option')) {
    console.log('✅ PASSED: Correctly caught --invalid-option\n');
  } else {
    console.log('❌ FAILED: Wrong error:', error.message, '\n');
  }
}

// Test 2: Invalid short option
console.log('Test 2: -x should be caught');
try {
  const argv2 = yargs(['-x'])
    .option('token', { type: 'string', alias: 't' })
    .parse();
  validateStrictOptions(argv2, DEFINED_OPTIONS);
  console.log('❌ FAILED: Should have thrown error\n');
} catch (error) {
  if (error.message.includes('x') || error.message.includes('-x')) {
    console.log('✅ PASSED: Correctly caught -x\n');
  } else {
    console.log('❌ FAILED: Wrong error:', error.message, '\n');
  }
}

// Test 3: Valid option should pass
console.log('Test 3: --token should pass');
try {
  const argv3 = yargs(['--token', 'mytoken'])
    .option('token', { type: 'string' })
    .parse();
  validateStrictOptions(argv3, DEFINED_OPTIONS);
  console.log('✅ PASSED: --token correctly allowed\n');
} catch (error) {
  console.log('❌ FAILED:', error.message, '\n');
}

// Test 4: Alias should pass
console.log('Test 4: -t (alias) should pass');
try {
  const argv4 = yargs(['-t', 'mytoken'])
    .option('token', { type: 'string', alias: 't' })
    .parse();
  validateStrictOptions(argv4, DEFINED_OPTIONS);
  console.log('✅ PASSED: -t correctly allowed\n');
} catch (error) {
  console.log('❌ FAILED:', error.message, '\n');
}

console.log('Testing complete!');
