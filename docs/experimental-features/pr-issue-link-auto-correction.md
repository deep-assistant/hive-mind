# PR Issue Link Auto-Correction (Experimental)

⚠️ **Status**: EXPERIMENTAL - This feature is disabled by default and should be used with caution.

## Overview

The PR Issue Link Auto-Correction feature provides real-time monitoring of pull request descriptions to ensure they always contain proper GitHub issue linking keywords. This prevents the type of temporary linking failure documented in [issue #713](https://github.com/deep-assistant/hive-mind/issues/713).

## Problem Statement

When AI tools edit PR descriptions during their work session, they may inadvertently remove or replace GitHub linking keywords (like "Fixes #123") with non-linking phrases (like "Related to #123" or "Issue: #123"). This breaks the automatic linking between PRs and issues, which can cause:

- Issues not closing automatically when PRs are merged
- Loss of connection between work and requirements
- Difficulty tracking which PRs address which issues

### The 53-Second Window

In [PR #710](https://github.com/deep-assistant/hive-mind/pull/710), there was a 53-second window where the PR was not linked to its issue because:
1. Initial PR body had "Fixes #696" (correct)
2. AI edited the body to "Issue: #696" (incorrect - not a linking keyword)
3. AI realized the mistake and fixed it back to "Fixes #696"

Without this feature, such windows of broken linking can last much longer if they go unnoticed.

## Solution

This experimental feature monitors PR descriptions in real-time and immediately corrects them when linking keywords are removed:

1. **Continuous Monitoring**: Polls the PR description every 5 seconds
2. **Keyword Detection**: Uses GitHub's official linking keyword list
3. **Automatic Repair**: Adds proper linking text with separator when missing
4. **Non-Invasive**: Only adds linking info, never removes other content

## Usage

Enable the feature with the command-line flag:

```bash
./solve.mjs "https://github.com/owner/repo/issues/123" --pull-request-issue-link-auto-correction
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  solve.mjs (Main Process)                               │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  1. Start PR Monitoring                          │   │
│  │     - Check every 5 seconds                       │   │
│  │     - Compare current body with last known        │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ▼                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  2. Execute AI Tool (Claude/OpenCode/Codex)      │   │
│  │     - AI may edit PR description                  │   │
│  │     - Monitoring runs in parallel                 │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ▼                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  3. Detect & Correct                             │   │
│  │     - If linking keyword removed                  │   │
│  │     - Add "---\n\nResolves #N" to body           │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ▼                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  4. Stop Monitoring                               │   │
│  │     - When AI tool completes                      │   │
│  │     - Report correction count                     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Monitoring Logic

The feature uses a polling-based approach:

```javascript
// Check every 5 seconds
setInterval(async () => {
  const currentBody = await getPRBody();

  if (currentBody !== lastKnownBody) {
    const hasKeyword = checkForLinkingKeyword(currentBody, issueNumber);

    if (!hasKeyword) {
      // Auto-correct: add linking keyword
      await updatePRBody(currentBody + '\n\n---\n\nResolves #' + issueNumber);
      correctionCount++;
    }

    lastKnownBody = currentBody;
  }
}, 5000);
```

### Valid Linking Keywords

GitHub recognizes these keywords (case-insensitive):
- `close`, `closes`, `closed`
- `fix`, `fixes`, `fixed`
- `resolve`, `resolves`, `resolved`

Valid formats:
- `Fixes #123`
- `Fixes owner/repo#123` (for cross-repo)
- `Fixes https://github.com/owner/repo/issues/123`

## Implementation Details

### Files Added/Modified

1. **New Libraries**:
   - `src/pr-issue-linking.lib.mjs` - Shared PR-issue linking utilities
   - `src/pr-issue-link-auto-correction.lib.mjs` - Monitoring and auto-correction logic

2. **Modified Files**:
   - `src/solve.config.lib.mjs` - Added CLI option
   - `src/solve.mjs` - Integrated monitoring start/stop
   - `src/solve.results.lib.mjs` - Refactored to use shared library

### Configuration

The feature is controlled by the CLI flag `--pull-request-issue-link-auto-correction`:

```javascript
.option('pull-request-issue-link-auto-correction', {
  type: 'boolean',
  description: '⚠️ EXPERIMENTAL: Monitor PR description changes and auto-correct when issue linking keywords are removed (default: false)',
  default: false
})
```

### API Calls

The feature makes minimal API calls:
- **Per Check**: 1 API call to `gh pr view` (every 5 seconds)
- **Per Correction**: 1 API call to `gh pr edit`

For a typical 5-minute AI session:
- **Without corrections**: ~60 API calls (monitoring only)
- **With 3 corrections**: ~63 API calls (monitoring + 3 edits)

This is well within GitHub's rate limits (5000 requests/hour).

## Benefits

1. **Prevents Linking Failures**: Catches and fixes broken links immediately
2. **Zero Manual Intervention**: Automatic correction requires no user action
3. **Non-Destructive**: Only adds linking info, preserves all other content
4. **Auditable**: Logs every correction for review

## Limitations

1. **Experimental**: May have edge cases or unexpected behaviors
2. **Polling Overhead**: Makes API calls every 5 seconds during AI execution
3. **Race Conditions**: If AI edits PR at same moment as correction (unlikely)
4. **Fork-Specific**: Uses `owner/repo#N` format for forks, `#N` for same-repo

## Trade-offs

### Advantages
✅ Immediate detection and correction (5-second window max)
✅ Prevents human error and AI mistakes
✅ Works with all AI tools (Claude, OpenCode, Codex)
✅ Separate, maintainable codebase for easy removal

### Disadvantages
❌ Additional API calls (minimal but present)
❌ Experimental status (not battle-tested)
❌ Polling-based (not event-driven)
❌ Could mask underlying AI prompt issues

## Alternative Approaches

### Why Not Webhooks?

GitHub doesn't provide webhooks for PR description edits in real-time for the editing user. Webhooks are better suited for:
- External services
- Cross-user notifications
- Asynchronous processing

For same-user, same-session monitoring, polling is more practical.

### Why Not Post-Execution Only?

The existing post-execution check (in `solve.results.lib.mjs`) runs after AI completes. While this catches most issues, it:
- Doesn't prevent temporary linking failures during execution
- Misses cases where AI makes multiple edits
- Can't provide immediate feedback to AI if using the PR as context

## Testing

### Manual Testing

```bash
# 1. Start with auto-correction enabled
./solve.mjs "https://github.com/owner/repo/issues/123" \
  --pull-request-issue-link-auto-correction \
  --verbose

# 2. While AI is running, manually edit the PR description
#    Remove the "Fixes #123" keyword

# 3. Within 5 seconds, the system should auto-correct it
#    Check verbose logs for correction message

# 4. At completion, check the correction count in logs
```

### Expected Output

```
🔍 [Experimental] Starting PR issue link monitoring...
   PR: #456 in owner/repo
   Issue: #123
   Check interval: 5000ms
   ...

  🔧 [Auto-correction] PR description corrected to re-add issue link (correction #1)
     This prevents the linking failure documented in issue #713

  ...

✅ [Auto-correction] Monitoring stopped
   Total corrections applied: 1
```

## Future Improvements

1. **Event-Driven Monitoring**: If GitHub adds PR edit events to their API
2. **Adaptive Polling**: Slower checks when no recent changes detected
3. **AI Prompt Enhancement**: Update AI prompts to prevent removals in first place
4. **Correction Analytics**: Track which AI tools/models need corrections most
5. **Rate Limit Awareness**: Reduce polling if approaching API limits

## Removal Plan

If this feature proves unnecessary or problematic, it can be cleanly removed:

1. Delete `src/pr-issue-link-auto-correction.lib.mjs`
2. Remove monitoring start/stop calls from `src/solve.mjs`
3. Remove CLI option from `src/solve.config.lib.mjs`
4. Keep `src/pr-issue-linking.lib.mjs` (shared utility, used elsewhere)

The design intentionally keeps this feature isolated for easy integration and removal.

## References

- **Original Issue**: [#713 - Pull Request was not linked to the issue](https://github.com/deep-assistant/hive-mind/issues/713)
- **Case Study**: [PR-Issue Linking Failure Analysis](../case-studies/issue-713-pr-linking-failure/CASE_STUDY.md)
- **GitHub Documentation**: [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
