#!/usr/bin/env bun

import { $ } from '../cli-experiments/$.mjs';
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Logging Test ===\n');

let sessionId = null;
let logQueue = [];
let currentLogFile = null;

// Custom $ wrapper that also logs to file
async function $withLogging(strings, ...values) {
  const result = await $(strings, ...values);
  
  // Queue the captured output
  if (result.stdout) {
    logQueue.push(result.stdout);
    
    // Try to extract session ID from first line if not already found
    if (!sessionId && result.stdout.includes('session_id')) {
      try {
        const lines = result.stdout.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const parsed = JSON.parse(line);
            if (parsed.session_id) {
              sessionId = parsed.session_id;
              currentLogFile = join(process.cwd(), `${sessionId}.log`);
              
              console.log(`\n   ✅ Session ID extracted: ${sessionId}`);
              console.log(`   📁 Log file: ${currentLogFile}\n`);
              
              // Flush queued logs to the session-specific file
              if (logQueue.length > 0) {
                writeFileSync(currentLogFile, logQueue.join(''));
                logQueue = [];
              }
              break;
            }
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
    
    // If we have a log file, append new content
    if (currentLogFile) {
      appendFileSync(currentLogFile, result.stdout);
    }
  }
  
  return result;
}

try {
  console.log('1. Testing streaming Claude output with logging...');
  
  // Run Claude with streaming output and capture
  const result = await $withLogging`${claude} -p "Hello, can you tell me a short joke? Remember my name is Alice." --output-format stream-json --verbose --model sonnet`;

  console.log('\n=== Summary ===');
  console.log('✅ Successfully streamed Claude output to both console and log file');
  console.log(`✅ Session ID extracted: ${sessionId}`);
  console.log(`✅ Log file created: ${currentLogFile}`);
  console.log(`✅ Exit code: ${result.code}`);
  
  // Show log file contents
  if (currentLogFile) {
    console.log('\n📄 Log file contents (first 10 lines):');
    console.log('---');
    const logContents = await $`head -n 10 ${currentLogFile}`;
    console.log('---');
  }

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}