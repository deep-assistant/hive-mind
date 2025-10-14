#!/usr/bin/env bash
# Test script to verify phpenv installation functionality
set -euo pipefail

echo "[*] Testing phpenv installation functionality..."

# Check if phpenv directory exists
if [ -d "$HOME/.phpenv" ]; then
  echo "[*] phpenv directory found at $HOME/.phpenv"

  # Setup phpenv in PATH
  export PHPENV_ROOT="$HOME/.phpenv"
  export PATH="$PHPENV_ROOT/bin:$PATH"

  # Check if phpenv command is available
  if command -v phpenv >/dev/null 2>&1; then
    echo "[*] phpenv command is available"

    # Initialize phpenv
    eval "$(phpenv init -)"

    # Check phpenv version
    echo "[*] phpenv version:"
    phpenv --version || echo "[!] Could not get phpenv version"

    # List installed PHP versions
    echo "[*] Installed PHP versions:"
    phpenv versions || echo "[!] No PHP versions installed yet"

    # Check if php-build plugin exists
    if [ -d "$HOME/.phpenv/plugins/php-build" ]; then
      echo "[*] php-build plugin is installed"

      # List available PHP versions (first 10)
      echo "[*] Sample of available PHP versions to install:"
      phpenv install --list | head -20 || echo "[!] Could not list available versions"
    else
      echo "[!] php-build plugin not found"
    fi

    # Check if PHP is available in PATH
    if command -v php >/dev/null 2>&1; then
      echo "[*] PHP is available in PATH"
      echo "[*] Current PHP version:"
      php --version
    else
      echo "[!] PHP not found in PATH (no version installed yet)"
    fi

    echo "[*] Test completed successfully"
  else
    echo "[!] phpenv command not found in PATH"
    exit 1
  fi
else
  echo "[!] phpenv not installed at $HOME/.phpenv"
  echo "[*] This is expected before running the installation script"
  exit 0
fi
