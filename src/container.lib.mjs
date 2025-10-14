#!/usr/bin/env node

/**
 * Container management library for Hive Mind
 * Provides Docker-based containerization for job isolation
 *
 * Features:
 * - CPU, RAM, and disk limits
 * - Environment variable filtering
 * - Self-cleanup after task completion
 * - Optional per-user containers
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const os = (await use('os')).default;
const crypto = (await use('crypto')).default;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

/**
 * Container configuration interface
 * @typedef {Object} ContainerConfig
 * @property {string} cpuLimit - CPU limit (e.g., "1.0" for 1 CPU core)
 * @property {string} memoryLimit - RAM limit (e.g., "1g" for 1GB)
 * @property {string} diskLimit - Disk limit (e.g., "10g" for 10GB)
 * @property {string[]} allowedEnvVars - List of environment variables to pass through
 * @property {boolean} autoCleanup - Whether to cleanup container after execution
 * @property {string} userId - Optional user ID for per-user containers
 * @property {string} containerName - Custom container name
 */

/**
 * Default container configuration
 */
const DEFAULT_CONTAINER_CONFIG = {
  cpuLimit: '2.0',           // 2 CPU cores
  memoryLimit: '2g',          // 2GB RAM
  diskLimit: '50g',           // 50GB disk
  allowedEnvVars: [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TERM',
    'LANG',
    'LC_ALL',
    'ANTHROPIC_API_KEY',
    'CLAUDE_API_KEY',
    'GITHUB_TOKEN',
    'GH_TOKEN'
  ],
  autoCleanup: true,
  userId: null,
  containerName: null
};

/**
 * Check if Docker is available on the system
 * @returns {Promise<boolean>} True if Docker is available
 */
export async function isDockerAvailable() {
  try {
    const result = await $`docker --version 2>/dev/null`;
    return result.code === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Check if Docker daemon is running
 * @returns {Promise<boolean>} True if Docker daemon is running
 */
export async function isDockerRunning() {
  try {
    const result = await $`docker info 2>/dev/null`;
    return result.code === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a unique container name
 * @param {string} jobType - Type of job (solve, hive, review)
 * @param {string} userId - Optional user ID for per-user containers
 * @returns {string} Container name
 */
export function generateContainerName(jobType, userId = null) {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(4).toString('hex');
  const userPart = userId ? `-${userId}` : '';
  return `hive-mind-${jobType}${userPart}-${timestamp}-${randomId}`;
}

/**
 * Build Docker image for Hive Mind jobs
 * Uses the host's Ubuntu 24.04 installation script for consistency
 * @returns {Promise<{success: boolean, imageName: string, error?: string}>}
 */
export async function buildDockerImage() {
  const imageName = 'hive-mind-job:latest';

  try {
    await log('🐳 Building Docker image for Hive Mind jobs...');

    // Check if image already exists
    const imageCheckResult = await $`docker image inspect ${imageName} 2>/dev/null`;
    if (imageCheckResult.code === 0) {
      await log('   ✅ Image already exists, skipping build');
      return { success: true, imageName };
    }

    // Create a temporary Dockerfile
    const dockerfile = `FROM ubuntu:24.04

# Install basic dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    ca-certificates \\
    gnupg \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (required for hive-mind)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN mkdir -p /etc/apt/keyrings \\
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \\
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
    && apt-get update \\
    && apt-get install -y gh \\
    && rm -rf /var/lib/apt/lists/*

# Install Bun (optional, for better performance)
RUN curl -fsSL https://bun.sh/install | bash

# Set up working directory
WORKDIR /workspace

# Create hive user for running jobs
RUN useradd -m -s /bin/bash hive \\
    && chown -R hive:hive /workspace

# Switch to hive user
USER hive

# Set default command
CMD ["/bin/bash"]
`;

    const tempDir = os.tmpdir();
    const dockerfilePath = `${tempDir}/Dockerfile.hive-mind`;

    // Write Dockerfile
    const fs = (await use('fs')).promises;
    await fs.writeFile(dockerfilePath, dockerfile);

    await log('   📝 Dockerfile created, building image...');

    // Build Docker image
    const buildResult = await $`docker build -t ${imageName} -f ${dockerfilePath} ${tempDir}`;

    // Clean up Dockerfile
    await fs.unlink(dockerfilePath).catch(() => {});

    if (buildResult.code !== 0) {
      const errorMsg = buildResult.stderr?.toString() || 'Unknown error';
      await log(`   ❌ Failed to build Docker image: ${errorMsg}`, { level: 'error' });
      return { success: false, imageName, error: errorMsg };
    }

    await log('   ✅ Docker image built successfully');
    return { success: true, imageName };

  } catch (error) {
    reportError(error, {
      context: 'build_docker_image',
      operation: 'build_image'
    });
    await log(`   ❌ Error building Docker image: ${error.message}`, { level: 'error' });
    return { success: false, imageName, error: error.message };
  }
}

/**
 * Filter environment variables based on allowed list
 * @param {string[]} allowedEnvVars - List of allowed environment variable names
 * @returns {Object} Filtered environment variables
 */
export function filterEnvironmentVariables(allowedEnvVars) {
  const filtered = {};

  for (const varName of allowedEnvVars) {
    if (process.env[varName]) {
      filtered[varName] = process.env[varName];
    }
  }

  return filtered;
}

/**
 * Create and start a Docker container for job execution
 * @param {ContainerConfig} config - Container configuration
 * @param {string} imageName - Docker image name
 * @param {string} command - Command to execute in container
 * @param {string[]} args - Command arguments
 * @returns {Promise<{success: boolean, containerId: string, error?: string}>}
 */
export async function createContainer(config, imageName, command, args = []) {
  try {
    const containerName = config.containerName || generateContainerName('job', config.userId);

    await log(`🐳 Creating Docker container: ${containerName}`);

    // Filter environment variables
    const envVars = filterEnvironmentVariables(config.allowedEnvVars);
    const envArgs = Object.entries(envVars).map(([key, value]) => ['-e', `${key}=${value}`]).flat();

    // Build docker run command
    const dockerArgs = [
      'run',
      '-d',                          // Detached mode
      '--name', containerName,
      '--cpus', config.cpuLimit,
      '--memory', config.memoryLimit,
      '--storage-opt', `size=${config.diskLimit}`,
      ...envArgs,
      '--rm',                        // Auto-remove on exit if autoCleanup is true
      imageName,
      command,
      ...args
    ];

    await log(`   📋 Container: ${containerName}`, { verbose: true });
    await log(`   💻 CPU Limit: ${config.cpuLimit}`, { verbose: true });
    await log(`   🧠 RAM Limit: ${config.memoryLimit}`, { verbose: true });
    await log(`   💾 Disk Limit: ${config.diskLimit}`, { verbose: true });
    await log(`   🔧 Command: ${command} ${args.join(' ')}`, { verbose: true });

    const result = await $`docker ${dockerArgs.join(' ')}`;

    if (result.code !== 0) {
      const errorMsg = result.stderr?.toString() || 'Unknown error';
      await log(`   ❌ Failed to create container: ${errorMsg}`, { level: 'error' });
      return { success: false, containerId: null, error: errorMsg };
    }

    const containerId = result.stdout?.toString().trim();
    await log(`   ✅ Container created: ${containerId}`);

    return { success: true, containerId, containerName };

  } catch (error) {
    reportError(error, {
      context: 'create_container',
      operation: 'create_docker_container'
    });
    await log(`   ❌ Error creating container: ${error.message}`, { level: 'error' });
    return { success: false, containerId: null, error: error.message };
  }
}

/**
 * Wait for container to finish execution
 * @param {string} containerId - Container ID
 * @returns {Promise<{success: boolean, exitCode: number, error?: string}>}
 */
export async function waitForContainer(containerId) {
  try {
    await log(`⏳ Waiting for container ${containerId} to complete...`);

    const result = await $`docker wait ${containerId}`;

    if (result.code !== 0) {
      const errorMsg = result.stderr?.toString() || 'Unknown error';
      await log(`   ❌ Error waiting for container: ${errorMsg}`, { level: 'error' });
      return { success: false, exitCode: -1, error: errorMsg };
    }

    const exitCode = parseInt(result.stdout?.toString().trim() || '0', 10);
    await log(`   ✅ Container exited with code: ${exitCode}`);

    return { success: true, exitCode };

  } catch (error) {
    reportError(error, {
      context: 'wait_for_container',
      containerId,
      operation: 'wait_container'
    });
    await log(`   ❌ Error waiting for container: ${error.message}`, { level: 'error' });
    return { success: false, exitCode: -1, error: error.message };
  }
}

/**
 * Get container logs
 * @param {string} containerId - Container ID
 * @returns {Promise<{success: boolean, logs: string, error?: string}>}
 */
export async function getContainerLogs(containerId) {
  try {
    const result = await $`docker logs ${containerId}`;

    if (result.code !== 0) {
      const errorMsg = result.stderr?.toString() || 'Unknown error';
      return { success: false, logs: '', error: errorMsg };
    }

    const logs = result.stdout?.toString() || '';
    return { success: true, logs };

  } catch (error) {
    reportError(error, {
      context: 'get_container_logs',
      containerId,
      operation: 'fetch_logs'
    });
    return { success: false, logs: '', error: error.message };
  }
}

/**
 * Stop and remove a container
 * @param {string} containerId - Container ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function cleanupContainer(containerId) {
  try {
    await log(`🧹 Cleaning up container: ${containerId}`);

    // Stop container
    const stopResult = await $`docker stop ${containerId} 2>/dev/null`;
    if (stopResult.code !== 0) {
      await log(`   ⚠️  Failed to stop container (might already be stopped)`, { verbose: true });
    }

    // Remove container
    const rmResult = await $`docker rm ${containerId} 2>/dev/null`;
    if (rmResult.code !== 0) {
      await log(`   ⚠️  Failed to remove container (might already be removed)`, { verbose: true });
    }

    await log(`   ✅ Container cleaned up`);
    return { success: true };

  } catch (error) {
    reportError(error, {
      context: 'cleanup_container',
      containerId,
      operation: 'cleanup_docker_container'
    });
    await log(`   ⚠️  Error cleaning up container: ${error.message}`, { level: 'warning' });
    return { success: false, error: error.message };
  }
}

/**
 * Execute a job in a Docker container
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Partial<ContainerConfig>} userConfig - User-provided configuration
 * @returns {Promise<{success: boolean, exitCode: number, logs: string, error?: string}>}
 */
export async function executeInContainer(command, args = [], userConfig = {}) {
  // Merge user config with defaults
  const config = { ...DEFAULT_CONTAINER_CONFIG, ...userConfig };

  try {
    // Check Docker availability
    if (!(await isDockerAvailable())) {
      await log('❌ Docker is not installed on this system', { level: 'error' });
      await log('   Please install Docker: https://docs.docker.com/engine/install/', { level: 'error' });
      return { success: false, exitCode: -1, logs: '', error: 'Docker not available' };
    }

    if (!(await isDockerRunning())) {
      await log('❌ Docker daemon is not running', { level: 'error' });
      await log('   Please start Docker and try again', { level: 'error' });
      return { success: false, exitCode: -1, logs: '', error: 'Docker not running' };
    }

    // Build Docker image if needed
    const imageResult = await buildDockerImage();
    if (!imageResult.success) {
      return { success: false, exitCode: -1, logs: '', error: imageResult.error };
    }

    // Create and start container
    const createResult = await createContainer(config, imageResult.imageName, command, args);
    if (!createResult.success) {
      return { success: false, exitCode: -1, logs: '', error: createResult.error };
    }

    const { containerId } = createResult;

    try {
      // Wait for container to complete
      const waitResult = await waitForContainer(containerId);

      // Get container logs
      const logsResult = await getContainerLogs(containerId);

      // Cleanup container if auto-cleanup is enabled
      if (config.autoCleanup) {
        await cleanupContainer(containerId);
      }

      return {
        success: waitResult.success && waitResult.exitCode === 0,
        exitCode: waitResult.exitCode,
        logs: logsResult.logs || '',
        error: waitResult.error
      };

    } catch (execError) {
      // Ensure cleanup happens even on error
      if (config.autoCleanup) {
        await cleanupContainer(containerId);
      }
      throw execError;
    }

  } catch (error) {
    reportError(error, {
      context: 'execute_in_container',
      command,
      operation: 'run_containerized_job'
    });
    await log(`❌ Error executing in container: ${error.message}`, { level: 'error' });
    return { success: false, exitCode: -1, logs: '', error: error.message };
  }
}

/**
 * Validate container configuration
 * @param {Partial<ContainerConfig>} config - Configuration to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateContainerConfig(config) {
  const errors = [];

  if (config.cpuLimit) {
    const cpuNum = parseFloat(config.cpuLimit);
    if (isNaN(cpuNum) || cpuNum <= 0) {
      errors.push('CPU limit must be a positive number');
    }
  }

  if (config.memoryLimit) {
    if (!config.memoryLimit.match(/^\d+[kmg]$/i)) {
      errors.push('Memory limit must be in format like "1g", "512m", "256k"');
    }
  }

  if (config.diskLimit) {
    if (!config.diskLimit.match(/^\d+[kmg]$/i)) {
      errors.push('Disk limit must be in format like "50g", "10g", "1024m"');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  isDockerAvailable,
  isDockerRunning,
  generateContainerName,
  buildDockerImage,
  filterEnvironmentVariables,
  createContainer,
  waitForContainer,
  getContainerLogs,
  cleanupContainer,
  executeInContainer,
  validateContainerConfig,
  DEFAULT_CONTAINER_CONFIG
};
