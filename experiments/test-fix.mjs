#!/usr/bin/env node

/**
 * Test the fix for command-stream iteration
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

console.log('Testing the fix for Claude command execution...\n');

// Test the fixed pattern
console.log('=== Testing Fixed Pattern ===\n');

const tempDir = '/tmp';

// Write mock Claude output to a file
const mockFile = '/tmp/mock-claude-output.jsonl';
const mockClaudeOutput = [
  '{"type": "session_id", "session_id": "test-session-123"}',
  '{"type": "message", "role": "assistant"}',
  '{"type": "text", "text": "Starting to solve the issue..."}',
  '{"type": "tool_use", "name": "bash", "input": {"command": "ls"}}',
  '{"type": "tool_result", "output": "file1.txt\\nfile2.txt"}',
  '{"type": "text", "text": "Task completed successfully."}'
].join('\n');

const fs = (await use('fs')).promises;
await fs.writeFile(mockFile, mockClaudeOutput);

const claudePath = 'cat';
const claudeArgs = `${mockFile} | jq -c .`;

let sessionId = null;
let messageCount = 0;
let toolUseCount = 0;
let lastMessage = '';
let commandFailed = false;

console.log('Executing command with fixed pattern...\n');

// Create the command
const claudeCommand = $({
  cwd: tempDir,
  shell: true,
  exitOnError: false
})`${claudePath} ${claudeArgs}`;

// Stream the output
for await (const chunk of claudeCommand.stream()) {
  const output = chunk.type === 'stdout' ? chunk.data.toString() : '';

  if (output) {
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        // Capture session ID
        if (!sessionId && data.session_id) {
          sessionId = data.session_id;
          console.log(`📌 Session ID: ${sessionId}`);
        }

        // Track message and tool use counts
        if (data.type === 'message') {
          messageCount++;
          console.log(`📨 Message ${messageCount} from assistant`);
        } else if (data.type === 'tool_use') {
          toolUseCount++;
          console.log(`🔧 Using tool: ${data.name}`);
        }

        // Handle text output
        if (data.type === 'text' && data.text) {
          console.log(`💬 ${data.text}`);
          lastMessage = data.text;
        }

      } catch (parseError) {
        // Not JSON
        if (line.trim()) {
          console.log(`Raw: ${line}`);
        }
      }
    }
  }
}

// After the stream ends, get the command result (THE FIX!)
const commandResult = await claudeCommand;

if (commandResult.code !== 0) {
  commandFailed = true;
  console.log(`\n❌ Command failed with exit code ${commandResult.code}`);
} else {
  console.log(`\n✅ Claude command completed`);
}

console.log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);

console.log('\n=== Results ===');
console.log('Session ID captured:', sessionId ? 'YES' : 'NO');
console.log('Messages counted:', messageCount);
console.log('Tool uses counted:', toolUseCount);
console.log('Last message:', lastMessage);
console.log('Command exit code:', commandResult.code);
console.log('Command failed flag:', commandFailed);

if (messageCount > 0 && toolUseCount > 0 && !commandFailed) {
  console.log('\n✅ FIX VERIFIED: Command execution works correctly!');
} else {
  console.log('\n❌ FIX FAILED: Something is still wrong');
}