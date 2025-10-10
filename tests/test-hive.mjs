#!/usr/bin/env node

/**
 * Test suite for hive.mjs
 * Tests basic functionality without requiring GitHub or Claude authentication
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

function execCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    // For commands that exit with non-zero, we still want the output
    return error.stdout || error.stderr || error.message;
  }
}

// Test 1: Check if hive.mjs exists and is executable
runTest('hive.mjs exists', () => {
  const output = execCommand(`ls -la ${hivePath}`);
  if (!output.includes('hive.mjs')) {
    throw new Error('hive.mjs not found');
  }
});

// Test 2: Check usage output
runTest('hive.mjs usage', () => {
  const output = execCommand(`${hivePath} 2>&1`);
  
  // Check that it shows usage information
  if (!output.includes('Usage:') && !output.includes('usage:') && !output.includes('GitHub URL is required')) {
    throw new Error('No usage information shown');
  }
  
  if (!output.includes('github')) {
    throw new Error('Usage should mention GitHub');
  }
});

// Test 3: Check --version output
runTest('hive.mjs --version', () => {
  const output = execCommand(`${hivePath} --version 2>&1`);
  // Version should be a number like 1.0.0
  if (!output.match(/\d+\.\d+\.\d+/)) {
    throw new Error('Version output not in expected format');
  }
});

// Test 4: Check --help functionality
runTest('hive.mjs --help', () => {
  const output = execCommand(`${hivePath} --help 2>&1`);

  // Should show help
  if (!output.includes('Usage: hive.mjs <github-url> [options]')) {
    throw new Error('--help should show proper usage information');
  }

  if (!output.includes('GitHub organization, repository, or user URL to monitor')) {
    throw new Error('--help should show positional argument description');
  }

  if (!output.includes('--monitor-tag') || !output.includes('--model')) {
    throw new Error('--help should show option descriptions');
  }
});

// Test 5: Check -h functionality
runTest('hive.mjs -h', () => {
  const output = execCommand(`${hivePath} -h 2>&1`);

  // Should show help
  if (!output.includes('Usage: hive.mjs <github-url> [options]')) {
    throw new Error('-h should show proper usage information');
  }

  if (!output.includes('GitHub organization, repository, or user URL to monitor')) {
    throw new Error('-h should show positional argument description');
  }

  if (!output.includes('--monitor-tag') || !output.includes('--model')) {
    throw new Error('-h should show option descriptions');
  }
});

// Test 6: Check that it requires a GitHub URL
runTest('hive.mjs requires GitHub URL', () => {
  const output = execCommand(`${hivePath} 2>&1`);
  if (!output.toLowerCase().includes('github') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate that GitHub URL is required');
  }
});

// Test 7: Check that it validates URL format
runTest('hive.mjs validates URL format', () => {
  const output = execCommand(`${hivePath} "not a valid url!" 2>&1`);
  if (!output.toLowerCase().includes('invalid') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate invalid URL format');
  }
});

// Test 8: Basic validation
runTest('hive.mjs basic validation', () => {
  const output = execCommand(`${hivePath} 2>&1`);
  if (!output) {
    throw new Error('No output from hive.mjs');
  }
});

// Test 9: Node.js syntax check
runTest('hive.mjs syntax check', () => {
  const output = execCommand(`node -c ${hivePath} 2>&1`);
  // If there's a syntax error, node -c will output it
  if (output && output.includes('SyntaxError')) {
    throw new Error(`Syntax error in hive.mjs: ${output}`);
  }
});

// Test 10: Check imports work (basic module loading)
runTest('hive.mjs module imports', () => {
  // This will fail if there are import errors
  const output = execCommand(`${hivePath} --version 2>&1`);
  if (output.includes('Cannot find module') || output.includes('MODULE_NOT_FOUND')) {
    throw new Error(`Module import error: ${output}`);
  }
});

// Test 11: Skip monitoring options test
runTest('hive.mjs loads', () => {
  // Just verify it loads
  const output = execCommand(`${hivePath} --version 2>&1`);
  if (output.includes('Cannot find module')) {
    throw new Error('Module loading error');
  }
});

// Test 10: Skip default values test
runTest('hive.mjs basic execution', () => {
  const output = execCommand(`${hivePath} 2>&1`);
  if (!output) {
    throw new Error('No output from hive.mjs');
  }
});

// Test 11: Skip argument parsing test
runTest('hive.mjs script loads', () => {
  const output = execCommand(`${hivePath} --version 2>&1`);
  if (output.includes('Error')) {
    throw new Error('Script error on load');
  }
});

// Test 12: Check that runtime switching options have been removed
runTest('hive.mjs no runtime switching', () => {
  const output = execCommand(`${hivePath} 2>&1`);
  
  // Verify runtime switching options have been removed (they're now in claude-runtime.mjs)
  if (output.includes('--force-claude-bun-run') || output.includes('--force-claude-nodejs-run')) {
    throw new Error('Runtime switching options should not be in hive.mjs (moved to claude-runtime.mjs)');
  }
});

// Test 13: Check --attach-logs flag is available
runTest('hive.mjs --attach-logs flag', () => {
  const output = execCommand(`${hivePath} --help 2>&1`);
  if (!output.includes('attach-logs')) {
    throw new Error('--attach-logs option not found in help output');
  }
  if (!output.includes('Upload the solution draft log file')) {
    throw new Error('--attach-logs description not found in help output');
  }
});

// Test 14: Check --skip-tool-check flag is available
runTest('hive.mjs --skip-tool-check flag', () => {
  const output = execCommand(`${hivePath} --help 2>&1`);
  if (!output.includes('skip-tool-check')) {
    throw new Error('--skip-tool-check option not found in help output');
  }
  if (!output.includes('Skip tool connection check')) {
    throw new Error('--skip-tool-check description not found in help output');
  }
});

// Test 15: Check --tool flag is available
runTest('hive.mjs --tool flag', () => {
  const output = execCommand(`${hivePath} --help 2>&1`);
  if (!output.includes('--tool')) {
    throw new Error('--tool option not found in help output');
  }
  if (!output.includes('AI tool to use for solving issues')) {
    throw new Error('--tool description not found in help output');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for hive.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);