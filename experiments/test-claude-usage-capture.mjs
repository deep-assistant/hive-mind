#!/usr/bin/env node

/**
 * Experiment: Capture output from interactive 'claude /usage' command
 *
 * This test verifies we can:
 * 1. Spawn 'claude /usage' in a PTY (pseudo-terminal)
 * 2. Wait for the TUI to render completely
 * 3. Capture the final frame containing usage information
 * 4. Verify the output contains expected markers: 'Usage' and 'Esc to exit'
 */

import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

console.log('=== Testing claude /usage capture ===\n');

// Method 1: Using child_process.spawn with PTY allocation
async function testWithSpawn() {
  console.log('Method 1: Using spawn with script command wrapper');

  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';

    // Use 'script' command to allocate a pseudo-terminal
    // The -q flag suppresses the script start/done messages
    // The -c flag specifies the command to run
    // /dev/null discards the typescript output file
    const child = spawn('script', [
      '-q',
      '-c',
      'claude /usage',
      '/dev/null'
    ], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      }
    });

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log('[STDOUT CHUNK]:', chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.log('[STDERR CHUNK]:', chunk);
    });

    child.on('error', (error) => {
      console.error('Process error:', error);
      reject(error);
    });

    // Send Escape key after a delay to exit the TUI
    setTimeout(() => {
      console.log('\n[SENDING ESCAPE KEY]');
      child.stdin.write('\x1b'); // ESC character
      child.stdin.end();
    }, 3000); // Wait 3 seconds for TUI to render

    child.on('close', (code) => {
      console.log(`\n[PROCESS CLOSED] Exit code: ${code}`);
      console.log('\n=== FULL OUTPUT ===');
      console.log(output);
      console.log('\n=== ERROR OUTPUT ===');
      console.log(errorOutput);

      // Check for expected content
      const hasUsage = output.includes('Usage') || errorOutput.includes('Usage');
      const hasEscToExit = output.includes('Esc to exit') || errorOutput.includes('Esc to exit');

      console.log('\n=== VALIDATION ===');
      console.log(`Contains "Usage": ${hasUsage}`);
      console.log(`Contains "Esc to exit": ${hasEscToExit}`);

      if (hasUsage && hasEscToExit) {
        console.log('\n✅ SUCCESS: Captured expected TUI output!');
        resolve({ output, errorOutput, success: true });
      } else {
        console.log('\n❌ FAILED: Missing expected markers');
        resolve({ output, errorOutput, success: false });
      }
    });
  });
}

// Method 2: Using unbuffer (if available)
async function testWithUnbuffer() {
  console.log('\n\nMethod 2: Using unbuffer command');

  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';

    const child = spawn('unbuffer', ['claude', '/usage'], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      }
    });

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log('[STDOUT CHUNK]:', chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.log('[STDERR CHUNK]:', chunk);
    });

    child.on('error', (error) => {
      console.error('Process error (unbuffer may not be available):', error.message);
      resolve({ output: '', errorOutput: '', success: false, error: error.message });
      return;
    });

    // Send Escape key after a delay to exit the TUI
    setTimeout(() => {
      console.log('\n[SENDING ESCAPE KEY]');
      child.stdin.write('\x1b'); // ESC character
      child.stdin.end();
    }, 3000);

    child.on('close', (code) => {
      console.log(`\n[PROCESS CLOSED] Exit code: ${code}`);

      const hasUsage = output.includes('Usage') || errorOutput.includes('Usage');
      const hasEscToExit = output.includes('Esc to exit') || errorOutput.includes('Esc to exit');

      console.log('\n=== VALIDATION ===');
      console.log(`Contains "Usage": ${hasUsage}`);
      console.log(`Contains "Esc to exit": ${hasEscToExit}`);

      if (hasUsage && hasEscToExit) {
        console.log('\n✅ SUCCESS: Captured expected TUI output!');
        resolve({ output, errorOutput, success: true });
      } else {
        console.log('\n❌ FAILED: Missing expected markers');
        resolve({ output, errorOutput, success: false });
      }
    });
  });
}

// Run tests
try {
  const result1 = await testWithSpawn();

  if (!result1.success) {
    console.log('\n\nTrying alternative method...');
    const result2 = await testWithUnbuffer();
  }

  console.log('\n=== Test Complete ===');
} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
