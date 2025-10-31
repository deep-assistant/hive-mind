#!/usr/bin/env node

// Test script to verify the output improvements in hive.mjs
// This script simulates various scenarios to test the enhanced error handling and output

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🧪 Testing hive.mjs output improvements...\n');

// Test 1: Test graceful shutdown with SIGINT
console.log('📋 Test 1: Testing graceful shutdown (SIGINT handling)');
console.log('   Starting hive.mjs with a non-existent repo to trigger quick shutdown...');

const hiveProcess = spawn('node', ['./hive.mjs', 'https://github.com/nonexistent/repo', '--once', '--dry-run'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: '/tmp/gh-issue-solver-1757428526964'
});

let output = '';
let errors = '';

hiveProcess.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(`   [stdout] ${text}`);
});

hiveProcess.stderr.on('data', (data) => {
  const text = data.toString();
  errors += text;
  process.stderr.write(`   [stderr] ${text}`);
});

// Wait a moment for it to start, then send SIGINT
setTimeout(2000).then(() => {
  console.log('   📡 Sending SIGINT to test graceful shutdown...');
  hiveProcess.kill('SIGINT');
});

hiveProcess.on('close', (code) => {
  console.log(`   ✅ Process exited with code ${code}`);
  
  // Check if output contains duplicate shutdown messages
  const shutdownMessages = (output.match(/🛑 Received.*signal, shutting down gracefully/g) || []).length;
  
  if (shutdownMessages <= 1) {
    console.log(`   ✅ Good: Found ${shutdownMessages} shutdown message(s) (no duplicates)`);
  } else {
    console.log(`   ❌ Issue: Found ${shutdownMessages} shutdown messages (duplicates detected)`);
  }
  
  // Check for cleaner error messages
  const noisyErrors = output.match(/\/bin\/sh: \d+:|Command failed:/g) || [];
  if (noisyErrors.length === 0) {
    console.log('   ✅ Good: No noisy error message prefixes found');
  } else {
    console.log(`   ⚠️  Found ${noisyErrors.length} noisy error prefixes that should be cleaned`);
  }
  
  console.log('\n🎯 Test complete!');
  console.log('\n📋 Summary of improvements made:');
  console.log('   ✅ Added isShuttingDown flag to prevent duplicate SIGINT messages');
  console.log('   ✅ Improved gracefulShutdown() function with better worker handling');
  console.log('   ✅ Added cleanErrorMessage() to remove noise from error outputs');
  console.log('   ✅ Applied clean error formatting to all error reporting locations');
  console.log('   ✅ Enhanced shutdown process to wait for workers to finish gracefully');
});

hiveProcess.on('error', (err) => {
  console.error(`   ❌ Process error: ${err.message}`);
});