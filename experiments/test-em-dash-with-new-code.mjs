#!/usr/bin/env node

// Test em-dash detection with the new real parsing approach

import { parseRawOptionsFromArgs, createStrictOptionsCheck } from '../src/yargs-strict.lib.mjs';

// Simulate command with em-dash (issue #453)
const testCommand = ['—fork']; // em-dash, not regular dash

console.log('Testing em-dash detection with new parsing approach\n');
console.log('Command with em-dash (—fork):', testCommand);
console.log('');

// Parse raw options
const options = parseRawOptionsFromArgs(testCommand);
console.log('Parsed option flags:');
for (const opt of options) {
  console.log(`  - ${opt} (char codes: ${opt.split('').map(c => c.charCodeAt(0)).join(', ')})`);
}
console.log('');

// Define valid options (fork is valid, but —fork with em-dash is not)
const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'fork', 'f',
  '_', '$0'
]);

// Mock process.argv
const originalArgv = process.argv;
process.argv = ['node', 'test.mjs', ...testCommand];

try {
  // Create a mock argv object (simulating what yargs would create)
  const mockArgv = {
    _: [],
    $0: 'test.mjs',
    '—fork': false, // em-dash version (should be flagged as unknown)
    fork: false      // regular version (yargs creates both)
  };

  // Test validation
  const check = createStrictOptionsCheck(DEFINED_OPTIONS);
  check(mockArgv);

  console.log('❌ FAIL: Should have detected —fork (em-dash) as invalid');
} catch (error) {
  console.log('✅ PASS: Correctly detected em-dash option as invalid');
  console.log('   Error:', error.message);
} finally {
  process.argv = originalArgv;
}
