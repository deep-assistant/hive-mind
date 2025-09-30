#!/usr/bin/env node
// Test script for start-screen command

import { parseGitHubUrl } from '../src/github.lib.mjs';
import { execSync } from 'child_process';

// Test cases for screen name generation
const testCases = [
  {
    command: 'solve',
    url: 'https://github.com/veb86/zcadvelecAI/issues/2',
    expectedName: 'solve-veb86-zcadvelecAI-2',
    description: 'solve command with issue URL'
  },
  {
    command: 'hive',
    url: 'https://github.com/veb86/zcadvelecAI',
    expectedName: 'hive-veb86-zcadvelecAI',
    description: 'hive command with repo URL'
  },
  {
    command: 'solve',
    url: 'https://github.com/deep-assistant/hive-mind/issues/333',
    expectedName: 'solve-deep-assistant-hive-mind-333',
    description: 'solve command with another issue'
  },
  {
    command: 'hive',
    url: 'https://github.com/openai/gpt-4',
    expectedName: 'hive-openai-gpt-4',
    description: 'hive command with different repo'
  }
];

console.log('Testing screen name generation logic...\n');

let allPassed = true;

for (const testCase of testCases) {
  const { command, url, expectedName, description } = testCase;

  // Parse the URL
  const parsedUrl = parseGitHubUrl(url);

  // Build screen name (same logic as in start-screen.mjs)
  let screenName = command;

  if (parsedUrl.owner) {
    const safeOwner = parsedUrl.owner.replace(/[^a-zA-Z0-9-_]/g, '-');
    screenName += `-${safeOwner}`;
  }

  if (parsedUrl.repo) {
    const safeRepo = parsedUrl.repo.replace(/[^a-zA-Z0-9-_]/g, '-');
    screenName += `-${safeRepo}`;
  }

  if (parsedUrl.type === 'issue' && parsedUrl.number) {
    screenName += `-${parsedUrl.number}`;
  }

  const passed = screenName === expectedName;
  allPassed = allPassed && passed;

  console.log(`Test: ${description}`);
  console.log(`  URL: ${url}`);
  console.log(`  Expected: ${expectedName}`);
  console.log(`  Got: ${screenName}`);
  console.log(`  Result: ${passed ? '✓ PASSED' : '✗ FAILED'}\n`);
}

// Test help output
console.log('Testing help output...');
try {
  const helpOutput = execSync('./start-screen.mjs 2>&1', { encoding: 'utf8' });
  const hasUsage = helpOutput.includes('Usage:');
  const hasSolve = helpOutput.includes('solve');
  const hasHive = helpOutput.includes('hive');

  if (hasUsage && hasSolve && hasHive) {
    console.log('  Help output: ✓ PASSED\n');
  } else {
    console.log('  Help output: ✗ FAILED - Missing expected content\n');
    allPassed = false;
  }
} catch (error) {
  // Expected to fail with exit code 1
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('Usage:')) {
    console.log('  Help output: ✓ PASSED\n');
  } else {
    console.log('  Help output: ✗ FAILED - Unexpected error\n');
    allPassed = false;
  }
}

// Test invalid command handling
console.log('Testing invalid command handling...');
try {
  execSync('./start-screen.mjs invalid-command https://github.com/test/repo 2>&1', { encoding: 'utf8' });
  console.log('  Invalid command: ✗ FAILED - Should have thrown error\n');
  allPassed = false;
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('Must be \'solve\' or \'hive\'')) {
    console.log('  Invalid command: ✓ PASSED\n');
  } else {
    console.log('  Invalid command: ✗ FAILED - Wrong error message\n');
    allPassed = false;
  }
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