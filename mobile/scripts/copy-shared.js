#!/usr/bin/env node
/* global __dirname */
/**
 * Copy shared folder into mobile/src/shared for EAS builds
 * This script runs as a prebuild hook to ensure shared contracts are available
 *
 * During local dev, src/shared is a symlink to ../../shared
 * During EAS build, we replace the symlink with actual files
 */

const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '../../shared');
const targetDir = path.resolve(__dirname, '../src/shared');

console.log('[copy-shared] Copying shared folder for EAS build...');
console.log(`[copy-shared] Source: ${sourceDir}`);
console.log(`[copy-shared] Target: ${targetDir}`);

// Check if source exists
if (!fs.existsSync(sourceDir)) {
  console.log('[copy-shared] Source shared folder not found, skipping...');
  process.exit(0);
}

// Check if target is a symlink and remove it
try {
  const stat = fs.lstatSync(targetDir);
  if (stat.isSymbolicLink()) {
    console.log('[copy-shared] Removing existing symlink...');
    fs.unlinkSync(targetDir);
  }
} catch {
  // Target doesn't exist, that's fine
}

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Copy all files from shared to src/shared
const files = fs.readdirSync(sourceDir);
for (const file of files) {
  const sourcePath = path.join(sourceDir, file);
  const targetPath = path.join(targetDir, file);

  // Skip node_modules symlink
  if (file === 'node_modules') {
    console.log(`[copy-shared] Skipping ${file} (symlink)`);
    continue;
  }

  const stat = fs.statSync(sourcePath);
  if (stat.isFile()) {
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[copy-shared] Copied ${file}`);
  }
}

console.log('[copy-shared] Done!');
