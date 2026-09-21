import type { Amounts, AsteroidBelt, GameState, Grade, Mission, ResourceId, Ship } from '../types.ts';
import { gradeMultiplier } from '../universe/generate.ts';
import { addCargo, cargoFree, shipStats } from '../ships/ship.ts';
import { addToast } from './toast.ts';
import { addNews } from '../news/news.ts';
import { beltReserve, MIN_BELT_RESERVE } from '../data/belts.ts';
import { siteMiningBonus } from '../site/site.ts';
import { resourceName } from '../data/resources.ts';

/**
 * Добыча. Вахта — это набор заходов бура с фиксированной длительностью, поэтому
 * игрок видит прогресс, может задать план по количеству и остановиться в любой
 * момент. Пояс не бесконечен: у него есть запас, который вычитается за каждый
 * поднятый юнит.
 */

/** Один заход бура. */
export const MINING_CYCLE_SECONDS = 12;
/** Travel time from the jump point to the belt itself. */
export const BELT_APPROACH_SECONDS = 5;
/** Сколько заходов можно «догнать» за один тик симуляции (защита от спирали). */
const MAX_CATCHUP_PIECES = 64;

export type MineMission = Extract<Mission, { kind: 'mine' }>;

export type MineStopKind = 'plan' | 'full' | 'depleted' | 'empty';

export interface MineStop {
  kind: MineStopKind;
  text: string;
}

export function miningBonus(state: GameState): number {
  const research = state.station.research.mining * 0.05;
  const hub = (state.station.buildings.miningHub ?? 0) * 0.15;
  return research + hub + siteMiningBonus(state);
}

export function sumAmounts(amounts: Amounts): number {
  let total = 0;
  for (const value of Object.values(amounts)) total += value ?? 0;
  return total;
}

/** Units pulled out of the belt in one cycle, split by the belt grades. */
export function miningYieldPerCycle(ship: Ship, belt: AsteroidBelt, bonus: number): Amounts {
  const stats = shipStats(ship);
  const entries = Object.entries(belt.grades) as [ResourceId, Grade][];
  if (entries.length === 0 || stats.mining <= 0) return {};
  const weights = entries.map(([id, grade]) => ({ id, weight: gradeMultiplier(grade) }));
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  // Небольшая база: даже слабый бур даёт заметный залп, иначе старт немой.
  const totalUnits = (2 + stats.mining * 1.1) * belt.richness * (1 + bonus);
  const output: Amounts = {};
  for (const entry of weights) {
    const units = Math.max(1, Math.round((totalUnits * entry.weight) / totalWeight));
    output[entry.id] = units;
  }
  return output;
}

export function beltById(
  state: GameState,
  beltId: string,
): { belt: AsteroidBelt; systemId: string } | null {
  for (const id of state.systemIds) {
    const system = state.systems[id];
    const belt = system?.belts.find((b) => b.id === beltId);
    if (belt && system) return { belt, systemId: system.id };
  }
  return null;
}

/**
 * Что корабль успеет набрать за одну вахту: трюм, запас пояса и пропорции
 * пояса по ресурсам. Именно это количество панель предлагает по умолчанию.
 */
export function miningCapacity(state: GameState, ship: Ship, belt: AsteroidBelt): Amounts {
  const out: Amounts = {};
  const usable = Math.min(cargoFree(ship), Math.max(0, beltReserve(belt) - MIN_BELT_RESERVE));
  if (usable <= 0) return out;
  const perCycle = miningYieldPerCycle(ship, belt, miningBonus(state));
  const entries = Object.entries(perCycle) as [ResourceId, number][];
  const total = entries.reduce((sum, [, qty]) => sum + qty, 0);
  if (total <= 0) return out;
  let left = usable;
  for (const [id, qty] of entries) {
    if (left <= 0) break;
    const share = Math.min(left, Math.max(1, Math.floor((usable * qty) / total)));
    out[id] = share;
    left -= share;
  }
  return out;
}

export function missionRemaining(mission: MineMission): Amounts {
  const plan = mission.plan ?? {};
  const hauled = mission.hauled ?? {};
  const out: Amounts = {};
  for (const [id, qty] of Object.entries(plan) as [ResourceId, number][]) {
    if (!qty) continue;
    out[id] = Math.max(0, qty - (hauled[id] ?? 0));
  }
  return out;
}

/**
 * План вахты из одного числа: «набурить всего N единиц». Раскладывается по
 * составу пояса пропорционально тому, сколько влезает в трюм.
 */
export function planFromTotal(
  state: GameState,
  ship: Ship,
  belt: AsteroidBelt,
  total: number,
): Amounts {
  const capacity = miningCapacity(state, ship, belt);
  const capacityTotal = sumAmounts(capacity);
  if (capacityTotal <= 0 || total <= 0) return {};
  const factor = Math.min(1, total / capacityTotal);
  const out: Amounts = {};
  for (const [id, qty] of Object.entries(capacity) as [ResourceId, number][]) {
    out[id] = Math.max(1, Math.round(qty * factor));
  }
  return out;
}

export function missionPlannedTotal(mission: MineMission): number {
  return sumAmounts(mission.plan ?? {});
}

export function missionHauledTotal(mission: MineMission): number {
  return sumAmounts(mission.hauled ?? {});
}

/** «8 × Руда, 4 × Газ» — короткая сводка трюма для тостов и панелей. */
export function amountsSummary(amounts: Amounts): string {
  const parts = (Object.entries(amounts) as [ResourceId, number][])
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${qty} × ${resourceName(id)}`);
  return parts.length > 0 ? parts.join(', ') : 'пусто';
}

/**
 * Старт вахты. `plan` — сколько единиц каждого ресурса набурить; если он не
 * задан, корабль работает до полного трюма (столько, сколько влезает).
 */
export function startMining(
  state: GameState,
  ship: Ship,
  beltId: string,
  plan?: Amounts | null,
): boolean {
  const found = beltById(state, beltId);
  if (!found) {
    addToast(state, 'Пояс не найден.', 'bad');
    return false;
  }
  if (ship.systemId !== found.systemId) {
    addToast(state, 'Этот пояс в другой системе. Сначала прыжок.', 'bad');
    return false;
  }
  if (!found.belt.discovered) {
    addToast(state, 'Этот пояс ещё не нанесён на карты. Нужна разведка пояса.', 'bad');
    return false;
  }
  if (state.survey) {
    addToast(state, 'Сканер занят: сначала закончите или прервите сканирование.', 'bad');
    return false;
  }
  const stats = shipStats(ship);
  if (stats.mining <= 0) {
    addToast(state, 'На этом корабле нет бурового оборудования.', 'bad');
    return false;
  }
  if (cargoFree(ship) <= 0) {
    addToast(state, 'Трюм уже полон.', 'bad');
    return false;
  }
  const capacity = miningCapacity(state, ship, found.belt);
  if (sumAmounts(capacity) <= 0) {
    addToast(state, `Пояс ${found.belt.name} выработан: бурить больше нечего.`, 'bad');
    return false;
  }

  let target: Amounts = {};
  if (plan && sumAmounts(plan) > 0) {
    for (const [id, qty] of Object.entries(plan) as [ResourceId, number][]) {
      if (!qty || qty <= 0) continue;
      if (!found.belt.grades[id]) {
        addToast(state, `В поясе ${found.belt.name} нет «${resourceName(id)}».`, 'bad');
        return false;
      }
      const allowed = Math.min(Math.floor(qty), capacity[id] ?? 0);
      if (allowed > 0) target[id] = allowed;
    }
    if (sumAmounts(target) <= 0) {
      addToast(state, 'Указанное количество не влезает в трюм или превышает запас пояса.', 'bad');
      return false;
    }
  } else {
    target = capacity;
  }

  ship.status = 'mining';
  ship.travel = null;
  ship.mission = {
    kind: 'mine',
    beltId: found.belt.id,
    beltSystemId: found.systemId,
    homeSystemId: state.player.homeSystemId,
    phase: 'working',
    arriveAt: state.gameTime + BELT_APPROACH_SECONDS,
    workUntil: state.gameTime + BELT_APPROACH_SECONDS,
    cyclesLeft: 999,
    expected: {},
    plan: target,
    hauled: {},
    piece: 1,
  };
  addToast(
    state,
    `План вахты в поясе ${found.belt.name}: ${amountsSummary(target)}. Прогресс и остановка — во вкладке СИСТЕМА.`,
    'info',
  );
  return true;
}

export function stopMining(state: GameState, ship: Ship): void {
  if (ship.mission?.kind !== 'mine') return;
  const hauled = missionHauledTotal(ship.mission);
  ship.mission = null;
  ship.status = 'docked';
  addToast(
    state,
    hauled > 0
      ? `Добыча остановлена. В трюме ${hauled} ед. — можно везти на рынок или на склад.`
      : 'Добыча остановлена.',
    'info',
  );
}

/** Один заход бура. Возвращает причину остановки или null, если вахта идёт. */
function drillPiece(
  state: GameState,
  ship: Ship,
  belt: AsteroidBelt,
  mission: MineMission,
  bonus: number,
): MineStop | null {
  const reserve = beltReserve(belt);
  if (reserve <= MIN_BELT_RESERVE) {
    return { kind: 'depleted', text: `Пояс ${belt.name} выработан полностью.` };
  }
  const planned = Object.keys(mission.plan ?? {}).length > 0;
  const need = missionRemaining(mission);
  if (planned && sumAmounts(need) <= 0) {
    return { kind: 'plan', text: 'План вахты выполнен.' };
  }

  const cycle = miningYieldPerCycle(ship, belt, bonus);
  const capped: Amounts = {};
  let want = 0;
  for (const [id, qty] of Object.entries(cycle) as [ResourceId, number][]) {
    const limit = planned ? Math.min(qty, need[id] ?? qty) : qty;
    if (limit > 0) {
      capped[id] = limit;
      want += limit;
    }
  }
  if (want > reserve) {
    const factor = reserve / Math.max(1, want);
    for (const [id, qty] of Object.entries(capped) as [ResourceId, number][]) {
      capped[id] = Math.max(1, Math.floor(qty * factor));
    }
  }

  let mined = 0;
  for (const [id, qty] of Object.entries(capped) as [ResourceId, number][]) {
    const added = addCargo(ship, id, qty);
    if (added <= 0) continue;
    mined += added;
    mission.expected[id] = (mission.expected[id] ?? 0) + added;
    mission.hauled[id] = (mission.hauled[id] ?? 0) + added;
  }
  mission.piece += 1;
  if (mined > 0) {
    belt.reserve = Math.max(0, reserve - mined);
    ship.minedUnits += mined;
    state.player.stats.mined += mined;
  }

  if (mined <= 0 || cargoFree(ship) <= 0) {
    return { kind: 'full', text: `Трюм полон после пояса ${belt.name}. Груз можно продать.` };
  }
  if (beltReserve(belt) <= MIN_BELT_RESERVE) {
    return { kind: 'depleted', text: `Пояс ${belt.name} выработан полностью.` };
  }
  if (planned && sumAmounts(missionRemaining(mission)) <= 0) {
    return { kind: 'plan', text: 'План вахты выполнен.' };
  }
  return null;
}

export function finishMining(
  state: GameState,
  ship: Ship,
  belt: AsteroidBelt,
  stop: MineStop,
): void {
  const mission = ship.mission;
  if (mission?.kind !== 'mine') return;
  const hauled = missionHauledTotal(mission);
  ship.mission = null;
  ship.status = 'docked';
  addToast(state, `${stop.text} Поднято ${hauled} ед.`, stop.kind === 'empty' ? 'bad' : 'good');
  if (hauled > 0) {
    addNews(
      state,
      `${ship.name} завершил вахту в поясе ${belt.name}: ${hauled} ед. руды в трюме.`,
      'mining',
      belt.systemId,
      state.systems[belt.systemId]?.factionId ?? null,
    );
  }
}

/** Ticks the drilling rig of a mining ship. */
export function processMining(state: GameState, ship: Ship): void {
  const mission = ship.mission;
  if (!mission || mission.kind !== 'mine') return;
  const found = beltById(state, mission.beltId);
  if (!found) {
    ship.mission = null;
    ship.status = 'docked';
    return;
  }
  mission.plan = mission.plan ?? {};
  mission.hauled = mission.hauled ?? {};
  mission.piece = mission.piece ?? 1;
  if (state.gameTime < mission.workUntil) return;

  const bonus = miningBonus(state);
  let pieces = 0;
  while (
    ship.mission === mission &&
    state.gameTime >= mission.workUntil &&
    pieces < MAX_CATCHUP_PIECES
  ) {
    pieces += 1;
    mission.workUntil += MINING_CYCLE_SECONDS;
    const stop = drillPiece(state, ship, found.belt, mission, bonus);
    if (stop) {
      finishMining(state, ship, found.belt, stop);
      return;
    }
  }
}

export interface MiningStatus {
  belt: AsteroidBelt;
  phase: 'approach' | 'drilling';
  piece: number;
  /** Прогресс текущего захода, 0..1. */
  pieceProgress: number;
  pieceLeft: number;
  /** Прогресс подхода к поясу, 0..1 (для фазы 'approach'). */
  approachProgress: number;
  approachLeft: number;
  plan: Amounts;
  hauled: Amounts;
  plannedTotal: number;
  hauledTotal: number;
  /** Прогресс всей вахты, 0..1. */
  progress: number;
  cargoFree: number;
  reserveLeft: number;
  exhausted: boolean;
}

/** Состояние вахты для интерфейса: прогресс, план, остаток пояса. */
export function miningStatus(state: GameState, ship: Ship): MiningStatus | null {
  const mission = ship.mission;
  if (!mission || mission.kind !== 'mine') return null;
  const found = beltById(state, mission.beltId);
  if (!found) return null;
  const plan = mission.plan ?? {};
  const hauled = mission.hauled ?? {};
  const plannedTotal = sumAmounts(plan);
  const hauledTotal = sumAmounts(hauled);
  const pieceStart = mission.workUntil - MINING_CYCLE_SECONDS;
  const pieceProgress =
    state.gameTime <= pieceStart
      ? 0
      : Math.min(1, Math.max(0, (state.gameTime - pieceStart) / MINING_CYCLE_SECONDS));
  const approachLeft = Math.max(0, mission.arriveAt - state.gameTime);
  return {
    belt: found.belt,
    phase: state.gameTime < mission.arriveAt ? 'approach' : 'drilling',
    piece: mission.piece ?? 1,
    pieceProgress,
    pieceLeft: Math.max(0, Math.ceil(mission.workUntil - state.gameTime)),
    approachProgress: Math.min(1, Math.max(0, 1 - approachLeft / BELT_APPROACH_SECONDS)),
    approachLeft: Math.ceil(approachLeft),
    plan,
    hauled,
    plannedTotal,
    hauledTotal,
    progress: plannedTotal > 0 ? Math.min(1, hauledTotal / plannedTotal) : 0,
    cargoFree: cargoFree(ship),
    reserveLeft: beltReserve(found.belt),
    exhausted: beltReserve(found.belt) <= MIN_BELT_RESERVE,
  };
}
