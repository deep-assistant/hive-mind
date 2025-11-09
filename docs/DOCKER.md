# Docker Support for Hive Mind

This document explains how to run Hive Mind in Docker containers.

## Quick Start

### Option 1: Using Pre-built Image from Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull deepassistant/hive-mind:latest

# Run an interactive session
docker run -it deepassistant/hive-mind:latest

# Inside the container, authenticate with GitHub
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# Authenticate with Claude
claude

# Now you can use hive and solve commands
solve https://github.com/owner/repo/issues/123
```

### Option 2: Building Locally

```bash
# Build the production image
docker build -f Dockerfile.production -t hive-mind:local .

# Run the image
docker run -it hive-mind:local
```

### Option 3: Development Mode (Gitpod-style)

For development purposes, the legacy `Dockerfile` provides a Gitpod-compatible environment:

```bash
# Build the development image
docker build -t hive-mind-dev .

# Run with credential mounts
docker run --rm -it \
    -v ~/.config/gh:/workspace/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/workspace/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/workspace/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/workspace/output" \
    hive-mind-dev
```

## Authentication

The production Docker image (`Dockerfile.production`) uses Ubuntu 24.04 and the official installation script. Authentication is performed **inside the container** after starting it:

### GitHub Authentication
```bash
# Inside the container
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication
```bash
# Inside the container
claude
```

This approach allows:
- ✅ Multiple Docker instances with different GitHub accounts
- ✅ Multiple Docker instances with different Claude subscriptions
- ✅ No credential leakage between containers
- ✅ Each container has its own isolated authentication

## Prerequisites

1. **Docker:** Install Docker Desktop or Docker Engine (version 20.10 or higher)
2. **Internet Connection:** Required for pulling images and authentication

## Directory Structure

```
.
├── Dockerfile                    # Development/Gitpod image (legacy)
├── Dockerfile.production         # Production image using Ubuntu 24.04
├── scripts/
│   └── ubuntu-24-server-install.sh  # Installation script used by Dockerfile.production
└── docs/
    └── DOCKER.md                 # This file
```

## Advanced Usage

### Running with Persistent Storage

To persist authentication and work between container restarts:

```bash
# Create a volume for the hive user's home directory
docker volume create hive-home

# Run with the volume mounted
docker run -it -v hive-home:/home/hive deepassistant/hive-mind:latest
```

### Running in Detached Mode

```bash
# Start a detached container
docker run -d --name hive-worker -v hive-home:/home/hive deepassistant/hive-mind:latest sleep infinity

# Execute commands in the running container
docker exec -it hive-worker bash

# Inside the container, run your commands
solve https://github.com/owner/repo/issues/123
```

### Using with Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  hive-mind:
    image: deepassistant/hive-mind:latest
    volumes:
      - hive-home:/home/hive
    stdin_open: true
    tty: true

volumes:
  hive-home:
```

Then run:
```bash
docker-compose run --rm hive-mind
```

## Troubleshooting

### GitHub Authentication Issues
```bash
# Inside the container, check authentication status
gh auth status

# Re-authenticate if needed
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication Issues
```bash
# Inside the container, re-run Claude to authenticate
claude
```

### Docker Issues
```bash
# Check Docker status on host
docker info

# Pull the latest image
docker pull deepassistant/hive-mind:latest

# Rebuild from source
docker build -f Dockerfile.production -t hive-mind:local .
```

### Build Issues

If you encounter issues building the image locally:

1. Ensure you have enough disk space (at least 20GB free)
2. Check your internet connection
3. Try building with more verbose output:
   ```bash
   docker build -f Dockerfile.production -t hive-mind:local --progress=plain .
   ```

## Security Notes

- Each container maintains its own isolated authentication
- No credentials are shared between containers
- No credentials are stored in the Docker image itself
- Authentication happens inside the container after it starts
- Each GitHub/Claude account can have its own container instance