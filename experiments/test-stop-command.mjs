#!/usr/bin/env node
// Test script for /stop command functionality
// This tests the CTRL+C sending to screen sessions

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('Testing /stop command functionality...\n');

/**
 * Test 1: Generate screen session name
 */
console.log('Test 1: Screen name generation');
function generateScreenName(command, githubUrl) {
  const urlMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\/(?:issues|pull)\/(\d+))?/);

  if (!urlMatch) {
    const sanitized = githubUrl.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    return `${command}-${sanitized}`;
  }

  const [, owner, repo, number] = urlMatch;
  const parts = [command, owner, repo];

  if (number) {
    parts.push(number);
  }

  return parts.join('-');
}

const testCases = [
  {
    command: 'solve',
    url: 'https://github.com/deep-assistant/hive-mind/issues/524',
    expected: 'solve-deep-assistant-hive-mind-524'
  },
  {
    command: 'hive',
    url: 'https://github.com/deep-assistant/hive-mind',
    expected: 'hive-deep-assistant-hive-mind'
  },
  {
    command: 'solve',
    url: 'https://github.com/owner/repo/pull/123',
    expected: 'solve-owner-repo-123'
  }
];

let allPassed = true;

for (const testCase of testCases) {
  const result = generateScreenName(testCase.command, testCase.url);
  const passed = result === testCase.expected;
  allPassed = allPassed && passed;

  console.log(`  ${testCase.command} + ${testCase.url}`);
  console.log(`    Expected: ${testCase.expected}`);
  console.log(`    Got: ${result}`);
  console.log(`    Result: ${passed ? '✓ PASSED' : '✗ FAILED'}\n`);
}

/**
 * Test 2: Test screen session creation and CTRL+C sending
 */
console.log('Test 2: Screen session creation and CTRL+C');

async function testScreenCtrlC() {
  const testSessionName = 'test-stop-command';

  try {
    // Check if screen is installed
    try {
      await execAsync('which screen');
      console.log('  ✓ screen command is available\n');
    } catch (error) {
      console.log('  ✗ screen command not found - skipping live test\n');
      return true; // Pass if screen not available
    }

    // Clean up any existing test session
    try {
      await execAsync(`screen -S ${testSessionName} -X quit`);
    } catch (error) {
      // Ignore error if session doesn't exist
    }

    // Create a test screen session with a long-running command
    console.log(`  Creating test session: ${testSessionName}`);
    await execAsync(`screen -dmS ${testSessionName} bash -c 'sleep 300; exec bash'`);
    console.log('  ✓ Test session created\n');

    // Wait a moment for session to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if session exists
    const lsResult = await execAsync('screen -ls').catch(err => ({
      stdout: err.stdout || '',
      stderr: err.stderr || ''
    }));

    const sessionExists = (lsResult.stdout + lsResult.stderr).includes(testSessionName);

    if (!sessionExists) {
      console.log('  ✗ Test session was not created properly\n');
      return false;
    }

    console.log('  ✓ Test session is running\n');

    // Send CTRL+C to the session
    console.log('  Sending CTRL+C to test session...');
    await execAsync(`screen -S ${testSessionName} -X stuff $'\\003'`);
    console.log('  ✓ CTRL+C sent successfully\n');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 500));

    // Clean up
    try {
      await execAsync(`screen -S ${testSessionName} -X quit`);
      console.log('  ✓ Test session cleaned up\n');
    } catch (error) {
      console.log('  ⚠️  Warning: Could not clean up test session\n');
    }

    return true;
  } catch (error) {
    console.error('  ✗ Test failed:', error.message, '\n');
    return false;
  }
}

const screenTestPassed = await testScreenCtrlC();
allPassed = allPassed && screenTestPassed;

/**
 * Test 3: Test session tracking data structure
 */
console.log('Test 3: Session tracking data structure');

const activeSessionsPerChat = new Map();

function trackSession(chatId, sessionName, messageId, command, url) {
  if (!activeSessionsPerChat.has(chatId)) {
    activeSessionsPerChat.set(chatId, []);
  }

  const sessions = activeSessionsPerChat.get(chatId);
  sessions.push({
    sessionName,
    messageId,
    command,
    url,
    timestamp: Date.now()
  });

  if (sessions.length > 10) {
    sessions.shift();
  }
}

function getActiveSessions(chatId) {
  return activeSessionsPerChat.get(chatId) || [];
}

// Test tracking
const testChatId = -1002975819706;
trackSession(testChatId, 'solve-test-repo-1', 12345, 'solve', 'https://github.com/test/repo/issues/1');
trackSession(testChatId, 'solve-test-repo-2', 12346, 'solve', 'https://github.com/test/repo/issues/2');

const sessions = getActiveSessions(testChatId);

if (sessions.length === 2) {
  console.log('  ✓ Session tracking works correctly\n');
} else {
  console.log(`  ✗ Expected 2 sessions, got ${sessions.length}\n`);
  allPassed = false;
}

// Test session limit (should keep only last 10)
for (let i = 0; i < 15; i++) {
  trackSession(testChatId, `session-${i}`, 10000 + i, 'solve', `https://github.com/test/repo/issues/${i}`);
}

const limitedSessions = getActiveSessions(testChatId);
if (limitedSessions.length === 10) {
  console.log('  ✓ Session limit (10) works correctly\n');
} else {
  console.log(`  ✗ Expected 10 sessions after limit, got ${limitedSessions.length}\n`);
  allPassed = false;
}

/**
 * Summary
 */
console.log('=' .repeat(50));
if (allPassed) {
  console.log('All tests PASSED! ✓');
  process.exit(0);
} else {
  console.log('Some tests FAILED! ✗');
  process.exit(1);
}
