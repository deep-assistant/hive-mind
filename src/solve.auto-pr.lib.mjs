/**
 * Auto PR creation functionality for solve.mjs
 * Handles automatic creation of draft pull requests with initial commits
 */

export async function handleAutoPrCreation({
  argv,
  tempDir,
  branchName,
  issueNumber,
  owner,
  repo,
  defaultBranch,
  forkedRepo,
  isContinueMode,
  prNumber,
  log,
  formatAligned,
  $,
  reportError,
  path,
  fs
}) {
  // Skip auto-PR creation if:
  // 1. Auto-PR creation is disabled AND we're not in continue mode with no PR
  // 2. Continue mode is active AND we already have a PR
  if (!argv.autoPullRequestCreation && !(isContinueMode && !prNumber)) {
    return null;
  }

  if (isContinueMode && prNumber) {
    // Continue mode with existing PR - skip PR creation
    return null;
  }

  await log(`\n${formatAligned('🚀', 'Auto PR creation:', 'ENABLED')}`);
  await log('     Creating:               Initial commit and draft PR...');
  await log('');

  let prUrl = null;
  let localPrNumber = null;
  let claudeCommitHash = null;

  try {
    // Create CLAUDE.md file with the task details
    await log(formatAligned('📝', 'Creating:', 'CLAUDE.md with task details'));

    // Check if CLAUDE.md already exists and read its content
    const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    let existingContent = null;
    let fileExisted = false;
    try {
      existingContent = await fs.readFile(claudeMdPath, 'utf8');
      fileExisted = true;
    } catch (err) {
      // File doesn't exist, which is fine
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // Build task info section
    const taskInfo = `Issue to solve: ${argv._[0]}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;

    // If CLAUDE.md already exists, append the task info with separator
    // Otherwise, create new file with just the task info
    let finalContent;
    if (fileExisted && existingContent) {
      await log('   CLAUDE.md already exists, appending task info...', { verbose: true });
      // Remove any trailing whitespace and add separator
      const trimmedExisting = existingContent.trimEnd();
      finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}`;
    } else {
      finalContent = taskInfo;
    }

    await fs.writeFile(claudeMdPath, finalContent);
    await log(formatAligned('✅', 'File created:', 'CLAUDE.md'));

    // Add and commit the file
    await log(formatAligned('📦', 'Adding file:', 'To git staging'));

    // Use explicit cwd option for better reliability
    const addResult = await $({ cwd: tempDir })`git add CLAUDE.md`;

    if (addResult.code !== 0) {
      await log('❌ Failed to add CLAUDE.md', { level: 'error' });
      await log(`   Error: ${addResult.stderr ? addResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
      throw new Error('Failed to add CLAUDE.md');
    }

    // Verify the file was actually staged
    let statusResult = await $({ cwd: tempDir })`git status --short`;
    let gitStatus = statusResult.stdout ? statusResult.stdout.toString().trim() : '';

    if (argv.verbose) {
      await log(`   Git status after add: ${gitStatus || 'empty'}`);
    }

    // Track which file we're using for the commit
    let commitFileName = 'CLAUDE.md';

    // Check if anything was actually staged
    if (!gitStatus || gitStatus.length === 0) {
      await log('');
      await log(formatAligned('⚠️', 'CLAUDE.md not staged:', 'Checking if file is ignored'), { level: 'warning' });

      // Check if CLAUDE.md is in .gitignore
      const checkIgnoreResult = await $({ cwd: tempDir })`git check-ignore CLAUDE.md`;
      const isIgnored = checkIgnoreResult.code === 0;

      if (isIgnored) {
        await log(formatAligned('ℹ️', 'CLAUDE.md is ignored:', 'Using .gitkeep fallback'));
        await log('');
        await log('  📝 Fallback strategy:');
        await log('     CLAUDE.md is in .gitignore, using .gitkeep instead.');
        await log('     This allows auto-PR creation to proceed without modifying .gitignore.');
        await log('');

        // Create a .gitkeep file as fallback
        const gitkeepPath = path.join(tempDir, '.gitkeep');
        const gitkeepContent = `# Auto-generated file for PR creation
# Issue: ${argv._[0]}
# Branch: ${branchName}
# This file was created because CLAUDE.md is in .gitignore
# It will be removed when the task is complete`;

        await fs.writeFile(gitkeepPath, gitkeepContent);
        await log(formatAligned('✅', 'Created:', '.gitkeep file'));

        // Try to add .gitkeep
        const gitkeepAddResult = await $({ cwd: tempDir })`git add .gitkeep`;

        if (gitkeepAddResult.code !== 0) {
          await log('❌ Failed to add .gitkeep', { level: 'error' });
          await log(`   Error: ${gitkeepAddResult.stderr ? gitkeepAddResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
          throw new Error('Failed to add .gitkeep');
        }

        // Verify .gitkeep was staged
        statusResult = await $({ cwd: tempDir })`git status --short`;
        gitStatus = statusResult.stdout ? statusResult.stdout.toString().trim() : '';

        if (!gitStatus || gitStatus.length === 0) {
          await log('');
          await log(formatAligned('❌', 'GIT ADD FAILED:', 'Neither CLAUDE.md nor .gitkeep could be staged'), { level: 'error' });
          await log('');
          await log('  🔍 What happened:');
          await log('     Both CLAUDE.md and .gitkeep failed to stage.');
          await log('');
          await log('  🔧 Troubleshooting steps:');
          await log(`     1. Check git status: cd "${tempDir}" && git status`);
          await log(`     2. Check .gitignore: cat "${tempDir}/.gitignore"`);
          await log(`     3. Try force add: cd "${tempDir}" && git add -f .gitkeep`);
          await log('');
          throw new Error('Git add staged nothing - both files failed');
        }

        commitFileName = '.gitkeep';
        await log(formatAligned('✅', 'File staged:', '.gitkeep'));
      } else {
        await log('');
        await log(formatAligned('❌', 'GIT ADD FAILED:', 'Nothing was staged'), { level: 'error' });
        await log('');
        await log('  🔍 What happened:');
        await log('     CLAUDE.md was created but git did not stage any changes.');
        await log('');
        await log('  💡 Possible causes:');
        await log('     • CLAUDE.md already exists with identical content');
        await log('     • File system sync issue');
        await log('');
        await log('  🔧 Troubleshooting steps:');
        await log(`     1. Check file exists: ls -la "${tempDir}/CLAUDE.md"`);
        await log(`     2. Check git status: cd "${tempDir}" && git status`);
        await log(`     3. Force add: cd "${tempDir}" && git add -f CLAUDE.md`);
        await log('');
        await log('  📂 Debug information:');
        await log(`     Working directory: ${tempDir}`);
        await log(`     Branch: ${branchName}`);
        if (existingContent) {
          await log('     Note: CLAUDE.md already existed (attempted to update with timestamp)');
        }
        await log('');
        throw new Error('Git add staged nothing - CLAUDE.md may be unchanged');
      }
    }

    await log(formatAligned('📝', 'Creating commit:', `With ${commitFileName} file`));
    const commitMessage = commitFileName === 'CLAUDE.md'
      ? `Initial commit with task details for issue #${issueNumber}

Adding CLAUDE.md with task information for AI processing.
This file will be removed when the task is complete.

Issue: ${argv._[0]}`
      : `Initial commit with task details for issue #${issueNumber}

Adding .gitkeep for PR creation (CLAUDE.md is in .gitignore).
This file will be removed when the task is complete.

Issue: ${argv._[0]}`;

    // Use explicit cwd option for better reliability
    const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

    if (commitResult.code !== 0) {
      const commitStderr = commitResult.stderr ? commitResult.stderr.toString() : '';
      const commitStdout = commitResult.stdout ? commitResult.stdout.toString() : '';

      await log('');
      await log(formatAligned('❌', 'COMMIT FAILED:', 'Could not create initial commit'), { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log('     Git commit command failed after staging CLAUDE.md.');
      await log('');

      // Check for specific error patterns
      if (commitStdout.includes('nothing to commit') || commitStdout.includes('working tree clean')) {
        await log('  💡 Root cause:');
        await log('     Git reports "nothing to commit, working tree clean".');
        await log('     This means no changes were staged, despite running git add.');
        await log('');
        await log('  🔎 Why this happens:');
        await log('     • CLAUDE.md already exists with identical content');
        await log('     • File content did not actually change');
        await log('     • Previous run may have left CLAUDE.md in the repository');
        await log('');
        await log('  🔧 How to fix:');
        await log('     Option 1: Remove CLAUDE.md and try again');
        await log(`       cd "${tempDir}" && git rm CLAUDE.md && git commit -m "Remove CLAUDE.md"`);
        await log('');
        await log('     Option 2: Skip auto-PR creation');
        await log('       Run solve.mjs without --auto-pull-request-creation flag');
        await log('');
      } else {
        await log('  📦 Error output:');
        if (commitStderr) await log(`     stderr: ${commitStderr}`);
        if (commitStdout) await log(`     stdout: ${commitStdout}`);
        await log('');
      }

      await log('  📂 Debug information:');
      await log(`     Working directory: ${tempDir}`);
      await log(`     Branch: ${branchName}`);
      await log(`     Git status: ${gitStatus || '(empty)'}`);
      await log('');

      throw new Error('Failed to create initial commit');
    } else {
      await log(formatAligned('✅', 'Commit created:', `Successfully with ${commitFileName}`));
      if (argv.verbose) {
        await log(`   Commit output: ${commitResult.stdout.toString().trim()}`, { verbose: true });
      }

      // Get the commit hash of the CLAUDE.md commit we just created
      const commitHashResult = await $({ cwd: tempDir })`git log --format=%H -1 2>&1`;
      if (commitHashResult.code === 0) {
        claudeCommitHash = commitHashResult.stdout.toString().trim();
        await log(`   Commit hash: ${claudeCommitHash.substring(0, 7)}...`, { verbose: true });
      }

      // Verify commit was created before pushing
      const verifyCommitResult = await $({ cwd: tempDir })`git log --format="%h %s" -1 2>&1`;
      if (verifyCommitResult.code === 0) {
        const latestCommit = verifyCommitResult.stdout ? verifyCommitResult.stdout.toString().trim() : '';
        if (argv.verbose) {
          await log(`   Latest commit: ${latestCommit || '(empty - this is a problem!)'}`);

          // Show git status
          const statusResult = await $({ cwd: tempDir })`git status --short 2>&1`;
          await log(`   Git status: ${statusResult.stdout ? statusResult.stdout.toString().trim() || 'clean' : 'clean'}`);

          // Show remote info
          const remoteResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
          const remoteOutput = remoteResult.stdout ? remoteResult.stdout.toString().trim() : 'none';
          await log(`   Remotes: ${remoteOutput ? remoteOutput.split('\n')[0] : 'none configured'}`);

          // Show branch info
          const branchResult = await $({ cwd: tempDir })`git branch -vv 2>&1`;
          await log(`   Branch info: ${branchResult.stdout ? branchResult.stdout.toString().trim() : 'none'}`);
        }
      }

      // Push the branch
      await log(formatAligned('📤', 'Pushing branch:', 'To remote repository...'));

      if (argv.verbose) {
        await log(`   Command: git push -u origin ${branchName}`, { verbose: true });
      }

      // Push the branch with the CLAUDE.md commit
      if (argv.verbose) {
        await log(`   Push command: git push -f -u origin ${branchName}`);
      }

      // Always use force push to ensure our commit gets to GitHub
      // (The branch is new with random name, so force is safe)
      const pushResult = await $({ cwd: tempDir })`git push -f -u origin ${branchName} 2>&1`;

      if (argv.verbose) {
        await log(`   Push exit code: ${pushResult.code}`);
        if (pushResult.stdout) {
          await log(`   Push output: ${pushResult.stdout.toString().trim()}`);
        }
        if (pushResult.stderr) {
          await log(`   Push stderr: ${pushResult.stderr.toString().trim()}`);
        }
      }

      if (pushResult.code !== 0) {
        const errorOutput = pushResult.stderr ? pushResult.stderr.toString() : pushResult.stdout ? pushResult.stdout.toString() : 'Unknown error';

        // Check for permission denied error
        if (errorOutput.includes('Permission to') && errorOutput.includes('denied')) {
          // Check if user already has a fork
          let userHasFork = false;
          let currentUser = null;
          try {
            const userResult = await $`gh api user --jq .login`;
            if (userResult.code === 0) {
              currentUser = userResult.stdout.toString().trim();
              const forkCheckResult = await $`gh repo view ${currentUser}/${repo} --json parent 2>/dev/null`;
              if (forkCheckResult.code === 0) {
                const forkData = JSON.parse(forkCheckResult.stdout.toString());
                if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
                  userHasFork = true;
                }
              }
            }
          } catch (e) {
            reportError(e, {
              context: 'fork_check',
              owner,
              repo,
              operation: 'check_user_fork'
            });
            // Ignore error - fork check is optional
          }

          await log(`\n${formatAligned('❌', 'PERMISSION DENIED:', 'Cannot push to repository')}`, { level: 'error' });
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          await log(`  🔒 You don't have write access to ${owner}/${repo}`);
          await log('');
          await log('  This typically happens when:');
          await log('    • You\'re not a collaborator on the repository');
          await log('    • The repository belongs to another user/organization');
          await log('');
          await log('  📋 HOW TO FIX THIS:');
          await log('');
          await log('  ┌──────────────────────────────────────────────────────────┐');
          await log('  │  RECOMMENDED: Use the --fork option                     │');
          await log('  └──────────────────────────────────────────────────────────┘');
          await log('');
          await log('  Run the command again with --fork:');
          await log('');
          await log(`    ./solve.mjs "${argv._[0]}" --fork`);
          await log('');
          await log('  This will automatically:');
          if (userHasFork) {
            await log(`    ✓ Use your existing fork (${currentUser}/${repo})`);
            await log('    ✓ Sync your fork with the latest changes');
          } else {
            await log('    ✓ Fork the repository to your account');
          }
          await log('    ✓ Push changes to your fork');
          await log('    ✓ Create a PR from your fork to the original repo');
          await log('    ✓ Handle all the remote setup automatically');
          await log('');
          await log('  ─────────────────────────────────────────────────────────');
          await log('');
          await log('  Alternative options:');
          await log('');
          await log('  Option 2: Request collaborator access');
          await log(`  ${'-'.repeat(40)}`);
          await log('  Ask the repository owner to add you as a collaborator:');
          await log(`    → Go to: https://github.com/${owner}/${repo}/settings/access`);
          await log('');
          await log('  Option 3: Manual fork and clone');
          await log(`  ${'-'.repeat(40)}`);
          await log(`  1. Fork the repo: https://github.com/${owner}/${repo}/fork`);
          await log('  2. Clone your fork and work there');
          await log('  3. Create a PR from your fork');
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          await log('💡 Tip: The --fork option automates the entire fork workflow!');
          if (userHasFork) {
            await log(`   Note: We detected you already have a fork at ${currentUser}/${repo}`);
          }
          await log('');
          throw new Error('Permission denied - need fork or collaborator access');
        } else {
          // Other push errors
          await log(`${formatAligned('❌', 'Failed to push:', 'See error below')}`, { level: 'error' });
          await log(`   Error: ${errorOutput}`, { level: 'error' });
          throw new Error('Failed to push branch');
        }
      } else {
        await log(`${formatAligned('✅', 'Branch pushed:', 'Successfully to remote')}`);
        if (argv.verbose) {
          await log(`   Push output: ${pushResult.stdout.toString().trim()}`, { verbose: true });
        }

        // CRITICAL: Wait for GitHub to process the push before creating PR
        // This prevents "No commits between branches" error
        await log('   Waiting for GitHub to sync...');
        await new Promise(resolve => setTimeout(resolve, 8000)); // Longer wait for GitHub to process

        // Verify the push actually worked by checking GitHub API
        const branchCheckResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches/${branchName} --jq .name 2>&1`;
        if (branchCheckResult.code === 0 && branchCheckResult.stdout.toString().trim() === branchName) {
          await log(`   Branch verified on GitHub: ${branchName}`);

          // Get the commit SHA from GitHub
          const shaCheckResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches/${branchName} --jq .commit.sha 2>&1`;
          if (shaCheckResult.code === 0) {
            const remoteSha = shaCheckResult.stdout.toString().trim();
            await log(`   Remote commit SHA: ${remoteSha.substring(0, 7)}...`);
          }
        } else {
          await log('   Warning: Branch not found on GitHub!');
          await log('   This will cause PR creation to fail.');

          if (argv.verbose) {
            await log(`   Branch check result: ${branchCheckResult.stdout || branchCheckResult.stderr || 'empty'}`);

            // Show all branches on GitHub
            const allBranchesResult = await $({ silent: true })`gh api repos/${owner}/${repo}/branches --jq '.[].name' 2>&1`;
            if (allBranchesResult.code === 0) {
              await log(`   All GitHub branches: ${allBranchesResult.stdout.toString().split('\n').slice(0, 5).join(', ')}...`);
            }
          }

          // Try one more force push with explicit ref
          await log('   Attempting explicit push...');
          const explicitPushCmd = `git push origin HEAD:refs/heads/${branchName} -f`;
          if (argv.verbose) {
            await log(`   Command: ${explicitPushCmd}`);
          }
          const explicitPushResult = await $`cd ${tempDir} && ${explicitPushCmd} 2>&1`;
          if (explicitPushResult.code === 0) {
            await log('   Explicit push completed');
            if (argv.verbose && explicitPushResult.stdout) {
              await log(`   Output: ${explicitPushResult.stdout.toString().trim()}`);
            }
            // Wait a bit more for GitHub to process
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            await log('   ERROR: Cannot push to GitHub!');
            await log(`   Error: ${explicitPushResult.stderr || explicitPushResult.stdout || 'Unknown'}`);
          }
        }

        // Get issue title for PR title
        await log(formatAligned('📋', 'Getting issue:', 'Title from GitHub...'), { verbose: true });
        const issueTitleResult = await $({ silent: true })`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title 2>&1`;
        let issueTitle = `Fix issue #${issueNumber}`;
        if (issueTitleResult.code === 0) {
          issueTitle = issueTitleResult.stdout.toString().trim();
          await log(`   Issue title: "${issueTitle}"`, { verbose: true });
        } else {
          await log('   Warning: Could not get issue title, using default', { verbose: true });
        }

        // Get current GitHub user to set as assignee (but validate it's a collaborator)
        await log(formatAligned('👤', 'Getting user:', 'Current GitHub account...'), { verbose: true });
        const currentUserResult = await $({ silent: true })`gh api user --jq .login 2>&1`;
        let currentUser = null;
        let canAssign = false;

        if (currentUserResult.code === 0) {
          currentUser = currentUserResult.stdout.toString().trim();
          await log(`   Current user: ${currentUser}`, { verbose: true });

          // Check if user has push access (is a collaborator or owner)
          // IMPORTANT: We need to completely suppress the JSON error output
          // Using execSync to have full control over stderr
          try {
            const { execSync } = await import('child_process');
            // This will throw if user doesn't have access, but won't print anything
            execSync(`gh api repos/${owner}/${repo}/collaborators/${currentUser} 2>/dev/null`,
                      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            canAssign = true;
            await log('   User has collaborator access', { verbose: true });
          } catch (e) {
            reportError(e, {
              context: 'collaborator_check',
              owner,
              repo,
              currentUser,
              operation: 'check_collaborator_access'
            });
            // User doesn't have permission, but that's okay - we just won't assign
            canAssign = false;
            await log('   User is not a collaborator (will skip assignment)', { verbose: true });
          }

          // Set permCheckResult for backward compatibility
          const permCheckResult = { code: canAssign ? 0 : 1 };
          if (permCheckResult.code === 0) {
            canAssign = true;
            await log('   User has collaborator access', { verbose: true });
          } else {
            // User doesn't have permission, but that's okay - we just won't assign
            await log('   User is not a collaborator (will skip assignment)', { verbose: true });
          }
        } else {
          await log('   Warning: Could not get current user', { verbose: true });
        }

        // Create draft pull request
        const targetBranch = argv.baseBranch || defaultBranch;
        await log(formatAligned('🔀', 'Creating PR:', 'Draft pull request...'));
        if (argv.baseBranch) {
          await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (custom)`));
        } else {
          await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (default)`));
        }

        // Use full repository reference for cross-repo PRs (forks)
        const issueRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;

        const prBody = `## 🤖 AI-Powered Solution Draft

This pull request is being automatically generated to solve issue ${issueRef}.

### 📋 Issue Reference
Fixes ${issueRef}

### 🚧 Status
**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.

### 📝 Implementation Details
_Details will be added as the solution draft is developed..._

---
*This PR was created automatically by the AI issue solver*`;

        if (argv.verbose) {
          await log(`   PR Title: [WIP] ${issueTitle}`, { verbose: true });
          await log(`   Base branch: ${defaultBranch}`, { verbose: true });
          await log(`   Head branch: ${branchName}`, { verbose: true });
          if (currentUser) {
            await log(`   Assignee: ${currentUser}`, { verbose: true });
          }
          await log(`   PR Body:
${prBody}`, { verbose: true });
        }

        // Use execSync for gh pr create to avoid command-stream output issues
        // Similar to how create-test-repo.mjs handles it
        try {
          const { execSync } = await import('child_process');

          // Write PR body to temp file to avoid shell escaping issues
          const prBodyFile = `/tmp/pr-body-${Date.now()}.md`;
          await fs.writeFile(prBodyFile, prBody);

          // Write PR title to temp file to avoid shell escaping issues with quotes/apostrophes
          // This solves the issue where titles containing apostrophes (e.g., "don't") would cause
          // "Unterminated quoted string" errors
          const prTitle = `[WIP] ${issueTitle}`;
          const prTitleFile = `/tmp/pr-title-${Date.now()}.txt`;
          await fs.writeFile(prTitleFile, prTitle);

          // Build command with optional assignee and handle forks
          // Note: targetBranch is already defined above
          // IMPORTANT: Use --title-file instead of --title to avoid shell parsing issues with special characters
          let command;
          if (argv.fork && forkedRepo) {
            // For forks, specify the full head reference
            const forkUser = forkedRepo.split('/')[0];
            command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
          } else {
            command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${branchName}`;
          }
          // Only add assignee if user has permissions
          if (currentUser && canAssign) {
            command += ` --assignee ${currentUser}`;
          }

          if (argv.verbose) {
            await log(`   Command: ${command}`, { verbose: true });
          }

          const output = execSync(command, { encoding: 'utf8', cwd: tempDir });

          // Clean up temp files
          await fs.unlink(prBodyFile).catch((unlinkError) => {
            reportError(unlinkError, {
              context: 'pr_body_file_cleanup',
              prBodyFile,
              operation: 'delete_temp_file'
            });
          });
          await fs.unlink(prTitleFile).catch((unlinkError) => {
            reportError(unlinkError, {
              context: 'pr_title_file_cleanup',
              prTitleFile,
              operation: 'delete_temp_file'
            });
          });

          // Extract PR URL from output - gh pr create outputs the URL to stdout
          prUrl = output.trim();

          if (!prUrl) {
            await log('⚠️ Warning: PR created but no URL returned', { level: 'warning' });
            await log(`   Output: ${output}`, { verbose: true });

            // Try to get the PR URL using gh pr list
            await log('   Attempting to find PR using gh pr list...', { verbose: true });
            const prListResult = await $`cd ${tempDir} && gh pr list --head ${branchName} --json url --jq '.[0].url'`;
            if (prListResult.code === 0 && prListResult.stdout.toString().trim()) {
              prUrl = prListResult.stdout.toString().trim();
              await log(`   Found PR URL: ${prUrl}`, { verbose: true });
            }
          }

          // Extract PR number from URL
          if (prUrl) {
            const prMatch = prUrl.match(/\/pull\/(\d+)/);
            if (prMatch) {
              localPrNumber = prMatch[1];

              // CRITICAL: Verify the PR was actually created by querying GitHub API
              // This is essential because gh pr create can return a URL but PR creation might have failed
              await log(formatAligned('🔍', 'Verifying:', 'PR creation...'), { verbose: true });
              const verifyResult = await $({ silent: true })`gh pr view ${localPrNumber} --repo ${owner}/${repo} --json number,url,state 2>&1`;

              if (verifyResult.code === 0) {
                try {
                  const prData = JSON.parse(verifyResult.stdout.toString().trim());
                  if (prData.number && prData.url) {
                    await log(formatAligned('✅', 'Verification:', 'PR exists on GitHub'), { verbose: true });
                    // Update prUrl and localPrNumber from verified data
                    prUrl = prData.url;
                    localPrNumber = String(prData.number);
                  } else {
                    throw new Error('PR data incomplete');
                  }
                } catch {
                  await log('❌ PR verification failed: Could not parse PR data', { level: 'error' });
                  throw new Error('PR creation verification failed - invalid response');
                }
              } else {
                // PR does not exist - gh pr create must have failed silently
                await log('');
                await log(formatAligned('❌', 'FATAL ERROR:', 'PR creation failed'), { level: 'error' });
                await log('');
                await log('  🔍 What happened:');
                await log('     The gh pr create command returned a URL, but the PR does not exist on GitHub.');
                await log('');
                await log('  🔧 How to fix:');
                await log('     1. Check if PR exists manually:');
                await log(`        gh pr list --repo ${owner}/${repo} --head ${branchName}`);
                await log('     2. Try creating PR manually:');
                await log(`        cd ${tempDir}`);
                await log(`        gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
                await log('     3. Check GitHub authentication:');
                await log('        gh auth status');
                await log('');
                throw new Error('PR creation failed - PR does not exist on GitHub');
              }
              // Store PR info globally for error handlers
              global.createdPR = { number: localPrNumber, url: prUrl };
              await log(formatAligned('✅', 'PR created:', `#${localPrNumber}`));
              await log(formatAligned('📍', 'PR URL:', prUrl));
              if (currentUser && canAssign) {
                await log(formatAligned('👤', 'Assigned to:', currentUser));
              } else if (currentUser && !canAssign) {
                await log(formatAligned('ℹ️', 'Note:', 'Could not assign (no permission)'));
              }

              // CLAUDE.md will be removed after Claude command completes

              // Link the issue to the PR in GitHub's Development section using GraphQL API
              await log(formatAligned('🔗', 'Linking:', `Issue #${issueNumber} to PR #${localPrNumber}...`));
              try {
                // First, get the node IDs for both the issue and the PR
                const issueNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { issue(number: ${issueNumber}) { id } } }' --jq .data.repository.issue.id`;

                if (issueNodeResult.code !== 0) {
                  throw new Error(`Failed to get issue node ID: ${issueNodeResult.stderr}`);
                }

                const issueNodeId = issueNodeResult.stdout.toString().trim();
                await log(`   Issue node ID: ${issueNodeId}`, { verbose: true });

                const prNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${localPrNumber}) { id } } }' --jq .data.repository.pullRequest.id`;

                if (prNodeResult.code !== 0) {
                  throw new Error(`Failed to get PR node ID: ${prNodeResult.stderr}`);
                }

                const prNodeId = prNodeResult.stdout.toString().trim();
                await log(`   PR node ID: ${prNodeId}`, { verbose: true });

                // Now link them using the GraphQL mutation
                // GitHub automatically creates the link when we use "Fixes #" or "Fixes owner/repo#"
                // The Development section link is created automatically by GitHub when:
                // 1. The PR body contains "Fixes #N", "Closes #N", or "Resolves #N"
                // 2. For cross-repo (fork) PRs, we need "Fixes owner/repo#N"

                // Let's verify the link was created
                const linkCheckResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${localPrNumber}) { closingIssuesReferences(first: 10) { nodes { number } } } } }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`;

                if (linkCheckResult.code === 0) {
                  const linkedIssues = linkCheckResult.stdout.toString().trim().split('\n').filter(n => n);
                  if (linkedIssues.includes(issueNumber)) {
                    await log(formatAligned('✅', 'Link verified:', `Issue #${issueNumber} → PR #${localPrNumber}`));
                  } else {
                    // This is a problem - the link wasn't created
                    await log('');
                    await log(formatAligned('⚠️', 'ISSUE LINK MISSING:', 'PR not linked to issue'), { level: 'warning' });
                    await log('');

                    if (argv.fork) {
                      await log('   The PR was created from a fork but wasn\'t linked to the issue.', { level: 'warning' });
                      await log(`   Expected: "Fixes ${owner}/${repo}#${issueNumber}" in PR body`, { level: 'warning' });
                      await log('');
                      await log('   To fix manually:', { level: 'warning' });
                      await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                      await log(`   2. Add this line: Fixes ${owner}/${repo}#${issueNumber}`, { level: 'warning' });
                    } else {
                      await log(`   The PR wasn't linked to issue #${issueNumber}`, { level: 'warning' });
                      await log(`   Expected: "Fixes #${issueNumber}" in PR body`, { level: 'warning' });
                      await log('');
                      await log('   To fix manually:', { level: 'warning' });
                      await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                      await log(`   2. Ensure it contains: Fixes #${issueNumber}`, { level: 'warning' });
                    }
                    await log('');
                  }
                } else {
                  // Could not verify but show what should have been used
                  const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                  await log('⚠️ Could not verify issue link (API error)', { level: 'warning' });
                  await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                  await log(`   Please verify manually at: ${prUrl}`, { level: 'warning' });
                }
              } catch (linkError) {
                reportError(linkError, {
                  context: 'pr_issue_link_verification',
                  prUrl,
                  issueNumber,
                  operation: 'verify_issue_link'
                });
                const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                await log(`⚠️ Could not verify issue linking: ${linkError.message}`, { level: 'warning' });
                await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                await log(`   Please check manually at: ${prUrl}`, { level: 'warning' });
              }
            } else {
              await log(formatAligned('✅', 'PR created:', 'Successfully'));
              await log(formatAligned('📍', 'PR URL:', prUrl));
            }

            // CLAUDE.md will be removed after Claude command completes
          } else {
            await log('⚠️ Draft pull request created but URL could not be determined', { level: 'warning' });
          }
        } catch (prCreateError) {
          reportError(prCreateError, {
            context: 'pr_creation',
            issueNumber,
            branchName,
            operation: 'create_pull_request'
          });
          const errorMsg = prCreateError.message || '';

          // Clean up the error message - extract the meaningful part
          let cleanError = errorMsg;
          if (errorMsg.includes('pull request create failed:')) {
            cleanError = errorMsg.split('pull request create failed:')[1].trim();
          } else if (errorMsg.includes('Command failed:')) {
            // Extract just the error part, not the full command
            const lines = errorMsg.split('\n');
            cleanError = lines[lines.length - 1] || errorMsg;
          }

          // Check for specific error types
          if (errorMsg.includes('could not assign user') || errorMsg.includes('not found')) {
            // Assignment failed but PR might have been created
            await log('');
            await log(formatAligned('⚠️', 'Warning:', 'User assignment failed'), { level: 'warning' });
            await log('     Checking if PR was created anyway...');

            // Try to get the PR that was just created (use silent mode)
            const prListResult = await $({ silent: true })`cd ${tempDir} && gh pr list --head ${branchName} --json url,number --jq '.[0]' 2>&1`;
            if (prListResult.code === 0 && prListResult.stdout.toString().trim()) {
              try {
                const prData = JSON.parse(prListResult.stdout.toString().trim());
                prUrl = prData.url;
                localPrNumber = prData.number;
                // Store PR info globally for error handlers
                global.createdPR = { number: localPrNumber, url: prUrl };
                await log(formatAligned('✅', 'PR created:', `#${localPrNumber} (without assignee)`));
                await log(formatAligned('📍', 'PR URL:', prUrl));
                await log('');
                await log('  ℹ️  Note: The PR was created successfully but user assignment failed.');
                await log('     You can manually assign yourself in the PR page if needed.');
              } catch (parseErr) {
                reportError(parseErr, {
                  context: 'pr_output_parsing',
                  operation: 'parse_pr_creation_output'
                });
                // If we can't parse, this is a critical error
                await log('');
                await log(formatAligned('❌', 'PR VERIFICATION FAILED', ''), { level: 'error' });
                await log('');
                await log('  🔍 What happened:');
                await log('     Could not verify if PR was created.');
                await log('');
                await log('  📦 Parse error:');
                await log(`     ${parseErr.message}`);
                await log('');
                await log('  🔧 How to fix:');
                await log('     1. Check GitHub manually:');
                await log(`        https://github.com/${owner}/${repo}/pulls`);
                await log('     2. Look for a PR from branch: ' + branchName);
                await log('     3. If no PR exists, create it manually:');
                await log(`        cd ${tempDir} && gh pr create --draft`);
                await log('');
                throw new Error('PR verification failed - cannot determine PR status');
              }
            } else {
              // PR creation actually failed
              await log('');
              await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
              await log('');
              await log('  🔍 What happened:');
              await log('     Failed to create pull request after pushing branch.');
              await log('     The error mentions user assignment, but the PR was not created at all.');
              await log('');
              await log('  📦 Error details:');
              for (const line of cleanError.split('\n')) {
                if (line.trim()) await log(`     ${line.trim()}`);
              }
              await log('');
              await log('  💡 Why this happened:');
              await log('     GitHub rejected the PR creation command entirely.');
              await log('     This usually means the specified assignee doesn\'t have access to the repo.');
              await log('');
              await log('  🔧 How to fix:');
              await log('');
              await log('     Option 1: The assignee validation is too strict');
              await log('     This is a bug in GitHub CLI or the repository settings.');
              await log('     Try creating PR manually without --assignee flag:');
              await log(`       cd ${tempDir}`);
              await log(`       gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
              await log('');
              await log('     Option 2: Check collaborator permissions');
              await log(`     Verify that user '${currentUser}' has access to ${owner}/${repo}:`);
              await log(`       gh api repos/${owner}/${repo}/collaborators/${currentUser}`);
              await log('');
              await log('     Option 3: Retry the solve command');
              await log('     The code will try to avoid adding --assignee if it detects issues.');
              await log(`       ./solve.mjs "${argv._[0]}" --continue`);
              await log('');
              throw new Error('PR creation failed - assignee validation issue');
            }
          } else if (errorMsg.includes('No commits between') || errorMsg.includes('Head sha can\'t be blank')) {
            // Empty PR error
            await log('');
            await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log('     Cannot create PR - no commits between branches.');
            await log('');
            await log('  📦 Error details:');
            for (const line of cleanError.split('\n')) {
              if (line.trim()) await log(`     ${line.trim()}`);
            }
            await log('');
            await log('  💡 Possible causes:');
            await log('     • The branch wasn\'t pushed properly');
            await log('     • The commit wasn\'t created');
            await log('     • GitHub sync issue');
            await log('');
            await log('  🔧 How to fix:');
            await log('     1. Verify commit exists:');
            await log(`        cd ${tempDir} && git log --format="%h %s" -5`);
            await log('     2. Push again with tracking:');
            await log(`        cd ${tempDir} && git push -u origin ${branchName}`);
            await log('     3. Create PR manually:');
            await log(`        cd ${tempDir} && gh pr create --draft`);
            await log('');
            await log(`  📂 Working directory: ${tempDir}`);
            await log(`  🌿 Current branch: ${branchName}`);
            await log('');
            throw new Error('PR creation failed - no commits between branches');
          } else {
            // Generic PR creation error
            await log('');
            await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log('     Failed to create pull request.');
            await log('');
            await log('  📦 Error details:');
            for (const line of cleanError.split('\n')) {
              if (line.trim()) await log(`     ${line.trim()}`);
            }
            await log('');
            await log('  🔧 How to fix:');
            await log('     1. Try creating PR manually:');
            await log(`        cd ${tempDir} && gh pr create --draft`);
            await log('     2. Check branch status:');
            await log(`        cd ${tempDir} && git status`);
            await log('     3. Verify GitHub authentication:');
            await log('        gh auth status');
            await log('');
            throw new Error('PR creation failed');
          }
        }
      }
    }
  } catch (prError) {
    reportError(prError, {
      context: 'auto_pr_creation',
      issueNumber,
      operation: 'handle_auto_pr'
    });

    // CRITICAL: PR creation failure should stop the entire process
    // We cannot continue without a PR when auto-PR creation is enabled
    await log('');
    await log(formatAligned('❌', 'FATAL ERROR:', 'PR creation failed'), { level: 'error' });
    await log('');
    await log('  🔍 What this means:');
    await log('     The solve command cannot continue without a pull request.');
    await log('     Auto-PR creation is enabled but failed to create the PR.');
    await log('');
    await log('  📦 Error details:');
    await log(`     ${prError.message}`);
    await log('');
    await log('  🔧 How to fix:');
    await log('');
    await log('  Option 1: Retry without auto-PR creation');
    await log(`     ./solve.mjs "${argv._[0]}" --no-auto-pull-request-creation`);
    await log('     (Claude will create the PR during the session)');
    await log('');
    await log('  Option 2: Create PR manually first');
    await log(`     cd ${tempDir}`);
    await log(`     gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
    await log(`     Then use: ./solve.mjs "${argv._[0]}" --continue`);
    await log('');
    await log('  Option 3: Debug the issue');
    await log(`     cd ${tempDir}`);
    await log('     git status');
    await log('     git log --oneline -5');
    await log('     gh pr create --draft  # Try manually to see detailed error');
    await log('');

    // Re-throw the error to stop execution
    throw new Error(`PR creation failed: ${prError.message}`);
  }

  return { prUrl, prNumber: localPrNumber, claudeCommitHash };
}