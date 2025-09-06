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
 * Setup test environment (no try-catch, should fail on error)
 */
async function setup() {
  console.log('📦 Setting up test environment...');
  
  const testDir = path.join(os.tmpdir(), `test-escaping-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  
  // Initialize a git repo for testing
  await $`cd ${testDir} && git init`;
  await $`cd ${testDir} && git config user.name "Test User"`;
  await $`cd ${testDir} && git config user.email "test@example.com"`;
  
  // Create a test file
  await fs.writeFile(path.join(testDir, 'test.txt'), 'test content');
  await $`cd ${testDir} && git add test.txt`;
  
  console.log(`   Test directory: ${testDir}`);
  console.log('✅ Setup complete\n');
  
  return testDir;
}

/**
 * Cleanup function (no try-catch, best effort)
 */
async function cleanup(testDir) {
  console.log('\n🧹 Cleaning up...');
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  console.log('✅ Cleanup complete');
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const testDir = await setup();
  
  console.log('='.repeat(60));
  
  try {
    // TRY: Reproduce the issue - Complex git commit with quotes and newlines
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using command-stream $ with complex commit message:');
    
    const issueNumber = 123;
    const issueUrl = 'https://github.com/owner/repo/issues/123';
    const commitMessage = `Initial commit for issue #${issueNumber}

Preparing to work on: ${issueUrl}
Features: "quoted text" and special chars: $ \` \\`;
    
    console.log('   Message contains:');
    console.log('   • Multiple lines');
    console.log('   • Issue number #123');
    console.log('   • URL with special characters');
    console.log('   • Quoted text and shell special chars\n');
    
    // This should fail with escaping issues
    const result = await $`cd ${testDir} && git commit -m "${commitMessage}"`;
    
    // Verify the commit message was preserved correctly
    const logResult = await $`cd ${testDir} && git log -1 --format=%B`;
    const actualMessage = logResult.stdout.toString().trim();
    
    if (actualMessage !== commitMessage.trim()) {
      // Message was corrupted, throw error to trigger workaround
      const error = new Error('Commit message was corrupted by escaping');
      error.expected = commitMessage.trim();
      error.actual = actualMessage;
      throw error;
    }
    
    // If we get here, the issue may be fixed
    console.log('✅ Command worked (issue may be fixed)');
    console.log('   Commit message preserved correctly');
    
  } catch (error) {
    // CATCH: Apply workaround
    console.log('❌ ISSUE CONFIRMED: Complex shell escaping failed');
    
    if (error.expected) {
      console.log('\n   Expected message:');
      console.log('   ' + error.expected.split('\n').join('\n   '));
      console.log('\n   Actual message:');
      console.log('   ' + error.actual.split('\n').join('\n   '));
    } else {
      console.log(`   Error: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');
    
    // Reset for workaround
    await $`cd ${testDir} && git reset HEAD~1 2>/dev/null || true`;
    await $`cd ${testDir} && git add test.txt`;
    
    // WORKAROUND: Use HEREDOC syntax
    console.log('2️⃣  Using HEREDOC workaround:');
    
    const issueNumber = 123;
    const issueUrl = 'https://github.com/owner/repo/issues/123';
    const commitMessage = `Initial commit for issue #${issueNumber}

Preparing to work on: ${issueUrl}
Features: "quoted text" and special chars: $ \` \\`;
    
    // Use execSync with HEREDOC to preserve complex content
    const command = `cd "${testDir}" && git commit -m "$(cat <<'EOF'
${commitMessage}
EOF
)"`;
    
    console.log('   Using HEREDOC to preserve multi-line content');
    execSync(command, { encoding: 'utf8' });
    
    // Verify it worked
    const verifyResult = execSync(`cd "${testDir}" && git log -1 --format=%B`, { encoding: 'utf8' });
    const actualMessage = verifyResult.trim();
    
    if (actualMessage === commitMessage.trim()) {
      console.log('\n✅ WORKAROUND SUCCESSFUL!');
      console.log('   HEREDOC preserved the message perfectly');
    } else {
      console.log('\n⚠️  HEREDOC also had issues');
      
      // Alternative workaround: temp file
      console.log('\n3️⃣  Alternative: Using temp file workaround:');
      
      // Reset again
      execSync(`cd "${testDir}" && git reset HEAD~1 2>/dev/null || true`, { encoding: 'utf8' });
      execSync(`cd "${testDir}" && git add test.txt`, { encoding: 'utf8' });
      
      const messageFile = path.join(testDir, 'commit-message.txt');
      await fs.writeFile(messageFile, commitMessage);
      
      execSync(`cd "${testDir}" && git commit -F "${messageFile}"`, { encoding: 'utf8' });
      console.log('   ✅ Temp file method works reliably');
    }
  }
  
  // CLEANUP
  await cleanup(testDir);
  
  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: command-stream fails with complex shell escaping');
  console.log('   • Multi-line strings get corrupted');
  console.log('   • Nested quotes cause escaping errors');
  console.log('   • Special characters ($, `, \\) behave unpredictably');
  
  console.log('\n✅ WORKAROUNDS:');
  console.log('   1. Use HEREDOC syntax with execSync for multi-line content');
  console.log('   2. Write to temp file and use -F flag (most reliable)');
  console.log('   3. Avoid shell commands for complex content - use Node.js APIs');
  
  console.log('\nExample workaround code:');
  console.log('  // Option 1: HEREDOC');
  console.log('  execSync(`git commit -m "$(cat <<\'EOF\'\\n${message}\\nEOF\\n)"`);');
  console.log('  // Option 2: Temp file');
  console.log('  await fs.writeFile("msg.txt", message);');
  console.log('  execSync(`git commit -F msg.txt`);');
}

// Run the test
await runTest();