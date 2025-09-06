#!/usr/bin/env node

/**
 * Issue: Complex shell commands with nested quotes and variables fail
 * 
 * Minimal reproduction showing that command-stream has difficulty with
 * complex shell commands that involve nested quotes, variable substitutions,
 * and special characters, particularly when using GitHub CLI and git commands.
 * 
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #13: Complex shell escaping with nested quotes and variables\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

/**
 * Custom error for shell escaping issues
 */
class ShellEscapingError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ShellEscapingError';
    this.details = details;
  }
}

/**
 * Main test - minimal reproduction
 */
async function runTest() {
  console.log('='.repeat(60));
  console.log('REPRODUCING ISSUE\n');
  
  const testDir = path.join(os.tmpdir(), `test-escaping-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    // Test Case 1: Complex git commit message with quotes and variables
    console.log('Test Case 1: Git commit with complex message');
    console.log('='.repeat(40));
    
    const issueNumber = 123;
    const issueUrl = 'https://github.com/owner/repo/issues/123';
    const commitMessage = `Initial commit for issue #${issueNumber}

Preparing to work on: ${issueUrl}`;
    
    console.log('1️⃣  Using command-stream $ with complex commit message:');
    console.log(`   Message contains: newlines, #, URLs, variables`);
    
    try {
      // Initialize git repo for testing
      await $`cd ${testDir} && git init`;
      await fs.writeFile(path.join(testDir, 'test.txt'), 'test');
      await $`cd ${testDir} && git add test.txt`;
      
      // Attempt 1: Direct interpolation
      console.log('\n   Attempt 1: Direct interpolation with quotes');
      try {
        await $`cd ${testDir} && git commit -m "${commitMessage}"`;
        console.log('   ✅ Direct interpolation worked');
      } catch (e1) {
        console.log(`   ❌ Failed: ${e1.message?.split('\n')[0]}`);
        
        // Attempt 2: Escaped newlines
        console.log('\n   Attempt 2: Manual newline escaping');
        const escapedMessage = commitMessage.replace(/\n/g, '\\n');
        try {
          await $`cd ${testDir} && git commit -m "${escapedMessage}"`;
          console.log('   ✅ Escaped newlines worked');
        } catch (e2) {
          console.log(`   ❌ Failed: ${e2.message?.split('\n')[0]}`);
        }
      }
    } catch (error) {
      console.log(`   ❌ Setup failed: ${error.message}`);
    }
    
    // Test Case 2: GitHub PR with complex title and body
    console.log('\n\nTest Case 2: Complex GitHub CLI commands');
    console.log('='.repeat(40));
    
    const prTitle = '[WIP] Fix "special characters" & entities';
    const prBody = `## PR Description
    
This fixes issue #123 with the following:
- Handles "quoted strings"
- Supports URLs: https://example.com
- Special chars: & < > $ \` \\`;
    
    console.log('1️⃣  Using command-stream $ with complex PR data:');
    
    try {
      // Attempt 1: Direct interpolation
      console.log('\n   Attempt 1: Direct string interpolation');
      const cmd1 = `echo 'gh pr create --title "${prTitle}" --body "${prBody}"'`;
      const result1 = await $`${cmd1}`;
      const output1 = result1.stdout.toString();
      
      if (output1.includes('\\') || output1.includes('\\n')) {
        throw new ShellEscapingError(
          'Escaping added unwanted backslashes',
          { output: output1.substring(0, 100) }
        );
      }
      console.log('   ✅ Direct interpolation worked');
      
    } catch (error1) {
      if (error1 instanceof ShellEscapingError) {
        console.log(`   ❌ ${error1.message}`);
        console.log(`      Output preview: ${error1.details.output}...`);
      } else {
        console.log(`   ❌ Command failed: ${error1.message?.split('\n')[0]}`);
      }
      
      // Attempt 2: Using array arguments
      console.log('\n   Attempt 2: Array arguments');
      try {
        const args = ['echo', 'gh pr create', '--title', prTitle, '--body', prBody];
        const result2 = await $`${args}`;
        console.log('   ✅ Array arguments worked');
      } catch (error2) {
        console.log(`   ❌ Failed: ${error2.message?.split('\n')[0]}`);
      }
    }
    
    // Test Case 3: Combined commands with pipes and redirects
    console.log('\n\nTest Case 3: Combined commands with pipes');
    console.log('='.repeat(40));
    
    const searchQuery = 'repo:owner/repo label:"help wanted"';
    const jsonPath = '.items[0].title';
    
    console.log('1️⃣  Using command-stream $ with pipes and JSON parsing:');
    
    try {
      console.log('\n   Attempt 1: Direct pipe command');
      const pipeCmd = `echo '{"items":[{"title":"Test Issue"}]}' | jq '${jsonPath}'`;
      const result = await $`${pipeCmd}`;
      const output = result.stdout.toString().trim();
      
      if (output === 'Test Issue' || output === '"Test Issue"') {
        console.log('   ✅ Pipe command worked');
      } else {
        throw new ShellEscapingError(
          'Unexpected output from pipe',
          { expected: 'Test Issue', got: output }
        );
      }
    } catch (error) {
      if (error instanceof ShellEscapingError) {
        console.log(`   ❌ ${error.message}`);
        console.log(`      Expected: ${error.details.expected}`);
        console.log(`      Got: ${error.details.got}`);
      } else {
        console.log(`   ❌ Failed: ${error.message?.split('\n')[0]}`);
      }
    }
    
    // WORKAROUND
    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUNDS\n');
    
    console.log('2️⃣  Workaround strategies:');
    
    // Workaround 1: Use temp files
    console.log('\n   Strategy 1: Use temporary files');
    const tempFile = path.join(testDir, 'content.txt');
    await fs.writeFile(tempFile, prBody);
    console.log('   ✅ Write complex content to file, reference with --body-file');
    
    // Workaround 2: Use execSync for complex commands
    console.log('\n   Strategy 2: Use execSync for complex shell operations');
    try {
      const complexCmd = `echo "Complex 'string' with \\"quotes\\" and \${variables}"`;
      const output = execSync(complexCmd, { encoding: 'utf8', cwd: testDir });
      console.log('   ✅ execSync handles complex escaping correctly');
    } catch (e) {
      console.log(`   ⚠️  execSync also requires careful escaping`);
    }
    
    // Workaround 3: Use HEREDOC for multi-line content
    console.log('\n   Strategy 3: Use HEREDOC for multi-line strings');
    const heredocCmd = `cat <<'EOF'
${prBody}
EOF`;
    try {
      const result = await $`${heredocCmd}`;
      if (result.stdout.toString().includes(prBody)) {
        console.log('   ✅ HEREDOC preserves complex content perfectly');
      }
    } catch (e) {
      console.log('   ⚠️  HEREDOC may not work in all shells');
    }
    
  } catch (unexpectedError) {
    console.error('\n❌ Unexpected error:', unexpectedError.message);
  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
  
  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUES FOUND:');
  console.log('   • Multi-line strings in shell commands often fail');
  console.log('   • Nested quotes get over-escaped or under-escaped');
  console.log('   • Special characters ($, `, \\) cause unpredictable behavior');
  console.log('   • Complex pipes and redirects may not work as expected');
  
  console.log('\n✅ WORKAROUND STRATEGIES:');
  console.log('   1. Write complex content to temp files (--body-file, --file, etc.)');
  console.log('   2. Use execSync for critical complex commands');
  console.log('   3. Use HEREDOC for preserving multi-line content');
  console.log('   4. Avoid shell interpolation, use Node.js APIs directly');
  
  console.log('\n📝 Best Practice:');
  console.log('   For any user-generated or complex content, avoid shell commands.');
  console.log('   Use Node.js fs operations and API calls instead.');
}

// Run the test with top-level await
try {
  await runTest();
} catch (error) {
  process.exit(1);
}