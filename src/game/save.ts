import type { GameState } from './types.ts';
import { SAVE_VERSION, createGameState, playerShip } from './state/create.ts';
import { fallbackBeltReserve } from './data/belts.ts';
import { stationPhaseOf } from './sim/station.ts';
import { gameDay } from './news/news.ts';

/**
 * Persistence. The whole world is intentionally plain serializable data, so a
 * slot is a single JSON blob in localStorage (plus manual export/import).
 *
 * Слотов три: разные ключи галактики живут параллельно и не затирают друг
 * друга, а «продолжить» всегда ведёт в последний использованный слот. Сейв
 * старого формата (`frontier.save.v1`, одна галактика) при первом запуске
 * переезжает в первый свободный слот — игрок ничего не теряет.
 */

/** Сейв старого формата: читается один раз и переезжает в слот. */
export const SAVE_KEY = 'frontier.save.v1';
/** Список занятых слотов по порядку. */
export const SLOTS_KEY = 'frontier.slots.v1';
/** Слот, в который пишет автосохранение и кнопка «продолжить». */
export const ACTIVE_SLOT_KEY = 'frontier.activeSlot.v1';

export const SLOT_IDS = ['slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export interface SaveFile {
  version: number;
  savedAt: number;
  seed: string;
  state: GameState;
}

/** Что главное меню знает про слот: без самого мира, только шапка. */
export interface SlotInfo {
  id: SlotId;
  /** Номер для подписи «СЛОТ 1». */
  index: number;
  filled: boolean;
  seed: string;
  playerName: string;
  shipName: string;
  credits: number;
  day: number;
  savedAt: number;
  /** Именно в этот слот пишут автосохранение и «сохранить». */
  active: boolean;
}

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && (SLOT_IDS as readonly string[]).includes(value);
}

export function slotKey(id: SlotId): string {
  return `frontier.save.${id}.v1`;
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

/* ------------------------------------------------------------------ слоты */

/** Разбор блоба: один путь для слотов, импорта файла и старого сейва. */
function decodeFile(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaveFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.state?.systems) return null;
    if ((parsed.version ?? 1) > SAVE_VERSION) return null;
    const state = normalize(parsed.state);
    state.version = SAVE_VERSION;
    return migrate(state, parsed.version ?? 1);
  } catch {
    return null;
  }
}

/** Занятые слоты в порядке номеров; незнакомые записи молча выпадают. */
function readIndex(): SlotId[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(SLOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return SLOT_IDS.filter((id) => parsed.includes(id));
  } catch {
    return [];
  }
}

function writeIndex(ids: SlotId[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SLOTS_KEY, JSON.stringify(SLOT_IDS.filter((id) => ids.includes(id))));
  } catch {
    /* ignore quota/privacy mode errors */
  }
}

let legacyAdopted = false;

/**
 * Старый одиночный сейв переезжает в первый слот. Копия сначала проверяется
 * чтением, и только потом удаляется исходный ключ: обрыв на любом шаге оставляет
 * игрока с прежним файлом, а не с пустотой.
 */
export function adoptLegacySave(): void {
  if (legacyAdopted) return;
  legacyAdopted = true;
  const store = storage();
  if (!store) return;
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  // Слоты уже используются — старый ключ это просто мусор от прежних версий.
  if (readIndex().length > 0) {
    try {
      store.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const state = decodeFile(raw);
  if (!state) {
    try {
      store.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const id = SLOT_IDS[0];
  if (!writeSlot(id, state)) return;
  if (!readSlot(id)) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Шапка слота из живого мира: меню обновляется без перезагрузки страницы. */
export function slotInfoOf(state: GameState, id: SlotId, active: boolean): SlotInfo {
  const ship = playerShip(state);
  const index = SLOT_IDS.indexOf(id) + 1;
  return {
    id,
    index: index > 0 ? index : 1,
    filled: true,
    seed: state.seed,
    playerName: state.player.name,
    shipName: ship?.name ?? '—',
    credits: Math.round(state.player.credits),
    day: Math.round(gameDay(state) * 10) / 10,
    savedAt: state.savedAt ?? Date.now(),
    active,
  };
}

function readSlotInfo(id: SlotId, index: number, active: boolean): SlotInfo {
  const empty: SlotInfo = {
    id,
    index,
    filled: false,
    seed: '',
    playerName: '',
    shipName: '',
    credits: 0,
    day: 0,
    savedAt: 0,
    active,
  };
  const store = storage();
  if (!store) return empty;
  let raw: string | null = null;
  try {
    raw = store.getItem(slotKey(id));
  } catch {
    return empty;
  }
  const state = decodeFile(raw);
  if (!state) return empty;
  return slotInfoOf(state, id, active);
}

/** Все слоты по порядку, включая пустые: меню всегда рисует три карточки. */
export function slotList(): SlotInfo[] {
  adoptLegacySave();
  const active = activeSlotId();
  return SLOT_IDS.map((id, index) => readSlotInfo(id, index + 1, id === active));
}

export function firstFreeSlot(): SlotId {
  return slotList().find((slot) => !slot.filled)?.id ?? SLOT_IDS[0];
}

/** Последний по времени записи слот — его предлагает «продолжить». */
export function latestSlot(): SlotInfo | null {
  const filled = slotList().filter((slot) => slot.filled);
  if (filled.length === 0) return null;
  return filled.reduce((best, slot) => (slot.savedAt > best.savedAt ? slot : best));
}

export function activeSlotId(): SlotId | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(ACTIVE_SLOT_KEY);
    return isSlotId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setActiveSlot(id: SlotId | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (id) store.setItem(ACTIVE_SLOT_KEY, id);
    else store.removeItem(ACTIVE_SLOT_KEY);
  } catch {
    /* ignore quota/privacy mode errors */
  }
}

export function readSlot(id: SlotId): GameState | null {
  adoptLegacySave();
  const store = storage();
  if (!store) return null;
  try {
    return decodeFile(store.getItem(slotKey(id)));
  } catch {
    return null;
  }
}

export function writeSlot(id: SlotId, state: GameState): boolean {
  const store = storage();
  if (!store) return false;
  const now = Date.now();
  state.savedAt = now;
  state.lastSimulationTime = now;
  const file: SaveFile = { version: SAVE_VERSION, savedAt: now, seed: state.seed, state };
  try {
    store.setItem(slotKey(id), JSON.stringify(file));
  } catch {
    return false;
  }
  const index = readIndex();
  if (!index.includes(id)) writeIndex([...index, id]);
  return true;
}

export function deleteSlot(id: SlotId): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(slotKey(id));
  } catch {
    /* ignore */
  }
  writeIndex(readIndex().filter((slot) => slot !== id));
  if (activeSlotId() === id) setActiveSlot(null);
}

/** Пишет мир в слот: явный, активный или первый свободный. */
export function saveGame(state: GameState, slotId?: SlotId): boolean {
  const id = slotId ?? activeSlotId() ?? firstFreeSlot();
  const ok = writeSlot(id, state);
  if (ok) setActiveSlot(id);
  return ok;
}

/** Читает мир из слота: явного, активного или последнего записанного. */
export function loadGame(slotId?: SlotId): GameState | null {
  adoptLegacySave();
  const id = slotId ?? activeSlotId() ?? latestSlot()?.id;
  if (!id) return null;
  const state = readSlot(id);
  if (state) setActiveSlot(id);
  return state;
}

/** Seconds of world time that passed since the blob was written. */
export function offlineSeconds(state: GameState): number {
  return Math.max(0, (Date.now() - state.lastSimulationTime) / 1000);
}

/** Новый мир: сеется в указанный слот (или в первый свободный) и становится активным. */
export function startNewGame(seed: string, playerName?: string, slotId?: SlotId): GameState {
  const cleaned = seed.trim().toUpperCase() || 'FRONTIER-001';
  const state = createGameState(cleaned, playerName);
  const id = slotId ?? firstFreeSlot();
  writeSlot(id, state);
  setActiveSlot(id);
  return state;
}

export function exportSave(state: GameState): string {
  return JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), seed: state.seed, state });
}

export function importSave(json: string): GameState | null {
  return decodeFile(json);
}
