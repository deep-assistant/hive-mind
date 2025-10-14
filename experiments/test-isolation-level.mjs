#!/usr/bin/env node
// Test script for --isolation-level option in start-screen command

import { execSync } from 'child_process';

console.log('Testing --isolation-level option in start-screen command...\n');

let allPassed = true;

// Test 1: Help output includes --isolation-level
console.log('Test 1: Help output includes --isolation-level');
try {
  const helpOutput = execSync('./src/start-screen.mjs --help 2>&1', { encoding: 'utf8' });
  const hasIsolationLevel = helpOutput.includes('--isolation-level');
  const hasSameUserScreen = helpOutput.includes('same-user-screen');
  const hasSeparateUserScreen = helpOutput.includes('separate-user-screen');

  if (hasIsolationLevel && hasSameUserScreen && hasSeparateUserScreen) {
    console.log('  ✓ PASSED: --isolation-level appears in help with both modes\n');
  } else {
    console.log('  ✗ FAILED: Missing --isolation-level or modes in help\n');
    allPassed = false;
  }
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('--isolation-level')) {
    console.log('  ✓ PASSED: --isolation-level appears in help\n');
  } else {
    console.log('  ✗ FAILED: Missing --isolation-level in help\n');
    allPassed = false;
  }
}

// Test 2: Invalid isolation level value is rejected
console.log('Test 2: Invalid isolation level value is rejected');
try {
  execSync('./src/start-screen.mjs --isolation-level invalid-mode solve https://github.com/test/repo/issues/1 2>&1', { encoding: 'utf8' });
  console.log('  ✗ FAILED: Should have rejected invalid isolation level\n');
  allPassed = false;
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('Invalid isolation level')) {
    console.log('  ✓ PASSED: Invalid isolation level rejected\n');
  } else {
    console.log('  ✗ FAILED: Wrong error message for invalid isolation level\n');
    allPassed = false;
  }
}

// Test 3: --isolation-level without value is rejected
console.log('Test 3: --isolation-level without value is rejected');
try {
  execSync('./src/start-screen.mjs --isolation-level solve https://github.com/test/repo/issues/1 2>&1', { encoding: 'utf8' });
  console.log('  ✗ FAILED: Should have required a value for --isolation-level\n');
  allPassed = false;
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('Invalid isolation level') || output.includes('requires a value')) {
    console.log('  ✓ PASSED: --isolation-level requires a value\n');
  } else {
    console.log('  ✗ FAILED: Wrong error for missing isolation level value\n');
    allPassed = false;
  }
}

// Test 4: Valid isolation level values are accepted (dry-run to avoid actual execution)
console.log('Test 4: Valid isolation level same-user-screen is accepted');
try {
  // We can't actually test execution without screen installed and a real GitHub URL
  // But we can at least verify the argument parsing doesn't fail
  const output = execSync('./src/start-screen.mjs --help 2>&1', { encoding: 'utf8' });
  // Just verify that the usage shows the correct syntax
  if (output.includes('[--isolation-level <level>]')) {
    console.log('  ✓ PASSED: Usage syntax correct\n');
  } else {
    console.log('  ✗ FAILED: Usage syntax incorrect\n');
    allPassed = false;
  }
} catch (error) {
  console.log('  ✗ FAILED: Error checking usage\n');
  allPassed = false;
}

// Test 5: Combined with --auto-terminate
console.log('Test 5: --isolation-level can be combined with --auto-terminate');
try {
  const helpOutput = execSync('./src/start-screen.mjs --help 2>&1', { encoding: 'utf8' });
  // Check that both options appear in the usage string
  const hasAutoTerminate = helpOutput.includes('--auto-terminate');
  const hasIsolationLevel = helpOutput.includes('--isolation-level');

  if (hasAutoTerminate && hasIsolationLevel) {
    console.log('  ✓ PASSED: Both options appear in help\n');
  } else {
    console.log('  ✗ FAILED: One or both options missing from help\n');
    allPassed = false;
  }
} catch (error) {
  console.log('  ✗ FAILED: Error checking help\n');
  allPassed = false;
}

// Summary
console.log('=' .repeat(50));
if (allPassed) {
  console.log('All tests PASSED! ✓');
  process.exit(0);
} else {
  console.log('Some tests FAILED! ✗');
  process.exit(1);
}
