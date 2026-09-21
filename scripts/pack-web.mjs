#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

/**
 * Packs the built web game into the bundle the Android shell installs:
 * `build/frontier-web.zip` with index.html at its root plus a version.json that
 * the shell reads to know what it has just installed.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = process.argv[2] ?? join(root, 'build', 'frontier-web.zip');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html не найден — сначала соберите игру: npm run build');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
const manifest = {
  version: version.version,
  versionCode: version.versionCode,
  repo: version.repo,
  built: new Date().toISOString(),
  notes: version.notes ?? '',
};
writeFileSync(join(dist, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`);

mkdirSync(dirname(out), { recursive: true });
const result = createZip(dist, out);
console.log(`bundle  ${out}`);
console.log(`version ${manifest.version} (code ${manifest.versionCode})`);
console.log(`files   ${result.files}, ${(result.bytes / 1024).toFixed(1)} KiB`);
console.log(`dist    ${statSync(join(dist, 'assets')).isDirectory() ? 'assets/ на месте' : 'assets/ отсутствует'}`);
