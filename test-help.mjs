#!/usr/bin/env node

// Test script to verify that the --help option works correctly
// This is a simple test as required by issue #162

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

console.log('Testing --help option functionality...\n');

try {
  // Test --help flag by checking exit code and output
  console.log('1. Testing --help flag:');
  try {
    // Capture output to file since execSync might handle stdout differently
    execSync('node solve.mjs --help > help_test_output.txt 2>&1', { encoding: 'utf8' });
    const helpOutput = readFileSync('help_test_output.txt', 'utf8');

    if (helpOutput.includes('Usage: solve.mjs <issue-url> [options]') &&
        helpOutput.includes('The GitHub issue URL to solve')) {
      console.log('✅ --help works correctly\n');
    } else {
      console.log('❌ --help output is incorrect');
      console.log('Output:', helpOutput.substring(0, 500));
      process.exit(1);
    }
  } catch (error) {
    console.log('❌ --help command failed');
    console.log('Error:', error.message);
    process.exit(1);
  }

  // Test -h flag
  console.log('2. Testing -h flag:');
  try {
    execSync('node solve.mjs -h > h_test_output.txt 2>&1', { encoding: 'utf8' });
    const hOutput = readFileSync('h_test_output.txt', 'utf8');

    if (hOutput.includes('Usage: solve.mjs <issue-url> [options]') &&
        hOutput.includes('The GitHub issue URL to solve')) {
      console.log('✅ -h works correctly\n');
    } else {
      console.log('❌ -h output is incorrect\n');
      process.exit(1);
    }
  } catch (error) {
    console.log('❌ -h command failed');
    console.log('Error:', error.message);
    process.exit(1);
  }

  // Test that normal error behavior is preserved
  console.log('3. Testing normal error behavior (no arguments):');
  try {
    execSync('node solve.mjs', { encoding: 'utf8', stdio: 'pipe' });
    console.log('❌ Should have failed with no arguments\n');
    process.exit(1);
  } catch (error) {
    if (error.stderr && error.stderr.includes('GitHub issue URL is required')) {
      console.log('✅ Normal error behavior preserved\n');
    } else {
      console.log('❌ Error message is incorrect\n');
      process.exit(1);
    }
  }

  console.log('🎉 All tests passed! Help functionality is working correctly.');

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}