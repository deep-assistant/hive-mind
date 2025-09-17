#!/usr/bin/env node

/**
 * Debug script to test PR URL parsing exactly as solve.mjs does
 * This will help us understand if there's an issue with URL parsing
 * that could prevent comment detection
 */

console.log('🔍 PR URL Parsing Debug');
console.log('=======================\n');

// Import required modules
const { execSync } = await import('child_process');

// Helper function to run commands
async function $(command) {
  try {
    const stdout = execSync(command, { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status || 1, stderr: error.message };
  }
}

async function debugPrUrlParsing() {
  try {
    // Test the exact URL parsing logic from solve.mjs
    const issueUrl = 'https://github.com/deep-assistant/hive-mind/pull/169';
    console.log(`🔗 Input URL: ${issueUrl}`);

    // Check if it's recognized as a PR URL
    const isPrUrl = issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+$/);
    console.log(`📋 Is PR URL: ${!!isPrUrl}`);

    if (!isPrUrl) {
      console.log('❌ PROBLEM: URL not recognized as PR URL');
      return false;
    }

    // Parse URL parts exactly like solve.mjs
    const urlParts = issueUrl.replace('https://github.com/', '').split('/');
    const owner = urlParts[0];
    const repo = urlParts[1];
    const urlNumber = urlParts[3]; // Could be issue or PR number

    console.log(`📦 Owner: ${owner}`);
    console.log(`📂 Repo: ${repo}`);
    console.log(`🔢 URL Number: ${urlNumber} (type: ${typeof urlNumber})`);

    // Simulate continue mode activation
    let isContinueMode = true;
    let prNumber = urlNumber;

    console.log(`\\n🔄 Continue mode variables:`);
    console.log(`   isContinueMode: ${isContinueMode}`);
    console.log(`   prNumber: ${prNumber} (type: ${typeof prNumber})`);

    // Test the condition that determines if comment counting runs
    console.log(`\\n📊 Comment counting conditions:`);
    const branchName = 'issue-168-113ce685'; // Current branch
    console.log(`   prNumber: ${prNumber || 'NOT SET'}`);
    console.log(`   branchName: ${branchName || 'NOT SET'}`);
    console.log(`   Will count comments: ${!!(prNumber && branchName)}`);

    if (!prNumber) {
      console.log(`   ❌ PROBLEM: prNumber not set`);
      return false;
    }
    if (!branchName) {
      console.log(`   ❌ PROBLEM: branchName not set`);
      return false;
    }

    // Test the GitHub API calls with the extracted prNumber
    console.log(`\\n🔎 Testing GitHub API calls:`);

    console.log(`   Testing: gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    const prReviewCommentsResult = await $(`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    console.log(`   Review comments API result: ${prReviewCommentsResult.code === 0 ? 'SUCCESS' : 'FAILED'}`);

    console.log(`   Testing: gh api repos/${owner}/${repo}/issues/${prNumber}/comments`);
    const prConversationCommentsResult = await $(`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`);
    console.log(`   Conversation comments API result: ${prConversationCommentsResult.code === 0 ? 'SUCCESS' : 'FAILED'}`);

    if (prReviewCommentsResult.code !== 0) {
      console.log(`   ❌ Review comments API failed: ${prReviewCommentsResult.stderr}`);
    }
    if (prConversationCommentsResult.code !== 0) {
      console.log(`   ❌ Conversation comments API failed: ${prConversationCommentsResult.stderr}`);
    }

    // Test commit time detection
    console.log(`\\n⏰ Testing commit time detection:`);

    // Try exact solve.mjs logic for commit time
    let lastCommitResult = await $(`git log -1 --format="%aI" origin/${branchName}`);
    if (lastCommitResult.code !== 0) {
      console.log(`   Remote branch not found, trying local branch`);
      lastCommitResult = await $(`git log -1 --format="%aI" ${branchName}`);
    }

    if (lastCommitResult.code === 0) {
      const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
      console.log(`   ✅ Last commit time: ${lastCommitTime.toISOString()}`);

      // Count comments if APIs succeeded
      if (prReviewCommentsResult.code === 0 && prConversationCommentsResult.code === 0) {
        const prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
        const prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());

        const allPrComments = [...prReviewComments, ...prConversationComments];
        const newPrComments = allPrComments.filter(comment =>
          new Date(comment.created_at) > lastCommitTime
        ).length;

        console.log(`   📊 Total PR comments: ${allPrComments.length}`);
        console.log(`   📊 New PR comments: ${newPrComments}`);

        return newPrComments > 0;
      }
    } else {
      console.log(`   ❌ Could not get commit time: ${lastCommitResult.stderr}`);
    }

    return false;

  } catch (error) {
    console.error(`\\n❌ Error: ${error.message}`);
    return false;
  }
}

const result = await debugPrUrlParsing();

console.log(`\\n🎯 Overall Result: ${result ? 'WORKING' : 'ISSUE DETECTED'}`);
if (!result) {
  console.log('This may explain why comment detection fails in some scenarios.');
}