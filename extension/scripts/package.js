#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const distDir = join(rootDir, 'dist');
const releasesDir = join(rootDir, 'releases');

if (!existsSync(distDir)) {
  throw new Error('dist fehlt. Bitte zuerst npm run build ausführen.');
}

mkdirSync(releasesDir, { recursive: true });

let gitHash = Date.now().toString(36);
try {
  gitHash = execSync('git rev-parse --short HEAD', {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
} catch {
  // Timestamp fallback is deterministic enough for an uncommitted package.
}

const archiveName = `ct-details-updater-v${packageJson.version}-${gitHash}.zip`;
const archivePath = join(releasesDir, archiveName);

execFileSync('zip', ['-r', archivePath, 'dist', '-x', '*.map', '*.DS_Store'], {
  cwd: rootDir,
  stdio: 'inherit',
});

const sizeKb = Math.round(statSync(archivePath).size / 1024);
console.log(`Paket erstellt: ${archivePath} (${sizeKb} KB)`);
