#!/usr/bin/env bash
set -euo pipefail

echo "[TEST] Testing swap file creation function..."

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

# Pre-test checks
echo "[TEST] Current system status:"
echo "Available disk space:"
df -h /
echo ""
echo "Current swap status:"
swapon --show || echo "No swap currently active"
free -h
echo ""

# Test the function
echo "[TEST] Running create_swap_file function..."
if create_swap_file; then
    echo "[TEST] ✓ Swap file creation function succeeded"
else
    echo "[TEST] ✗ Swap file creation function failed"
    exit 1
fi

echo ""
echo "[TEST] Post-creation verification:"
echo "Swap status after creation:"
swapon --show
free -h

echo ""
echo "[TEST] Checking /etc/fstab entry:"
grep "/swapfile" /etc/fstab || echo "No fstab entry found"

echo ""
echo "[TEST] File permissions and details:"
ls -la /swapfile 2>/dev/null || echo "Swap file not found"

echo "[TEST] Test completed successfully!"