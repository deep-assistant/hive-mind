#!/usr/bin/env node

// Comprehensive test for strict option validation across all CLI commands
// Tests issue #453 fix: reject unrecognized options like —fork (em-dash)

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const tests = [
  {
    name: 'solve.mjs with valid --fork',
    command: './src/solve.mjs https://github.com/test/repo/issues/1 --fork --dry-run',
    shouldFail: false
  },
  {
    name: 'solve.mjs with em-dash —fork',
    command: './src/solve.mjs https://github.com/test/repo/issues/1 —fork',
    shouldFail: true,
    errorPattern: /fork/
  },
  {
    name: 'solve.mjs with invalid --invalid-option',
    command: './src/solve.mjs https://github.com/test/repo/issues/1 --invalid-option',
    shouldFail: true,
    errorPattern: /invalid-option/
  },
  {
    name: 'hive.mjs with valid --fork',
    command: './src/hive.mjs https://github.com/test/repo --fork --once --dry-run',
    shouldFail: false
  },
  {
    name: 'hive.mjs with em-dash —fork',
    command: './src/hive.mjs https://github.com/test/repo —fork',
    shouldFail: true,
    errorPattern: /fork/
  },
  {
    name: 'hive.mjs with invalid --bad-option',
    command: './src/hive.mjs https://github.com/test/repo --bad-option',
    shouldFail: true,
    errorPattern: /bad-option/
  },
  {
    name: 'task.mjs with valid --verbose',
    command: './src/task.mjs "test task" --verbose --only-clarify',
    shouldFail: false
  },
  {
    name: 'task.mjs with em-dash —verbose',
    command: './src/task.mjs "test task" —verbose',
    shouldFail: true,
    errorPattern: /verbose/
  },
  {
    name: 'review.mjs with valid --verbose',
    command: './src/review.mjs https://github.com/test/repo/pull/1 --verbose --dry-run',
    shouldFail: false
  },
  {
    name: 'review.mjs with em-dash —verbose',
    command: './src/review.mjs https://github.com/test/repo/pull/1 —verbose',
    shouldFail: true,
    errorPattern: /verbose/
  }
];

console.log('🧪 Running comprehensive strict options validation tests...\n');

let passed = 0;
let failed = 0;

for (const test of tests) {
  process.stdout.write(`Testing: ${test.name}... `);

  try {
    const result = await execAsync(test.command, {
      timeout: 10000,
      cwd: process.cwd()
    });

    if (test.shouldFail) {
      console.log('❌ FAIL (expected to fail but succeeded)');
      failed++;
    } else {
      console.log('✅ PASS');
      passed++;
    }
  } catch (error) {
    if (test.shouldFail) {
      // Check if error message matches expected pattern
      const errorOutput = error.stderr || error.stdout || error.message;
      if (test.errorPattern && test.errorPattern.test(errorOutput)) {
        console.log('✅ PASS (failed as expected with correct error)');
        passed++;
      } else if (!test.errorPattern) {
        console.log('✅ PASS (failed as expected)');
        passed++;
      } else {
        console.log(`❌ FAIL (failed but with wrong error)`);
        console.log(`   Expected pattern: ${test.errorPattern}`);
        console.log(`   Got: ${errorOutput.substring(0, 100)}`);
        failed++;
      }
    } else {
      console.log(`❌ FAIL (unexpected error)`);
      console.log(`   Error: ${error.message.substring(0, 100)}`);
      failed++;
    }
  }
}

console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
