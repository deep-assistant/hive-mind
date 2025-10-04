#!/usr/bin/env bash
set -euo pipefail

echo "[*] Starting hive environment setup..."

# --- Create hive user if missing ---
if id "hive" &>/dev/null; then
  echo "[*] hive user already exists."
else
  echo "[*] Creating hive user..."
  adduser --disabled-password --gecos "" hive
  passwd -d hive
  usermod -aG sudo hive
fi

# --- Function: apt safe update ---
apt_update_safe() {
  echo "[*] Updating apt sources..."
  for f in /etc/apt/sources.list.d/*.list; do
    if [ -f "$f" ] && ! grep -Eq "^deb " "$f"; then
      echo "[!] Removing malformed apt source: $f"
      sudo rm -f "$f"
    fi
  done
  sudo apt update -y || true
}

# --- Function: cleanup disk ---
apt_cleanup() {
  echo "[*] Cleaning up apt cache..."
  sudo apt-get clean
  sudo apt-get autoclean
  sudo apt-get autoremove -y
  sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
}

# --- Function: create swap file ---
create_swap_file() {
  echo "[*] Setting up 2GB total swap space..."

  local target_total_mb=2048  # 2GB target
  local current_total_mb=0

  # Function to get file size in MB
  get_file_size_mb() {
    local file="$1"
    if [ -f "$file" ]; then
      local size_bytes=$(stat -c%s "$file" 2>/dev/null || echo "0")
      echo $((size_bytes / 1024 / 1024))
    else
      echo "0"
    fi
  }

  # Check existing swap files and calculate total
  echo "[*] Checking existing swap configuration..."
  for i in "" 1 2 3 4 5; do
    local swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
      local size_mb=$(get_file_size_mb "$swapfile")
      current_total_mb=$((current_total_mb + size_mb))
      echo "[*] Found $swapfile: ${size_mb}MB"

      # Activate if not already active
      if ! swapon --show | grep -q "$swapfile"; then
        echo "[*] Activating $swapfile..."
        sudo swapon "$swapfile" || true
      fi
    fi
  done

  echo "[*] Current total swap: ${current_total_mb}MB, Target: ${target_total_mb}MB"

  # If we already have enough swap, we're done
  if [ "$current_total_mb" -ge "$target_total_mb" ]; then
    echo "[*] Already have sufficient swap space (${current_total_mb}MB >= ${target_total_mb}MB)"
    return 0
  fi

  # Calculate how much additional swap we need
  local needed_mb=$((target_total_mb - current_total_mb))
  echo "[*] Need to create ${needed_mb}MB additional swap space..."

  # Check available disk space (need extra margin for safety)
  local available_space_kb=$(df / | awk 'NR==2 {print $4}')
  local needed_space_kb=$((needed_mb * 1024 + 1024 * 1024))  # needed + 1GB safety margin

  if [ "$available_space_kb" -lt "$needed_space_kb" ]; then
    echo "[!] Warning: Insufficient disk space for additional swap. Available: $(($available_space_kb/1024/1024))GB, Needed: $(($needed_space_kb/1024/1024))GB"
    return 1
  fi

  # Find next available swap file name
  local new_swapfile=""
  for i in "" 1 2 3 4 5; do
    local candidate="/swapfile$i"
    if [ ! -f "$candidate" ]; then
      new_swapfile="$candidate"
      break
    fi
  done

  if [ -z "$new_swapfile" ]; then
    echo "[!] Error: Cannot find available swap file name (checked /swapfile through /swapfile5)"
    return 1
  fi

  # Create additional swap file
  echo "[*] Creating ${needed_mb}MB swap file at $new_swapfile..."
  if command -v fallocate >/dev/null 2>&1; then
    sudo fallocate -l "${needed_mb}M" "$new_swapfile"
  else
    # Fallback to dd if fallocate is not available
    sudo dd if=/dev/zero of="$new_swapfile" bs=1M count="$needed_mb" status=progress
  fi

  # Set proper permissions
  sudo chmod 600 "$new_swapfile"
  
  # Format as swap
  sudo mkswap "$new_swapfile"
  
  # Enable swap file
  sudo swapon "$new_swapfile"

  # Make it persistent by adding to /etc/fstab if not already there
  if ! grep -q "$new_swapfile" /etc/fstab; then
    echo "[*] Adding $new_swapfile to /etc/fstab for persistence..."
    # Ensure we have a backup of fstab
    if [ ! -f /etc/fstab.backup ]; then
      sudo cp /etc/fstab /etc/fstab.backup
    fi
    echo "$new_swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi

  # Verify swap is active and show final status
  if swapon --show | grep -q "$new_swapfile"; then
    echo "[*] Swap file $new_swapfile successfully created and activated."
    echo "[*] Final swap configuration:"
    swapon --show
    echo "[*] Total swap space: $((current_total_mb + needed_mb))MB"
  else
    echo "[!] Error: Swap file creation failed."
    return 1
  fi
}

# --- Ensure prerequisites ---
apt_update_safe

sudo apt install -y wget curl unzip git sudo ca-certificates gnupg dotnet-sdk-8.0 build-essential

# --- Setup swap file ---
create_swap_file

# --- Switch to hive user for language tools and gh setup ---
sudo -i -u hive bash <<'EOF_HIVE'
set -euo pipefail

echo "[*] Installing as hive user..."

# --- GitHub CLI ---
if ! command -v gh &>/dev/null; then
  echo "[*] Installing GitHub CLI..."
  # Use official installation method from GitHub CLI maintainers
  sudo mkdir -p -m 755 /etc/apt/keyrings
  out=$(mktemp)
  wget -nv -O"$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
  cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f "$out"

  sudo mkdir -p -m 755 /etc/apt/sources.list.d
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

  sudo apt update -y
  sudo apt install -y gh
else
  echo "[*] GitHub CLI already installed."
fi

# --- Run interactive GitHub login ---
if ! gh auth status &>/dev/null; then
  echo "[*] Launching GitHub auth login..."
  gh auth login -h github.com -s repo,workflow,user,read:org,gist
fi

# --- Bun ---
if ! command -v bun &>/dev/null; then
  echo "[*] Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
else
  echo "[*] Bun already installed."
fi

# --- NVM + Node ---
if [ ! -d "$HOME/.nvm" ]; then
  echo "[*] Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# --- Rust ---
if [ ! -d "$HOME/.cargo" ]; then
  echo "[*] Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  if [ -f "$HOME/.cargo/env" ]; then
    \. "$HOME/.cargo/env"
    echo "[*] Rust installed successfully."
  else
    echo "[!] Warning: Rust installation may have failed or been cancelled. Skipping Rust environment setup."
  fi
else
  echo "[*] Rust already installed."
fi

export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Ensure Node 20 is installed and active
if ! nvm ls 20 | grep -q 'v20'; then
  echo "[*] Installing Node.js 20..."
  nvm install 20
fi
nvm use 20

# --- Install Playwright OS dependencies first (as root via absolute npx path) ---
echo "[*] Installing Playwright OS dependencies with npx (requires sudo)..."
NPX_PATH="$(command -v npx || true)"
if [ -z "$NPX_PATH" ]; then
  echo "[!] npx not found after Node setup; aborting Playwright deps install."
else
  # Ensure root sees the same Node as hive by exporting PATH with node's bin dir
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
  sudo env "PATH=$NODE_BIN_DIR:$PATH" "$NPX_PATH" playwright@latest install-deps || {
    echo "[!] Warning: 'npx playwright install-deps' failed. You may need to install deps manually."
  }
fi

# --- Global bun packages ---
echo "[*] Installing global bun packages..."
bun install -g @deep-assistant/hive-mind @deep-assistant/claude-profiles @anthropic-ai/claude-code @openai/codex @qwen-code/qwen-code

# --- Install Playwright MCP ---
echo "[*] Installing Playwright MCP server..."
if npm list -g @playwright/mcp &>/dev/null; then
  echo "[*] Playwright MCP already installed, updating..."
  npm update -g @playwright/mcp
else
  echo "[*] Installing Playwright MCP package..."
  npm install -g @playwright/mcp
fi

# --- Now install Playwright browsers (after deps to avoid warnings) ---
echo "[*] Installing Playwright browsers..."
# Ensure CLI exists so we don't get the npx "install without dependencies" banner
if ! command -v playwright >/dev/null 2>&1; then
  echo "[*] Installing Playwright CLI globally to avoid npx warning..."
  npm install -g @playwright/test
fi
playwright install chromium firefox webkit || {
  echo "[!] Warning: Failed to install some Playwright browsers. This may affect browser automation."
}

# --- Configure Playwright MCP for Claude CLI ---
echo "[*] Configuring Playwright MCP for Claude CLI..."
# Wait for Claude CLI to be available
if ! command -v claude &>/dev/null; then
  echo "[!] Claude CLI not found. Waiting for installation to complete..."
  sleep 2
fi

# Check if Claude CLI is available now
if command -v claude &>/dev/null; then
  # Check if playwright MCP is already configured
  if claude mcp list 2>/dev/null | grep -q "playwright"; then
    echo "[*] Playwright MCP already configured in Claude CLI"
  else
    # Add the playwright MCP server to Claude CLI configuration
    # Use npx to ensure we use the correct version
    echo "[*] Adding Playwright MCP to Claude CLI configuration..."
    claude mcp add playwright "npx" "@playwright/mcp@latest" 2>/dev/null || {
      echo "[!] Warning: Could not add Playwright MCP to Claude CLI."
      echo "    You may need to run manually: claude mcp add playwright npx @playwright/mcp@latest"
    }
  fi

  # Verify the configuration
  if claude mcp get playwright 2>/dev/null | grep -q "playwright"; then
    echo "[*] ✅ Playwright MCP successfully configured"
  else
    echo "[!] ⚠️  Playwright MCP configuration could not be verified"
  fi
else
  echo "[!] Claude CLI is not available. Skipping MCP configuration."
  echo "    After Claude CLI is installed, run: claude mcp add playwright npx @playwright/mcp@latest"
fi

# --- Git setup with GitHub identity ---
echo "[*] Configuring Git with GitHub identity..."
git config --global user.name "$(gh api user --jq .login)"
git config --global user.email "$(gh api user/emails --jq '.[] | select(.primary==true).email')"
gh auth setup-git

# --- Clone or update hive-mind repo (idempotent, no fatal logs) ---
REPO_DIR="$HOME/hive-mind"
if [ -d "$REPO_DIR/.git" ]; then
  echo "[*] Updating existing hive-mind repository..."
  git -C "$REPO_DIR" fetch --all --prune || echo "[!] Warning: fetch failed (continuing)."
  git -C "$REPO_DIR" pull --ff-only || echo "[!] Warning: pull failed (continuing)."
elif [ -d "$REPO_DIR" ]; then
  echo "[!] Directory '$REPO_DIR' exists but is not a git repo; skipping clone."
else
  (cd "$HOME" && git clone https://github.com/deep-assistant/hive-mind) || echo "[!] Warning: clone failed (continuing)."
fi

EOF_HIVE

# --- Cleanup after everything (so install-deps/apt had full cache) ---
apt_cleanup

echo "[*] Setup complete."
