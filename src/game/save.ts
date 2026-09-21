import type { GameState } from './types.ts';
import { SAVE_VERSION, createGameState } from './state/create.ts';

/**
 * Persistence. The whole world is intentionally plain serializable data, so the
 * save is a single JSON blob in localStorage (plus manual export/import).
 */

export const SAVE_KEY = 'frontier.save.v1';

export interface SaveFile {
  version: number;
  savedAt: number;
  seed: string;
  state: GameState;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Older/partial blobs are patched up instead of being thrown away. */
function normalize(state: GameState): GameState {
  state.news = Array.isArray(state.news) ? state.news : [];
  state.systemIds = state.systemIds ?? Object.keys(state.systems);
  state.factionIds = state.factionIds ?? Object.keys(state.factions ?? {});
  state.pendingEvent = state.pendingEvent ?? null;
  state.toast = state.toast ?? null;
  state.ships = Array.isArray(state.ships) ? state.ships : [];
  state.lastSimulationTime = state.lastSimulationTime || Date.now();
  return state;
}

export function saveGame(state: GameState): boolean {
  const store = storage();
  if (!store) return false;
  const now = Date.now();
  state.savedAt = now;
  state.lastSimulationTime = now;
  const file: SaveFile = { version: SAVE_VERSION, savedAt: now, seed: state.seed, state };
  try {
    store.setItem(SAVE_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaveFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.state?.systems) return null;
    if (parsed.version !== SAVE_VERSION) return null;
    return normalize(parsed.state);
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  const store = storage();
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* ignore quota/privacy mode errors */
  }
}

/** Seconds of world time that passed since the blob was written. */
export function offlineSeconds(state: GameState): number {
  return Math.max(0, (Date.now() - state.lastSimulationTime) / 1000);
}

export function startNewGame(seed: string, playerName?: string): GameState {
  const cleaned = seed.trim().toUpperCase() || 'FRONTIER-001';
  const state = createGameState(cleaned, playerName);
  saveGame(state);
  return state;
}

export function exportSave(state: GameState): string {
  return JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), seed: state.seed, state });
}

export function importSave(json: string): GameState | null {
  try {
    const parsed = JSON.parse(json) as SaveFile;
    if (!parsed?.state?.systems) return null;
    return normalize(parsed.state);
  } catch {
    return null;
  }
}
