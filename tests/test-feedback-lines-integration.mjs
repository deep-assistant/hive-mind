#!/usr/bin/env node

/**
 * Integration test for feedback lines feature (Issue #168)
 *
 * This test creates a real repository with comments and tests that
 * solve.mjs correctly detects and includes comment counts in the prompt.
 *
 * Uses --dry-run to avoid actually running AI, just tests prompt generation.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Integration Test: Feedback Lines with Real Repository');
console.log('=======================================================\n');

let testsPassed = 0;
let testsTotal = 0;
let testRepo = null;
let cleanupFiles = [];

function test(name, testFn) {
  testsTotal++;
  console.log(`🔬 Test ${testsTotal}: ${name}`);
  try {
    const result = testFn();
    if (result) {
      console.log('   ✅ PASS\n');
      testsPassed++;
    } else {
      console.log('   ❌ FAIL\n');
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}\n`);
  }
}

// Helper function to run commands
function $(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
    return { code: 0, stdout: result };
  } catch (error) {
    return {
      code: error.status || 1,
      stderr: error.message,
      stdout: error.stdout || ''
    };
  }
}

// Get GitHub username from environment or default
function getGitHubUsername() {
  return process.env.TEST_GITHUB_USERNAME || 'konard';
}

// Generate unique repository name
function generateTestRepoName() {
  const uuid = crypto.randomUUID().slice(0, 8);
  return `test-feedback-lines-${uuid}`;
}

// Create test repository with issue and comments
async function createTestRepository() {
  testRepo = generateTestRepoName();
  const username = getGitHubUsername();
  console.log(`📦 Creating test repository: ${testRepo}`);

  // Setup authentication if custom token is provided
  if (process.env.TEST_GITHUB_USER_TOKEN) {
    console.log('   🔑 Using custom GitHub token for authentication');
    // Set the GITHUB_TOKEN environment variable for gh CLI
    process.env.GITHUB_TOKEN = process.env.TEST_GITHUB_USER_TOKEN;
  }

  // Get current user
  const userResult = $('gh auth status', { silent: true });
  if (userResult.code !== 0) {
    throw new Error('GitHub authentication required');
  }

  // Create repository
  const createResult = $(`gh repo create ${testRepo} --public --description "Test repository for feedback lines testing"`, { silent: true });
  if (createResult.code !== 0) {
    throw new Error(`Failed to create repository: ${createResult.stderr}`);
  }

  console.log(`   ✅ Repository created: https://github.com/${username}/${testRepo}`);

  // Initialize local repository
  const tempDir = `/tmp/${testRepo}-init`;
  cleanupFiles.push(tempDir);

  $(`mkdir -p ${tempDir}`);
  process.chdir(tempDir);

  const initResult = $('git init');
  if (initResult.code !== 0) {
    throw new Error(`Failed to init git: ${initResult.stderr}`);
  }

  // Configure git user for commits (required in CI environment)
  $('git config user.email "test@example.com"');
  $('git config user.name "Test User"');

  $('echo "# Test Repository\\n\\nThis is a test repository for feedback lines testing." > README.md');
  $('git add README.md');

  const commitResult = $('git commit -m "Initial commit"');
  if (commitResult.code !== 0) {
    throw new Error(`Failed to commit: ${commitResult.stderr}`);
  }

  $(`git remote add origin https://github.com/${username}/${testRepo}.git`);
  $('git branch -M main');

  const pushResult = $('git push -u origin main');
  if (pushResult.code !== 0) {
    throw new Error(`Failed to push main branch: ${pushResult.stderr}`);
  }

  console.log('   ✅ Repository initialized with initial commit');

  // Create test issue
  const issueResult = $(`gh issue create --title "Test feedback lines feature" --body "This issue is for testing comment detection in solve.mjs"`, { silent: true });
  if (issueResult.code !== 0) {
    throw new Error(`Failed to create issue: ${issueResult.stderr}`);
  }

  console.log('   ✅ Test issue created');

  // Create a branch and pull request
  $('git checkout -b test-branch');
  $('echo "\\n## Testing\\nAdded testing section" >> README.md');
  $('git add README.md');

  const branchCommitResult = $('git commit -m "Add testing section"');
  if (branchCommitResult.code !== 0) {
    throw new Error(`Failed to commit on test-branch: ${branchCommitResult.stderr}`);
  }

  const branchPushResult = $('git push -u origin test-branch');
  if (branchPushResult.code !== 0) {
    throw new Error(`Failed to push test-branch: ${branchPushResult.stderr}`);
  }

  const prResult = $(`gh pr create --title "Test PR for feedback lines" --body "This PR is for testing comment detection"`, { silent: true });
  if (prResult.code !== 0) {
    throw new Error(`Failed to create PR: ${prResult.stderr}`);
  }

  console.log('   ✅ Test PR created');

  // Get PR number
  const prListResult = $('gh pr list --json number', { silent: true });
  if (prListResult.code !== 0) {
    throw new Error('Failed to get PR number');
  }

  const prs = JSON.parse(prListResult.stdout);
  const prNumber = prs[0]?.number;
  if (!prNumber) {
    throw new Error('No PR found');
  }

  console.log(`   ✅ PR number: ${prNumber}`);

  // Add some comments to the PR
  $(`gh pr comment ${prNumber} --body "First test comment for feedback lines testing"`);
  $(`gh pr comment ${prNumber} --body "Second test comment to verify comment counting"`);

  console.log('   ✅ Test comments added');

  // Make another commit to establish a baseline
  $('echo "\\n## Documentation\\nAdded docs section" >> README.md');
  $('git add README.md');

  const baselineCommitResult = $('git commit -m "Add documentation section"');
  if (baselineCommitResult.code !== 0) {
    throw new Error(`Failed to create baseline commit: ${baselineCommitResult.stderr}`);
  }

  const baselinePushResult = $('git push');
  if (baselinePushResult.code !== 0) {
    throw new Error(`Failed to push baseline commit: ${baselinePushResult.stderr}`);
  }

  console.log('   ✅ Baseline commit created');

  // Add more comments after the commit
  $(`gh pr comment ${prNumber} --body "Third comment - this should be detected as NEW"`);
  $(`gh pr comment ${prNumber} --body "Fourth comment - this should also be detected as NEW"`);

  console.log('   ✅ New comments added after baseline commit');

  return {
    repoName: testRepo,
    prNumber: prNumber,
    prUrl: `https://github.com/${username}/${testRepo}/pull/${prNumber}`,
    tempDir: tempDir
  };
}

// Test solve.mjs with --dry-run to check prompt generation
function testSolveFeedbackLines(prUrl) {
  console.log(`🔍 Testing solve.mjs with PR: ${prUrl}`);

  // Run solve.mjs with --dry-run and --verbose to see the prompt
  const solvePath = path.join(__dirname, '..', 'solve.mjs');
  const solveResult = $(`node ${solvePath} "${prUrl}" --dry-run --verbose 2>&1`, { silent: true });

  if (solveResult.code !== 0) {
    console.log('   ⚠️  solve.mjs had issues (expected for --dry-run)');
  }

  const output = solveResult.stdout + (solveResult.stderr || '');
  console.log('   📋 Analyzing solve.mjs output...');

  // Check for feedback lines in the output
  const hasFeedbackLines = output.includes('New comments on the pull request:');
  const hasCommentCount = /New comments on the pull request: \d+/.test(output);

  console.log(`   📊 Feedback lines detected: ${hasFeedbackLines ? 'YES' : 'NO'}`);
  console.log(`   📊 Comment count included: ${hasCommentCount ? 'YES' : 'NO'}`);

  // Check that feedback lines are NOT in system prompt
  const systemPromptMatch = output.match(/System prompt.*?(?=User prompt|$)/s);
  const hasSystemPromptWithFeedback = systemPromptMatch && systemPromptMatch[0].includes('New comments on the pull request:');

  console.log(`   📊 Feedback in system prompt: ${hasSystemPromptWithFeedback ? 'YES (BUG!)' : 'NO (CORRECT)'}`);

  // Check that feedback lines ARE in main prompt
  const userPromptMatch = output.match(/User prompt.*?(?=System prompt|$)/s);
  const hasUserPromptWithFeedback = userPromptMatch && userPromptMatch[0].includes('New comments on the pull request:');

  console.log(`   📊 Feedback in user prompt: ${hasUserPromptWithFeedback ? 'YES (CORRECT)' : 'NO (WRONG)'}`);

  // Save output for debugging
  const reportFile = `/tmp/feedback-lines-integration-report-${Date.now()}.txt`;
  fs.writeFileSync(reportFile, output);
  cleanupFiles.push(reportFile);
  console.log(`   📄 Full output saved: ${reportFile}`);

  return {
    hasFeedbackLines,
    hasCommentCount,
    hasSystemPromptWithFeedback: !hasSystemPromptWithFeedback, // Inverted because we want NO feedback in system
    hasUserPromptWithFeedback,
    output
  };
}

// Cleanup function
function cleanup() {
  console.log('\\n🧹 Cleaning up test resources...');

  if (testRepo) {
    const username = getGitHubUsername();
    try {
      const deleteResult = $(`gh repo delete ${username}/${testRepo} --yes`, { silent: true });
      if (deleteResult.code === 0) {
        console.log('   ✅ Test repository deleted');
      } else {
        console.log('   ⚠️  Could not delete repository (may need manual cleanup)');
      }
    } catch (error) {
      console.log('   ⚠️  Cleanup error (may need manual cleanup)');
    }
  }

  cleanupFiles.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        if (fs.statSync(file).isDirectory()) {
          fs.rmSync(file, { recursive: true, force: true });
        } else {
          fs.unlinkSync(file);
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  console.log('   ✅ Temporary files cleaned up');
}

// Main test execution
async function runIntegrationTest() {
  let repoData = null;
  let testError = null;

  try {
    // Step 1: Create test repository with comments
    console.log('📦 Step 1: Creating test repository with comments...');
    repoData = await createTestRepository();
    console.log('✅ Test repository setup complete\\n');

    // Step 2: Test solve.mjs feedback detection
    console.log('🚀 Step 2: Testing solve.mjs feedback detection...');
    const result = testSolveFeedbackLines(repoData.prUrl);
    console.log('✅ solve.mjs testing complete\\n');

    // Step 3: Run tests
    console.log('🧪 Step 3: Running integration tests...\\n');

    test('Feedback lines should be detected in PR with new comments', () => {
      return result.hasFeedbackLines && result.hasCommentCount;
    });

    test('Feedback lines should NOT appear in system prompt', () => {
      return result.hasSystemPromptWithFeedback; // This is inverted in the function
    });

    test('Feedback lines should appear in user prompt', () => {
      return result.hasUserPromptWithFeedback;
    });

    test('Comment counting should work with real repository data', () => {
      return result.hasCommentCount;
    });

  } catch (error) {
    console.error(`❌ Integration test failed: ${error.message}`);
    testError = error;
  } finally {
    cleanup();
  }

  // Final results
  console.log('\\n📊 Integration Test Results:');
  console.log(`   Passed: ${testsPassed}/${testsTotal}`);

  // Check for test error first - if we couldn't even set up, we failed
  if (testError) {
    console.log('   ❌ Integration test setup failed');
    console.log(`   Error: ${testError.message}`);
    return false;
  }

  // Check if any tests actually ran
  if (testsTotal === 0) {
    console.log('   ❌ No tests were executed');
    console.log('   🔍 Check the test setup for errors');
    return false;
  }

  if (testsPassed === testsTotal) {
    console.log('   🎉 ALL INTEGRATION TESTS PASSED!');
    console.log('   ✅ Feedback lines feature works with real repository data');
  } else {
    console.log('   ❌ Some integration tests failed');
    console.log('   🔍 Check the output logs for detailed analysis');
  }

  return testsPassed === testsTotal && testsTotal > 0;
}

// Run the integration test
const success = await runIntegrationTest();
process.exit(success ? 0 : 1);