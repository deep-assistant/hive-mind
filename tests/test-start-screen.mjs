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
  const helpOutput = execSync('./src/start-screen.mjs 2>&1', { encoding: 'utf8' });
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
  execSync('./src/start-screen.mjs invalid-command https://github.com/test/repo 2>&1', { encoding: 'utf8' });
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

// Test --auto-terminate flag in help output
console.log('Testing --auto-terminate flag in help output...');
try {
  execSync('./src/start-screen.mjs 2>&1', { encoding: 'utf8' });
  console.log('  --auto-terminate in help: ✗ FAILED - Should have thrown error\n');
  allPassed = false;
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('--auto-terminate')) {
    console.log('  --auto-terminate in help: ✓ PASSED\n');
  } else {
    console.log('  --auto-terminate in help: ✗ FAILED - Missing in help text\n');
    allPassed = false;
  }
}

// Test --auto-terminate flag position (should be before command)
console.log('Testing --auto-terminate flag position...');
try {
  const helpOutput = execSync('./src/start-screen.mjs --help 2>&1', { encoding: 'utf8' });
  if (helpOutput.includes('[--auto-terminate]') && helpOutput.includes('<solve|hive>')) {
    console.log('  --auto-terminate position in usage: ✓ PASSED\n');
  } else {
    console.log('  --auto-terminate position in usage: ✗ FAILED - Not in correct position\n');
    allPassed = false;
  }
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('[--auto-terminate]') && output.includes('<solve|hive>')) {
    console.log('  --auto-terminate position in usage: ✓ PASSED\n');
  } else {
    console.log('  --auto-terminate position in usage: ✗ FAILED - Not in correct position\n');
    allPassed = false;
  }
}

// Test --isolation-level option in help
console.log('Testing --isolation-level option in help...');
try {
  const helpOutput = execSync('./src/start-screen.mjs --help 2>&1', { encoding: 'utf8' });
  const hasIsolationLevel = helpOutput.includes('--isolation-level');
  const hasSameUserScreen = helpOutput.includes('same-user-screen');
  const hasSeparateUserScreen = helpOutput.includes('separate-user-screen');

  if (hasIsolationLevel && hasSameUserScreen && hasSeparateUserScreen) {
    console.log('  --isolation-level in help: ✓ PASSED\n');
  } else {
    console.log('  --isolation-level in help: ✗ FAILED - Missing in help text or missing modes\n');
    allPassed = false;
  }
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('--isolation-level')) {
    console.log('  --isolation-level in help: ✓ PASSED\n');
  } else {
    console.log('  --isolation-level in help: ✗ FAILED - Missing in help text\n');
    allPassed = false;
  }
}

// Test invalid isolation level value
console.log('Testing invalid isolation level value rejection...');
try {
  execSync('./src/start-screen.mjs --isolation-level invalid solve https://github.com/test/repo 2>&1', { encoding: 'utf8' });
  console.log('  Invalid isolation level: ✗ FAILED - Should have rejected invalid value\n');
  allPassed = false;
} catch (error) {
  const output = error.stdout || error.stderr || error.output?.join('') || '';
  if (output.includes('Invalid isolation level')) {
    console.log('  Invalid isolation level: ✓ PASSED\n');
  } else {
    console.log('  Invalid isolation level: ✗ FAILED - Wrong error message\n');
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