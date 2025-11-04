#!/bin/bash

# Wrapper script to capture claude /usage output
# This script runs claude in a PTY, sends /usage, waits for output, then sends ESC

# Create a temporary file for the output
TMPFILE=$(mktemp)

# Run claude with script to allocate a PTY
# The script will:
# 1. Start claude
# 2. Wait a bit for it to load
# 3. Type /usage and Enter
# 4. Wait for the usage screen to render
# 5. Send ESC to exit

(
  sleep 0.5
  echo "/usage"
  sleep 3
  printf '\033'  # ESC character
  sleep 0.5
) | script -q -c "claude" /dev/null 2>&1 | tee "$TMPFILE"

# Return the temp file path
echo "$TMPFILE"
