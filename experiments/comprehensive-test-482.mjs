#!/usr/bin/env node

// Comprehensive test for issue #482 fix

import { parseRawOptionsFromArgs, createStrictOptionsCheck } from '../src/yargs-strict.lib.mjs';

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

const tests = [
  {
    name: 'Original failing command from issue #482',
    args: [
      '--token', '8490...aOEM',
      '--allowed-chats', '(-1002975819706 -1002861722681)',
      '--no-hive',
      '--solve-overrides', '( \n  --auto-continue\n  --attach-logs\n)'
    ],
    shouldPass: true
  },
  {
    name: 'Token value with special characters',
    args: ['--token', '8490abc123_XYZ-...aOEM'],
    shouldPass: true
  },
  {
    name: 'Lino notation with parentheses and negative numbers',
    args: ['--allowed-chats', '(-1002975819706 -1002861722681)'],
    shouldPass: true
  },
  {
    name: 'Multi-line value with newlines',
    args: ['--solve-overrides', '( \n  --auto-continue\n  --attach-logs\n  --verbose\n)'],
    shouldPass: true
  },
  {
    name: 'Invalid option --unknown',
    args: ['--unknown', 'value'],
    shouldPass: false,
    expectedError: 'unknown'
  },
  {
    name: 'Em-dash option —fork (should fail)',
    args: ['—fork'],
    shouldPass: false,
    expectedError: '—fork'
  },
  {
    name: 'Valid --no-hive boolean negation',
    args: ['--no-hive'],
    shouldPass: true
  },
  {
    name: 'Valid camelCase variant allowedChats',
    args: ['--allowedChats', '(123 456)'],
    shouldPass: true
  },
  {
    name: 'Option=value format',
    args: ['--token=abc123'],
    shouldPass: true
  },
  {
    name: 'Invalid option=value format',
    args: ['--invalid-option=value'],
    shouldPass: false,
    expectedError: 'invalid-option'
  }
];

console.log('Running comprehensive tests for issue #482 fix\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\nTest: ${test.name}`);
  console.log(`Args: ${test.args.join(' ')}`);

  const originalArgv = process.argv;
  process.argv = ['node', 'test.mjs', ...test.args];

  try {
    // Parse options
    const options = parseRawOptionsFromArgs(test.args);

    // Create mock argv
    const mockArgv = { _: [], $0: 'test.mjs' };

    // Validate
    const check = createStrictOptionsCheck(DEFINED_OPTIONS);
    check(mockArgv);

    if (test.shouldPass) {
      console.log('✅ PASS');
      passed++;
    } else {
      console.log(`❌ FAIL: Expected error but got none`);
      failed++;
    }
  } catch (error) {
    if (!test.shouldPass) {
      if (test.expectedError && error.message.includes(test.expectedError)) {
        console.log(`✅ PASS (error: ${error.message})`);
        passed++;
      } else {
        console.log(`❌ FAIL: Wrong error message`);
        console.log(`   Expected: ${test.expectedError}`);
        console.log(`   Got: ${error.message}`);
        failed++;
      }
    } else {
      console.log(`❌ FAIL: Unexpected error: ${error.message}`);
      failed++;
    }
  } finally {
    process.argv = originalArgv;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
