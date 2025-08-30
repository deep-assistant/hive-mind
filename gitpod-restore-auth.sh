# Restore backup of auth data after stopped workspace is restarted (to not login again all the time)

# --- Claude restore ---
mkdir -p ~/.claude
mkdir -p /workspace/.persisted-configs/.claude # To not fail on missing folder

# Show backup files before restore
echo "📦 Claude files available in backup:"
ls -R -a /workspace/.persisted-configs/.claude 2>/dev/null || echo "(none)"
[ -f /workspace/.persisted-configs/.claude.json ] && echo " - .claude.json found"
[ -f /workspace/.persisted-configs/.claude.json.backup ] && echo " - .claude.json.backup found"

# Restore Claude credentials
cp -r /workspace/.persisted-configs/.claude ~/.claude 2>/dev/null || true
[ -f /workspace/.persisted-configs/.claude/.credentials.json ] && cp /workspace/.persisted-configs/.claude/.credentials.json ~/.claude/
[ -f /workspace/.persisted-configs/.claude.json ] && cp /workspace/.persisted-configs/.claude.json ~/
[ -f /workspace/.persisted-configs/.claude.json.backup ] && cp /workspace/.persisted-configs/.claude.json.backup ~/

CLAUDE_CRED=~/.claude/.credentials.json
[ -f "$CLAUDE_CRED" ] && echo "✅ Claude credentials restored" || echo "❌ Claude credentials missing"

# Show restored files (same style as backup)
echo "📂 Claude files in ~/.claude after restore:"
ls -R -a ~/.claude 2>/dev/null || echo "(none)"
[ -f ~/.claude.json ] && echo " - .claude.json present"
[ -f ~/.claude.json.backup ] && echo " - .claude.json.backup present"

# --- GitHub restore ---
mkdir -p ~/.config
mkdir -p /workspace/.persisted-configs/gh # To not fail on missing folder

# Show backup files before restore
echo "📦 GitHub files available in backup:"
ls -R -a /workspace/.persisted-configs/gh 2>/dev/null || echo "(none)"

cp -r /workspace/.persisted-configs/gh ~/.config/ 2>/dev/null || true

GH_CONFIG=~/.config/gh/hosts.yml
[ -f "$GH_CONFIG" ] && echo "✅ GitHub credentials restored" || echo "❌ GitHub credentials missing"

# Show restored files (same style as backup)
echo "📂 GitHub files in ~/.config/gh after restore:"
ls -R -a ~/.config/gh 2>/dev/null || echo "(none)"

# --- Verify GitHub login status ---
echo "🔄 Verify GitHub login status"
gh auth status