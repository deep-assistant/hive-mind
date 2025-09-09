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
  sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
}

# --- Ensure prerequisites ---
apt_update_safe
sudo apt install -y wget curl unzip git sudo ca-certificates gnupg
apt_cleanup

# --- Switch to hive user for language tools and gh setup ---
sudo -i -u hive bash <<'EOF_HIVE'
set -euo pipefail

echo "[*] Installing as hive user..."

# --- GitHub CLI ---
if ! command -v gh &>/dev/null; then
  echo "[*] Installing GitHub CLI..."
  mkdir -p -m 755 ~/.local/share/keyrings
  mkdir -p $HOME/.config
  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee ~/.local/share/keyrings/githubcli-archive-keyring.gpg >/dev/null
  chmod go+r ~/.local/share/keyrings/githubcli-archive-keyring.gpg

  ARCH=$(dpkg --print-architecture)
  echo "deb [arch=${ARCH} signed-by=$HOME/.local/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee $HOME/.config/github-cli.list >/dev/null

  # Temporary local sources dir
  sudo mkdir -p /etc/apt/sources.list.d/
  sudo cp $HOME/.config/github-cli.list /etc/apt/sources.list.d/github-cli.list

  sudo apt update -y
  sudo apt install -y gh
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

EOF_HIVE

echo "[*] Setup complete."