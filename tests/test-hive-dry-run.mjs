#!/usr/bin/env node

/**
 * Test suite for hive.mjs --dry-run functionality
 * This test ensures that the hive command executes with --dry-run and doesn't silently fail
 *
 * Issue #504: hive command stopped working
 * This test was added to ensure the issue never repeats
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const hivePath = join(__dirname, '..', 'src', 'hive.mjs');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function execCommand(command, timeout = 60000) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: timeout
    });
  } catch (error) {
    // For commands that exit with non-zero or timeout, we still want the output
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      code: error.status,
      error: error.message
    };
  }
}

// Test 1: Basic --dry-run execution with --no-sentry
runTest('hive --dry-run with --no-sentry doesn\'t hang', () => {
  const output = execCommand(`${hivePath} github.com/test -vas --once --dry-run --no-sentry --skip-tool-check 2>&1`, 30000);
  const outputStr = typeof output === 'string' ? output : output.stdout + output.stderr;

  // Check that it produces output (not silent)
  if (!outputStr || outputStr.trim().length === 0) {
    throw new Error('Command produced no output (silent failure)');
  }

  // Check for dry run indicators
  if (!outputStr.includes('DRY RUN') && !outputStr.includes('dry-run') && !outputStr.includes('dry run')) {
    throw new Error('Output doesn\'t indicate dry-run mode');
  }
});

// Test 2: --dry-run shows issues that would be processed
runTest('hive --dry-run shows what would be processed', () => {
  const output = execCommand(`${hivePath} github.com/test --once --dry-run --no-sentry --skip-tool-check 2>&1`, 30000);
  const outputStr = typeof output === 'string' ? output : output.stdout + output.stderr;

  // Should show configuration
  if (!outputStr.includes('Monitoring Configuration') && !outputStr.includes('DRY RUN')) {
    throw new Error('Dry run doesn\'t show monitoring configuration');
  }
});

// Test 3: --dry-run exits successfully
runTest('hive --dry-run exits without hanging', () => {
  try {
    // This should complete within 30 seconds
    execSync(`timeout 30 ${hivePath} github.com/test --once --dry-run --no-sentry --skip-tool-check 2>&1 > /dev/null`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
  } catch (error) {
    // Check if it timed out (exit code 124)
    if (error.status === 124) {
      throw new Error('Command hung and timed out after 30 seconds');
    }
    // Other exit codes are ok - we just want to ensure it doesn't hang
  }
});

// Test 4: Verify --version works (regression test for #504)
runTest('hive --version works without hanging', () => {
  const output = execCommand(`${hivePath} --version 2>&1`, 10000);
  const outputStr = typeof output === 'string' ? output : output.stdout;

  // Should output a version number
  if (!outputStr.match(/\d+\.\d+\.\d+/)) {
    throw new Error('Version output not in expected format');
  }
});

// Test 5: Verify --help works (even if slow)
runTest('hive --help shows usage information', () => {
  const output = execCommand(`node ${hivePath} --help 2>&1`, 10000);
  const outputStr = typeof output === 'string' ? output : output.stdout;

  // Should show usage
  if (!outputStr.includes('Usage:') && !outputStr.includes('usage:')) {
    throw new Error('Help doesn\'t show usage information');
  }

  if (!outputStr.includes('--dry-run')) {
    throw new Error('Help doesn\'t mention --dry-run option');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for hive --dry-run:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
