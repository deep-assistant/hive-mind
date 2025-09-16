#!/bin/bash
echo "========================================"
echo "Hive-Mind Container"
echo "========================================"

# Fix permissions for mounted volumes (runs as root)
echo "Fixing permissions for mounted volumes..."
mkdir -p /home/hive/.claude/plugins /home/hive/.config/gh
chown -R hive:hive /home/hive/.claude /home/hive/.config
chown -R hive:hive /app/claude-logs /app/claude-sessions /app/output 2>/dev/null || true

# Pass environment to hive user and run main logic
exec su -s /bin/bash hive -c '
cd /app

# Set token if provided
if [ -n "$GITHUB_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
elif [ -n "$GH_TOKEN" ]; then
  export GITHUB_TOKEN="$GH_TOKEN"
fi

# Set PATH for installed tools
export PATH="/home/hive/.bun/bin:/home/hive/.n/bin:/home/hive/.cargo/bin:$PATH"

# Check if we have auth and URL
if gh auth status >/dev/null 2>&1 && [ -n "$GITHUB_URL" ]; then
  echo "✓ GitHub authenticated"
  echo "✓ Starting hive-mind to monitor: $GITHUB_URL"
  exec node hive.mjs "$GITHUB_URL"
else
  echo ""
  if ! gh auth status >/dev/null 2>&1; then
    echo "⚠ GitHub not authenticated. Run: gh auth login"
  fi
  if [ -z "$GITHUB_URL" ]; then
    echo "⚠ GITHUB_URL not set. Set it in Coolify environment variables"
  fi
  echo ""
  echo "Container running. Access terminal to configure."
  echo "Keeping container alive..."
  # Keep container running without consuming CPU
  tail -f /dev/null
fi
'