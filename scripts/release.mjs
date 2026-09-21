#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/**
 * Releases a new version of FRONTIER.
 *
 *   node scripts/release.mjs patch        # 0.1.0 → 0.1.1, build, publish
 *   node scripts/release.mjs 0.4.0        # explicit version
 *   node scripts/release.mjs patch --skip-build --no-git
 *
 * The version lives in version.json and is baked both into the web bundle and the
 * APK, so the updater on the phone only compares one number. Publishing means a
 * GitHub release with two assets: `frontier-web.zip` (installed in place, without
 * any installer) and `frontier-<version>.apk` (handed to the Android installer).
 * The token is read from GH_TOKEN/GITHUB_TOKEN or ~/.git-credentials.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const noGit = args.includes('--no-git');
// --current publishes the version already in version.json (re-running a release).
const keepVersion = args.includes('--current');
const notesFlag = args.indexOf('--notes');
const bump = args.find((arg) => !arg.startsWith('--')) ?? 'patch';
const extraNotes = notesFlag >= 0 ? args[notesFlag + 1] : '';

const versionFile = join(root, 'version.json');
const manifest = JSON.parse(readFileSync(versionFile, 'utf8'));
if (!keepVersion) {
  manifest.version = nextVersion(bump, manifest.version);
  manifest.versionCode = Number(manifest.versionCode ?? 0) + 1;
}
if (extraNotes) manifest.notes = extraNotes;
writeFileSync(versionFile, `${JSON.stringify(manifest, null, 2)}\n`);

// package.json follows the same version so the repository reads consistently.
const pkgFile = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.version = manifest.version;
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

const tag = `v${manifest.version}`;
const webBundle = join(root, 'build', 'frontier-web.zip');
const apk = join(root, 'build', `frontier-${manifest.version}.apk`);
console.log(`release ${tag} (code ${manifest.versionCode})`);

if (!skipBuild) {
  run('npm', ['run', 'build']);
  run('node', [join(root, 'scripts', 'pack-web.mjs')]);
  run('node', [join(root, 'scripts', 'android-build.mjs'), 'assembleRelease']);
}

for (const file of [webBundle, apk]) {
  if (!existsSync(file)) {
    console.error(`Нет файла для загрузки: ${file}`);
    process.exit(1);
  }
}
console.log(`web ${(statSync(webBundle).size / 1024).toFixed(1)} KiB · apk ${(statSync(apk).size / 1024).toFixed(1)} KiB`);

if (!noGit) {
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `release: ${tag}`, '--no-verify']);
  run('git', ['tag', '-f', tag]);
  run('git', ['push', 'origin', 'HEAD:main']);
  run('git', ['push', '--force', 'origin', tag]);
}

await publish();

/** Reuses the release with this tag or creates it; both artifacts are uploaded. */
async function publish() {
  const { repo } = manifest;
  const headers = {
    Authorization: `Bearer ${readToken()}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'frontier-release',
  };

  const existing = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
  let release = existing.ok ? await existing.json() : null;
  if (!release) {
    const created = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `FRONTIER ${manifest.version}`,
        body: manifest.notes ?? '',
        draft: false,
        prerelease: false,
      }),
    });
    if (!created.ok) throw new Error(`Не удалось создать релиз: ${created.status} ${await created.text()}`);
    release = await created.json();
  }

  // Re-uploading replaces the assets, which is what re-running a release needs.
  for (const asset of release.assets ?? []) {
    if (asset.name === 'frontier-web.zip' || asset.name.endsWith('.apk')) {
      await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE', headers });
    }
  }

  for (const [file, type] of [
    [webBundle, 'application/zip'],
    [apk, 'application/vnd.android.package-archive'],
  ]) {
    const name = file.split('/').pop();
    const uploaded = await fetch(
      `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      { method: 'POST', headers: { ...headers, 'Content-Type': type }, body: readFileSync(file) },
    );
    if (!uploaded.ok) throw new Error(`Не удалось загрузить ${name}: ${uploaded.status} ${await uploaded.text()}`);
    const info = await uploaded.json();
    console.log(`asset    ${info.name} (${(info.size / 1024).toFixed(1)} KiB)`);
  }

  console.log(`\nготово: https://github.com/${repo}/releases/tag/${tag}`);
}

function nextVersion(kind, current) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [major, minor, patch] = current.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function readToken() {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv.trim();
  const credentials = join(homedir(), '.git-credentials');
  if (existsSync(credentials)) {
    const match = /https:\/\/[^:]+:([^@]+)@github\.com/.exec(readFileSync(credentials, 'utf8'));
    if (match) return match[1];
  }
  console.error('Нужен токен GitHub: экспортируйте GH_TOKEN или положите его в ~/.git-credentials.');
  process.exit(1);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Команда не выполнена: ${command} ${commandArgs.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}
