# command-stream Issue Draft

## Issue: Lack of ability to turn off auto-quoting in command-stream

### Background

When using `command-stream` library for executing shell commands, the entire command string can be interpreted as a quoted command with spaces and syntax, due to automatic quoting behavior.

### Problem

In our telegram bot implementation, we needed to execute commands like:
```javascript
const fullCommand = `node ${startScreenPath} ${command} ${quotedArgs}`;
const commandResult = await $`${fullCommand}`;
```

However, `command-stream` lacks an ability to turn off auto-quoting, which causes issues:
1. The entire string gets interpreted with automatic quoting
2. Special characters and syntax can be mishandled
3. Commands may fail with "not found" errors despite being correctly constructed

### Expected Behavior

There should be a way to:
- Disable automatic quoting when needed
- Have fine-grained control over how arguments are passed to the shell
- Execute commands without additional quoting layers

### Workaround

We had to replace `command-stream` with Node.js native `child_process.spawn()`:

```javascript
import { spawn } from 'child_process';

function executeWithCommand(startScreenCmd, command, args) {
  return new Promise((resolve) => {
    const allArgs = [command, ...args];

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    // ... handle stdout, stderr, events
  });
}
```

This gives us direct control over argument passing without automatic quoting issues.

### Suggested Solution

Add an option to `command-stream` to disable or control automatic quoting behavior:

```javascript
// Example API
const result = await $`${fullCommand}`.noAutoQuote();
// or
const result = await $({ autoQuote: false })`${fullCommand}`;
```

### References

- Our workaround implementation: [telegram-bot.mjs](../src/telegram-bot.mjs)
- Related issue: [#377](https://github.com/deep-assistant/hive-mind/issues/377)
- PR with fix: [#387](https://github.com/deep-assistant/hive-mind/pull/387)
