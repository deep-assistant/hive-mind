#!/usr/bin/env node

/**
 * Experiment: Capture output from 'claude /usage' using node-pty
 *
 * This test uses node-pty to properly allocate a PTY and capture
 * the full TUI output including ANSI escape sequences.
 */

import { promisify } from 'util';
const sleep = promisify(setTimeout);

// Dynamic import of node-pty using use-m
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

console.log('=== Testing claude /usage capture with node-pty ===\n');

let pty;
try {
  const ptyModule = await use('node-pty');
  pty = ptyModule.default || ptyModule;
  console.log('✅ node-pty loaded successfully\n');
} catch (error) {
  console.error('❌ Failed to load node-pty:', error.message);
  console.log('\nNote: node-pty requires native compilation.');
  console.log('Falling back to alternative approach...\n');
  process.exit(1);
}

async function captureClaudeUsage() {
  return new Promise((resolve, reject) => {
    let output = '';
    let lastData = '';
    let dataTimeout;

    console.log('Spawning claude in PTY...');

    // Spawn claude in a pseudo-terminal
    const ptyProcess = pty.spawn('claude', ['/usage'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env
    });

    // Capture all data
    ptyProcess.onData((data) => {
      output += data;
      lastData = data;

      // Reset the timeout - we'll wait for 1 second of no data before assuming we have the final frame
      clearTimeout(dataTimeout);
      dataTimeout = setTimeout(() => {
        console.log('\n[NO MORE DATA - ASSUMING FINAL FRAME]');

        // Send ESC to exit
        console.log('[SENDING ESC TO EXIT]');
        ptyProcess.write('\x1b');

        // Give it a moment to process the ESC
        setTimeout(() => {
          ptyProcess.kill();
        }, 500);
      }, 1000);

      console.log('[DATA CHUNK RECEIVED]');
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      clearTimeout(dataTimeout);
      console.log(`\n[PROCESS EXITED] Code: ${exitCode}, Signal: ${signal}`);

      console.log('\n=== RAW OUTPUT (with ANSI codes) ===');
      console.log(output);
      console.log('\n=== END RAW OUTPUT ===');

      // Check for expected content
      const hasUsage = output.includes('Usage');
      const hasEscToExit = output.includes('Esc to exit');
      const hasCurrentSession = output.includes('Current session');
      const hasCurrentWeek = output.includes('Current week');

      console.log('\n=== VALIDATION ===');
      console.log(`Contains "Usage": ${hasUsage}`);
      console.log(`Contains "Esc to exit": ${hasEscToExit}`);
      console.log(`Contains "Current session": ${hasCurrentSession}`);
      console.log(`Contains "Current week": ${hasCurrentWeek}`);

      const success = hasUsage && hasEscToExit;
      if (success) {
        console.log('\n✅ SUCCESS: Captured expected TUI output!');
      } else {
        console.log('\n❌ FAILED: Missing expected markers');
      }

      resolve({ output, success });
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      console.log('\n[TIMEOUT - FORCING EXIT]');
      ptyProcess.kill();
    }, 10000);
  });
}

try {
  const result = await captureClaudeUsage();
  console.log('\n=== Test Complete ===');

  if (result.success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
