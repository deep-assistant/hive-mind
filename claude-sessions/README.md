# Claude Sessions Documentation

## Overview

This document contains findings from testing Claude Code's session management capabilities, particularly focusing on non-interactive mode usage for automation.

## Key Findings

### Session ID Extraction ✅

- **Session IDs are available** in JSON output when using `--output-format stream-json --verbose`
- Session ID appears in the first JSON line of output in the `session_id` field
- Example: `{"type":"system","subtype":"init","session_id":"uuid-here",...}`
- Each non-interactive call generates a unique session ID

### Session Restoration ✅

- **`--resume <session-id>` DOES restore conversation context in non-interactive mode**
  - Creates a NEW session with a different ID but maintains conversation history
  - DOES maintain conversation context from the original session
  - Claude can reference and continue from previous messages in the resumed session
  - **Session restoration in automation IS possible with `--resume`**

### Session Locking Mechanism 🔒

- **Session locking is purely file existence-based**
  - Claude checks if `~/.claude/projects/[project-path]/[session-id].jsonl` exists
  - If the file exists (regardless of content), the session is "locked"
  - Empty files, minimal content, or corrupted files still trigger "already in use"
  - Only complete file deletion unlocks the session ID

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
  - Session data is stored in `~/.claude/projects/[project-path]/[session-id].jsonl`
  - **Session IDs can be "unlocked" by deleting their JSONL file**
  - Context IS stored but cannot be accessed in non-interactive mode

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
5. **Session IDs can be recycled** by deleting their JSONL files (loses all context)
6. **File-based locking** enables simple session management scripts

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

- The `--resume` flag creates new session IDs (but DOES restore context)
- The `--session-id` flag creates new sessions (doesn't restore context) 
- Once a session ID is used, it becomes locked and cannot be reused
- Session data IS stored in JSONL files and IS accessible via `--resume`
- The `-c` flag may hang in non-interactive mode
- **`--session-id` cannot be combined with `--resume` or `--continue`** (mutually exclusive)
- **`--resume` requires a session ID when used with `-p` flag**

## Recommendations

For automation tasks that need context:
1. **Use `--resume <session-id>` to restore conversation context** (this actually works!)
2. Extract session IDs from previous runs for continuation
3. Be aware that resumed sessions get new IDs but maintain conversation history
4. Fall back to including context in prompts if you don't have a session to resume

For session ID management:
1. Delete JSONL files to recycle session IDs when needed
2. Use file existence checks to verify session availability
3. Implement cleanup scripts to manage old sessions
4. Be aware that deleting session files loses all conversation history

## Testing Commands

```bash
# Get session ID from non-interactive mode (pipe to jq for readable output)
claude -p "hi" --output-format stream-json --verbose --model sonnet | jq

# Resume session with context restoration (creates new session ID but keeps history!)
claude --resume <session-id> -p "test" --output-format stream-json --verbose --model sonnet | jq

# Create session with custom ID (works once per ID)
claude --session-id 12345678-1234-1234-1234-123456789012 -p "test" --output-format stream-json --verbose --model sonnet | jq

# Unlock a session ID by deleting its file (loses all context)
rm ~/.claude/projects/[project-path]/[session-id].jsonl

# Check if a session ID is available (file doesn't exist)
test ! -f ~/.claude/projects/[project-path]/[session-id].jsonl && echo "Available" || echo "Locked"

# Continue most recent (interactive use only)
claude -c -p "continue message"

# These combinations will fail with error:
# claude --session-id <uuid> --resume    # Error: cannot be used together
# claude --session-id <uuid> --continue  # Error: cannot be used together
```