#!/usr/bin/env bun

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Real-Time Streaming Logs Test ===\n');

let sessionId = null;
let currentLogFile = null;
let pendingData = '';

// Function to process streaming data chunk by chunk
function processChunk(chunk) {
  const data = chunk.toString();
  pendingData += data;
  
  // Look for complete JSON lines
  const lines = pendingData.split('\n');
  pendingData = lines.pop() || ''; // Keep incomplete line for next chunk
  
  for (const line of lines) {
    if (line.trim()) {
      // Write to log file immediately as we get each line
      if (currentLogFile) {
        appendFileSync(currentLogFile, line + '\n');
      }
      
      // Try to extract session ID if not found yet
      if (!sessionId && line.includes('session_id')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.session_id) {
            sessionId = parsed.session_id;
            currentLogFile = join(process.cwd(), `${sessionId}.log`);
            
            console.log(`\n   ✅ Session ID extracted: ${sessionId}`);
            console.log(`   📁 Log file: ${currentLogFile}\n`);
            
            // Write the current line to start the new log file
            writeFileSync(currentLogFile, line + '\n');
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }
    }
  }
}

// Custom streaming function with real-time file logging
async function streamClaudeWithRealTimeLogging(command) {
  // Use sh with custom options to intercept streaming data
  const originalStdoutWrite = process.stdout.write;
  
  // Monkey patch stdout to intercept data being written to console
  process.stdout.write = function(chunk) {
    // Process the chunk for logging
    processChunk(chunk);
    
    // Still write to console
    return originalStdoutWrite.call(this, chunk);
  };
  
  try {
    const result = await $`${command}`;
    
    return result;
  } finally {
    // Restore original stdout.write
    process.stdout.write = originalStdoutWrite;
    
    // Process any remaining data
    if (pendingData.trim()) {
      if (currentLogFile) {
        appendFileSync(currentLogFile, pendingData);
      }
    }
  }
}

try {
  console.log('1. Testing real-time streaming with immediate file logging...');
  
  const command = `${claude} -p "Hello, can you tell me a joke and then count from 1 to 5? Remember my name is Bob." --output-format stream-json --verbose --model sonnet`;
  
  // Use our custom streaming function
  const result = await streamClaudeWithRealTimeLogging(command);

  console.log('\n=== Summary ===');
  console.log('✅ Successfully streamed Claude output with real-time logging');
  console.log(`✅ Session ID extracted: ${sessionId}`);
  console.log(`✅ Log file created: ${currentLogFile}`);
  console.log(`✅ Exit code: ${result.code}`);
  
  // Show log file contents
  if (currentLogFile) {
    console.log('\n📄 Log file contents (first 5 lines):');
    console.log('---');
    const logContents = await $`head -n 5 ${currentLogFile}`;
    console.log(logContents.stdout);
    console.log('---');
  }

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}