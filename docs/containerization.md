# Containerization Feature

## Overview

The Hive Mind containerization feature provides isolated Docker-based execution environments for AI jobs (`solve`, `hive`, `review`). This enhances security by sandboxing job execution with resource limits and environment variable filtering.

## Features

- **Resource Limits**: Control CPU, RAM, and disk usage for each job
- **Environment Variable Filtering**: Only pass necessary environment variables to containers
- **Auto-Cleanup**: Automatic container removal after job completion
- **Per-User Isolation**: Optional per-user containers for multi-user environments (e.g., Telegram bot)
- **Security**: Isolated execution prevents jobs from affecting the host system

## Requirements

- Docker installed and running
- Sufficient system resources for container limits
- Docker daemon accessible by the user

## Installation

1. Install Docker (if not already installed):
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com | sh

   # Start Docker
   sudo systemctl start docker
   sudo systemctl enable docker

   # Add user to docker group (optional, to run without sudo)
   sudo usermod -aG docker $USER
   # Log out and log back in for group changes to take effect
   ```

2. Verify Docker is working:
   ```bash
   docker --version
   docker info
   ```

## Usage

### Basic Usage

Enable containerization with the `--containerize` flag:

```bash
# Solve an issue in a container
solve https://github.com/owner/repo/issues/123 --containerize

# Run hive monitoring with containerization
hive https://github.com/owner/repo --containerize --concurrency 2
```

### Custom Resource Limits

Adjust CPU, memory, and disk limits:

```bash
# Custom limits for a single solve job
solve https://github.com/owner/repo/issues/123 \
  --containerize \
  --container-cpu 1.0 \
  --container-memory 1g \
  --container-disk 20g

# Custom limits for hive workers
hive https://github.com/owner/repo \
  --containerize \
  --container-cpu 0.5 \
  --container-memory 512m \
  --container-disk 10g \
  --concurrency 4
```

### Per-User Containers (Telegram Bot)

For multi-user environments like the Telegram bot, use `--container-user-id` to isolate jobs by user:

```bash
# In Telegram bot configuration
hive-telegram-bot \
  --token YOUR_TOKEN \
  --solve-overrides "(
    --containerize
    --container-cpu 1.0
    --container-memory 1g
    --container-user-id \$USER_ID
  )"
```

This ensures each Telegram user's jobs run in separate containers with their own resource limits.

## Configuration Options

### `--containerize`
**Type**: `boolean`
**Default**: `false`
**Description**: Enable containerized execution for jobs

### `--container-cpu`
**Type**: `string`
**Default**: `"2.0"`
**Description**: CPU limit in cores (e.g., "1.0" for 1 core, "2.0" for 2 cores)

### `--container-memory`
**Type**: `string`
**Default**: `"2g"`
**Description**: RAM limit (e.g., "512m", "1g", "2g")

### `--container-disk`
**Type**: `string`
**Default**: `"50g"`
**Description**: Disk storage limit (e.g., "10g", "50g", "100g")

### `--container-user-id`
**Type**: `string`
**Default**: `undefined`
**Description**: User ID for per-user container isolation

## Examples

### Example 1: Secure Issue Solving

Solve an issue with strict resource limits:

```bash
solve https://github.com/owner/repo/issues/456 \
  --containerize \
  --container-cpu 1.0 \
  --container-memory 1g \
  --container-disk 10g \
  --auto-fork \
  --verbose
```

### Example 2: High-Throughput Hive

Run multiple workers with containerization:

```bash
hive https://github.com/microsoft \
  --all-issues \
  --containerize \
  --container-cpu 0.5 \
  --container-memory 512m \
  --concurrency 8 \
  --max-issues 50
```

### Example 3: Telegram Bot with Containerization

Configure the Telegram bot to use containers for all jobs:

```bash
hive-telegram-bot \
  --token 1234567890:ABC... \
  --allowed-chats "(-100123456789)" \
  --solve-overrides "(
    --containerize
    --container-cpu 1.0
    --container-memory 1g
    --container-disk 20g
    --auto-fork
    --verbose
  )"
```

## Security Considerations

### Environment Variables

By default, only these environment variables are passed to containers:

- `PATH`
- `HOME`
- `USER`
- `SHELL`
- `TERM`
- `LANG`
- `LC_ALL`
- `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`
- `GITHUB_TOKEN` / `GH_TOKEN`

To customize the allowed environment variables, modify `allowedEnvVars` in `src/container.lib.mjs`.

### Resource Limits

Resource limits prevent:
- CPU exhaustion (CPU limit)
- Memory leaks (RAM limit)
- Disk space abuse (Disk limit)

Always set appropriate limits based on your system's capacity and job requirements.

### Docker Security

- Containers run with limited privileges
- No access to host network by default
- Isolated filesystem
- Auto-cleanup removes containers after execution

### Best Practices

1. **Start with conservative limits**: Begin with lower resource limits and increase as needed
2. **Monitor resource usage**: Check Docker stats to understand actual usage patterns
3. **Use per-user containers**: In multi-user environments, always use `--container-user-id`
4. **Keep Docker updated**: Regular updates include security patches
5. **Review container logs**: Check logs for security issues or suspicious behavior

## Troubleshooting

### Docker Not Available

**Error**: `Docker is not installed on this system`

**Solution**:
```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo systemctl start docker
```

### Docker Daemon Not Running

**Error**: `Docker daemon is not running`

**Solution**:
```bash
# Start Docker daemon
sudo systemctl start docker

# Enable on boot
sudo systemctl enable docker
```

### Permission Denied

**Error**: `permission denied while trying to connect to the Docker daemon`

**Solution**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and log back in
exit
```

### Container Build Failure

**Error**: `Failed to build Docker image`

**Solution**:
- Check internet connectivity
- Ensure sufficient disk space
- Verify Docker daemon is running
- Check Docker logs: `docker logs`

### Resource Limit Errors

**Error**: `Cannot set memory limit`

**Solution**:
- Ensure requested limits are within system capacity
- Check Docker resource configuration
- Adjust limits to match available resources

## Performance Impact

Containerization adds minimal overhead:

- **Startup**: ~2-5 seconds for container creation
- **Execution**: <5% CPU/memory overhead
- **Cleanup**: ~1-2 seconds for container removal

Benefits outweigh overhead:
- Enhanced security
- Resource isolation
- Predictable performance
- Multi-user safety

## Architecture

```
┌─────────────────────────────────────┐
│         Hive Mind CLI               │
│  (solve.mjs / hive.mjs / review.mjs)│
└──────────────┬──────────────────────┘
               │
               ├─ Without --containerize
               │  └─> Direct execution
               │
               └─ With --containerize
                  └─> container.lib.mjs
                      ├─> Build Docker image
                      ├─> Create container
                      │   ├─ CPU limit
                      │   ├─ RAM limit
                      │   ├─ Disk limit
                      │   └─ Filtered env vars
                      ├─> Execute job
                      ├─> Get logs
                      └─> Cleanup container
```

## Implementation Details

### Container Image

The base image is built from `ubuntu:24.04` with:
- Node.js 20.x
- GitHub CLI (gh)
- Bun (optional, for performance)
- Git and basic utilities

### Resource Management

- **CPU**: Docker `--cpus` flag
- **Memory**: Docker `--memory` flag
- **Disk**: Docker `--storage-opt size=` flag

### Lifecycle

1. Check Docker availability
2. Build/reuse Docker image
3. Create container with resource limits
4. Execute job command
5. Stream logs
6. Wait for completion
7. Retrieve exit code and logs
8. Cleanup (if `autoCleanup: true`)

## API Reference

See `src/container.lib.mjs` for the complete API:

- `isDockerAvailable()`: Check if Docker is installed
- `isDockerRunning()`: Check if Docker daemon is running
- `buildDockerImage()`: Build the Hive Mind job image
- `createContainer()`: Create and start a container
- `waitForContainer()`: Wait for container to finish
- `getContainerLogs()`: Retrieve container logs
- `cleanupContainer()`: Stop and remove container
- `executeInContainer()`: High-level execution wrapper
- `validateContainerConfig()`: Validate configuration
- `filterEnvironmentVariables()`: Filter env vars

## Testing

Run the test suite:

```bash
# Run containerization tests
node examples/test-containerization.mjs
```

Expected output:
```
🧪 Testing Hive Mind Containerization Feature

Test 1: Checking Docker availability...
   Docker available: ✅ Yes

Test 2: Checking Docker daemon...
   Docker daemon running: ✅ Yes

Test 3: Validating container configurations...
   Valid config: ✅ Pass
   Invalid config 1: ✅ Correctly rejected
   Invalid config 2: ✅ Correctly rejected
   Invalid config 3: ✅ Correctly rejected

Test 4: Executing simple command in container...
   ✅ Container execution successful
   Exit code: 0
   Output: Hello from container!

Test 5: Testing environment variable filtering...
   ✅ Environment filtering working

✅ All tests completed!
```

## Future Enhancements

Potential improvements for future versions:

1. **Firecracker Support**: Add lightweight VM isolation as an alternative to Docker
2. **Network Isolation**: Implement custom network policies for containers
3. **Volume Management**: Support for persistent volumes across job runs
4. **Container Registry**: Pre-built images for faster startup
5. **Resource Monitoring**: Real-time monitoring dashboard
6. **Auto-Scaling**: Dynamic resource adjustment based on job demands
7. **Cost Tracking**: Track resource usage and costs per job

## Contributing

To contribute to the containerization feature:

1. Read the main [CONTRIBUTING.md](../docs/CONTRIBUTING.md)
2. Review the container library: `src/container.lib.mjs`
3. Add tests to: `examples/test-containerization.mjs`
4. Update this documentation for any new features

## License

This feature is part of the Hive Mind project and follows the same Unlicense license.
