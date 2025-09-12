#!/bin/bash

# Docker version of credential restoration for solve.mjs
# This script restores both GitHub and Claude credentials transferred from host machine

echo "🐳 Starting credential restoration in Docker container..."

# --- GitHub restore ---
echo "📦 Restoring GitHub credentials..."
mkdir -p ~/.config
mkdir -p /workspace/.persisted-configs/gh # To not fail on missing folder

# Show backup files before restore
echo "📦 GitHub files available in backup:"
ls -R -a /workspace/.persisted-configs/gh 2>/dev/null || echo "(none)"

# Copy GitHub credentials from mounted volume
cp -r /workspace/.persisted-configs/gh ~/.config/ 2>/dev/null || true

GH_CONFIG=~/.config/gh/hosts.yml
[ -f "$GH_CONFIG" ] && echo "✅ GitHub credentials restored" || echo "❌ GitHub credentials missing"

# Show restored files (same style as backup)
echo "📂 GitHub files in ~/.config/gh after restore:"
ls -R -a ~/.config/gh 2>/dev/null || echo "(none)"

# --- Verify GitHub login status ---
echo "🔄 Verify GitHub login status"
gh auth status || echo "⚠️  GitHub authentication not available"

# --- Claude restore ---
echo "🤖 Restoring Claude credentials..."

# Check if Claude profiles are mounted and restore them
if [ -d "/workspace/.persisted-configs/claude" ]; then
    echo "📦 Claude profile files available in backup:"
    ls -R -a /workspace/.persisted-configs/claude 2>/dev/null || echo "(none)"
    
    # Restore Claude profiles - adjust path as needed for the specific profiles setup
    claude-profiles --restore docker --watch docker --skip-projects --verbose --log 2>/dev/null || echo "⚠️  Claude profiles restoration failed or not configured"
else
    echo "📂 No Claude credential backup found in /workspace/.persisted-configs/claude"
    echo "💡 Tip: Mount your Claude credentials with -v ~/.local/share/claude-profiles:/workspace/.persisted-configs/claude"
fi

# Check for Claude Code credentials
if [ -f "/workspace/.persisted-configs/claude-code/config" ]; then
    echo "📦 Claude Code config found, copying..."
    mkdir -p ~/.config/claude-code
    cp /workspace/.persisted-configs/claude-code/* ~/.config/claude-code/ 2>/dev/null || true
    echo "✅ Claude Code credentials restored"
else
    echo "📂 No Claude Code credentials found"
    echo "💡 Tip: Mount your Claude Code config with -v ~/.config/claude-code:/workspace/.persisted-configs/claude-code"
fi

echo "🎉 Credential restoration completed!"
echo ""
echo "🚀 Ready to run solve.mjs with transferred credentials"