#!/usr/bin/env node

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getGitVersion } from './git.lib.mjs';

export async function getVersion() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');

  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    const currentVersion = packageJson.version;
    const version = await getGitVersion(execSync, currentVersion);
    return version;
  } catch (error) {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  }
}

export default { getVersion };