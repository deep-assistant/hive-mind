#!/usr/bin/env node

// Git-related library functions for hive-mind project

// Helper function to check if we're in a git repository
export const isGitRepository = async (execSync) => {
  try {
    execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore']  // Suppress both stdout and stderr
    });
    return true;
  } catch {
    return false;
  }
};

// Helper function to get git tag for current HEAD
export const getGitTag = async (execSync) => {
  try {
    const gitTag = execSync('git describe --exact-match --tags HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']  // Suppress stderr
    }).trim();
    return gitTag;
  } catch {
    return null;
  }
};

// Helper function to get latest git tag
export const getLatestGitTag = async (execSync) => {
  try {
    const latestTag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']  // Suppress stderr
    }).trim().replace(/^v/, '');
    return latestTag;
  } catch {
    return null;
  }
};

// Helper function to get short commit SHA
export const getCommitSha = async (execSync) => {
  try {
    const commitSha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']  // Suppress stderr
    }).trim();
    return commitSha;
  } catch {
    return null;
  }
};

// Helper function to get version string based on git state
export const getGitVersion = async (execSync, currentVersion) => {
  // First check if we're in a git repository
  if (!await isGitRepository(execSync)) {
    return currentVersion;
  }

  // Check if this is a release version (has a git tag)
  const gitTag = await getGitTag(execSync);
  if (gitTag) {
    // It's a tagged release, use the version from package.json
    return currentVersion;
  }

  // Not a tagged release, get the latest tag and commit SHA
  const latestTag = await getLatestGitTag(execSync);
  const commitSha = await getCommitSha(execSync);

  if (latestTag && commitSha) {
    return `${latestTag}.${commitSha}`;
  }

  // Fallback to package.json version if git commands fail
  return currentVersion;
};

// Helper function for async git operations with zx
export const getGitVersionAsync = async ($, currentVersion) => {
  // First check if we're in a git repository to avoid "fatal: not a git repository" errors
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const gitCheckResult = await $`git rev-parse --git-dir 2>/dev/null || true`;
    const output = gitCheckResult.stdout.toString().trim();
    if (!output || gitCheckResult.code !== 0) {
      // Not in a git repository, use package.json version
      return currentVersion;
    }
  } catch {
    // Not in a git repository, use package.json version
    return currentVersion;
  }

  // We're in a git repo, proceed with version detection
  // Check if this is a release version (has a git tag)
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const gitTagResult = await $`git describe --exact-match --tags HEAD 2>/dev/null || true`;
    if (gitTagResult.code === 0 && gitTagResult.stdout.toString().trim()) {
      // It's a tagged release, use the version from package.json
      return currentVersion;
    }
  } catch {
    // Ignore error - will try next method
  }

  // Not a tagged release, get the latest tag and commit SHA
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const latestTagResult = await $`git describe --tags --abbrev=0 2>/dev/null || true`;
    const commitShaResult = await $`git rev-parse --short HEAD 2>/dev/null || true`;

    const latestTag = latestTagResult.stdout.toString().trim().replace(/^v/, '');
    const commitSha = commitShaResult.stdout.toString().trim();

    if (latestTag && commitSha && latestTagResult.code === 0 && commitShaResult.code === 0) {
      return `${latestTag}.${commitSha}`;
    }
  } catch {
    // Ignore error - will use fallback
  }

  // Fallback to package.json version if git commands fail
  return currentVersion;
};

// Export all functions as default as well
export default {
  isGitRepository,
  getGitTag,
  getLatestGitTag,
  getCommitSha,
  getGitVersion,
  getGitVersionAsync
};