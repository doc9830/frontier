import type { Amounts, AsteroidBelt, GameState, Grade, ResourceId, Ship } from '../types.ts';
import { gradeMultiplier } from '../universe/generate.ts';
import { addCargo, cargoFree, shipStats } from '../ships/ship.ts';
import { addToast } from './toast.ts';
import { addNews } from '../news/news.ts';

/** One drilling cycle. Mining is not interactive: the ship just works. */
export const MINING_CYCLE_SECONDS = 10;
/** Travel time from the jump point to the belt itself. */
export const BELT_APPROACH_SECONDS = 5;

export function miningBonus(state: GameState): number {
  const research = state.station.research.mining * 0.05;
  const hub = (state.station.buildings.miningHub ?? 0) * 0.15;
  return research + hub;
}

/** Units pulled out of the belt in one cycle, split by the belt grades. */
export function miningYieldPerCycle(
  ship: Ship,
  belt: AsteroidBelt,
  bonus: number,
): Amounts {
  const stats = shipStats(ship);
  const entries = Object.entries(belt.grades) as [ResourceId, Grade][];
  if (entries.length === 0 || stats.mining <= 0) return {};
  const weights = entries.map(([id, grade]) => ({
    id,
    weight: gradeMultiplier(grade),
  }));
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const totalUnits = stats.mining * 1.4 * belt.richness * (1 + bonus);
  const output: Amounts = {};
  for (const entry of weights) {
    const units = Math.max(1, Math.round((totalUnits * entry.weight) / totalWeight));
    output[entry.id] = units;
  }
  return output;
}

export function beltById(state: GameState, beltId: string): { belt: AsteroidBelt; systemId: string } | null {
  for (const id of state.systemIds) {
    const system = state.systems[id];
    const belt = system?.belts.find((b) => b.id === beltId);
    if (belt && system) return { belt, systemId: system.id };
  }
  return null;
}

/**
 * Starts a mining stint. The player mines until the hold is full or until the
 * mission is cancelled from the UI.
 */
export function startMining(state: GameState, ship: Ship, beltId: string): boolean {
  const found = beltById(state, beltId);
  if (!found) {
    addToast(state, 'Пояс не найден.', 'bad');
    return false;
  }
  if (ship.systemId !== found.systemId) {
    addToast(state, `${found.belt.name} is in another system. Jump there first.`, 'bad');
    return false;
  }
  if (!found.belt.discovered) {
    addToast(state, 'Этот пояс ещё не нанесён на карты.', 'bad');
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
  };
  addToast(state, `Бурение в поясе ${found.belt.name}. Трюм наполняется с каждым залпом.`, 'info');
  return true;
}

export function stopMining(state: GameState, ship: Ship): void {
  if (ship.mission?.kind !== 'mine') return;
  ship.mission = null;
  ship.status = 'docked';
  addToast(state, 'Добыча остановлена. Руда лежит в трюме.', 'info');
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
  const bonus = miningBonus(state);
  let cycles = 0;
  while (ship.mission && state.gameTime >= mission.workUntil && cycles < 40) {
    cycles += 1;
    mission.workUntil += MINING_CYCLE_SECONDS;
    const output = miningYieldPerCycle(ship, found.belt, bonus);
    let mineTotal = 0;
    for (const [id, qty] of Object.entries(output) as [ResourceId, number][]) {
      const added = addCargo(ship, id, qty);
      mineTotal += added;
      mission.expected[id] = (mission.expected[id] ?? 0) + added;
    }
    ship.minedUnits += mineTotal;
    state.player.stats.mined += mineTotal;
    mission.cyclesLeft = Math.max(0, mission.cyclesLeft - 1);
    if (mineTotal === 0 || cargoFree(ship) <= 0) {
      ship.mission = null;
      ship.status = 'docked';
      addToast(state, `Трюм полон после пояса ${found.belt.name}. Руду можно продать.`, 'good');
      addNews(
        state,
        `${ship.name} вернулся из пояса ${found.belt.name} с полным трюмом.`,
        'mining',
        found.systemId,
        state.systems[found.systemId]?.factionId ?? null,
      );
      return;
    }
    if (mission.cyclesLeft <= 0) {
      ship.mission = null;
      ship.status = 'docked';
      return;
    }
  }
}
