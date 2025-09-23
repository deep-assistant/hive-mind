#!/usr/bin/env node

// Test script to verify that log paths are displayed correctly
import { execSync, spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('Testing log path display on various exits...\n');

// Test 1: Test hive.mjs with SIGINT
console.log('Test 1: Testing hive.mjs with SIGINT...');
const hiveProcess = spawn('node', ['src/hive.mjs', 'https://github.com/test/test', '--once'], {
  stdio: 'pipe'
});

let hiveOutput = '';
hiveProcess.stdout.on('data', (data) => {
  hiveOutput += data.toString();
});
hiveProcess.stderr.on('data', (data) => {
  hiveOutput += data.toString();
});

// Wait a bit then send SIGINT
setTimeout(1000).then(() => {
  hiveProcess.kill('SIGINT');
});

hiveProcess.on('exit', (code) => {
  console.log('Hive process exited with code:', code);

  // Check if log path is shown
  if (hiveOutput.includes('📁 Full log file:')) {
    console.log('✅ Hive shows log path on SIGINT');
  } else {
    console.log('❌ Hive does not show log path on SIGINT');
  }

  // Extract log path
  const logMatch = hiveOutput.match(/📁 (?:Full log file|Log file): (.+)/);
  if (logMatch) {
    const logPath = logMatch[1].trim();
    if (logPath.startsWith('/')) {
      console.log('✅ Hive log path is absolute:', logPath);
    } else {
      console.log('❌ Hive log path is not absolute:', logPath);
    }
  }

  console.log('\n---\n');
  testSolve();
});

// Test 2: Test solve.mjs with SIGINT
function testSolve() {
  console.log('Test 2: Testing solve.mjs with SIGINT...');
  const solveProcess = spawn('node', ['src/solve.mjs', 'https://github.com/test/test/issues/1'], {
    stdio: 'pipe'
  });

  let solveOutput = '';
  solveProcess.stdout.on('data', (data) => {
    solveOutput += data.toString();
  });
  solveProcess.stderr.on('data', (data) => {
    solveOutput += data.toString();
  });

  // Wait a bit then send SIGINT
  setTimeout(1000).then(() => {
    solveProcess.kill('SIGINT');
  });

  solveProcess.on('exit', (code) => {
    console.log('Solve process exited with code:', code);

    // Check if log path is shown
    if (solveOutput.includes('📁') && solveOutput.includes('log file')) {
      console.log('✅ Solve shows log path on SIGINT');
    } else {
      console.log('❌ Solve does not show log path on SIGINT');
    }

    // Extract log path
    const logMatch = solveOutput.match(/📁 (?:Full log file|Log file|Complete log file): (.+)/);
    if (logMatch) {
      const logPath = logMatch[1].trim();
      if (logPath.startsWith('/')) {
        console.log('✅ Solve log path is absolute:', logPath);
      } else {
        console.log('❌ Solve log path is not absolute:', logPath);
      }
    }

    console.log('\n=== Test Summary ===');
    console.log('Both commands should show absolute log paths on SIGINT.');
    console.log('Check output above for verification.');
  });
}