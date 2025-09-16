FROM ubuntu:24.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Update and install base packages
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    git \
    sudo \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    python3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install .NET SDK 8.0
RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && chmod +x dotnet-install.sh \
    && ./dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet \
    && rm dotnet-install.sh \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet

# Install GitHub CLI
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create hive user
RUN useradd -m -s /bin/bash hive

# Switch to hive user for language tools installation
USER hive
WORKDIR /home/hive

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/home/hive/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# Install Node.js via n with proper prefix for user installation
ENV N_PREFIX=/home/hive/.n
ENV PATH="${N_PREFIX}/bin:${PATH}"
RUN curl -L https://raw.githubusercontent.com/tj/n/master/bin/n -o n \
    && bash n lts \
    && rm n

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/hive/.cargo/bin:${PATH}"

# Install global npm/bun packages
RUN bun install -g \
    @anthropic-ai/claude-code \
    @deep-assistant/claude-profiles \
    @deep-assistant/hive-mind

# Create app directory
WORKDIR /app

# Switch back to root to copy files and set permissions
USER root

# Copy application files from repo root (build context)
COPY --chown=hive:hive . .

# Ensure scripts are executable
RUN chmod +x *.mjs || true

# Create necessary directories
RUN mkdir -p /app/claude-logs /app/claude-sessions /app/output \
    && chown -R hive:hive /app

# Switch back to hive user for runtime
USER hive

# Environment variables (can be overridden)
ENV NODE_ENV=production
ENV PORT=3000
ENV MONITOR_TAG="help wanted"
ENV CONCURRENCY=2
ENV INTERVAL=300
ENV MODEL=sonnet

# Health check - check if container is running (either hive.mjs or waiting)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "hive.mjs\|tail" > /dev/null || exit 1

# Create a startup script that keeps container running for configuration
RUN echo '#!/bin/sh\n\
\n\
echo "========================================"\n\
echo "Hive-Mind Container Starting..."\n\
echo "========================================"\n\
\n\
# Try to configure GitHub authentication if token is provided\n\
# Note: We do NOT use set -e to avoid exiting on auth failures\n\
if [ -n "$GITHUB_TOKEN" ]; then\n\
  echo "Attempting to configure GitHub CLI with provided token..."\n\
  if echo "$GITHUB_TOKEN" | gh auth login --with-token 2>/dev/null; then\n\
    echo "GitHub CLI authentication successful"\n\
    export GH_TOKEN="$GITHUB_TOKEN"\n\
  else\n\
    echo "GitHub CLI authentication failed - token may be invalid"\n\
    echo "You can configure it manually via terminal: gh auth login"\n\
  fi\n\
elif [ -n "$GH_TOKEN" ]; then\n\
  echo "Attempting to use GH_TOKEN for GitHub CLI..."\n\
  if echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null; then\n\
    echo "GitHub CLI authentication successful"\n\
  else\n\
    echo "GitHub CLI authentication failed - token may be invalid"\n\
    echo "You can configure it manually via terminal: gh auth login"\n\
  fi\n\
fi\n\
\n\
# Check authentication status\n\
echo ""\n\
echo "GitHub CLI Status:"\n\
gh auth status 2>&1 || echo "Not authenticated yet"\n\
echo ""\n\
\n\
# Check for GitHub URL and start monitoring if set\n\
if [ -z "$GITHUB_URL" ]; then\n\
  echo "========================================"\n\
  echo "WAITING FOR CONFIGURATION"\n\
  echo "========================================"\n\
  echo ""\n\
  echo "GITHUB_URL is not set. Container is running but not monitoring."\n\
  echo ""\n\
  echo "To configure:"\n\
  echo "1. Set GITHUB_URL environment variable in Coolify"\n\
  echo "2. Set GITHUB_TOKEN environment variable in Coolify"\n\
  echo "3. Restart the container"\n\
  echo ""\n\
  echo "OR access the terminal and run:"\n\
  echo "  gh auth login"\n\
  echo "  export GITHUB_URL=https://github.com/org/repo"\n\
  echo "  node hive.mjs \$GITHUB_URL"\n\
  echo ""\n\
  echo "Container will stay running for terminal access..."\n\
  # Keep container alive for terminal access\n\
  tail -f /dev/null\n\
else\n\
  echo "Starting hive-mind to monitor: $GITHUB_URL"\n\
  # Export GH_TOKEN for gh CLI to use\n\
  export GH_TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"\n\
  # Start monitoring\n\
  exec node hive.mjs "$GITHUB_URL"\n\
fi' > /app/start.sh && chmod +x /app/start.sh

# Default command - run the startup script
ENTRYPOINT ["/app/start.sh"]