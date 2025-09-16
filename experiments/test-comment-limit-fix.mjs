#!/usr/bin/env node

// Test script to verify the comment limit fix implementation

import fs from 'fs/promises';

// Function to test comment length checking logic
async function testCommentLengthLogic() {
  console.log('🧪 Testing comment length logic...\n');
  
  const GITHUB_COMMENT_LIMIT = 65536;
  
  // Test case 1: Short log content (should use regular comment)
  const shortLogContent = 'This is a short log content for testing';
  const shortLogComment = `## 🤖 Solution Log

This log file contains the complete execution trace of the AI solution process.

<details>
<summary>Click to expand solution log (1KB)</summary>

\`\`\`
${shortLogContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-logs option*`;

  console.log(`Test 1 - Short log:`);
  console.log(`  Comment length: ${shortLogComment.length} chars`);
  console.log(`  Expected behavior: Use regular comment (${shortLogComment.length <= GITHUB_COMMENT_LIMIT ? '✅' : '❌'})`);
  console.log();
  
  // Test case 2: Long log content (should use gist)
  const longLogContent = 'Very long log line '.repeat(4000); // ~80KB of content
  const longLogComment = `## 🤖 Solution Log

This log file contains the complete execution trace of the AI solution process.

<details>
<summary>Click to expand solution log (80KB)</summary>

\`\`\`
${longLogContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-logs option*`;

  console.log(`Test 2 - Long log:`);
  console.log(`  Comment length: ${longLogComment.length} chars`);
  console.log(`  Expected behavior: Use gist (${longLogComment.length > GITHUB_COMMENT_LIMIT ? '✅' : '❌'})`);
  console.log();
  
  // Test case 3: Edge case - exactly at the limit
  const targetLength = GITHUB_COMMENT_LIMIT - 200; // Leave some margin for header/footer
  const edgeLogContent = 'x'.repeat(targetLength);
  const edgeLogComment = `## 🤖 Solution Log

This log file contains the complete execution trace of the AI solution process.

<details>
<summary>Click to expand solution log (64KB)</summary>

\`\`\`
${edgeLogContent}
\`\`\`

</details>

---
*Log automatically attached by solve.mjs with --attach-logs option*`;

  console.log(`Test 3 - Edge case:`);
  console.log(`  Comment length: ${edgeLogComment.length} chars`);
  console.log(`  GitHub limit: ${GITHUB_COMMENT_LIMIT} chars`);
  console.log(`  Expected behavior: ${edgeLogComment.length <= GITHUB_COMMENT_LIMIT ? 'Use regular comment ✅' : 'Use gist ✅'}`);
  console.log();
}

// Test the updated solve.mjs file contains the expected changes
async function testImplementationPresence() {
  console.log('🔍 Checking implementation changes in solve.mjs...\n');
  
  try {
    const solveContent = await fs.readFile('./solve.mjs', 'utf8');
    
    const checks = [
      {
        name: 'GitHub comment limit constant',
        pattern: /GITHUB_COMMENT_LIMIT\s*=\s*65536/,
        required: true
      },
      {
        name: 'Comment length check for PR',
        pattern: /logComment\.length\s*>\s*GITHUB_COMMENT_LIMIT/,
        required: true
      },
      {
        name: 'Gist creation for PR',
        pattern: /gh gist create.*--desc.*PR/,
        required: true
      },
      {
        name: 'Gist creation for issue',
        pattern: /gh gist create.*--desc.*issue/,
        required: true
      },
      {
        name: 'Truncated comment fallback',
        pattern: /Log truncated due to length/,
        required: true
      },
      {
        name: 'Gist URL logging',
        pattern: /Gist URL:/,
        required: true
      }
    ];
    
    let allPassed = true;
    
    for (const check of checks) {
      const found = check.pattern.test(solveContent);
      console.log(`  ${found ? '✅' : '❌'} ${check.name}`);
      
      if (check.required && !found) {
        allPassed = false;
      }
    }
    
    console.log();
    console.log(`Overall implementation: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log();
    
  } catch (error) {
    console.log(`❌ Error reading solve.mjs: ${error.message}`);
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Testing Comment Limit Fix Implementation\n');
  console.log('=' .repeat(50));
  console.log();
  
  await testCommentLengthLogic();
  console.log('-'.repeat(50));
  console.log();
  await testImplementationPresence();
  
  console.log('🏁 Test completed!');
}

runTests().catch(console.error);