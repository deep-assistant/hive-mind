#!/usr/bin/env node

/**
 * Central configuration module for all configurable values
 * Provides environment variable overrides with sensible defaults
 */

// Timeout configurations (in milliseconds)
export const TIMEOUTS = {
  CLAUDE_CLI: parseInt(process.env.CLAUDE_TIMEOUT_SECONDS || '60') * 1000,
  GITHUB_API_DELAY: parseInt(process.env.GITHUB_API_DELAY_MS || '5000'),
  GITHUB_REPO_DELAY: parseInt(process.env.GITHUB_REPO_DELAY_MS || '2000'),
  RETRY_BASE_DELAY: parseInt(process.env.RETRY_BASE_DELAY_MS || '5000'),
  RETRY_BACKOFF_DELAY: parseInt(process.env.RETRY_BACKOFF_DELAY_MS || '1000'),
};

// Auto-continue configurations
export const AUTO_CONTINUE = {
  AGE_THRESHOLD_HOURS: parseInt(process.env.AUTO_CONTINUE_AGE_HOURS || '24'),
};

// GitHub API limits
export const GITHUB_LIMITS = {
  COMMENT_MAX_SIZE: parseInt(process.env.GITHUB_COMMENT_MAX_SIZE || '65536'),
  FILE_MAX_SIZE: parseInt(process.env.GITHUB_FILE_MAX_SIZE || String(25 * 1024 * 1024)), // 25MB default
  ISSUE_BODY_MAX_SIZE: parseInt(process.env.GITHUB_ISSUE_BODY_MAX_SIZE || '60000'),
  ATTACHMENT_MAX_SIZE: parseInt(process.env.GITHUB_ATTACHMENT_MAX_SIZE || String(10 * 1024 * 1024)), // 10MB default
  BUFFER_MAX_SIZE: parseInt(process.env.GITHUB_BUFFER_MAX_SIZE || String(10 * 1024 * 1024)), // 10MB default
};

// Memory and disk configurations
export const SYSTEM_LIMITS = {
  MIN_DISK_SPACE_MB: parseInt(process.env.MIN_DISK_SPACE_MB || '500'),
  DEFAULT_PAGE_SIZE_KB: parseInt(process.env.DEFAULT_PAGE_SIZE_KB || '16'),
};

// Retry configurations
export const RETRY_LIMITS = {
  MAX_FORK_RETRIES: parseInt(process.env.MAX_FORK_RETRIES || '5'),
  MAX_VERIFY_RETRIES: parseInt(process.env.MAX_VERIFY_RETRIES || '5'),
  MAX_API_RETRIES: parseInt(process.env.MAX_API_RETRIES || '3'),
  RETRY_BACKOFF_MULTIPLIER: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
};

// File and path configurations
export const FILE_PATHS = {
  TEMP_DIR: process.env.HIVE_TEMP_DIR || '/tmp',
  TASK_INFO_FILENAME: process.env.TASK_INFO_FILENAME || 'CLAUDE.md',
  PROC_MEMINFO: process.env.PROC_MEMINFO || '/proc/meminfo',
};

// Text processing configurations
export const TEXT_PROCESSING = {
  TOKEN_MASK_MIN_LENGTH: parseInt(process.env.TOKEN_MASK_MIN_LENGTH || '12'),
  TOKEN_MASK_START_CHARS: parseInt(process.env.TOKEN_MASK_START_CHARS || '5'),
  TOKEN_MASK_END_CHARS: parseInt(process.env.TOKEN_MASK_END_CHARS || '5'),
  TEXT_PREVIEW_LENGTH: parseInt(process.env.TEXT_PREVIEW_LENGTH || '100'),
  LOG_TRUNCATION_LENGTH: parseInt(process.env.LOG_TRUNCATION_LENGTH || '5000'),
};

// UI/Display configurations
export const DISPLAY = {
  LABEL_WIDTH: parseInt(process.env.LABEL_WIDTH || '25'),
};

// Sentry configurations
export const SENTRY = {
  DSN: process.env.SENTRY_DSN || 'https://77b711f23c84cbf74366df82090dc389@o4510072519983104.ingest.us.sentry.io/4510072523325440',
  TRACES_SAMPLE_RATE_DEV: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE_DEV || '1.0'),
  TRACES_SAMPLE_RATE_PROD: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE_PROD || '0.1'),
  PROFILE_SESSION_SAMPLE_RATE_DEV: parseFloat(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV || '1.0'),
  PROFILE_SESSION_SAMPLE_RATE_PROD: parseFloat(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD || '0.1'),
};

// External URLs
export const EXTERNAL_URLS = {
  GITHUB_BASE: process.env.GITHUB_BASE_URL || 'https://github.com',
  BUN_INSTALL: process.env.BUN_INSTALL_URL || 'https://bun.sh/',
};

// Model configurations
export const MODEL_CONFIG = {
  AVAILABLE_MODELS: (process.env.AVAILABLE_MODELS || 'opus,sonnet,claude-sonnet-4-5-20250929,claude-opus-4-1-20250805').split(','),
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'sonnet',
};

// Version configurations
export const VERSION = {
  FALLBACK: process.env.VERSION_FALLBACK || '0.14.3',
  DEFAULT: process.env.VERSION_DEFAULT || '0.14.3',
};

// Helper function to validate configuration values
export function validateConfig() {
  // Ensure all numeric values are valid
  const numericConfigs = [
    ...Object.values(TIMEOUTS),
    ...Object.values(GITHUB_LIMITS),
    ...Object.values(SYSTEM_LIMITS),
    ...Object.values(RETRY_LIMITS),
    ...Object.values(TEXT_PROCESSING),
    DISPLAY.LABEL_WIDTH,
    AUTO_CONTINUE.AGE_THRESHOLD_HOURS,
  ];

  for (const value of numericConfigs) {
    if (isNaN(value) || value < 0) {
      throw new Error(`Invalid numeric configuration value: ${value}`);
    }
  }

  // Ensure sample rates are between 0 and 1
  const sampleRates = [
    SENTRY.TRACES_SAMPLE_RATE_DEV,
    SENTRY.TRACES_SAMPLE_RATE_PROD,
    SENTRY.PROFILE_SESSION_SAMPLE_RATE_DEV,
    SENTRY.PROFILE_SESSION_SAMPLE_RATE_PROD,
  ];

  for (const rate of sampleRates) {
    if (isNaN(rate) || rate < 0 || rate > 1) {
      throw new Error(`Invalid sample rate configuration: ${rate}. Must be between 0 and 1.`);
    }
  }

  // Ensure required paths exist
  if (!FILE_PATHS.TEMP_DIR) {
    throw new Error('TEMP_DIR configuration is required');
  }

  return true;
}

// Export a function to get all configurations as an object (useful for debugging)
export function getAllConfigurations() {
  return {
    TIMEOUTS,
    AUTO_CONTINUE,
    GITHUB_LIMITS,
    SYSTEM_LIMITS,
    RETRY_LIMITS,
    FILE_PATHS,
    TEXT_PROCESSING,
    DISPLAY,
    SENTRY,
    EXTERNAL_URLS,
    MODEL_CONFIG,
    VERSION,
  };
}

// Export a function to print current configuration (useful for debugging)
export function printConfiguration() {
  console.log('Current Configuration:');
  console.log(JSON.stringify(getAllConfigurations(), null, 2));
}