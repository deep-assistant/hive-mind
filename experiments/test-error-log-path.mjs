#!/usr/bin/env node

// Test script to verify absolute log path is shown on errors

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const testScenarios = [
  {
    name: 'Test hive.mjs with invalid URL',
    command: 'node',
    args: ['src/hive.mjs', 'invalid-url'],
    expectedPattern: /Full log file:.*\/hive-.*\.log/
  },
  {
    name: 'Test solve.mjs without arguments',
    command: 'node',
    args: ['src/solve.mjs'],
    expectedPattern: /Missing required github issue/
  }
];

async function runTest(scenario) {
  console.log(`\n📝 Running: ${scenario.name}`);
  console.log(`   Command: ${scenario.command} ${scenario.args.join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn(scenario.command, scenario.args, {
      cwd: process.cwd(),
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    child.on('exit', (code) => {
      const output = stdout + stderr;

      if (scenario.expectedPattern) {
        if (scenario.expectedPattern.test(output)) {
          console.log(`   ✅ Test passed: Found expected pattern`);
          resolve(true);
        } else {
          console.log(`   ❌ Test failed: Pattern not found`);
          console.log(`      Expected pattern: ${scenario.expectedPattern}`);
          resolve(false);
        }
      } else {
        console.log(`   Exit code: ${code}`);
        resolve(code === 0);
      }
    });
  });
}

async function main() {
  console.log('🧪 Testing error log path display...\n');

  let allPassed = true;

  for (const scenario of testScenarios) {
    const passed = await runTest(scenario);
    if (!passed) allPassed = false;
  }

  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('✅ All tests passed!');
  } else {
    console.log('❌ Some tests failed');
  }
}

main().catch(console.error);