#!/usr/bin/env node
// Test script for clean-screens command

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function testCleanScreens() {
  console.log('Testing clean-screens command...\n');

  // Test 1: Create some test screen sessions
  console.log('Test 1: Creating test screen sessions...');
  try {
    await execAsync('screen -dmS test-clean-screens-1 bash');
    await execAsync('screen -dmS test-clean-screens-2 bash');
    await execAsync('screen -dmS other-session bash');
    console.log('✓ Created test sessions: test-clean-screens-1, test-clean-screens-2, other-session\n');
  } catch (error) {
    console.error('✗ Failed to create test sessions:', error.message);
    process.exit(1);
  }

  // Test 2: List all sessions
  console.log('Test 2: Listing all screen sessions...');
  try {
    const { stdout } = await execAsync('screen -ls');
    console.log(stdout);
  } catch (error) {
    // screen -ls returns non-zero when there are sessions
    if (error.stdout) {
      console.log(error.stdout);
    }
  }

  // Test 3: Dry-run mode
  console.log('\nTest 3: Testing dry-run mode...');
  try {
    const { stdout } = await execAsync('clean-screens "test-clean-screens-*" --dry-run');
    console.log(stdout);
    console.log('✓ Dry-run mode works\n');
  } catch (error) {
    console.error('✗ Dry-run mode failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }

  // Test 4: Check sessions still exist after dry-run
  console.log('Test 4: Verifying sessions still exist after dry-run...');
  try {
    const { stdout } = await execAsync('screen -ls');
    if (stdout.includes('test-clean-screens-1') && stdout.includes('test-clean-screens-2')) {
      console.log('✓ Sessions still exist (dry-run did not kill them)\n');
    } else {
      console.error('✗ Sessions were killed during dry-run!\n');
    }
  } catch (error) {
    if (error.stdout) {
      if (error.stdout.includes('test-clean-screens-1') && error.stdout.includes('test-clean-screens-2')) {
        console.log('✓ Sessions still exist (dry-run did not kill them)\n');
      } else {
        console.error('✗ Sessions were killed during dry-run!\n');
      }
    }
  }

  // Test 5: Force mode (actually kill sessions)
  console.log('Test 5: Testing force mode...');
  try {
    const { stdout } = await execAsync('clean-screens "test-clean-screens-*" --force');
    console.log(stdout);
    console.log('✓ Force mode works\n');
  } catch (error) {
    console.error('✗ Force mode failed:', error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }

  // Test 6: Verify sessions were killed
  console.log('Test 6: Verifying sessions were killed...');
  try {
    const { stdout } = await execAsync('screen -ls');
    if (stdout.includes('test-clean-screens-1') || stdout.includes('test-clean-screens-2')) {
      console.error('✗ Sessions were not killed!\n');
    } else if (stdout.includes('other-session')) {
      console.log('✓ Test sessions were killed, other-session remains\n');
    }
  } catch (error) {
    if (error.stdout) {
      if (error.stdout.includes('test-clean-screens-1') || error.stdout.includes('test-clean-screens-2')) {
        console.error('✗ Sessions were not killed!\n');
      } else if (error.stdout.includes('other-session')) {
        console.log('✓ Test sessions were killed, other-session remains\n');
      }
    } else {
      console.log('✓ All test sessions were killed\n');
    }
  }

  // Cleanup: Kill remaining test sessions
  console.log('Cleanup: Removing remaining test sessions...');
  try {
    await execAsync('screen -S other-session -X quit');
    console.log('✓ Cleanup complete\n');
  } catch (error) {
    console.error('Warning: Cleanup failed:', error.message);
  }

  console.log('All tests completed!');
}

testCleanScreens().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
