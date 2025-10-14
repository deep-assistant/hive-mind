#!/usr/bin/env node

/**
 * Container Secrets Integration
 *
 * This module integrates the secret storage system with Docker containers
 * for isolated key injection into Hive Mind jobs (solve, hive, review)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import os from 'os';

/**
 * Container Secret Injector
 * Manages secret injection into Docker containers
 */
export class ContainerSecretInjector {
  constructor(storageManager, keyInjector, options = {}) {
    this.storageManager = storageManager;
    this.keyInjector = keyInjector;
    this.verbose = options.verbose || false;
    this.$ = options.$ || null; // command-stream $ instance
  }

  /**
   * Prepare secrets for container injection
   *
   * @param {string} userId - User identifier
   * @param {string} jobId - Job identifier (solve/hive/review)
   * @param {string[]} secretIds - Array of secret IDs to inject
   * @param {object} jobContext - Job context information
   */
  async prepareSecretsForContainer(userId, jobId, secretIds, jobContext = {}) {
    // Create session for this job
    const sessionId = await this.keyInjector.createSession(jobId, userId, jobContext);

    // Create temporary directory for secrets
    const secretTempDir = join(os.tmpdir(), `hive-secrets-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(secretTempDir, { recursive: true, mode: 0o700 });

    const preparedSecrets = [];

    try {
      // Retrieve and prepare each secret
      for (const secretId of secretIds) {
        const secret = await this.storageManager.retrieveSecret(secretId, userId);

        // Write secret to temporary file
        const secretFileName = `secret-${randomBytes(8).toString('hex')}`;
        const secretFilePath = join(secretTempDir, secretFileName);

        await fs.writeFile(secretFilePath, secret.keyData, { mode: 0o600 });

        preparedSecrets.push({
          secretId,
          keyType: secret.keyType,
          keyName: secret.keyName,
          hostPath: secretFilePath,
          containerPath: `/tmp/hive-secrets/${secretFileName}`,
          metadata: secret.metadata
        });
      }

      // Generate injection script
      const injectionScript = this._generateContainerInjectionScript(preparedSecrets);
      const scriptPath = join(secretTempDir, 'inject-secrets.sh');

      await fs.writeFile(scriptPath, injectionScript, { mode: 0o700 });

      return {
        sessionId,
        secretTempDir,
        preparedSecrets,
        injectionScriptPath: scriptPath
      };
    } catch (error) {
      // Cleanup on error
      await fs.rm(secretTempDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`Failed to prepare secrets: ${error.message}`);
    }
  }

  /**
   * Generate Docker volume mounts for secrets
   */
  generateDockerVolumeMounts(preparedSecrets, secretTempDir) {
    const volumeMounts = [];

    // Mount the injection script
    volumeMounts.push({
      hostPath: join(secretTempDir, 'inject-secrets.sh'),
      containerPath: '/tmp/inject-secrets.sh',
      readonly: true
    });

    // Mount each secret file
    for (const secret of preparedSecrets) {
      volumeMounts.push({
        hostPath: secret.hostPath,
        containerPath: secret.containerPath,
        readonly: true
      });
    }

    return volumeMounts;
  }

  /**
   * Generate Docker run command arguments for secret injection
   */
  generateDockerRunArgs(volumeMounts) {
    const args = [];

    for (const mount of volumeMounts) {
      const mode = mount.readonly ? 'ro' : 'rw';
      args.push('-v', `${mount.hostPath}:${mount.containerPath}:${mode}`);
    }

    return args;
  }

  /**
   * Execute secret injection in container
   *
   * @param {string} containerId - Docker container ID
   * @param {string} injectionScriptPath - Path to injection script
   */
  async injectSecretsIntoContainer(containerId, injectionScriptPath) {
    if (!this.$) {
      throw new Error('Command stream $ instance not provided');
    }

    try {
      // Copy injection script to container
      const result = await this.$`docker exec ${containerId} bash -c "chmod +x /tmp/inject-secrets.sh && /tmp/inject-secrets.sh"`;

      if (result.code !== 0) {
        throw new Error(`Injection script failed: ${result.stderr || 'Unknown error'}`);
      }

      return true;
    } catch (error) {
      throw new Error(`Failed to inject secrets: ${error.message}`);
    }
  }

  /**
   * Cleanup temporary secret files after container execution
   */
  async cleanupSecrets(sessionId, secretTempDir) {
    try {
      // Close the session
      await this.keyInjector.closeSession(sessionId);

      // Remove temporary directory with all secrets
      await fs.rm(secretTempDir, { recursive: true, force: true });

      if (this.verbose) {
        console.log(`✅ Cleaned up secrets for session ${sessionId}`);
      }

      return true;
    } catch (error) {
      console.error(`⚠️  Failed to cleanup secrets: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate container injection script
   */
  _generateContainerInjectionScript(preparedSecrets) {
    const scriptLines = [
      '#!/bin/bash',
      '# Auto-generated secret injection script',
      '# Generated by Hive Mind Container Secret Injector',
      '',
      'set -e',
      '',
      'echo "🔐 Injecting secrets into container..."',
      ''
    ];

    for (const secret of preparedSecrets) {
      scriptLines.push(`echo "  → Injecting ${secret.keyType}: ${secret.keyName}"`);

      switch (secret.keyType) {
        case 'ssh-rsa':
        case 'ssh-ed25519':
          const keyName = secret.keyType === 'ssh-ed25519' ? 'id_ed25519' : 'id_rsa';
          scriptLines.push(
            `mkdir -p ~/.ssh`,
            `chmod 700 ~/.ssh`,
            `cp ${secret.containerPath} ~/.ssh/${keyName}`,
            `chmod 600 ~/.ssh/${keyName}`,
            `echo "    ✅ SSH key installed at ~/.ssh/${keyName}"`,
            ''
          );
          break;

        case 'github-token':
          scriptLines.push(
            `export GITHUB_TOKEN=$(cat ${secret.containerPath})`,
            `export GH_TOKEN=$(cat ${secret.containerPath})`,
            `# Configure gh CLI to use the token`,
            `mkdir -p ~/.config/gh`,
            `echo "github.com:" > ~/.config/gh/hosts.yml`,
            `echo "  oauth_token: $(cat ${secret.containerPath})" >> ~/.config/gh/hosts.yml`,
            `echo "  user: $(gh api user --jq .login 2>/dev/null || echo 'user')" >> ~/.config/gh/hosts.yml`,
            `echo "    ✅ GitHub token configured"`,
            ''
          );
          break;

        case 'github-app':
          scriptLines.push(
            `export GITHUB_APP_CONFIG=$(cat ${secret.containerPath})`,
            `echo "    ✅ GitHub App configuration loaded"`,
            ''
          );
          break;

        case 'oauth-token':
          scriptLines.push(
            `export OAUTH_TOKEN=$(cat ${secret.containerPath})`,
            `echo "    ✅ OAuth token configured"`,
            ''
          );
          break;

        case 'generic-secret':
          // For generic secrets, just make them available as environment variables
          const envVarName = secret.keyName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
          scriptLines.push(
            `export ${envVarName}=$(cat ${secret.containerPath})`,
            `echo "    ✅ Secret ${secret.keyName} configured as ${envVarName}"`,
            ''
          );
          break;
      }
    }

    scriptLines.push(
      'echo "✅ All secrets injected successfully"',
      '',
      '# Cleanup: Remove secret files from filesystem',
      'rm -rf /tmp/hive-secrets',
      ''
    );

    return scriptLines.join('\n');
  }

  /**
   * Create a Docker container with secrets pre-configured
   *
   * @param {object} options - Container creation options
   */
  async createContainerWithSecrets(options) {
    const {
      userId,
      jobId,
      secretIds,
      imageName,
      containerName,
      command,
      additionalVolumes = [],
      additionalEnvVars = {},
      jobContext = {}
    } = options;

    if (!this.$) {
      throw new Error('Command stream $ instance not provided');
    }

    // Prepare secrets
    const {
      sessionId,
      secretTempDir,
      preparedSecrets,
      injectionScriptPath
    } = await this.prepareSecretsForContainer(userId, jobId, secretIds, jobContext);

    try {
      // Generate volume mounts
      const volumeMounts = this.generateDockerVolumeMounts(preparedSecrets, secretTempDir);

      // Add additional volumes
      volumeMounts.push(...additionalVolumes);

      // Build Docker run command
      const dockerArgs = ['docker', 'run', '-d'];

      // Add container name
      if (containerName) {
        dockerArgs.push('--name', containerName);
      }

      // Add volume mounts
      for (const mount of volumeMounts) {
        const mode = mount.readonly ? 'ro' : 'rw';
        dockerArgs.push('-v', `${mount.hostPath}:${mount.containerPath}:${mode}`);
      }

      // Add environment variables
      for (const [key, value] of Object.entries(additionalEnvVars)) {
        dockerArgs.push('-e', `${key}=${value}`);
      }

      // Add security options
      dockerArgs.push(
        '--security-opt', 'no-new-privileges',
        '--cap-drop', 'ALL',
        '--cap-add', 'NET_BIND_SERVICE'
      );

      // Add resource limits
      dockerArgs.push(
        '--memory', '2g',
        '--cpus', '2',
        '--pids-limit', '100'
      );

      // Add image and command
      dockerArgs.push(imageName);

      if (command) {
        dockerArgs.push('bash', '-c', `source /tmp/inject-secrets.sh && ${command}`);
      }

      // Execute Docker run
      if (this.verbose) {
        console.log('🐳 Creating container with command:', dockerArgs.join(' '));
      }

      const result = await this.$`${dockerArgs.join(' ')}`;

      if (result.code !== 0) {
        throw new Error(`Container creation failed: ${result.stderr || 'Unknown error'}`);
      }

      const containerId = result.stdout.toString().trim();

      return {
        containerId,
        sessionId,
        secretTempDir,
        preparedSecrets
      };
    } catch (error) {
      // Cleanup on error
      await this.cleanupSecrets(sessionId, secretTempDir);
      throw error;
    }
  }

  /**
   * Enhanced docker-solve.sh integration
   * Generate a modified version of docker-solve.sh that includes secret injection
   */
  async generateEnhancedDockerSolveScript(userId, secretIds, outputPath) {
    const template = `#!/bin/bash

# Enhanced Docker wrapper for solve.mjs with secret injection
# Generated by Hive Mind Container Secret Injector
# Usage: ./docker-solve-secure.sh [solve.mjs arguments]

set -e

echo "🔐 Running solve.mjs in Docker container with secret injection..."
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon is not running"
    echo "Please start Docker first"
    exit 1
fi

# User ID for secret management
USER_ID="${userId}"

# Secret IDs to inject
SECRET_IDS=(${secretIds.join(' ')})

# Create output directory if it doesn't exist
mkdir -p ./output

# Build the Docker image if it doesn't exist or if --build is passed
if [[ "$1" == "--build" ]] || [[ "$(docker images -q hive-mind-solver 2> /dev/null)" == "" ]]; then
    echo "🔨 Building Docker image..."
    docker build -t hive-mind-solver .
    if [[ "$1" == "--build" ]]; then
        shift # Remove --build from arguments
    fi
fi

# Generate unique job ID
JOB_ID="job-$(date +%s)-$$"

echo "🚀 Starting solve.mjs with secrets for user: $USER_ID"
echo "📦 Job ID: $JOB_ID"
echo ""

# Note: Actual secret injection would be handled by the Node.js module
# This script serves as a template/example

# Run the container with proper volume mounts and argument passing
docker run --rm -it \\
    -v ~/.config/gh:/workspace/.persisted-configs/gh:ro \\
    -v ~/.local/share/claude-profiles:/workspace/.persisted-configs/claude:ro \\
    -v ~/.config/claude-code:/workspace/.persisted-configs/claude-code:ro \\
    -v "$(pwd)/output:/workspace/output" \\
    -e USER_ID="$USER_ID" \\
    -e JOB_ID="$JOB_ID" \\
    --security-opt no-new-privileges \\
    --cap-drop ALL \\
    --memory 2g \\
    --cpus 2 \\
    hive-mind-solver \\
    bash -c "
        # Restore credentials first
        ./docker-restore-auth.sh
        echo ''
        # Then run the solve script with passed arguments
        ./solve.mjs $*
    "

echo ""
echo "🎉 Docker execution completed!"
echo "📁 Check ./output/ directory for any generated files"
`;

    await fs.writeFile(outputPath, template, { mode: 0o755 });

    return outputPath;
  }
}

/**
 * Factory function for creating container secret injector
 */
export async function createContainerSecretInjector(storageManager, keyInjector, options = {}) {
  return new ContainerSecretInjector(storageManager, keyInjector, options);
}

/**
 * Integration helper for solve.mjs, hive.mjs, review.mjs
 */
export class HiveMindSecretIntegration {
  constructor(containerInjector, options = {}) {
    this.containerInjector = containerInjector;
    this.enabled = options.enabled !== false;
    this.verbose = options.verbose || false;
  }

  /**
   * Wrap solve.mjs execution with secret injection
   */
  async wrapSolveExecution(userId, issueUrl, secretIds, solveOptions = {}) {
    if (!this.enabled) {
      // Secrets disabled, run normally
      return { secretsEnabled: false };
    }

    const jobId = `solve-${Date.now()}`;
    const jobContext = {
      type: 'solve',
      issueUrl,
      timestamp: new Date().toISOString()
    };

    // Prepare secrets
    const preparation = await this.containerInjector.prepareSecretsForContainer(
      userId,
      jobId,
      secretIds,
      jobContext
    );

    return {
      secretsEnabled: true,
      sessionId: preparation.sessionId,
      secretTempDir: preparation.secretTempDir,
      injectionScriptPath: preparation.injectionScriptPath,
      cleanup: async () => {
        await this.containerInjector.cleanupSecrets(
          preparation.sessionId,
          preparation.secretTempDir
        );
      }
    };
  }

  /**
   * Wrap hive.mjs execution with secret injection
   */
  async wrapHiveExecution(userId, repoUrl, secretIds, hiveOptions = {}) {
    if (!this.enabled) {
      return { secretsEnabled: false };
    }

    const jobId = `hive-${Date.now()}`;
    const jobContext = {
      type: 'hive',
      repoUrl,
      timestamp: new Date().toISOString()
    };

    const preparation = await this.containerInjector.prepareSecretsForContainer(
      userId,
      jobId,
      secretIds,
      jobContext
    );

    return {
      secretsEnabled: true,
      sessionId: preparation.sessionId,
      secretTempDir: preparation.secretTempDir,
      injectionScriptPath: preparation.injectionScriptPath,
      cleanup: async () => {
        await this.containerInjector.cleanupSecrets(
          preparation.sessionId,
          preparation.secretTempDir
        );
      }
    };
  }

  /**
   * Wrap review.mjs execution with secret injection
   */
  async wrapReviewExecution(userId, prUrl, secretIds, reviewOptions = {}) {
    if (!this.enabled) {
      return { secretsEnabled: false };
    }

    const jobId = `review-${Date.now()}`;
    const jobContext = {
      type: 'review',
      prUrl,
      timestamp: new Date().toISOString()
    };

    const preparation = await this.containerInjector.prepareSecretsForContainer(
      userId,
      jobId,
      secretIds,
      jobContext
    );

    return {
      secretsEnabled: true,
      sessionId: preparation.sessionId,
      secretTempDir: preparation.secretTempDir,
      injectionScriptPath: preparation.injectionScriptPath,
      cleanup: async () => {
        await this.containerInjector.cleanupSecrets(
          preparation.sessionId,
          preparation.secretTempDir
        );
      }
    };
  }
}

/**
 * Factory for Hive Mind integration
 */
export async function createHiveMindSecretIntegration(containerInjector, options = {}) {
  return new HiveMindSecretIntegration(containerInjector, options);
}
