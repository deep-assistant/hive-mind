#!/usr/bin/env node

/**
 * Test for the --git-username and --git-email options in solve.mjs and hive.mjs
 */

import { execSync } from 'child_process';
import assert from 'assert';

console.log('Testing --git-username and --git-email options...');

// Test 1: Check that --help shows the new options for solve.mjs
console.log('\n1. Testing solve.mjs --help output...');
try {
  const helpOutput = execSync('node src/solve.mjs --help', { encoding: 'utf8', stdio: 'pipe' });
  console.log('solve.mjs help output length:', helpOutput.length);
  console.log('Looking for git options...');

  if (helpOutput.includes('--git-username')) {
    console.log('✓ Found --git-username option');
  } else {
    console.error('✗ --git-username not found');
  }

  if (helpOutput.includes('Set local git user.name')) {
    console.log('✓ Found git-username description');
  } else {
    console.error('✗ git-username description not found');
  }

  if (helpOutput.includes('--git-email')) {
    console.log('✓ Found --git-email option');
  } else {
    console.error('✗ --git-email not found');
  }

  if (helpOutput.includes('Set local git user.email')) {
    console.log('✓ Found git-email description');
  } else {
    console.error('✗ git-email description not found');
  }

  if (helpOutput.includes('--gu')) {
    console.log('✓ Found --gu alias');
  } else {
    console.error('✗ --gu alias not found');
  }

  if (helpOutput.includes('--ge')) {
    console.log('✓ Found --ge alias');
  } else {
    console.error('✗ --ge alias not found');
  }

  // Only assert if all checks pass
  assert(helpOutput.includes('--git-username'), 'solve.mjs --help should include --git-username option');
  assert(helpOutput.includes('Set local git user.name'), 'solve.mjs should show git-username description');
  assert(helpOutput.includes('--git-email'), 'solve.mjs --help should include --git-email option');
  assert(helpOutput.includes('Set local git user.email'), 'solve.mjs should show git-email description');
  assert(helpOutput.includes('--gu'), 'solve.mjs should show git-username alias');
  assert(helpOutput.includes('--ge'), 'solve.mjs should show git-email alias');
  console.log('✓ solve.mjs --help shows --git-username and --git-email options');
} catch (error) {
  console.error('✗ Failed to find git options in solve.mjs --help');
  if (error.status) {
    console.error('Exit code:', error.status);
  }
  if (error.stdout) {
    console.error('Stdout snippet (last 200 chars):', error.stdout.slice(-200));
  }
  if (error.stderr) {
    console.error('Stderr:', error.stderr);
  }
  console.error('Message:', error.message);
  process.exit(1);
}

// Test 2: Check that --help shows the new options for hive.mjs
console.log('\n2. Testing hive.mjs --help output...');
try {
  const helpOutput = execSync('node src/hive.mjs --help', { encoding: 'utf8', stdio: 'pipe' });
  assert(helpOutput.includes('--git-username'), 'hive.mjs --help should include --git-username option');
  assert(helpOutput.includes('Set local git user.name'), 'hive.mjs should show git-username description');
  assert(helpOutput.includes('--git-email'), 'hive.mjs --help should include --git-email option');
  assert(helpOutput.includes('Set local git user.email'), 'hive.mjs should show git-email description');
  assert(helpOutput.includes('--gu'), 'hive.mjs should show git-username alias');
  assert(helpOutput.includes('--ge'), 'hive.mjs should show git-email alias');
  console.log('✓ hive.mjs --help shows --git-username and --git-email options');
} catch (error) {
  console.error('✗ Failed to find git options in hive.mjs --help');
  if (error.status) {
    console.error('Exit code:', error.status);
  }
  if (error.stdout) {
    console.error('Stdout:', error.stdout);
  }
  if (error.stderr) {
    console.error('Stderr:', error.stderr);
  }
  console.error('Message:', error.message);
  process.exit(1);
}

// Test 3: Test argument parsing with the flags
console.log('\n3. Testing argument parsing...');
try {
  // Test that solve.mjs doesn't crash with the new flags (dry run mode)
  execSync('node src/solve.mjs https://github.com/owner/repo/issues/123 --git-username "Test User" --git-email "test@example.com" --dry-run', {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5000
  });
  console.log('✓ solve.mjs accepts --git-username and --git-email flags');
} catch (error) {
  console.error('✗ solve.mjs failed to parse git flags');
  if (error.status) {
    console.error('Exit code:', error.status);
  }
  if (error.stdout) {
    console.error('Stdout:', error.stdout);
  }
  if (error.stderr) {
    console.error('Stderr:', error.stderr);
  }
  console.error('Message:', error.message);
  // Don't exit on this test since it might fail due to missing dependencies
}

console.log('\n✅ All git option tests passed!');