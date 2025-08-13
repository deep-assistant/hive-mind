#!/usr/bin/env bun

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('=== Quick Enhanced $ API Demo ===\n');

// Test 1: Classic await
console.log('1. Classic await pattern:');
const result1 = await $`echo "Hello World"`;
console.log(`   Output: ${result1.stdout.trim()}\n`);

// Test 2: Async iteration
console.log('2. Async iteration pattern:');
let chunks = 0;
for await (const chunk of $`echo "Line 1"; echo "Line 2"; echo "Line 3"`.stream()) {
  if (chunk.type === 'stdout') {
    console.log(`   Chunk ${++chunks}: ${chunk.data.toString().trim()}`);
  }
}
console.log();

// Test 3: EventEmitter pattern
console.log('3. EventEmitter pattern:');
await new Promise((resolve) => {
  let eventCount = 0;
  $`echo "Event test"`
    .on('data', (chunk) => {
      if (chunk.type === 'stdout') {
        console.log(`   Event ${++eventCount}: ${chunk.data.toString().trim()}`);
      }
    })
    .on('end', (result) => {
      console.log(`   Final result: ${result.stdout.trim()}`);
      resolve();
    });
});
console.log();

// Test 4: Mixed pattern
console.log('4. Mixed pattern (EventEmitter + await):');
let realtimeOutput = '';
const process = $`echo "Mixed test"`;

process.on('data', (chunk) => {
  if (chunk.type === 'stdout') {
    realtimeOutput += chunk.data.toString();
  }
});

const result4 = await process;
console.log(`   Real-time: "${realtimeOutput.trim()}"`);
console.log(`   Final: "${result4.stdout.trim()}"`);
console.log(`   Match: ${realtimeOutput === result4.stdout ? 'YES' : 'NO'}`);

console.log('\n✅ All patterns working correctly!');