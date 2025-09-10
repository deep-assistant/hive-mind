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

# --- Ensure prerequisites ---
apt_update_safe

sudo apt install -y wget curl unzip git sudo ca-certificates gnupg dotnet-sdk-8.0
apt_cleanup

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
  gh auth login -s user
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
