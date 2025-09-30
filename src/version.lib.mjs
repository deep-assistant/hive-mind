#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getGitVersion } from './git.lib.mjs';

function isRunningAsScript() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const gitDir = join(__dirname, '..', '.git');
  return existsSync(gitDir);
}

export async function getVersion() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    const currentVersion = packageJson.version;

    if (isRunningAsScript()) {
      const version = await getGitVersion(execSync, currentVersion);
      return version;
    }

    return currentVersion;
  } catch {
    return 'unknown';
  }
}

export default { getVersion };