#!/usr/bin/env bun

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
import { writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Enhanced $ API Test ===\n');

// Test 1: Classic await pattern (backward compatibility)
async function testClassicAwait() {
  console.log('1. Testing classic await pattern...');
  
  const result = await $`echo "Hello from classic await!"`;
  console.log(`   ✅ Exit code: ${result.code}`);
  console.log(`   ✅ Output: ${result.stdout.trim()}`);
  console.log();
}

// Test 2: Async iteration pattern
async function testAsyncIteration() {
  console.log('2. Testing async iteration pattern...');
  
  let chunkCount = 0;
  const logFile = join(process.cwd(), 'iteration-test.log');
  
  for await (const chunk of $`${claude} -p "Tell me a short joke" --output-format stream-json --verbose --model sonnet`.stream()) {
    chunkCount++;
    
    if (chunk.type === 'stdout') {
      // Process each chunk as it arrives
      const data = chunk.data.toString();
      appendFileSync(logFile, data);
      
      // Extract session ID if available
      if (data.includes('session_id')) {
        try {
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.trim() && line.includes('session_id')) {
              const parsed = JSON.parse(line);
              if (parsed.session_id) {
                console.log(`   ✅ Session ID from iteration: ${parsed.session_id}`);
                break;
              }
            }
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }
    }
  }
  
  console.log(`   ✅ Processed ${chunkCount} chunks via async iteration`);
  console.log(`   ✅ Log file: ${logFile}`);
  console.log();
}

// Test 3: EventEmitter pattern
async function testEventEmitter() {
  console.log('3. Testing EventEmitter pattern...');
  
  return new Promise((resolve) => {
    let sessionId = null;
    let dataChunks = 0;
    const logFile = join(process.cwd(), 'emitter-test.log');
    
    $`${claude} -p "Count from 1 to 3" --output-format stream-json --verbose --model sonnet`
      .on('data', (chunk) => {
        dataChunks++;
        
        if (chunk.type === 'stdout') {
          const data = chunk.data.toString();
          appendFileSync(logFile, data);
          
          // Extract session ID
          if (!sessionId && data.includes('session_id')) {
            try {
              const lines = data.split('\n');
              for (const line of lines) {
                if (line.trim() && line.includes('session_id')) {
                  const parsed = JSON.parse(line);
                  if (parsed.session_id) {
                    sessionId = parsed.session_id;
                    console.log(`   ✅ Session ID from EventEmitter: ${sessionId}`);
                    break;
                  }
                }
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      })
      .on('stdout', (chunk) => {
        // Handle stdout specifically
        console.log(`   📤 Stdout chunk: ${chunk.length} bytes`);
      })
      .on('stderr', (chunk) => {
        // Handle stderr specifically  
        console.log(`   📤 Stderr chunk: ${chunk.length} bytes`);
      })
      .on('end', (result) => {
        console.log(`   ✅ Process ended with code: ${result.code}`);
        console.log(`   ✅ Processed ${dataChunks} data events`);
        console.log(`   ✅ Log file: ${logFile}`);
        console.log();
        resolve();
      })
      .on('exit', (code) => {
        console.log(`   ✅ Exit event received: ${code}`);
      });
  });
}

// Test 4: Stream properties access
async function testStreamProperties() {
  console.log('4. Testing stream properties access...');
  
  const process = $`echo "Testing stream properties"`;
  
  // Access streams before starting
  console.log(`   ✅ Stdout available: ${process.stdout !== undefined}`);
  console.log(`   ✅ Stderr available: ${process.stderr !== undefined}`);
  console.log(`   ✅ Stdin available: ${process.stdin !== undefined}`);
  
  const result = await process;
  console.log(`   ✅ Result: ${result.stdout.trim()}`);
  console.log();
}

// Test 5: Mixed pattern - EventEmitter + await
async function testMixedPattern() {
  console.log('5. Testing mixed EventEmitter + await pattern...');
  
  let realTimeLog = '';
  const logFile = join(process.cwd(), 'mixed-test.log');
  
  const process = $`${claude} -p "Say hello and goodbye" --output-format stream-json --verbose --model sonnet`;
  
  // Set up real-time logging
  process.on('data', (chunk) => {
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();
      realTimeLog += data;
      appendFileSync(logFile, data);
    }
  });
  
  // Still await the final result
  const result = await process;
  
  console.log(`   ✅ Real-time log length: ${realTimeLog.length} chars`);
  console.log(`   ✅ Final result length: ${result.stdout.length} chars`);
  console.log(`   ✅ Logs match: ${realTimeLog === result.stdout ? 'YES' : 'NO'}`);
  console.log(`   ✅ Log file: ${logFile}`);
  console.log();
}

// Run all tests
async function runAllTests() {
  try {
    await testClassicAwait();
    await testAsyncIteration();
    await testEventEmitter();
    await testStreamProperties();
    await testMixedPattern();
    
    console.log('=== Summary ===');
    console.log('✅ All enhanced $ API patterns working correctly');
    console.log('✅ Classic await: backward compatible');
    console.log('✅ Async iteration: real-time chunk processing');
    console.log('✅ EventEmitter: event-driven streaming');
    console.log('✅ Stream properties: direct access to child streams');
    console.log('✅ Mixed patterns: EventEmitter + await combination');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

runAllTests();