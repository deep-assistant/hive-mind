#!/usr/bin/env node

// Test script to verify the limit fix works correctly
// This script simulates the issue filtering logic to demonstrate the fix

console.log('🧪 Testing limit fix for skipped issues...\n');

// Simulate issues data
const allIssues = [
  { title: 'Issue 1', url: 'https://github.com/test/repo/issues/1', hasPR: true },
  { title: 'Issue 2', url: 'https://github.com/test/repo/issues/2', hasPR: false },
  { title: 'Issue 3', url: 'https://github.com/test/repo/issues/3', hasPR: true },
  { title: 'Issue 4', url: 'https://github.com/test/repo/issues/4', hasPR: false },
  { title: 'Issue 5', url: 'https://github.com/test/repo/issues/5', hasPR: true },
  { title: 'Issue 6', url: 'https://github.com/test/repo/issues/6', hasPR: false },
  { title: 'Issue 7', url: 'https://github.com/test/repo/issues/7', hasPR: false },
  { title: 'Issue 8', url: 'https://github.com/test/repo/issues/8', hasPR: false },
];

const maxIssues = 3;
const skipIssuesWithPrs = true;

console.log(`📋 Total issues found: ${allIssues.length}`);
console.log(`🔢 Max issues limit: ${maxIssues}`);
console.log(`🚫 Skip issues with PRs: ${skipIssuesWithPrs ? 'Yes' : 'No'}\n`);

// OLD LOGIC (buggy - applies limit before filtering)
console.log('❌ OLD LOGIC (buggy):');
let oldIssuesToProcess = allIssues;

// Apply limit first (old way)
if (maxIssues > 0 && allIssues.length > maxIssues) {
  oldIssuesToProcess = allIssues.slice(0, maxIssues);
  console.log(`   🔢 Applied limit first: ${oldIssuesToProcess.length} issues`);
}

// Then filter
if (skipIssuesWithPrs) {
  const oldFilteredIssues = oldIssuesToProcess.filter(issue => !issue.hasPR);
  const oldSkippedCount = oldIssuesToProcess.length - oldFilteredIssues.length;
  console.log(`   ⏭️  Skipped ${oldSkippedCount} issues with PRs`);
  console.log(`   ✅ Final issues to process: ${oldFilteredIssues.length}`);
  oldFilteredIssues.forEach(issue => console.log(`      - ${issue.title}`));
} else {
  console.log(`   ✅ Final issues to process: ${oldIssuesToProcess.length}`);
}

console.log('\n' + '='.repeat(50) + '\n');

// NEW LOGIC (fixed - applies limit after filtering)
console.log('✅ NEW LOGIC (fixed):');
let newIssuesToProcess = allIssues;

// Filter first
if (skipIssuesWithPrs) {
  const newFilteredIssues = newIssuesToProcess.filter(issue => !issue.hasPR);
  const newSkippedCount = newIssuesToProcess.length - newFilteredIssues.length;
  console.log(`   ⏭️  Skipped ${newSkippedCount} issues with PRs`);
  newIssuesToProcess = newFilteredIssues;
}

// Then apply limit (new way)
if (maxIssues > 0 && newIssuesToProcess.length > maxIssues) {
  newIssuesToProcess = newIssuesToProcess.slice(0, maxIssues);
  console.log(`   🔢 Applied limit after filtering: ${maxIssues} issues`);
}

console.log(`   ✅ Final issues to process: ${newIssuesToProcess.length}`);
newIssuesToProcess.forEach(issue => console.log(`      - ${issue.title}`));

console.log('\n🎯 Result:');
console.log(`   Old logic would process: ${skipIssuesWithPrs ? allIssues.slice(0, maxIssues).filter(issue => !issue.hasPR).length : Math.min(maxIssues, allIssues.length)} issues`);
console.log(`   New logic processes: ${newIssuesToProcess.length} issues`);
console.log('   ✨ New logic correctly excludes skipped issues from the limit count!');