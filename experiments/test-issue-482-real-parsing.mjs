#!/usr/bin/env node

// Test the new real parsing approach for issue #482
// This should properly validate options by parsing raw arguments, not parsed argv keys

import { parseRawOptionsFromArgs, createStrictOptionsCheck } from '../src/yargs-strict.lib.mjs';

// Simulate the original failing command from issue #482
const testCommand = [
  '--token', '8490...aOEM',
  '--allowed-chats', '(-1002975819706 -1002861722681)',
  '--no-hive',
  '--solve-overrides', '( \n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)'
];

console.log('Testing real parsing approach for issue #482\n');
console.log('Command:', testCommand.join(' '));
console.log('');

// Parse raw options
const options = parseRawOptionsFromArgs(testCommand);
console.log('Parsed option flags (not values):');
for (const opt of options) {
  console.log(`  - ${opt}`);
}
console.log('');

// Define valid options for telegram-bot
const DEFINED_OPTIONS = new Set([
  'help', 'h', 'version',
  'token', 't',
  'allowed-chats', 'allowedChats', 'a',
  'solve-overrides', 'solveOverrides',
  'hive-overrides', 'hiveOverrides',
  'solve', 'no-solve', 'noSolve',
  'hive', 'no-hive', 'noHive',
  '_', '$0'
]);

// Mock process.argv for testing
const originalArgv = process.argv;
process.argv = ['node', 'telegram-bot.mjs', ...testCommand];

try {
  // Create a mock argv object (simulating what yargs would create)
  const mockArgv = {
    _: [],
    $0: 'telegram-bot.mjs',
    token: '8490...aOEM',
    allowedChats: '(-1002975819706 -1002861722681)',
    'allowed-chats': '(-1002975819706 -1002861722681)',
    noHive: true,
    'no-hive': true,
    hive: false,
    solveOverrides: '( \n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)',
    'solve-overrides': '( \n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)'
  };

  // Test validation
  const check = createStrictOptionsCheck(DEFINED_OPTIONS);
  check(mockArgv);

  console.log('✅ PASS: Validation succeeded (no false positives)');
  console.log('   Option values were correctly NOT flagged as unknown options');
} catch (error) {
  console.log('❌ FAIL: Validation failed');
  console.log('   Error:', error.message);
} finally {
  process.argv = originalArgv;
}

console.log('');
console.log('Testing invalid option detection...');

// Test with an actually invalid option
const invalidCommand = ['--token', 'abc123', '--unknown-flag', 'value'];
process.argv = ['node', 'telegram-bot.mjs', ...invalidCommand];

try {
  const mockArgv = {
    _: [],
    $0: 'telegram-bot.mjs',
    token: 'abc123',
    unknownFlag: 'value',
    'unknown-flag': 'value'
  };

  const check = createStrictOptionsCheck(DEFINED_OPTIONS);
  check(mockArgv);

  console.log('❌ FAIL: Should have detected --unknown-flag as invalid');
} catch (error) {
  console.log('✅ PASS: Correctly detected invalid option');
  console.log('   Error:', error.message);
} finally {
  process.argv = originalArgv;
}
