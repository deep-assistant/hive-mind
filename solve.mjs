#!/usr/bin/env sh
':' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

let $;
if (typeof Bun !== 'undefined') {
  // Bun has built-in $ support
  const bunModule = await import("bun");
  $ = bunModule.$;
} else {
  // Node.js: use execa for $ template literals
  const { $: $$ } = await use('execa');
  $ = $$({ verbose: 'full' });
}

const yargs = (await use('yargs@latest')).default;
const os = await use('os');
const path = await use('path');
const fs = (await use('fs')).promises;

// Configure command line arguments - GitHub issue URL as positional argument
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <issue-url>')
  .positional('issue-url', {
    type: 'string',
    description: 'The GitHub issue URL to solve'
  })
  .demandCommand(1, 'The GitHub issue URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const issueUrl = argv._[0];

// Validate GitHub issue URL format
if (!issueUrl.match(/^https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+$/)) {
  console.error('Error: Please provide a valid GitHub issue URL (e.g., https://github.com/owner/repo/issues/123)');
  process.exit(1);
}

const claudePath = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

// Extract repository and issue number from URL
const urlParts = issueUrl.split('/');
const owner = urlParts[3];
const repo = urlParts[4];
const issueNumber = urlParts[6];

// Create temporary directory for cloning the repository
const tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
await fs.mkdir(tempDir, { recursive: true });

console.log(`Creating temporary directory: ${tempDir}`);

try {
  // Clone the repository using gh tool with authentication
  console.log(`Cloning repository ${owner}/${repo} using gh tool...`);
  await $`gh repo clone ${owner}/${repo} ${tempDir} -- --depth 1`;
  
  console.log(`Repository cloned successfully to ${tempDir}`);
  
  const prompt = `GitHub Issue Solver Task:

1. INITIAL RESEARCH PHASE:
   a) Use the gh tool to fetch detailed information about this GitHub issue: ${issueUrl}
      - Get issue title, description, labels, comments, and any other relevant details
      - Understand the problem completely before proceeding
   
   b) Explore the organization's codebase for context:
      - Use gh tool to search for related code across the entire ${owner} organization
      - Look for similar implementations, patterns, or related functionality
      - Use: gh search code --owner ${owner} [relevant keywords from issue]
   
   c) Review previous pull requests:
      - Search for closed/merged PRs related to this issue or similar features
      - Use: gh pr list --repo ${owner}/${repo} --state all --search "[keywords]"
      - Study merged PRs to understand the repository's code style and conventions
      - Look for any previous attempts to solve this issue

2. COMPREHENSIVE TESTING APPROACH:
   - DO NOT HESITATE to write and run tests to understand how the codebase works
   - Test individual functions to understand their behavior and API
   - Write unit tests with mocks for your solution
   - Include integration/e2e tests where appropriate
   - Use the existing test framework in the repository
   - Run: npm test, pytest, go test, or whatever testing command the repo uses
   - Your PR MUST include automated tests that verify the solution works correctly

3. SOLUTION IMPLEMENTATION:
   - Analyze if this issue is solvable via Pull Request:
     * If YES: Create a solution with comprehensive tests and submit a pull request
     * If NO: Comment on the issue asking for clarification or explaining what information is needed
   
4. Guidelines:
   - Read all issue details and comments thoroughly
   - Study the codebase style from merged PRs before writing code
   - Follow the repository's contributing guidelines and code style exactly
   - Test any code changes thoroughly before submitting
   - Write clear commit messages and PR descriptions
   - Include automated tests in your PR to test key features of your solution
   - If the issue requires clarification, ask specific questions in a comment

Repository: ${owner}/${repo}
Issue Number: ${issueNumber}

IMPORTANT: 
- Your Pull Request SHOULD contain automated tests (unit, integration, or e2e as appropriate)
- Please mention the resulting link (Pull Request URL or Comment URL) in your final response.`;

  // Execute claude command from the cloned repository directory
  console.log(`Executing claude command from repository directory...`);
  const result = await $`cd ${tempDir} && ${claudePath} -p "${prompt}" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "You are an expert GitHub issue solver. CRITICAL REQUIREMENTS: 1) First use gh tool to thoroughly research: explore the entire organization's codebase for context, review merged PRs for code style, search for related implementations. 2) TESTING IS MANDATORY: Write and run tests to understand the codebase, test individual functions to learn their APIs, include comprehensive automated tests (unit/integration/e2e) in your PR. 3) Your PR must contain automated tests that verify your solution. 4) Study the repository's testing framework and use it properly. 5) Always mention the resulting PR or comment link in your response." --model sonnet | jq`;
  
  const output = result.text();
  console.log(output);
  
  // Extract all GitHub URLs from the output
  const githubUrls = output.match(/https:\/\/github\.com\/[^\s\)]+/g) || [];
  
  // Get the last GitHub URL (most likely the result)
  const lastUrl = githubUrls[githubUrls.length - 1];
  
  if (lastUrl) {
    // Check if it's a PR in the same repo
    const prPattern = new RegExp(`^https://github\\.com/${owner}/${repo}/pull/\\d+`);
    // Check if it's a comment on the same issue
    const commentPattern = new RegExp(`^https://github\\.com/${owner}/${repo}/issues/${issueNumber}#issuecomment-\\d+`);
    
    if (prPattern.test(lastUrl)) {
      console.log(`SUCCESS: Pull Request created at ${lastUrl}`);
      process.exit(0);
    } else if (commentPattern.test(lastUrl)) {
      console.log(`SUCCESS: Comment posted at ${lastUrl}`);
      process.exit(0);
    }
  }
  
  // If no valid link found, return error
  console.error('FAILURE: No valid Pull Request or Comment link found in output');
  process.exit(1);
  
} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
} finally {
  // Clean up temporary directory
  try {
    console.log(`Cleaning up temporary directory: ${tempDir}`);
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('Temporary directory cleaned up successfully');
  } catch (cleanupError) {
    console.warn(`Warning: Failed to clean up temporary directory: ${cleanupError.message}`);
  }
}