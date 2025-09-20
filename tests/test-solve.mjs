#!/usr/bin/env node

/**
 * Test suite for solve.mjs
 * Tests basic functionality without requiring GitHub or Claude authentication
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const solvePath = join(__dirname, '..', 'src', 'solve.mjs');

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

// Test 1: Check if solve.mjs exists and is executable
runTest('solve.mjs exists', () => {
  const output = execCommand(`ls -la ${solvePath}`);
  if (!output.includes('solve.mjs')) {
    throw new Error('solve.mjs not found');
  }
});

// Test 2: Check usage output when no arguments provided
runTest('solve.mjs usage without args', () => {
  const output = execCommand(`${solvePath} 2>&1`);

  // Check that it shows usage information
  if (!output.includes('Usage:') && !output.includes('usage:')) {
    throw new Error('No usage information shown');
  }

  if (!output.includes('github') || !output.includes('issue')) {
    throw new Error('Usage should mention GitHub issues');
  }
});

// Test 3: Check --version output
runTest('solve.mjs --version', () => {
  const output = execCommand(`${solvePath} --version 2>&1`);
  // Version should be a number like 1.0.0
  if (!output.match(/\d+\.\d+\.\d+/)) {
    throw new Error('Version output not in expected format');
  }
});

// Test 4: Check --help functionality (Issue #162)
runTest('solve.mjs --help', () => {
  const output = execCommand(`${solvePath} --help 2>&1`);

  // Should show help without errors
  if (!output.includes('Usage: solve.mjs <issue-url> [options]')) {
    throw new Error('--help should show proper usage information');
  }

  if (!output.includes('The GitHub issue URL to solve')) {
    throw new Error('--help should show positional argument description');
  }

  if (!output.includes('--model') || !output.includes('--verbose')) {
    throw new Error('--help should show option descriptions');
  }
});

// Test 5: Check -h functionality (Issue #162)
runTest('solve.mjs -h', () => {
  const output = execCommand(`${solvePath} -h 2>&1`);

  // Should show help without errors
  if (!output.includes('Usage: solve.mjs <issue-url> [options]')) {
    throw new Error('-h should show proper usage information');
  }

  if (!output.includes('The GitHub issue URL to solve')) {
    throw new Error('-h should show positional argument description');
  }

  if (!output.includes('--model') || !output.includes('--verbose')) {
    throw new Error('-h should show option descriptions');
  }
});

// Test 6: Check that it requires a GitHub URL
runTest('solve.mjs requires GitHub URL', () => {
  const output = execCommand(`${solvePath} 2>&1`);
  if (!output.toLowerCase().includes('github') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate that GitHub URL is required');
  }
});

// Test 7: Check that it validates URL format
runTest('solve.mjs validates URL format', () => {
  const output = execCommand(`${solvePath} not-a-url 2>&1`);
  if (!output.toLowerCase().includes('invalid') && !output.toLowerCase().includes('url')) {
    throw new Error('Should indicate invalid URL format');
  }
});

// Test 8: Skip model options test (no standard help)
runTest('solve.mjs basic validation', () => {
  // Just verify the script can be executed
  const output = execCommand(`${solvePath} 2>&1`);
  if (!output) {
    throw new Error('No output from solve.mjs');
  }
});

// Test 9: Node.js syntax check
runTest('solve.mjs syntax check', () => {
  const output = execCommand(`node -c ${solvePath} 2>&1`);
  // If there's a syntax error, node -c will output it
  if (output && output.includes('SyntaxError')) {
    throw new Error(`Syntax error in solve.mjs: ${output}`);
  }
});

// Test 10: Check imports work (basic module loading)
runTest('solve.mjs module imports', () => {
  // This will fail if there are import errors
  const output = execCommand(`${solvePath} --version 2>&1`);
  if (output.includes('Cannot find module') || output.includes('MODULE_NOT_FOUND')) {
    throw new Error(`Module import error: ${output}`);
  }
});

// Test 11: Check that runtime switching options have been removed
runTest('solve.mjs no runtime switching', () => {
  const output = execCommand(`${solvePath} 2>&1`);
  
  // Verify runtime switching options have been removed (they're now in claude-runtime.mjs)
  if (output.includes('--force-claude-bun-run') || output.includes('--force-claude-nodejs-run')) {
    throw new Error('Runtime switching options should not be in solve.mjs (moved to claude-runtime.mjs)');
  }
});

// Test 12: Validate that script loads without errors
runTest('solve.mjs loads successfully', () => {
  // Just verify no critical errors on load
  const output = execCommand(`${solvePath} --version 2>&1`);
  if (output.includes('Error:') || output.includes('Cannot find')) {
    throw new Error('Script loading error');
  }
});

// Test 13: Check --skip-claude-check flag is available
runTest('solve.mjs --skip-claude-check flag', () => {
  const output = execCommand(`${solvePath} --help 2>&1`);
  if (!output.includes('skip-claude-check')) {
    throw new Error('--skip-claude-check option not found in help output');
  }
  if (!output.includes('Skip Claude connection check')) {
    throw new Error('--skip-claude-check description not found in help output');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for solve.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);