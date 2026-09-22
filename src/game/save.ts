import type { GameState } from './types.ts';
import { SAVE_VERSION, createGameState } from './state/create.ts';
import { fallbackBeltReserve } from './data/belts.ts';
import { stationPhaseOf } from './sim/station.ts';

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

/**
 * Дозаполняет поля, которые появились позже. Сейв v1 писался, когда станция
 * всегда стояла в родной системе и вокруг неё не было стадий строительства,
 * поэтому такие станции считаются действующими, а пояса получают запас.
 * В v3 появились контракты-курьеры и клейма верфей: старые записи доски
 * становятся контрактами-поставками, а модули — серийной сборкой.
 * В v4 появились арендуемые склады на станциях фракций (услуга «склад»).
 *
 * Стадия станции не восстанавливается из поля `phase`, а выводится из построек:
 * у сейвов 0.1.x поля не было, но база со складом уже стояла — такая станция
 * считалась «участком», из-за чего склад не принимал груз, а командный центр
 * было не построить. Теперь сейв и площадка не могут разойтись.
 */
function migrate(state: GameState, fromVersion: number): GameState {
  if (fromVersion < SAVE_VERSION) {
    const station = state.station;
    station.sitePlanetId = station.sitePlanetId ?? null;
    station.production = Array.isArray(station.production) ? station.production : [];
    station.research = station.research ?? { mining: 0, trade: 0, logistics: 0 };
    station.phase = stationPhaseOf(station);
    if (station.phase !== 'planned' && !station.systemId) {
      station.systemId = state.player.homeSystemId;
    }
    for (const id of state.systemIds ?? Object.keys(state.systems)) {
      const system = state.systems[id];
      if (!system) continue;
      system.contracts = Array.isArray(system.contracts) ? system.contracts : [];
      for (const contract of system.contracts) {
        contract.kind = contract.kind === 'courier' ? 'courier' : 'supply';
        contract.targetSystemId = contract.targetSystemId ?? contract.systemId;
        contract.hops = contract.hops ?? 0;
        contract.distance = contract.distance ?? 0;
        contract.cargoLoaded = contract.cargoLoaded ?? false;
      }
      system.scanned = system.scanned ?? (system.factionId !== null && system.discovered === true);
      for (const belt of system.belts ?? []) {
        if (typeof belt.reserve !== 'number') belt.reserve = fallbackBeltReserve(belt);
      }
      for (const systemStation of system.stations ?? []) {
        if (typeof systemStation.hasRefuel !== 'boolean') systemStation.hasRefuel = true;
        if (typeof systemStation.hasRepair !== 'boolean') {
          systemStation.hasRepair = !!systemStation.hasShipyard || systemStation.type !== 'military';
        }
        // Арендуемые склады появились в v4: у старых станций услуга есть.
        if (typeof systemStation.hasStorage !== 'boolean') systemStation.hasStorage = true;
      }
    }
    for (const ship of state.ships ?? []) {
      ship.makers = ship.makers ?? {};
      ship.sealed = ship.sealed ?? {};
    }
  }
  return state;
}


/** Older/partial blobs are patched up instead of being thrown away. */
function normalize(state: GameState): GameState {
  state.news = Array.isArray(state.news) ? state.news : [];
  state.systemIds = state.systemIds ?? Object.keys(state.systems);
  state.factionIds = state.factionIds ?? Object.keys(state.factions ?? {});
  state.pendingEvent = state.pendingEvent ?? null;
  state.survey = state.survey ?? null;
  state.toast = state.toast ?? null;
  // Склады по станциям появились в v4: у старых сейвов их просто нет.
  state.depots = state.depots ?? {};
  state.ships = Array.isArray(state.ships) ? state.ships : [];
  state.player.reputation = state.player.reputation ?? {};
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
    if (parsed.version > SAVE_VERSION) return null;
    const state = normalize(parsed.state);
    state.version = SAVE_VERSION;
    return migrate(state, parsed.version ?? 1);
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
    const state = normalize(parsed.state);
    state.version = SAVE_VERSION;
    return migrate(state, parsed.version ?? 1);
  } catch {
    return null;
  }
}
