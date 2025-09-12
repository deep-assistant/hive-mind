#!/usr/bin/env node

// Test script to verify comment counting logic
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing comment counting logic...');

// Mock values for testing
const owner = 'deep-assistant';
const repo = 'hive-mind';
const prNumber = 82;
const issueNumber = 76;

// Test getting last commit timestamp
try {
  console.log('\n1. Testing last commit timestamp...');
  const lastCommitResult = await $`git log -1 --format="%aI" HEAD`;
  if (lastCommitResult.code === 0) {
    const lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
    console.log('✅ Last commit time:', lastCommitTime.toISOString());
  } else {
    console.log('❌ Failed to get last commit time');
  }
} catch (error) {
  console.log('❌ Error getting commit time:', error.message);
}

// Test getting PR comments
try {
  console.log('\n2. Testing PR comments API...');
  const prCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  if (prCommentsResult.code === 0) {
    const prComments = JSON.parse(prCommentsResult.stdout.toString());
    console.log('✅ PR comments count:', prComments.length);
    if (prComments.length > 0) {
      console.log('   Latest comment:', new Date(prComments[prComments.length - 1].created_at).toISOString());
    }
  } else {
    console.log('❌ Failed to get PR comments');
  }
} catch (error) {
  console.log('❌ Error getting PR comments:', error.message);
}

// Test getting issue comments
try {
  console.log('\n3. Testing issue comments API...');
  const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  if (issueCommentsResult.code === 0) {
    const issueComments = JSON.parse(issueCommentsResult.stdout.toString());
    console.log('✅ Issue comments count:', issueComments.length);
    if (issueComments.length > 0) {
      console.log('   Latest comment:', new Date(issueComments[issueComments.length - 1].created_at).toISOString());
    }
  } else {
    console.log('❌ Failed to get issue comments');
  }
} catch (error) {
  console.log('❌ Error getting issue comments:', error.message);
}

// Test the jq sorting commands
try {
  console.log('\n4. Testing sorted comment commands...');
  const sortedPrResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'sort_by(.created_at) | reverse | .[0] | .created_at'`;
  if (sortedPrResult.code === 0) {
    console.log('✅ Latest PR comment sorted:', sortedPrResult.stdout.toString().trim());
  }
} catch (error) {
  console.log('❌ Error with sorted PR commands:', error.message);
}

console.log('\n✅ Test completed!');