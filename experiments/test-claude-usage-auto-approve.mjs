#!/usr/bin/env node

/**
 * Experiment: Capture output from 'claude /usage' with auto-approval
 *
 * This test handles the initial permission prompt by sending Enter,
 * then captures the /usage screen output.
 */

import { promisify } from 'util';
const sleep = promisify(setTimeout);

// Dynamic import of node-pty using use-m
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

console.log('=== Testing claude /usage capture with auto-approval ===\n');

let pty;
try {
  const ptyModule = await use('node-pty');
  pty = ptyModule.default || ptyModule;
  console.log('✅ node-pty loaded successfully\n');
} catch (error) {
  console.error('❌ Failed to load node-pty:', error.message);
  process.exit(1);
}

async function captureClaudeUsage() {
  return new Promise((resolve, reject) => {
    let output = '';
    let approvalSent = false;
    let waitingForUsageScreen = false;
    let usageScreenTimeout;

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
      console.log('[DATA CHUNK]:', data.substring(0, 100).replace(/\n/g, '\\n'));

      // Check if we see the permission prompt
      if (!approvalSent && output.includes('Ready to code here?')) {
        console.log('\n[DETECTED PERMISSION PROMPT]');
        console.log('[SENDING ENTER TO APPROVE]');

        // Send Enter to approve
        setTimeout(() => {
          ptyProcess.write('\r'); // Carriage return (Enter)
          approvalSent = true;
          waitingForUsageScreen = true;

          console.log('[WAITING FOR USAGE SCREEN TO RENDER...]');

          // Wait 2 seconds for the usage screen to fully render
          usageScreenTimeout = setTimeout(() => {
            console.log('\n[USAGE SCREEN SHOULD BE READY]');

            // Send ESC to exit
            console.log('[SENDING ESC TO EXIT]');
            ptyProcess.write('\x1b');

            // Give it a moment to process
            setTimeout(() => {
              ptyProcess.kill();
            }, 500);
          }, 2000);
        }, 500); // Small delay before sending Enter
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      clearTimeout(usageScreenTimeout);
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

      const success = hasUsage && hasEscToExit && hasCurrentSession;
      if (success) {
        console.log('\n✅ SUCCESS: Captured expected TUI output!');
      } else {
        console.log('\n❌ FAILED: Missing expected markers');
      }

      resolve({ output, success });
    });

    // Overall timeout after 15 seconds
    setTimeout(() => {
      console.log('\n[TIMEOUT - FORCING EXIT]');
      ptyProcess.kill();
    }, 15000);
  });
}

try {
  const result = await captureClaudeUsage();
  console.log('\n=== Test Complete ===');

  if (result.success) {
    console.log('\nNext step: Parse the usage data from the captured output');
    process.exit(0);
  } else {
    process.exit(1);
  }
} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}
