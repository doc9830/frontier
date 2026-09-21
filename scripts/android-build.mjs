#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

/**
 * Builds the Android shell.
 *
 *   node scripts/android-build.mjs assembleRelease   # signed APK for releases
 *   node scripts/android-build.mjs assembleDebug     # quick local build
 *
 * JDK and the Android SDK are resolved from the environment (JAVA_HOME /
 * ANDROID_HOME), falling back to the usual local install locations, and the APK
 * is copied into `build/` where the release script picks it up.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const task = process.argv[2] ?? 'assembleRelease';
const variant = task === 'assembleDebug' ? 'debug' : 'release';

const javaHome = resolveJavaHome();
const sdkDir = resolveSdkDir();

if (!javaHome) {
  console.error('Не найден JDK 17+. Установите JDK или задайте JAVA_HOME.');
  process.exit(1);
}

// AGP finds the SDK through local.properties; it is machine specific and ignored by git.
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdkDir}\n`);
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.warn('Внимание: dist/index.html не найден — APK соберётся без игры. Сначала npm run build.');
}

const gradle = resolveGradle();
console.log(`gradle  ${gradle}`);
console.log(`java    ${javaHome}`);
console.log(`sdk     ${sdkDir}`);

const result = spawnSync(gradle, [task, '--console=plain'], {
  cwd: androidDir,
  stdio: 'inherit',
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdkDir, ANDROID_SDK_ROOT: sdkDir },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const apk = join(androidDir, 'app', 'build', 'outputs', 'apk', variant, variant === 'release' ? 'app-release.apk' : 'app-debug.apk');
if (!existsSync(apk)) {
  // Newer AGP writes renamed artifacts (app-release-unsigned.apk and friends).
  const dir = dirname(apk);
  const found = existsSync(dir) ? readdirSync(dir).find((name) => name.endsWith('.apk')) : undefined;
  if (!found) {
    console.error(`APK не найден в ${dir}`);
    process.exit(1);
  }
  copy(join(dir, found));
} else {
  copy(apk);
}

function copy(from) {
  const version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version;
  // Release builds keep the plain name: it becomes the asset name on GitHub.
  const suffix = variant === 'release' ? '' : `-${variant}`;
  const target = join(root, 'build', `frontier-${version}${suffix}.apk`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
  console.log(`apk      ${target}`);
}

function resolveGradle() {
  // FRONTIER_GRADLE wins so a machine with a local distribution never re-downloads one.
  if (process.env.FRONTIER_GRADLE && existsSync(process.env.FRONTIER_GRADLE)) return process.env.FRONTIER_GRADLE;
  const wrapper = join(androidDir, 'gradlew');
  if (existsSync(wrapper)) return wrapper;
  const local = join(homedir(), 'gradle-dist', 'gradle-8.13', 'bin', 'gradle');
  if (existsSync(local)) return local;
  return 'gradle';
}

function resolveJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java'))) return process.env.JAVA_HOME;
  const candidates = readdirSync(homedir())
    .filter((name) => /^jdk-?\d/.test(name))
    .map((name) => join(homedir(), name))
    .filter((path) => existsSync(join(path, 'bin', 'java')))
    .sort()
    .reverse();
  return candidates[0];
}

function resolveSdkDir() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Android', 'Sdk')];
  for (const path of candidates) {
    if (path && existsSync(join(path, 'platforms'))) return path;
  }
  console.error('Не найден Android SDK. Задайте ANDROID_HOME.');
  process.exit(1);
}
