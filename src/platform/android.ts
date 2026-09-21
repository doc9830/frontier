/**
 * The Android shell injects `window.FrontierAndroid`. On the plain web build every
 * helper here becomes a no-op, so the game never has to branch on its host — it
 * just asks "is there a shell?" once and hides the update card when there is none.
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'uptodate'
  | 'downloading'
  | 'unpacking'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'permission'
  | 'busy'
  | 'error';

/** One progress report from the shell (see Updater.kt for the producer). */
export interface UpdateState {
  phase: UpdatePhase;
  message: string;
  version?: string;
  installedWeb?: string;
  installedApp?: string;
  /** A newer game bundle is published. */
  web?: boolean;
  /** A newer APK is published. */
  apk?: boolean;
  percent?: number;
  notes?: string;
  url?: string;
  silent?: boolean;
  reload?: boolean;
  channel?: 'apk' | 'web';
  needsPermission?: boolean;
}

export interface ShellInfo {
  app: string;
  web: string;
  repo: string;
  repoUrl: string;
}

interface AndroidBridge {
  info(): string;
  check(): void;
  installWeb(): void;
  installApk(): void;
  openInstallSettings(): void;
  reload(): void;
  toast(message: string): void;
}

declare global {
  interface Window {
    FrontierAndroid?: AndroidBridge;
    /** Called by the shell for every update event. */
    __frontierUpdate?: (state: UpdateState) => void;
    /** Hardware back: true means the game consumed the press. */
    __frontierBack?: () => boolean;
    /** Set by the app shell once the save is available. */
    __frontierFlush?: () => void;
  }
}

const listeners = new Set<(state: UpdateState) => void>();
const backListeners = new Set<() => boolean>();
let lastState: UpdateState = { phase: 'idle', message: '' };

function bridge(): AndroidBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.FrontierAndroid;
}

export function isAndroidShell(): boolean {
  return Boolean(bridge());
}

/** Versions and repository the shell follows; null outside the Android app. */
export function shellInfo(): ShellInfo | null {
  const api = bridge();
  if (!api) return null;
  try {
    const parsed = JSON.parse(api.info()) as Record<string, unknown>;
    return {
      app: String(parsed.app ?? ''),
      web: String(parsed.web ?? ''),
      repo: String(parsed.repo ?? ''),
      repoUrl: String(parsed.repoUrl ?? ''),
    };
  } catch {
    return null;
  }
}

export function checkForUpdate(): void {
  bridge()?.check();
}

export function installWebUpdate(): void {
  bridge()?.installWeb();
}

export function installAppUpdate(): void {
  bridge()?.installApk();
}

/** Opens the "install unknown apps" system screen — the only step a browser-free self-update needs. */
export function openInstallSettings(): void {
  bridge()?.openInstallSettings();
}

/** Saves nothing by itself: the shell flushes the save first, then reloads. */
export function reloadShell(): void {
  bridge()?.reload();
}

export function shellToast(message: string): void {
  bridge()?.toast(message);
}

export function currentUpdateState(): UpdateState {
  return lastState;
}

/** Subscribes to shell progress; the callback fires immediately with the latest state. */
export function onUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  listener(lastState);
  return () => {
    listeners.delete(listener);
  };
}

/** Hardware back inside the shell: the game gets the first chance to close something. */
export function onShellBack(listener: () => boolean): () => void {
  backListeners.add(listener);
  return () => {
    backListeners.delete(listener);
  };
}

if (typeof window !== 'undefined' && isAndroidShell()) {
  window.__frontierUpdate = (state: UpdateState) => {
    lastState = { ...state };
    listeners.forEach((listener) => listener(lastState));
  };
  window.__frontierBack = () => {
    for (const listener of backListeners) {
      if (listener()) return true;
    }
    return false;
  };
}
