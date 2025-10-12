#!/usr/bin/env node

// Test edge cases for the fix

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

// Import strict options validation
const yargsStrictLib = await import('../src/yargs-strict.lib.mjs');
const { validateStrictOptions } = yargsStrictLib;

const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  'verbose', 'v',
  'config', 'c',
  '_', '$0'
]);

console.log('Testing edge cases...\n');

// Test 1: Should catch actual invalid options
console.log('Test 1: Invalid option --unknown should fail');
try {
  const argv1 = yargs(['--unknown', 'value'])
    .option('token', { type: 'string' })
    .parse();
  validateStrictOptions(argv1, DEFINED_OPTIONS);
  console.log('❌ Test 1 FAILED: Should have thrown error\n');
} catch (error) {
  if (error.message.includes('Unknown option')) {
    console.log('✅ Test 1 PASSED: Correctly caught invalid option\n');
  } else {
    console.log('❌ Test 1 FAILED: Wrong error:', error.message, '\n');
  }
}

// Test 2: Should allow valid options
console.log('Test 2: Valid option --token should pass');
try {
  const argv2 = yargs(['--token', 'mytoken'])
    .option('token', { type: 'string' })
    .parse();
  validateStrictOptions(argv2, DEFINED_OPTIONS);
  console.log('✅ Test 2 PASSED\n');
} catch (error) {
  console.log('❌ Test 2 FAILED:', error.message, '\n');
}

// Test 3: Should allow values with special characters
console.log('Test 3: Values with parentheses should pass');
try {
  const argv3 = yargs(['--config', '(a b c)'])
    .option('config', { type: 'string' })
    .parse();
  validateStrictOptions(argv3, DEFINED_OPTIONS);
  console.log('✅ Test 3 PASSED\n');
} catch (error) {
  console.log('❌ Test 3 FAILED:', error.message, '\n');
}

// Test 4: Should allow values that start with numbers
console.log('Test 4: Values starting with numbers should pass');
try {
  const argv4 = yargs(['--token', '123456abc'])
    .option('token', { type: 'string' })
    .parse();
  validateStrictOptions(argv4, DEFINED_OPTIONS);
  console.log('✅ Test 4 PASSED\n');
} catch (error) {
  console.log('❌ Test 4 FAILED:', error.message, '\n');
}

// Test 5: Should allow multi-line values
console.log('Test 5: Multi-line values should pass');
try {
  const argv5 = yargs(['--config', '(\n  line1\n  line2\n)'])
    .option('config', { type: 'string' })
    .parse();
  validateStrictOptions(argv5, DEFINED_OPTIONS);
  console.log('✅ Test 5 PASSED\n');
} catch (error) {
  console.log('❌ Test 5 FAILED:', error.message, '\n');
}

// Test 6: Should still catch option-like strings in positional args
console.log('Test 6: Option-like positional args should be caught');
try {
  const argv6 = yargs(['--verbose', '--invalid-option'])
    .option('verbose', { type: 'boolean' })
    .parse();
  validateStrictOptions(argv6, DEFINED_OPTIONS);
  console.log('❌ Test 6 FAILED: Should have thrown error\n');
} catch (error) {
  if (error.message.includes('Unknown option') || error.message.includes('invalid-option')) {
    console.log('✅ Test 6 PASSED: Correctly caught invalid option\n');
  } else {
    console.log('❌ Test 6 FAILED: Wrong error:', error.message, '\n');
  }
}

// Test 7: Should allow aliases
console.log('Test 7: Aliases should pass');
try {
  const argv7 = yargs(['-t', 'mytoken'])
    .option('token', { type: 'string', alias: 't' })
    .parse();
  validateStrictOptions(argv7, DEFINED_OPTIONS);
  console.log('✅ Test 7 PASSED\n');
} catch (error) {
  console.log('❌ Test 7 FAILED:', error.message, '\n');
}

// Test 8: Should allow negation options
console.log('Test 8: Negation options should pass');
try {
  const argv8 = yargs(['--no-verbose'])
    .option('verbose', { type: 'boolean', default: true })
    .parserConfiguration({ 'boolean-negation': true })
    .parse();
  // Add no-verbose to defined options for this test
  const optionsWithNegation = new Set([...DEFINED_OPTIONS, 'no-verbose', 'noVerbose']);
  validateStrictOptions(argv8, optionsWithNegation);
  console.log('✅ Test 8 PASSED\n');
} catch (error) {
  console.log('❌ Test 8 FAILED:', error.message, '\n');
}

console.log('Testing complete!');
