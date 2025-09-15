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
  sudo apt-get autoremove
  sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
}

# --- Function: create swap file ---
create_swap_file() {
  echo "[*] Setting up 2GB swap file..."
  
  # Check if swap file already exists
  if [ -f /swapfile ]; then
    echo "[*] Swap file already exists, checking if it's active..."
    if swapon --show | grep -q /swapfile; then
      echo "[*] Swap file is already active."
      return 0
    else
      echo "[*] Swap file exists but not active, activating it..."
      sudo swapon /swapfile
      return 0
    fi
  fi
  
  # Check available disk space (need at least 3GB free for 2GB swap + safety margin)
  available_space_kb=$(df / | awk 'NR==2 {print $4}')
  required_space_kb=$((3 * 1024 * 1024))  # 3GB in KB
  
  if [ "$available_space_kb" -lt "$required_space_kb" ]; then
    echo "[!] Warning: Insufficient disk space for 2GB swap file. Available: $(($available_space_kb/1024/1024))GB, Required: 3GB"
    return 1
  fi
  
  # Create 2GB swap file
  echo "[*] Creating 2GB swap file at /swapfile..."
  if command -v fallocate >/dev/null 2>&1; then
    sudo fallocate -l 2G /swapfile
  else
    # Fallback to dd if fallocate is not available
    sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
  fi
  
  # Set proper permissions
  sudo chmod 600 /swapfile
  
  # Format as swap
  sudo mkswap /swapfile
  
  # Enable swap file
  sudo swapon /swapfile
  
  # Make it persistent by adding to /etc/fstab if not already there
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "[*] Adding swap file to /etc/fstab for persistence..."
    sudo cp /etc/fstab /etc/fstab.backup
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  fi
  
  # Verify swap is active
  if swapon --show | grep -q /swapfile; then
    echo "[*] Swap file successfully created and activated."
    swapon --show
  else
    echo "[!] Error: Swap file creation failed."
    return 1
  fi
}

# --- Ensure prerequisites ---
apt_update_safe

sudo apt install -y wget curl unzip git sudo ca-certificates gnupg dotnet-sdk-8.0
apt_cleanup

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
  wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg
  cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f $out
  
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
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  \. "$HOME/.cargo/env"
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

if ! nvm ls 20 &>/dev/null; then
  echo "[*] Installing Node.js 20..."
  nvm install 20
fi

# --- Global bun packages ---
echo "[*] Installing global bun packages..."
bun install -g @anthropic-ai/claude-code @deep-assistant/claude-profiles opencode-ai || true

# --- Git setup with GitHub identity ---
echo "[*] Configuring Git with GitHub identity..."
git config --global user.name "$(gh api user --jq .login)"
git config --global user.email "$(gh api user/emails --jq '.[] | select(.primary==true).email')"
gh auth setup-git

(cd ~ && git clone https://github.com/deep-assistant/hive-mind)

EOF_HIVE

echo "[*] Setup complete."
