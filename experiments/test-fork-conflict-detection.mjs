#!/usr/bin/env node

// Experiment: Test fork conflict detection
// Test if we can detect when a user tries to fork a repo that shares
// the same root as an existing fork they already have

// Use use-m for cross-runtime compatibility
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');

console.log('🧪 Testing Fork Conflict Detection\n');

/**
 * Get the root repository of any repository
 * Returns the source (root) repository if the repo is a fork, otherwise returns the repo itself
 */
async function getRootRepository(owner, repo) {
  try {
    console.log(`📋 Checking if ${owner}/${repo} is a fork...`);
    const result = await $`gh api repos/${owner}/${repo} --jq '{fork: .fork, source: .source.full_name}'`;

    if (result.code !== 0) {
      console.log(`   ❌ Failed to get repository info`);
      return null;
    }

    const repoInfo = JSON.parse(result.stdout.toString().trim());

    if (repoInfo.fork && repoInfo.source) {
      console.log(`   ✅ This is a fork. Root repository: ${repoInfo.source}`);
      return repoInfo.source;
    } else {
      console.log(`   ✅ This is NOT a fork. Root repository: ${owner}/${repo}`);
      return `${owner}/${repo}`;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Check if current user has a fork of the given root repository
 */
async function checkExistingForkOfRoot(rootRepo) {
  try {
    const [rootOwner, rootRepoName] = rootRepo.split('/');

    console.log(`\n📋 Checking if current user has a fork of ${rootRepo}...`);

    // Get current user
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      console.log(`   ❌ Failed to get current user`);
      return null;
    }
    const currentUser = userResult.stdout.toString().trim();
    console.log(`   Current user: ${currentUser}`);

    // Check if user has a fork of the root repository
    // GitHub API allows us to list all forks of a repository
    console.log(`   Searching for ${currentUser}'s fork of ${rootRepo}...`);

    // Try to find user's fork in the forks list
    const forksResult = await $`gh api repos/${rootRepo}/forks --paginate --jq '.[] | select(.owner.login == "${currentUser}") | .full_name'`;

    if (forksResult.code !== 0) {
      console.log(`   ❌ Failed to list forks`);
      return null;
    }

    const forks = forksResult.stdout.toString().trim().split('\n').filter(f => f);

    if (forks.length > 0) {
      console.log(`   ✅ Found existing fork: ${forks[0]}`);
      return forks[0];
    } else {
      console.log(`   ℹ️  No existing fork found`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Main test function
 */
async function testForkConflictDetection() {
  // Test scenario from issue #344:
  // User forked zamtmn/zcad
  // Then tried to work on veb86/zcadvelecAI (which is also a fork of zamtmn/zcad)

  console.log('\n' + '='.repeat(70));
  console.log('TEST SCENARIO (from issue #344)');
  console.log('='.repeat(70));

  const testCases = [
    {
      name: 'Original repository (zamtmn/zcad)',
      owner: 'zamtmn',
      repo: 'zcad'
    },
    {
      name: 'Fork of original (veb86/zcadvelecAI)',
      owner: 'veb86',
      repo: 'zcadvelecAI'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Testing: ${testCase.name}`);
    console.log(`Repository: ${testCase.owner}/${testCase.repo}`);
    console.log(`${'─'.repeat(70)}`);

    // Step 1: Get root repository
    const rootRepo = await getRootRepository(testCase.owner, testCase.repo);

    if (!rootRepo) {
      console.log(`❌ Could not determine root repository`);
      continue;
    }

    // Step 2: Check if user already has a fork of the root
    const existingFork = await checkExistingForkOfRoot(rootRepo);

    if (existingFork) {
      console.log(`\n⚠️  FORK CONFLICT DETECTED!`);
      console.log(`   You already have a fork of ${rootRepo}: ${existingFork}`);
      console.log(`   Trying to fork ${testCase.owner}/${testCase.repo} (which is also derived from ${rootRepo})`);
      console.log(`   would cause issues because GitHub doesn't allow multiple forks of the same root.`);
      console.log(`\n💡 Suggested action:`);
      console.log(`   Delete your existing fork: gh repo delete ${existingFork}`);
      console.log(`   Then fork ${testCase.owner}/${testCase.repo} instead`);
    } else {
      console.log(`\n✅ No fork conflict - safe to proceed`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

// Run the test
await testForkConflictDetection();
