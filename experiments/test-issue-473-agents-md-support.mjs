#!/usr/bin/env node
/**
 * Test script to verify issue #473 fix - AGENTS.md support
 * This tests that when AGENTS.md exists and CLAUDE.md doesn't,
 * we copy AGENTS.md content to CLAUDE.md before appending task info
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

console.log('🧪 Testing AGENTS.md support (issue #473)...\n');

const testDir = join(tmpdir(), `test-agents-md-${Date.now()}`);

try {
    // Setup test directory
    console.log('📁 Creating test directory...');
    await mkdir(testDir, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    console.log('✅ Git repo initialized');

    // Create an AGENTS.md file (simulating a repo that uses agents.md standard)
    const agentsMdPath = join(testDir, 'AGENTS.md');
    const agentsContent = `# Project Instructions for AI Agents

This project uses the agents.md standard for guiding AI assistants.

## Build Commands
\`\`\`bash
npm run build
npm test
\`\`\`

## Code Style
- Use TypeScript
- Follow ESLint rules
- Write tests for all features
`;

    await writeFile(agentsMdPath, agentsContent);
    execSync('git add AGENTS.md', { cwd: testDir });
    execSync('git commit -m "Add AGENTS.md"', { cwd: testDir });
    console.log('✅ Created AGENTS.md in test repo');

    // Simulate what solve.auto-pr.lib.mjs does
    console.log('\n🔄 Simulating CLAUDE.md creation with AGENTS.md support...');

    const claudeMdPath = join(testDir, 'CLAUDE.md');

    // Check if CLAUDE.md exists
    let existingContent = null;
    let fileExisted = false;
    try {
        existingContent = await readFile(claudeMdPath, 'utf8');
        fileExisted = true;
        console.log('   CLAUDE.md already exists');
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        console.log('   CLAUDE.md does not exist');
    }

    // Support for AGENTS.md standard - this is the NEW code being tested
    if (!fileExisted) {
        try {
            const agentsContent = await readFile(agentsMdPath, 'utf8');
            existingContent = agentsContent;
            fileExisted = true;
            console.log('   ✅ Found AGENTS.md, using it as base for CLAUDE.md');
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            console.log('   AGENTS.md does not exist either');
        }
    }

    // Build task info section
    const taskInfo = `Issue to solve: https://github.com/owner/repo/issues/123
Your prepared branch: test-branch
Your prepared working directory: ${testDir}

Proceed.`;

    // Create final content
    let finalContent;
    if (fileExisted && existingContent) {
        console.log('   Appending task info to existing content...');
        const trimmedExisting = existingContent.trimEnd();
        finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}`;
    } else {
        finalContent = taskInfo;
    }

    await writeFile(claudeMdPath, finalContent);
    console.log('✅ Created CLAUDE.md with combined content');

    // Verify the result
    console.log('\n🔍 Verifying CLAUDE.md content...');
    const claudeContent = await readFile(claudeMdPath, 'utf8');

    // Check that AGENTS.md content is preserved
    if (claudeContent.includes('# Project Instructions for AI Agents')) {
        console.log('✅ AGENTS.md content is preserved in CLAUDE.md');
    } else {
        throw new Error('❌ AGENTS.md content NOT found in CLAUDE.md');
    }

    // Check that task info is appended
    if (claudeContent.includes('Issue to solve:') && claudeContent.includes('Proceed.')) {
        console.log('✅ Task info is appended to CLAUDE.md');
    } else {
        throw new Error('❌ Task info NOT found in CLAUDE.md');
    }

    // Check for separator
    if (claudeContent.includes('---')) {
        console.log('✅ Separator is present between AGENTS.md and task info');
    } else {
        throw new Error('❌ Separator NOT found in CLAUDE.md');
    }

    // Display the final CLAUDE.md content
    console.log('\n📄 Final CLAUDE.md content:');
    console.log('─'.repeat(80));
    console.log(claudeContent);
    console.log('─'.repeat(80));

    console.log('\n✅ All checks passed! AGENTS.md support is working correctly.');

} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
} finally {
    // Cleanup
    try {
        await rm(testDir, { recursive: true, force: true });
        console.log('\n🧹 Cleaned up test directory');
    } catch (err) {
        console.warn('⚠️  Failed to clean up test directory:', err.message);
    }
}

console.log('\n✨ Test completed successfully!');
