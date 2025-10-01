# Configuration Guide

The Hive Mind application now supports extensive configuration through environment variables. This allows you to customize various aspects of the application without modifying the source code.

## Configuration Categories

### 1. Timeout Configurations (milliseconds)

- `CLAUDE_TIMEOUT_SECONDS`: Claude CLI timeout in seconds (default: 60)
- `GITHUB_API_DELAY_MS`: Delay between GitHub API calls (default: 5000)
- `GITHUB_REPO_DELAY_MS`: Delay between repository operations (default: 2000)
- `RETRY_BASE_DELAY_MS`: Base delay for retry operations (default: 5000)
- `RETRY_BACKOFF_DELAY_MS`: Backoff delay for retries (default: 1000)

### 2. Auto-Continue Settings

- `AUTO_CONTINUE_AGE_HOURS`: Minimum age of PRs before auto-continue (default: 24)

### 3. GitHub API Limits

- `GITHUB_COMMENT_MAX_SIZE`: Maximum size of GitHub comments (default: 65536)
- `GITHUB_FILE_MAX_SIZE`: Maximum file size for GitHub operations (default: 26214400 / 25MB)
- `GITHUB_ISSUE_BODY_MAX_SIZE`: Maximum size of issue body (default: 60000)
- `GITHUB_ATTACHMENT_MAX_SIZE`: Maximum attachment size (default: 10485760 / 10MB)
- `GITHUB_BUFFER_MAX_SIZE`: Maximum buffer size for GitHub operations (default: 10485760 / 10MB)

### 4. System Resource Limits

- `MIN_DISK_SPACE_MB`: Minimum required disk space in MB (default: 500)
- `DEFAULT_PAGE_SIZE_KB`: Default memory page size in KB (default: 16)

### 5. Retry Configurations

- `MAX_FORK_RETRIES`: Maximum fork creation retries (default: 5)
- `MAX_VERIFY_RETRIES`: Maximum verification retries (default: 5)
- `MAX_API_RETRIES`: Maximum API call retries (default: 3)
- `RETRY_BACKOFF_MULTIPLIER`: Retry backoff multiplier (default: 2)

### 6. File and Path Settings

- `HIVE_TEMP_DIR`: Temporary directory path (default: /tmp)
- `TASK_INFO_FILENAME`: Task info filename (default: CLAUDE.md)
- `PROC_MEMINFO`: Path to memory info file (default: /proc/meminfo)

### 7. Text Processing

- `TOKEN_MASK_MIN_LENGTH`: Minimum length for token masking (default: 12)
- `TOKEN_MASK_START_CHARS`: Characters to show at start when masking (default: 5)
- `TOKEN_MASK_END_CHARS`: Characters to show at end when masking (default: 5)
- `TEXT_PREVIEW_LENGTH`: Length of text previews (default: 100)
- `LOG_TRUNCATION_LENGTH`: Log truncation length (default: 5000)

### 8. Display Settings

- `LABEL_WIDTH`: Width of labels in formatted output (default: 25)

### 9. Sentry Error Tracking

- `SENTRY_DSN`: Sentry DSN for error tracking (default: provided)
- `SENTRY_TRACES_SAMPLE_RATE_DEV`: Trace sample rate in development (default: 1.0)
- `SENTRY_TRACES_SAMPLE_RATE_PROD`: Trace sample rate in production (default: 0.1)
- `SENTRY_PROFILE_SESSION_SAMPLE_RATE_DEV`: Profile sample rate in development (default: 1.0)
- `SENTRY_PROFILE_SESSION_SAMPLE_RATE_PROD`: Profile sample rate in production (default: 0.1)

### 10. External URLs

- `GITHUB_BASE_URL`: GitHub base URL (default: https://github.com)
  - Useful for GitHub Enterprise instances
- `BUN_INSTALL_URL`: Bun installation URL (default: https://bun.sh/)

### 11. Model Configuration

- `AVAILABLE_MODELS`: Comma-separated list of available models (default: opus,sonnet,claude-sonnet-4-5-20250929,claude-opus-4-1-20250805)
- `DEFAULT_MODEL`: Default model to use (default: sonnet)

### 12. Version Settings

- `VERSION_FALLBACK`: Fallback version number (default: 0.14.3)
- `VERSION_DEFAULT`: Default version number (default: 0.14.3)

## Usage Examples

### Setting Environment Variables

```bash
# Increase Claude timeout to 2 minutes
export CLAUDE_TIMEOUT_SECONDS=120

# Reduce GitHub API delay for faster operations
export GITHUB_API_DELAY_MS=2000

# Increase auto-continue threshold to 48 hours
export AUTO_CONTINUE_AGE_HOURS=48

# Use custom temporary directory
export HIVE_TEMP_DIR=/var/tmp/hive-mind

# Disable Sentry in production
export SENTRY_DSN=""

# Configure for GitHub Enterprise
export GITHUB_BASE_URL=https://github.enterprise.com
```

### Running with Custom Configuration

```bash
# Run with custom timeouts
CLAUDE_TIMEOUT_SECONDS=120 RETRY_BASE_DELAY_MS=10000 hive monitor

# Run with increased limits
GITHUB_FILE_MAX_SIZE=52428800 MIN_DISK_SPACE_MB=1000 solve https://github.com/owner/repo/issues/123

# Run with custom auto-continue settings
AUTO_CONTINUE_AGE_HOURS=12 solve --auto-continue https://github.com/owner/repo/issues/456
```

### Configuration File (Optional)

You can also create a `.env` file in your project root:

```bash
# .env file
CLAUDE_TIMEOUT_SECONDS=90
GITHUB_API_DELAY_MS=3000
AUTO_CONTINUE_AGE_HOURS=36
HIVE_TEMP_DIR=/opt/hive-mind/tmp
SENTRY_DSN=your-custom-sentry-dsn
```

Then source it before running:

```bash
source .env
hive monitor
```

## Notes

- All timeout values are in milliseconds unless otherwise specified
- All size limits are in bytes unless otherwise specified
- Sample rates must be between 0.0 and 1.0
- The application validates all configuration values on startup
- Invalid values will cause the application to fail with an error message
- You can view the current configuration by checking the application logs in verbose mode

## Troubleshooting

If you encounter issues with configuration:

1. Check that numeric values are positive integers
2. Ensure sample rates are between 0 and 1
3. Verify that paths exist and are accessible
4. Run with `--verbose` flag to see configuration values being used
5. Check application logs for configuration validation errors