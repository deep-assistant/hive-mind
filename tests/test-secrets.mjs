#!/usr/bin/env node

/**
 * Tests for secure user key storage and injection mechanism
 */

import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import os from 'os';

import {
  createSecretManager,
  createKeyInjector,
  KEY_TYPES,
  AUDIT_EVENTS
} from '../src/secrets.lib.mjs';

import { createContainerSecretInjector } from '../src/container-secrets.lib.mjs';

/**
 * Test helper: Create temporary test storage
 */
async function createTestStorage() {
  const tempDir = join(os.tmpdir(), `hive-test-${randomBytes(8).toString('hex')}`);
  await fs.mkdir(tempDir, { recursive: true });

  return {
    storagePath: join(tempDir, 'secrets'),
    auditLogPath: join(tempDir, 'audit.log'),
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

/**
 * Test: Initialize storage manager
 */
async function testInitialization() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false,
      verbose: false
    });

    // Check that directories were created
    const storageStat = await fs.stat(storage.storagePath);
    assert.ok(storageStat.isDirectory(), 'Storage directory should exist');

    // Check that key type directories were created
    for (const keyType of Object.values(KEY_TYPES)) {
      const keyTypeDir = join(storage.storagePath, keyType);
      const keyTypeStat = await fs.stat(keyTypeDir);
      assert.ok(keyTypeStat.isDirectory(), `${keyType} directory should exist`);
    }

    console.log('✅ testInitialization passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Store and retrieve SSH key
 */
async function testStoreRetrieveSSHKey() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';
    const keyName = 'test-ssh-key';
    const keyData = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBK0V4xGxg7Z8z9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END OPENSSH PRIVATE KEY-----`;

    // Store the key
    const secretId = await manager.storeSecret(
      userId,
      KEY_TYPES.SSH_ED25519,
      keyName,
      keyData
    );

    assert.ok(secretId, 'Secret ID should be returned');
    assert.ok(secretId.startsWith('test-user-test-ssh-key'), 'Secret ID should have correct prefix');

    // Retrieve the key
    const retrieved = await manager.retrieveSecret(secretId, userId);

    assert.strictEqual(retrieved.keyData, keyData, 'Retrieved key data should match');
    assert.strictEqual(retrieved.keyType, KEY_TYPES.SSH_ED25519, 'Key type should match');
    assert.strictEqual(retrieved.keyName, keyName, 'Key name should match');

    console.log('✅ testStoreRetrieveSSHKey passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Store and retrieve GitHub token
 */
async function testStoreRetrieveGitHubToken() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';
    const keyName = 'github-token';
    const keyData = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD';

    // Store the token
    const secretId = await manager.storeSecret(
      userId,
      KEY_TYPES.GITHUB_TOKEN,
      keyName,
      keyData
    );

    // Retrieve the token
    const retrieved = await manager.retrieveSecret(secretId, userId);

    assert.strictEqual(retrieved.keyData, keyData, 'Retrieved token should match');
    assert.strictEqual(retrieved.keyType, KEY_TYPES.GITHUB_TOKEN, 'Key type should match');

    console.log('✅ testStoreRetrieveGitHubToken passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Access control - user mismatch
 */
async function testAccessControl() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId1 = 'user1';
    const userId2 = 'user2';
    const keyName = 'test-secret';
    const keyData = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD';

    // User1 stores a secret
    const secretId = await manager.storeSecret(
      userId1,
      KEY_TYPES.GITHUB_TOKEN,
      keyName,
      keyData
    );

    // User2 tries to access User1's secret
    try {
      await manager.retrieveSecret(secretId, userId2);
      assert.fail('Should have thrown access denied error');
    } catch (error) {
      assert.ok(error.message.includes('Access denied'), 'Should throw access denied error');
    }

    console.log('✅ testAccessControl passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: List secrets
 */
async function testListSecrets() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';

    // Store multiple secrets
    await manager.storeSecret(
      userId,
      KEY_TYPES.SSH_ED25519,
      'ssh-key-1',
      '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----'
    );

    await manager.storeSecret(
      userId,
      KEY_TYPES.GITHUB_TOKEN,
      'github-token-1',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
    );

    // List all secrets
    const allSecrets = await manager.listSecrets(userId);
    assert.strictEqual(allSecrets.length, 2, 'Should have 2 secrets');

    // List only SSH keys
    const sshSecrets = await manager.listSecrets(userId, KEY_TYPES.SSH_ED25519);
    assert.strictEqual(sshSecrets.length, 1, 'Should have 1 SSH key');
    assert.strictEqual(sshSecrets[0].keyType, KEY_TYPES.SSH_ED25519, 'Should be SSH key');

    console.log('✅ testListSecrets passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Delete secret
 */
async function testDeleteSecret() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';
    const keyName = 'test-secret';
    const keyData = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD';

    // Store a secret
    const secretId = await manager.storeSecret(
      userId,
      KEY_TYPES.GITHUB_TOKEN,
      keyName,
      keyData
    );

    // Delete the secret
    await manager.deleteSecret(secretId, userId);

    // Try to retrieve - should fail
    try {
      await manager.retrieveSecret(secretId, userId);
      assert.fail('Should have thrown secret not found error');
    } catch (error) {
      assert.ok(error.message.includes('Secret not found'), 'Should throw not found error');
    }

    console.log('✅ testDeleteSecret passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Audit logging
 */
async function testAuditLogging() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';
    const keyName = 'test-secret';
    const keyData = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD';

    // Store a secret (should be audited)
    const secretId = await manager.storeSecret(
      userId,
      KEY_TYPES.GITHUB_TOKEN,
      keyName,
      keyData
    );

    // Retrieve the secret (should be audited)
    await manager.retrieveSecret(secretId, userId);

    // Get audit logs
    const logs = await manager.getAuditLogs({ userId });

    assert.ok(logs.length >= 2, 'Should have at least 2 audit entries');

    // Check for store event
    const storeEvent = logs.find(log => log.event === AUDIT_EVENTS.KEY_STORED && log.details.secretId === secretId);
    assert.ok(storeEvent, 'Should have store event');

    // Check for retrieve event
    const retrieveEvent = logs.find(log => log.event === AUDIT_EVENTS.KEY_RETRIEVED && log.details.secretId === secretId);
    assert.ok(retrieveEvent, 'Should have retrieve event');

    console.log('✅ testAuditLogging passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Session key injector
 */
async function testSessionKeyInjector() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const injector = await createKeyInjector(manager);

    const userId = 'test-user';
    const jobId = 'test-job-123';

    // Create session
    const sessionId = await injector.createSession(jobId, userId, {
      type: 'solve',
      issueUrl: 'https://github.com/test/repo/issues/1'
    });

    assert.ok(sessionId, 'Session ID should be returned');
    assert.ok(sessionId.startsWith('session-test-job-123'), 'Session ID should have correct prefix');

    // Check active sessions
    const activeSessions = injector.getActiveSessions(userId);
    assert.strictEqual(activeSessions.length, 1, 'Should have 1 active session');
    assert.strictEqual(activeSessions[0].sessionId, sessionId, 'Session ID should match');

    // Close session
    await injector.closeSession(sessionId);

    // Check that session is closed
    const session = injector.activeSessions.get(sessionId);
    assert.strictEqual(session.status, 'closed', 'Session should be closed');

    console.log('✅ testSessionKeyInjector passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Injection script generation
 */
async function testInjectionScriptGeneration() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const injector = await createKeyInjector(manager);

    const sessionId = 'session-test-123';
    const injectedKeys = [
      {
        secretId: 'secret-1',
        keyType: KEY_TYPES.SSH_ED25519,
        keyName: 'test-ssh-key',
        containerPath: '/tmp/hive-secrets/key-1',
        injectedAt: new Date().toISOString()
      },
      {
        secretId: 'secret-2',
        keyType: KEY_TYPES.GITHUB_TOKEN,
        keyName: 'github-token',
        containerPath: '/tmp/hive-secrets/key-2',
        injectedAt: new Date().toISOString()
      }
    ];

    // Create a mock session
    injector.activeSessions.set(sessionId, {
      sessionId,
      jobId: 'test-job',
      userId: 'test-user',
      injectedKeys,
      status: 'active'
    });

    // Generate script
    const script = injector.generateInjectionScript(sessionId, injectedKeys);

    assert.ok(script.includes('#!/bin/bash'), 'Script should have shebang');
    assert.ok(script.includes('mkdir -p ~/.ssh'), 'Script should create SSH directory');
    assert.ok(script.includes('GITHUB_TOKEN'), 'Script should export GITHUB_TOKEN');
    assert.ok(script.includes('rm -rf /tmp/hive-secrets'), 'Script should cleanup secrets');

    console.log('✅ testInjectionScriptGeneration passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Test: Key validation
 */
async function testKeyValidation() {
  const storage = await createTestStorage();

  try {
    const manager = await createSecretManager({
      storagePath: storage.storagePath,
      auditLogPath: storage.auditLogPath,
      gpgEnabled: false
    });

    const userId = 'test-user';

    // Test invalid SSH key
    try {
      await manager.storeSecret(
        userId,
        KEY_TYPES.SSH_ED25519,
        'invalid-key',
        'not-a-valid-ssh-key'
      );
      assert.fail('Should have thrown validation error');
    } catch (error) {
      assert.ok(error.message.includes('Invalid SSH'), 'Should throw SSH validation error');
    }

    // Test invalid GitHub token
    try {
      await manager.storeSecret(
        userId,
        KEY_TYPES.GITHUB_TOKEN,
        'invalid-token',
        'not-a-valid-token'
      );
      assert.fail('Should have thrown validation error');
    } catch (error) {
      assert.ok(error.message.includes('Invalid GitHub token'), 'Should throw token validation error');
    }

    console.log('✅ testKeyValidation passed');
  } finally {
    await storage.cleanup();
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🧪 Running Hive Mind Secrets Tests\n');

  const tests = [
    testInitialization,
    testStoreRetrieveSSHKey,
    testStoreRetrieveGitHubToken,
    testAccessControl,
    testListSecrets,
    testDeleteSecret,
    testAuditLogging,
    testSessionKeyInjector,
    testInjectionScriptGeneration,
    testKeyValidation
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error) {
      console.error(`❌ ${test.name} failed:`, error.message);
      console.error(error.stack);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
