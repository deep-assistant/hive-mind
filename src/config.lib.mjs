#!/usr/bin/env node

/**
 * Central configuration module for all configurable values
 * Provides environment variable overrides with sensible defaults
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const getenv = await use('getenv');

// Helper function to safely parse integers with fallback
const parseIntWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Helper function to safely parse floats with fallback
const parseFloatWithDefault = (envVar, defaultValue) => {
  const value = getenv(envVar, defaultValue.toString());
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Timeout configurations (in milliseconds)
export const timeouts = {
  claudeCli: parseIntWithDefault('CLAUDE_TIMEOUT_SECONDS', 60) * 1000,
  githubApiDelay: parseIntWithDefault('GITHUB_API_DELAY_MS', 5000),
  githubRepoDelay: parseIntWithDefault('GITHUB_REPO_DELAY_MS', 2000),
  retryBaseDelay: parseIntWithDefault('RETRY_BASE_DELAY_MS', 5000),
  retryBackoffDelay: parseIntWithDefault('RETRY_BACKOFF_DELAY_MS', 1000),
};

// Auto-continue configurations
export const autoContinue = {
  ageThresholdHours: parseIntWithDefault('AUTO_CONTINUE_AGE_HOURS', 24),
};

// GitHub API limits
export const githubLimits = {
  commentMaxSize: parseIntWithDefault('GITHUB_COMMENT_MAX_SIZE', 65536),
  fileMaxSize: parseIntWithDefault('GITHUB_FILE_MAX_SIZE', 25 * 1024 * 1024),
  issueBodyMaxSize: parseIntWithDefault('GITHUB_ISSUE_BODY_MAX_SIZE', 60000),
  attachmentMaxSize: parseIntWithDefault('GITHUB_ATTACHMENT_MAX_SIZE', 10 * 1024 * 1024),
  bufferMaxSize: parseIntWithDefault('GITHUB_BUFFER_MAX_SIZE', 10 * 1024 * 1024),
};

// Memory and disk configurations
export const systemLimits = {
  minDiskSpaceMb: parseIntWithDefault('MIN_DISK_SPACE_MB', 500),
  defaultPageSizeKb: parseIntWithDefault('DEFAULT_PAGE_SIZE_KB', 16),
};

// Retry configurations
export const retryLimits = {
  maxForkRetries: parseIntWithDefault('MAX_FORK_RETRIES', 5),
  maxVerifyRetries: parseIntWithDefault('MAX_VERIFY_RETRIES', 5),
  maxApiRetries: parseIntWithDefault('MAX_API_RETRIES', 3),
  retryBackoffMultiplier: parseFloatWithDefault('RETRY_BACKOFF_MULTIPLIER', 2),
};

// File and path configurations
export const filePaths = {
  tempDir: getenv('HIVE_TEMP_DIR', '/tmp'),
  taskInfoFilename: getenv('TASK_INFO_FILENAME', 'CLAUDE.md'),
  procMeminfo: getenv('PROC_MEMINFO', '/proc/meminfo'),
};

// Text processing configurations
export const textProcessing = {
  tokenMaskMinLength: parseIntWithDefault('TOKEN_MASK_MIN_LENGTH', 12),
  tokenMaskStartChars: parseIntWithDefault('TOKEN_MASK_START_CHARS', 5),
  tokenMaskEndChars: parseIntWithDefault('TOKEN_MASK_END_CHARS', 5),
  textPreviewLength: parseIntWithDefault('TEXT_PREVIEW_LENGTH', 100),
  logTruncationLength: parseIntWithDefault('LOG_TRUNCATION_LENGTH', 5000),
};

// UI/Display configurations
export const display = {
  labelWidth: parseIntWithDefault('LABEL_WIDTH', 25),
};

// Sentry configurations
export const sentry = {
  dsn: getenv('SENTRY_DSN', 'https://77b711f23c84cbf74366df82090dc389@o4510072519983104.ingest.us.sentry.io/4510072523325440'),
  tracesSampleRateDev: parseFloatWithDefault('SENTRY_TRACES_SAMPLE_RATE_DEV', 1.0),
  tracesSampleRateProd: parseFloatWithDefault('SENTRY_TRACES_SAMPLE_RATE_PROD', 0.1),
  profileSessionSampleRateDev: parseFloatWithDefault('SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV', 1.0),
  profileSessionSampleRateProd: parseFloatWithDefault('SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD', 0.1),
};

// External URLs
export const externalUrls = {
  githubBase: getenv('GITHUB_BASE_URL', 'https://github.com'),
  bunInstall: getenv('BUN_INSTALL_URL', 'https://bun.sh/'),
};

// Model configurations
export const modelConfig = {
  availableModels: getenv('AVAILABLE_MODELS', 'opus,sonnet,claude-sonnet-4-5-20250929,claude-opus-4-1-20250805').split(','),
  defaultModel: getenv('DEFAULT_MODEL', 'sonnet'),
};

// Version configurations
export const version = {
  fallback: getenv('VERSION_FALLBACK', '0.14.3'),
  default: getenv('VERSION_DEFAULT', '0.14.3'),
};

// Helper function to validate configuration values
export function validateConfig() {
  // Ensure all numeric values are valid
  const numericConfigs = [
    ...Object.values(timeouts),
    ...Object.values(githubLimits),
    ...Object.values(systemLimits),
    ...Object.values(retryLimits).filter(v => typeof v === 'number'),
    ...Object.values(textProcessing),
    display.labelWidth,
    autoContinue.ageThresholdHours,
  ];

  for (const value of numericConfigs) {
    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid numeric configuration value: ${value}`);
    }
  }

  // Ensure sample rates are between 0 and 1
  const sampleRates = [
    sentry.tracesSampleRateDev,
    sentry.tracesSampleRateProd,
    sentry.profileSessionSampleRateDev,
    sentry.profileSessionSampleRateProd,
  ];

  for (const rate of sampleRates) {
    if (isNaN(rate) || rate < 0 || rate > 1) {
      throw new Error(`Invalid sample rate configuration: ${rate}. Must be between 0 and 1.`);
    }
  }

  // Ensure required paths exist
  if (!filePaths.tempDir) {
    throw new Error('tempDir configuration is required');
  }

  return true;
}

// Export a function to get all configurations as an object (useful for debugging)
export function getAllConfigurations() {
  return {
    timeouts,
    autoContinue,
    githubLimits,
    systemLimits,
    retryLimits,
    filePaths,
    textProcessing,
    display,
    sentry,
    externalUrls,
    modelConfig,
    version,
  };
}

// Export a function to print current configuration (useful for debugging)
export function printConfiguration() {
  console.log('Current Configuration:');
  console.log(JSON.stringify(getAllConfigurations(), null, 2));
}