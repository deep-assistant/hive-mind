# Claude Sessions Documentation

## Overview

This document contains findings from testing Claude Code's session management capabilities, particularly focusing on non-interactive mode usage for automation.

## Key Findings

### Session ID Extraction ✅

- **Session IDs are available** in JSON output when using `--output-format stream-json --verbose`
- Session ID appears in the first JSON line of output in the `session_id` field
- Example: `{"type":"system","subtype":"init","session_id":"uuid-here",...}`
- Each non-interactive call generates a unique session ID

### Session Restoration ⚠️

- **`--resume <session-id>` does NOT restore the exact session**
  - Creates a NEW session with a different ID
  - Does not maintain conversation context from the original session
  - Effectively behaves like starting a fresh session

### Session Continuation Options

#### For Interactive Users

- **`-c` or `--continue` flag**: Continues the most recent conversation
  - Works well in interactive mode
  - May hang in non-interactive mode (not suitable for automation)
  - Maintains conversation context from the last session

- **`-r` or `--resume` flag**: 
  - Without arguments: Allows interactive selection of a conversation to resume
  - With session ID: Attempts to resume specific session (but creates new session as noted above)

#### For Automation

- **`--session-id <uuid>` flag**: Creates a new session with the specified ID
  - Works for creating sessions with custom IDs
  - Once a session ID is used, it becomes locked ("already in use" error)
  - Cannot restore previous session context - only sets the ID for a new session

## Command Line Options (from --help)

```
-c, --continue                   Continue the most recent conversation
-r, --resume [sessionId]         Resume a conversation - provide a session ID
                                 or interactively select a conversation to
                                 resume
--session-id <uuid>              Use a specific session ID for the
                                conversation (must be a valid UUID)
```

## Test Scripts

We created three test scripts to verify session behavior:

1. **test-session.mjs** - Cross-runtime compatible (Bun and Node.js)
2. **test-session-bun.mjs** - Bun-specific implementation
3. **test-session-node.mjs** - Node.js-specific implementation

All scripts confirm the same behavior across runtimes.

## Example JSON Output Structure

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/path/to/working/directory",
  "session_id": "8f97cceb-7392-4415-b05a-3fa52ecf5a6d",
  "tools": ["Task", "Bash", "Glob", ...],
  "model": "claude-sonnet-4-20250514",
  "permissionMode": "default",
  "apiKeySource": "none"
}
```

## Practical Implications

### For Automation Scripts

1. **Session IDs can be extracted** for logging/tracking purposes
2. **True session restoration is not available** in non-interactive mode
3. Each automated call will be a standalone interaction
4. Context must be provided in the prompt itself rather than relying on session history

### For Interactive Use

1. Use `-c` to quickly continue your last conversation
2. Use `-r` without arguments to select from recent conversations
3. Session persistence works well in interactive mode

## Technical Notes

- Always use `--verbose` with `--output-format stream-json` (required combination)
- The `--model sonnet` flag helps minimize token usage during testing
- Session IDs are UUIDs in standard format
- JSON output is newline-delimited (NDJSON format)

## Limitations

- No true session restoration in non-interactive/automated mode
- The `--resume` flag with session ID creates new sessions
- The `--session-id` flag creates new sessions (doesn't restore context)
- Once a session ID is used, it becomes locked and cannot be reused
- The `-c` flag may hang in non-interactive mode

## Recommendations

For automation tasks that need context:
1. Include all necessary context in each prompt
2. Use session IDs only for tracking/logging
3. Don't rely on session restoration for maintaining state
4. Consider using interactive mode with expect/pty for complex workflows requiring true session continuity

## Testing Commands

```bash
# Get session ID from non-interactive mode
claude -p "hi" --output-format stream-json --verbose --model sonnet

# Attempt to resume (creates new session)
claude --resume <session-id> -p "test" --output-format stream-json --verbose --model sonnet

# Create session with custom ID (works once per ID)
claude --session-id 12345678-1234-1234-1234-123456789012 -p "test" --output-format stream-json --verbose --model sonnet

# Continue most recent (interactive use only)
claude -c -p "continue message"
```