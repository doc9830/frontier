import type { GameState, PlayerStation, ResourceId, StationPhase } from '../types.ts';
import { warehouseCapacity, buildingDef } from '../data/buildings.ts';
import { recipe } from '../data/recipes.ts';
import { addToast } from './toast.ts';
import { addNews } from '../news/news.ts';
import { MINEABLE, resourceSymbol } from '../data/resources.ts';

/**
 * Station simulation: construction, storage, refinery production and research.
 * Everything is driven by real timestamps, so it keeps running while offline.
 */

const BASE_STORAGE = 120;

/**
 * Стадия станции выводится из построек, а не читается из поля `phase`.
 *
 * В сохранениях 0.1.x этого поля не было вовсе, а база со складом уже стояла: при
 * загрузке такая станция считалась «участком» — склад не принимал груз, и
 * командный центр было не построить даже с материалами на руках. Постройки
 * описывают ту же стадию, но никогда не расходятся с тем, что реально стоит на
 * площадке, поэтому источник правды — они.
 */
export function stationPhaseOf(station: PlayerStation): StationPhase {
  const buildings = station.buildings ?? {};
  if ((buildings.commandCenter ?? 0) > 0) return 'operational';
  // Склад — первый шаг воронки: он же превращает голый участок в стройплощадку.
  if ((buildings.warehouse ?? 0) > 0 || station.construction?.building === 'warehouse') {
    return 'foundation';
  }
  // Другие постройки без склада бывают только в старых сейвах: база уже стоит.
  if (Object.values(buildings).some((level) => (level ?? 0) > 0)) return 'foundation';
  return 'planned';
}

/** Склад появляется только вместе с закладкой: до неё хранить нечего и негде. */
export function storageCapacity(station: PlayerStation): number {
  if (stationPhaseOf(station) === 'planned') return 0;
  return BASE_STORAGE + warehouseCapacity(station.buildings.warehouse ?? 0);
}

/**
 * Работает ли склад базы как услуга станции.
 *
 * Новым базам склад открывает постройка Склада. У станции старого образца
 * (`sitePlanetId` пуст — она досталась от 0.1.x) склад был изначально: там
 * считались только базовые 120 единиц, и постройки Склада никто не требовал.
 * Если спрятать такой склад, груз на базе становится недоступен через интерфейс,
 * а КЦ не построить: материалы некуда выгрузить.
 */
export function stationHasStorage(station: PlayerStation): boolean {
  if (stationPhaseOf(station) === 'planned') return false;
  return (station.buildings.warehouse ?? 0) > 0 || !station.sitePlanetId;
}

export function storageUsed(station: PlayerStation): number {
  let total = 0;
  for (const value of Object.values(station.storage)) total += value ?? 0;
  return total;
}

export function storageFree(station: PlayerStation): number {
  return Math.max(0, storageCapacity(station) - storageUsed(station));
}

/** Adds to station storage, dropping whatever does not fit. */
export function addStorage(state: GameState, amounts: Partial<Record<ResourceId, number>>): { added: number; lost: number } {
  let added = 0;
  let lost = 0;
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    const free = storageFree(state.station);
    const fit = Math.min(qty, free);
    if (fit > 0) {
      state.station.storage[id] = (state.station.storage[id] ?? 0) + fit;
      added += fit;
    }
    lost += qty - fit;
  }
  return { added, lost };
}

export function removeStorage(state: GameState, amounts: Partial<Record<ResourceId, number>>): boolean {
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    if ((state.station.storage[id] ?? 0) < qty) return false;
  }
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    const left = (state.station.storage[id] ?? 0) - qty;
    if (left <= 0) delete state.station.storage[id];
    else state.station.storage[id] = left;
  }
  return true;
}

/** Building slots used by everything except the Command Center itself. */
export function slotsUsed(station: PlayerStation): number {
  let used = 0;
  for (const [type, level] of Object.entries(station.buildings) as [keyof PlayerStation['buildings'], number][]) {
    if (type === 'commandCenter') continue;
    if (level > 0) used += 1;
  }
  return used;
}

export function trainableResearch(station: PlayerStation): { level: number; cost: number }[] {
  return [1, 2, 3].map((level) => ({
    level,
    cost: level === 1 ? 2400 : level === 2 ? 6800 : 16000,
  })).filter(() => station.buildings.researchLab > 0);
}

export function processStation(state: GameState): void {
  const station = state.station;
  const now = state.gameTime;

  if (station.construction && now >= station.construction.finishAt) {
    const job = station.construction;
    // Стадия до стройки: КЦ Mk1 вводит базу в строй именно из «стройплощадки».
    const wasFoundation = stationPhaseOf(station) === 'foundation';
    station.buildings[job.building] = job.targetLevel;
    if (job.building === 'commandCenter') station.level = job.targetLevel;
    station.construction = null;
    state.player.stats.built += 1;
    const def = buildingDef(job.building);
    addToast(state, `${def.name} Mk ${job.targetLevel} введён в строй.`, 'good');
    addNews(
      state,
      `${station.name}: построено «${def.name} Mk ${job.targetLevel}».`,
      'station',
      station.systemId,
      state.systems[station.systemId]?.factionId ?? null,
    );
    // Базовая станция: закладка превращается в действующий узел, включая бонус
    // площадки. До этого уровня станция считается стройплощадкой.
    if (job.building === 'commandCenter' && wasFoundation) {
      const site = station.sitePlanetId
        ? state.systems[station.systemId]?.planets.find((p) => p.id === station.sitePlanetId)
        : null;
      addToast(state, `${station.name} введена в строй. Бонус площадки активен.`, 'good');
      addNews(
        state,
        `${station.name} начала работу${site ? ` у ${site.name}` : ''}: доки, склад и переработка приносят профильный бонус планеты.`,
        'station',
        station.systemId,
      );
    }
    // Поле стадии следует за постройками: сейв никогда не расходится с площадкой,
    // и КЦ Mk2 открывается сразу после ввода базы в строй.
    station.phase = stationPhaseOf(station);
  }

  for (let i = station.production.length - 1; i >= 0; i -= 1) {
    const job = station.production[i];
    if (now < job.finishAt) continue;
    const def = recipe(job.recipeId);
    if (!def) {
      station.production.splice(i, 1);
      continue;
    }
    const { added, lost } = addStorage(state, def.output);
    if (lost > 0) {
      addToast(state, `Склад переполнен: потеряно ${lost} ед. продукции переработки.`, 'bad');
    }
    if (added > 0) {
      const outputList = Object.entries(def.output)
        .map(([id, qty]) => `${qty} ${resourceSymbol(id as ResourceId)}`)
        .join(', ');
      addToast(state, `Переработка завершена: ${outputList}.`, 'good');
    }
    if (job.repeat && removeStorage(state, def.input)) {
      job.startedAt = job.finishAt;
      job.finishAt = job.finishAt + def.seconds;
    } else {
      station.production.splice(i, 1);
      if (job.repeat) addToast(state, 'Переработка простаивает: закончилось сырьё.', 'bad');
    }
  }
}

/** Mineable resources the station can process, used by the UI hints. */
export function stationProcesses(): ResourceId[] {
  return MINEABLE.slice();
}
