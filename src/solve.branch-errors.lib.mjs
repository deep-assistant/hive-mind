#!/usr/bin/env node
'use strict';

/**
 * Branch error handling module for solve.mjs
 * Provides improved error messages for branch checkout/creation failures
 */

export async function handleBranchCheckoutError({
  branchName,
  prNumber,
  errorOutput,
  issueUrl,
  owner,
  repo,
  tempDir,
  argv,
  formatAligned,
  log,
  $
}) {
  // Check if this is a PR from a fork
  let isForkPR = false;
  let forkOwner = null;
  let userHasFork = false;
  let suggestForkOption = false;

  if (prNumber) {
    try {
      const prCheckResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner,headRefName 2>/dev/null`;
      if (prCheckResult.code === 0) {
        const prData = JSON.parse(prCheckResult.stdout.toString());
        if (prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner) {
          isForkPR = true;
          forkOwner = prData.headRepositoryOwner.login;
          suggestForkOption = true;
        }
      }
    } catch (e) {
      // Ignore error, proceed with default message
    }

    // Check if the current user has a fork of this repository
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        const currentUser = userResult.stdout.toString().trim();
        const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json parent 2>/dev/null`;
        if (forkCheckResult.code === 0) {
          const forkData = JSON.parse(forkCheckResult.stdout.toString());
          if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
            userHasFork = true;
            forkOwner = currentUser;
            suggestForkOption = true;
          }
        }
      }
    } catch (e) {
      // Ignore error, proceed with default message
    }
  }

  await log(`${formatAligned('❌', 'BRANCH CHECKOUT FAILED', '')}`, { level: 'error' });
  await log('');

  // Provide a clearer explanation of what happened
  await log('  🔍 What happened:');
  await log(`     Failed to checkout the branch '${branchName}' for PR #${prNumber}.`);
  await log(`     Repository: https://github.com/${owner}/${repo}`);
  await log(`     Pull Request: https://github.com/${owner}/${repo}/pull/${prNumber}`);
  if (errorOutput.includes('is not a commit')) {
    await log('     The branch doesn\'t exist in the current repository.');
  } else {
    await log('     Git was unable to find or access the branch.');
  }
  await log('');

  // Only show git output if it's not the typical "not a commit" error
  if (!errorOutput.includes('is not a commit') || argv.verbose) {
    await log('  📦 Git error details:');
    for (const line of errorOutput.split('\n')) {
      await log(`     ${line}`);
    }
    await log('');
  }

  // Explain why this happened
  await log('  💡 Why this happened:');
  if (isForkPR && forkOwner) {
    await log(`     The PR branch exists in the fork: https://github.com/${forkOwner}/${repo}`);
    await log(`     but you're trying to access it from the main repository: https://github.com/${owner}/${repo}`);
    await log('     This is a common issue with pull requests from forks.');
  } else if (userHasFork) {
    await log('     You have a fork of this repository, but the PR branch');
    await log('     might be in your fork rather than the main repository.');
  } else {
    await log('     • The PR branch may not exist on the remote');
    await log('     • There might be network connectivity issues');
    await log('     • You might not have permission to access the branch');
  }
  await log('');

  // Provide clear solutions
  await log('  🔧 How to fix this:');

  if (isForkPR || suggestForkOption) {
    await log('');
    await log('  ┌──────────────────────────────────────────────────────────┐');
    await log('  │  RECOMMENDED: Use the --fork option                     │');
    await log('  └──────────────────────────────────────────────────────────┘');
    await log('');
    await log('  Run this command:');
    const fullUrl = prNumber ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : issueUrl;
    await log(`    ./solve.mjs "${fullUrl}" --fork`);
    await log('');
    await log('  This will automatically:');
    if (userHasFork) {
      await log(`    ✓ Use your existing fork (${forkOwner}/${repo})`);
    } else if (isForkPR && forkOwner) {
      await log('    ✓ Work with the fork that contains the PR branch');
    } else {
      await log('    ✓ Create or use a fork of the repository');
    }
    await log('    ✓ Set up the correct remotes and branches');
    await log('    ✓ Allow you to work on the PR without permission issues');
    await log('');
    await log('  ─────────────────────────────────────────────────────────');
    await log('');
    await log('  Alternative options:');
    await log(`    • Verify PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`    • Check your local setup: cd ${tempDir} && git remote -v`);
  } else {
    await log(`     1. Verify PR branch exists: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. Check remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try fetching manually: cd ${tempDir} && git fetch origin`);
    await log('');
    await log('     If you don\'t have write access to this repository,');
    await log('     consider using the --fork option:');
    const altFullUrl = prNumber ? `https://github.com/${owner}/${repo}/pull/${prNumber}` : issueUrl;
    await log(`       ./solve.mjs "${altFullUrl}" --fork`);
  }
}

export async function handleBranchCreationError({
  branchName,
  errorOutput,
  tempDir,
  owner,
  repo,
  formatAligned,
  log
}) {
  await log(`${formatAligned('❌', 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  await log(`     Unable to create branch '${branchName}'.`);
  if (owner && repo) {
    await log(`     Repository: https://github.com/${owner}/${repo}`);
  }
  await log('');
  await log('  📦 Git output:');
  for (const line of errorOutput.split('\n')) {
    await log(`     ${line}`);
  }
  await log('');
  await log('  💡 Possible causes:');
  await log('     • Branch name already exists');
  await log('     • Uncommitted changes in repository');
  await log('     • Git configuration issues');
  await log('');
  await log('  🔧 How to fix:');
  await log('     1. Try running the command again (uses random names)');
  await log(`     2. Check git status: cd ${tempDir} && git status`);
  await log(`     3. View existing branches: cd ${tempDir} && git branch -a`);
}

export async function handleBranchVerificationError({
  isContinueMode,
  branchName,
  actualBranch,
  prNumber,
  owner,
  repo,
  tempDir,
  formatAligned,
  log,
  $
}) {
  await log('');
  await log(`${formatAligned('❌', isContinueMode ? 'BRANCH CHECKOUT FAILED' : 'BRANCH CREATION FAILED', '')}`, { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  if (isContinueMode) {
    await log('     Git checkout command didn\'t switch to the PR branch.');
  } else {
    await log('     Git checkout -b command didn\'t create or switch to the branch.');
  }
  if (owner && repo) {
    await log(`     Repository: https://github.com/${owner}/${repo}`);
    if (prNumber) {
      await log(`     Pull Request: https://github.com/${owner}/${repo}/pull/${prNumber}`);
    }
  }
  await log('');
  await log('  📊 Branch status:');
  await log(`     Expected branch: ${branchName}`);
  await log(`     Currently on: ${actualBranch || '(unknown)'}`);
  await log('');

  // Show all branches to help debug
  const allBranchesResult = await $({ cwd: tempDir })`git branch -a 2>&1`;
  if (allBranchesResult.code === 0) {
    await log('  🌿 Available branches:');
    for (const line of allBranchesResult.stdout.toString().split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log('');
  }

  if (isContinueMode) {
    await log('  💡 This might mean:');
    await log('     • PR branch doesn\'t exist on remote');
    await log('     • Branch name mismatch');
    await log('     • Network/permission issues');
    await log('');
    await log('  🔧 How to fix:');
    await log(`     1. Check PR details: gh pr view ${prNumber} --repo ${owner}/${repo}`);
    await log(`     2. List remote branches: cd ${tempDir} && git branch -r`);
    await log(`     3. Try manual checkout: cd ${tempDir} && git checkout ${branchName}`);
  } else {
    await log('  💡 This is unusual. Possible causes:');
    await log('     • Git version incompatibility');
    await log('     • File system permissions issue');
    await log('     • Repository corruption');
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Try creating the branch manually:');
    await log(`        cd ${tempDir}`);
    await log(`        git checkout -b ${branchName}`);
    await log('     ');
    await log('     2. If that fails, try two-step approach:');
    await log(`        cd ${tempDir}`);
    await log(`        git branch ${branchName}`);
    await log(`        git checkout ${branchName}`);
    await log('     ');
    await log('     3. Check your git version:');
    await log('        git --version');
  }
  await log('');
  await log(`  📂 Working directory: ${tempDir}`);
  await log('');
}