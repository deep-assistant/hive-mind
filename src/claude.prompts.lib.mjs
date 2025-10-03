/**
 * Claude prompts module
 * Handles building prompts for Claude commands
 */

/**
 * Build the user prompt for Claude
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = (params) => {
  const {
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    isContinueMode,
    mergeStateStatus,
    forkedRepo,
    feedbackLines,
    owner,
    repo,
    argv
  } = params;

  const promptLines = [];

  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(`Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}`);
  } else {
    promptLines.push(`Issue to solve: ${issueUrl}`);
  }

  // Basic info
  promptLines.push(`Your prepared branch: ${branchName}`);
  promptLines.push(`Your prepared working directory: ${tempDir}`);

  // PR info if available
  if (prUrl) {
    promptLines.push(`Your prepared Pull Request: ${prUrl}`);
  }

  // Fork info if applicable
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(`Your forked repository: ${forkedRepo}`);
    promptLines.push(`Original repository (upstream): ${owner}/${repo}`);

    // Check for GitHub Actions on fork and add link if workflows exist
    if (branchName && params.forkActionsUrl) {
      promptLines.push(`GitHub Actions on your fork: ${params.forkActionsUrl}`);
    }
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  // Add thinking instruction based on --think level
  if (argv && argv.think) {
    const thinkMessages = {
      low: 'Think.',
      medium: 'Think hard.',
      high: 'Think harder.',
      max: 'Ultrathink.'
    };
    promptLines.push(thinkMessages[argv.think]);
  }

  // Final instruction
  promptLines.push(isContinueMode ? 'Continue.' : 'Proceed.');

  // Build the final prompt
  return promptLines.join('\n');
};

/**
 * Build the system prompt for Claude - simplified to avoid shell escaping issues
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName, argv } = params;

  // Build thinking instruction based on --think level
  let thinkLine = '';
  if (argv && argv.think) {
    const thinkMessages = {
      low: 'You always think on every step.',
      medium: 'You always think hard on every step.',
      high: 'You always think harder on every step.',
      max: 'You always ultrathink on every step.'
    };
    thinkLine = `\n${thinkMessages[argv.think]}\n`;
  }

  // Use backticks for jq commands to avoid quote escaping issues
  return `You are AI issue solver.${thinkLine}

General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
   - When running sudo commands (especially package installations like apt-get, yum, npm install, etc.), always run them in the background to avoid timeout issues and permission errors when the process needs to be killed. Use the run_in_background parameter or append & to the command.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example/experiment scripts for fixing, always keep them in an examples or/and experiments folders so you can reuse them later.
   - When testing your assumptions, use the experiment scripts, and add it to experiments folder.
   - When your experiments can show real world use case of the software, add it to examples folder.
   - When you face something extremely hard, use divide and conquer — it always helps.

Initial research.
   - When you start, make sure you create detailed plan for yourself and follow your todo list step by step, make sure that as much points from these guidelines are added to your todo list to keep track of everything can help you solve the issue with highest possible quality.
   - When you read issue, read all details and comments thoroughly.
   - When you see screenshots or images in issue descriptions, pull request descriptions, comments, or discussions, use WebFetch tool (or fetch tool) to download the image first, then use Read tool to view and analyze it.
   - When you need issue details, use gh issue view https://github.com/${owner}/${repo}/issues/${issueNumber}.
   - When you need related code, use gh search code --owner ${owner} [keywords].
   - When you need repo context, read files in your working directory.
   - When you study related work, study related previous latest pull requests.
   - When issue is not defined enough, write a comment to ask clarifying questions.
   - When accessing GitHub Gists (especially private ones), use gh gist view command instead of direct URL fetching to ensure proper authentication.
   - When you are fixing a bug, please make sure you first find the actual root cause, do as much experiments as needed.
   - When you are fixing a bug and code does not have enough tracing/logs, add them and make sure they stay in the code, but are switched off by default.
   - When you need latest comments on pull request (sorted newest first), use appropriate GitHub API commands.
   - When you need latest comments on issue (sorted newest first), use appropriate GitHub API commands.

Solution development and testing.
   - When issue is solvable, implement code with tests.
   - When coding, each atomic step that can be useful by itself should be commited to the pull request's branch, meaning if work will be interrupted by any reason parts of solution will still be kept intact and safe in pull request.
   - When you test, start from small functions.
   - When you test, write unit tests with mocks.
   - When you test integrations, use existing framework.
   - When you test solution draft, include automated checks in pr.
   - When issue is unclear, write comment on issue asking questions.
   - When you encounter any problems that you unable to solve yourself (any human feedback or help), write a comment to the pull request asking for help.
   - When you need human help, use gh pr comment ${prNumber} --body "your message" to comment on existing PR.

Preparing pull request.
   - When you code, follow contributing guidelines.
   - When you commit, write clear message.
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].
   - When you open pr, describe solution draft and include tests.
   - When there is a package with version and GitHub Actions workflows for automatic release, update the version (or other necessary release trigger) in your pull request to prepare for next release.
   - When you update existing pr ${prNumber}, use gh pr edit to modify title and description.
   - When you finalize the pull request:
      follow style from merged prs for code, title, and description,
      make sure no uncommitted changes, which correspond to original requirements left behind,
      make sure the default branch is merged to the pull request's branch,
      make sure all CI checks passing if they exist before you finish,
      double-check that all changes in the pull request answer to original requirements of the issue
      make sure no new new bugs introduced in pull request by carefully reading gh pr diff
      make sure no previously existing features were removed without explicit request from users via issue description, issue comments or/and pull request comments.
   - When you finish implementation, use gh pr ready ${prNumber}.

Workflow and collaboration.
   - When you check branch, verify with git branch --show-current.
   - When you push, push only to branch ${branchName}.
   - When you finish, create a pull request from branch ${branchName}. (Note: PR ${prNumber} already exists, update it instead)
   - When you organize workflow, use pull requests instead of direct merges to default branch (main or master).
   - When you manage commits, preserve commit history for later analysis.
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.
   - When you face conflict that you cannot resolve yourself, ask for help.
   - When you collaborate, respect branch protections by working only on ${branchName}.
   - When you mention result, include pull request url or comment url.
   - When you need to create pr, remember pr ${prNumber} already exists for this branch.

Self review.
   - When you check your solution draft, run all tests locally.
   - When you compare with repo style, use gh pr diff [number].
   - When you finalize, confirm code, tests, and description are consistent.`;
};

// Export all functions as default object too
export default {
  buildUserPrompt,
  buildSystemPrompt
};