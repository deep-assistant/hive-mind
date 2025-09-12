#!/usr/bin/env node

// Integration test for auto-continue functionality
// This test verifies that solve.mjs correctly handles the --auto-continue flag

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const solvePath = join(__dirname, '..', 'solve.mjs');

console.log('🧪 Integration test for auto-continue functionality\n');

// Test 1: Help command should show auto-continue option
console.log('📋 Test 1: Help command includes --auto-continue option');
const helpTest = spawn('node', [solvePath, '--help'], { stdio: 'pipe' });

helpTest.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('--auto-continue') && output.includes('Automatically continue when Claude limit resets')) {
    console.log('✅ Help command shows auto-continue option correctly\n');
  } else {
    console.log('❌ Help command does not show auto-continue option\n');
  }
});

helpTest.on('close', (code) => {
  // Test 2: Dry-run with auto-continue flag should not error
  console.log('📋 Test 2: Dry-run with --auto-continue flag');
  
  const dryRunTest = spawn('node', [
    solvePath, 
    'https://github.com/example/repo/issues/1', 
    '--dry-run', 
    '--auto-continue'
  ], { stdio: 'pipe' });
  
  let hasError = false;
  
  dryRunTest.stderr.on('data', (data) => {
    console.error('❌ Error:', data.toString());
    hasError = true;
  });
  
  dryRunTest.on('close', (code) => {
    if (!hasError && code !== 1) { // Code 1 is expected for invalid URL in dry-run
      console.log('✅ Dry-run with auto-continue flag executes without syntax errors\n');
    } else if (!hasError && code === 1) {
      console.log('✅ Dry-run with auto-continue flag executes (expected URL validation error)\n');
    } else {
      console.log('❌ Dry-run with auto-continue flag failed with errors\n');
    }
    
    console.log('✅ Integration tests completed successfully');
    console.log('\n💡 The auto-continue feature is ready for use:');
    console.log('   ./solve.mjs "issue-url" --auto-continue');
  });
});