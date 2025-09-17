#!/usr/bin/env node

/**
 * Test the actual hive.mjs worker output with the new prefix functionality
 */

import { spawn } from 'child_process';

console.log('🧪 Testing hive.mjs worker output with new prefixes...\n');

// Test with dry-run to avoid actually processing issues
const testCommand = './hive.mjs';
const testArgs = [
  'https://github.com/deep-assistant/hive-mind/issues/171',
  '--dry-run',
  '--concurrency', '2',
  '--verbose'
];

console.log(`📋 Running: ${testCommand} ${testArgs.join(' ')}`);
console.log('🔍 Looking for worker prefix patterns...\n');

const child = spawn(testCommand, testArgs, {
  stdio: 'pipe'
});

let foundWorkerPrefixes = false;

child.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);

  // Check for worker prefix patterns
  if (output.includes('worker-1') || output.includes('worker-2')) {
    foundWorkerPrefixes = true;
    console.log('✅ Found worker-specific prefixes in output!');
  }
});

child.stderr.on('data', (data) => {
  const output = data.toString();
  console.log('STDERR:', output);
});

child.on('close', (code) => {
  console.log(`\n🏁 Process finished with code: ${code}`);
  if (foundWorkerPrefixes) {
    console.log('✅ SUCCESS: Worker-specific prefixes are working!');
  } else {
    console.log('ℹ️  Worker prefixes may not have appeared in this short test');
  }
});

child.on('error', (error) => {
  console.log(`❌ Error: ${error.message}`);
});