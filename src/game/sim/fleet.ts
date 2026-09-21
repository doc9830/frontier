import type { GameState, ResourceId, Ship } from '../types.ts';
import { fleetLimit } from '../data/buildings.ts';
import { addCargo, cargoFree, removeCargo, shipStats } from '../ships/ship.ts';
import { runtimeRng } from '../rng.ts';
import {
  availableStock,
  applyBuy,
  applySell,
  playerBuyPrice,
  playerSellPrice,
} from '../economy/market.ts';
import { missionTravelSeconds } from '../exploration/travel.ts';
import { resourceSymbol } from '../data/resources.ts';
import { MINING_CYCLE_SECONDS, BELT_APPROACH_SECONDS, beltById, miningBonus, miningYieldPerCycle } from './mining.ts';
import { addStorage } from './station.ts';
import { beltReserve, MIN_BELT_RESERVE } from '../data/belts.ts';
import { stationPhase } from '../site/site.ts';
import { marketAccessInSystem } from '../actions/trade.ts';
import { addToast } from './toast.ts';
import { addNews } from '../news/news.ts';
import { reputationOf } from '../factions/reputation.ts';

/**
 * Fleet missions. Ships other than the flagship run on autopilot: mining stints,
 * trade routes and escort patrols. They refuel at the home outpost for free, so
 * mission economics stay readable; the cost of a fleet is the hull itself.
 */

export function fleetCap(state: GameState): number {
  return fleetLimit(state.station.level, state.station.buildings.fleetOffice ?? 0);
}

export function fleetShips(state: GameState): Ship[] {
  return state.ships.filter((s) => s.id !== state.player.shipId);
}

export function missionSlots(state: GameState): { used: number; cap: number } {
  const missionBuildings = state.station.buildings.miningHub ?? 0;
  const used = fleetShips(state).filter((s) => s.mission !== null).length;
  const cap = Math.max(1, fleetCap(state) - 1) + missionBuildings;
  return { used, cap };
}

function hop(state: GameState, fromId: string, toId: string, speed: number): number {
  const from = state.systems[fromId];
  const to = state.systems[toId];
  if (!from || !to) return 30;
  return missionTravelSeconds(from, to, speed);
}

export function assignMineMission(
  state: GameState,
  ship: Ship,
  beltId: string,
  cycles: number,
): boolean {
  const found = beltById(state, beltId);
  if (!found) {
    addToast(state, 'Пояс не найден.', 'bad');
    return false;
  }
  if (!found.belt.discovered) {
    addToast(state, `Пояс ${found.belt.name} не нанесён на карты: нужна разведка пояса.`, 'bad');
    return false;
  }
  if (stationPhase(state) === 'planned') {
    addToast(state, 'Сначала заложите склад: сгружать руду пока некуда.', 'bad');
    return false;
  }
  if (shipStats(ship).mining <= 0) {
    addToast(state, `${ship.name} без бурового оборудования.`, 'bad');
    return false;
  }
  const homeSystemId = state.station.systemId || state.player.homeSystemId;
  ship.mission = {
    kind: 'mine',
    beltId,
    beltSystemId: found.systemId,
    homeSystemId,
    phase: 'outbound',
    arriveAt: state.gameTime + hop(state, ship.systemId, found.systemId, shipStats(ship).speed),
    workUntil: 0,
    cyclesLeft: Math.max(1, cycles),
    expected: {},
    plan: {},
    hauled: {},
    piece: 1,
  };
  ship.travel = null;
  ship.status = 'mining';
  addToast(state, `${ship.name} назначен в пояс ${found.belt.name} (рейсов: ${Math.max(1, cycles)}).`, 'info');
  return true;
}

export function assignTradeMission(
  state: GameState,
  ship: Ship,
  resourceId: ResourceId,
  buySystemId: string,
  sellSystemId: string,
  cycles: number,
): boolean {
  if (buySystemId === sellSystemId) {
    addToast(state, 'Выберите две разные системы для торгового маршрута.', 'bad');
    return false;
  }
  const buyAccess = marketAccessInSystem(state, buySystemId);
  if (!buyAccess.ok) {
    addToast(state, buyAccess.reason ?? 'В системе закупки нет рынка.', 'bad');
    return false;
  }
  const sellAccess = marketAccessInSystem(state, sellSystemId);
  if (!sellAccess.ok) {
    addToast(state, sellAccess.reason ?? 'В системе продажи нет рынка.', 'bad');
    return false;
  }
  const stats = shipStats(ship);
  ship.mission = {
    kind: 'trade',
    resource: resourceId,
    buySystemId,
    sellSystemId,
    qty: 0,
    cyclesLeft: Math.max(1, cycles),
    phase: 'toBuy',
    arriveAt: state.gameTime + hop(state, ship.systemId, buySystemId, stats.speed),
    profit: 0,
  };
  ship.travel = null;
  ship.status = 'trading';
  addToast(
    state,
    `${ship.name} возит ${resourceSymbol(resourceId)} между системами ${state.systems[buySystemId]?.name} и ${state.systems[sellSystemId]?.name}.`,
    'info',
  );
  return true;
}

export function assignEscortMission(state: GameState, ship: Ship): boolean {
  ship.mission = { kind: 'escort', targetShipId: state.player.shipId };
  ship.status = 'escort';
  ship.travel = null;
  addToast(state, `${ship.name} назначен в эскорт в системе ${state.systems[ship.systemId]?.name}.`, 'info');
  return true;
}

export function clearMission(state: GameState, ship: Ship): void {
  if (!ship.mission) return;
  ship.mission = null;
  ship.status = 'docked';
  addToast(state, `${ship.name} освобождён от задания.`, 'info');
}

/** Escort ships docked in the same system cut the risk of a jump. */
export function escortBonus(state: GameState, systemId: string): number {
  let bonus = 0;
  for (const ship of fleetShips(state)) {
    if (ship.mission?.kind !== 'escort') continue;
    if (ship.systemId !== systemId) continue;
    bonus += Math.min(0.08, shipStats(ship).combat * 0.01);
  }
  return Math.min(0.25, bonus);
}

/**
 * Runs one autopilot ship. Mining ships loop belt → home → belt; traders loop
 * buy → sell. A finished route leaves the ship where it stopped: the next
 * assignment always starts from the ship's current system.
 */
export function processFleetShip(state: GameState, ship: Ship): void {
  const mission = ship.mission;
  if (!mission || mission.kind === 'escort') return;
  const now = state.gameTime;
  const stats = shipStats(ship);

  if (mission.kind === 'mine') {
    const beltInfo = beltById(state, mission.beltId);
    if (!beltInfo) {
      ship.mission = null;
      ship.status = 'docked';
      return;
    }
    if (mission.phase === 'outbound') {
      if (now < mission.arriveAt) return;
      ship.systemId = mission.beltSystemId;
      ship.status = 'mining';
      mission.phase = 'working';
      mission.workUntil = now + BELT_APPROACH_SECONDS;
      return;
    }
    if (mission.phase === 'working') {
      let guard = 0;
      while (now >= mission.workUntil && guard < 120) {
        guard += 1;
        mission.workUntil += MINING_CYCLE_SECONDS;
        const output = miningYieldPerCycle(ship, beltInfo.belt, miningBonus(state));
        const reserve = beltReserve(beltInfo.belt);
        let total = 0;
        for (const [id, qty] of Object.entries(output) as [ResourceId, number][]) {
          const wanted = reserve > MIN_BELT_RESERVE ? Math.min(qty, reserve - total) : 0;
          if (wanted <= 0) continue;
          const added = addCargo(ship, id, wanted);
          total += added;
          mission.expected[id] = (mission.expected[id] ?? 0) + added;
          mission.hauled[id] = (mission.hauled[id] ?? 0) + added;
        }
        if (total > 0) beltInfo.belt.reserve = Math.max(0, reserve - total);
        ship.minedUnits += total;
        state.player.stats.mined += total;
        if (total <= 0 || cargoFree(ship) <= 0 || beltReserve(beltInfo.belt) <= MIN_BELT_RESERVE) break;
      }
      if (beltReserve(beltInfo.belt) <= MIN_BELT_RESERVE) {
        addToast(state, `Пояс ${beltInfo.belt.name} выработан: ${ship.name} возвращается.`, 'bad');
      }
      if (cargoFree(ship) <= 0 || guard >= 120 || beltReserve(beltInfo.belt) <= MIN_BELT_RESERVE) {
        mission.phase = 'inbound';
        mission.arriveAt =
          Math.max(now, mission.workUntil) +
          hop(state, ship.systemId, mission.homeSystemId, stats.speed);
        ship.status = 'transit';
      }
      return;
    }
    // inbound: unload, then start the next loop or stand down
    if (now < mission.arriveAt) return;
    ship.systemId = mission.homeSystemId;
    const { added, lost } = addStorage(state, ship.cargo);
    ship.cargo = {};
    mission.cyclesLeft -= 1;
    if (lost > 0) addToast(state, `Склад форпоста переполнен: сброшено ${lost} ед.`, 'bad');
    if (mission.cyclesLeft > 0 && beltReserve(beltInfo.belt) > MIN_BELT_RESERVE) {
      mission.phase = 'outbound';
      mission.arriveAt = now + hop(state, ship.systemId, mission.beltSystemId, stats.speed);
      ship.status = 'transit';
      addToast(state, `${ship.name} выгрузил ${added} ед. и возвращается к поясу.`, 'good');
      return;
    }
    ship.mission = null;
    ship.status = 'docked';
    addToast(
      state,
      `${ship.name} завершил добывающий контракт (последний рейс — ${added} ед.).`,
      'good',
    );
    addNews(
      state,
      `${ship.name} доставил полный трюм на станцию ${state.station.name}.`,
      'mining',
      state.station.systemId,
      state.systems[state.station.systemId]?.factionId ?? null,
    );
    return;
  }

  // --- trade route ----------------------------------------------------------
  if (now < mission.arriveAt) return;
  if (mission.phase === 'toBuy') {
    ship.systemId = mission.buySystemId;
    const system = state.systems[mission.buySystemId];
    const price = playerBuyPrice(
      system.market,
      mission.resource,
      reputationOf(state, system.factionId),
    );
    const units = Math.min(
      cargoFree(ship),
      availableStock(system.market, mission.resource),
      Math.floor(state.player.credits / Math.max(1, price)),
    );
    if (units <= 0) {
      addToast(
        state,
        `${ship.name} не нашёл ${resourceSymbol(mission.resource)} или не хватило кредитов. Маршрут отменён.`,
        'bad',
      );
      ship.mission = null;
      ship.status = 'docked';
      return;
    }
    applyBuy(system.market, mission.resource, units);
    state.player.credits -= units * price;
    addCargo(ship, mission.resource, units);
    mission.qty = units;
    mission.phase = 'toSell';
    mission.arriveAt = now + hop(state, ship.systemId, mission.sellSystemId, stats.speed);
    ship.status = 'transit';
    return;
  }

  ship.systemId = mission.sellSystemId;
  const system = state.systems[mission.sellSystemId];
  const price = playerSellPrice(
    system.market,
    mission.resource,
    reputationOf(state, system.factionId),
  );
  const units = removeCargo(ship, mission.resource, mission.qty || Infinity);
  applySell(system.market, mission.resource, units);
  const revenue = units * price;
  state.player.credits += revenue;
  state.player.stats.trades += 1;
  state.player.stats.earned += revenue;
  ship.tradedCredits += revenue;
  mission.profit += revenue;
  mission.cyclesLeft -= 1;

  if (!survivesPiracy(state, ship)) return;

  if (mission.cyclesLeft > 0) {
    mission.phase = 'toBuy';
    mission.arriveAt = now + hop(state, ship.systemId, mission.buySystemId, stats.speed);
    ship.status = 'transit';
    return;
  }
  addToast(state, `${ship.name} завершил маршрут с выручкой ${mission.profit} кр.`, 'good');
  ship.mission = null;
  ship.status = 'docked';
}

/** Fleets are not immortal: a combat-poor freighter can be lost on a route. */
function survivesPiracy(state: GameState, ship: Ship): boolean {
  const power = shipStats(ship).combat;
  const chance = 0.025 + Math.min(0.05, (100 - Math.min(100, power * 4)) * 0.0006);
  if (!runtimeRng.chance(chance)) return true;
  if (runtimeRng.chance(Math.min(0.92, 0.3 + power * 0.06))) {
    addToast(state, `${ship.name} отбился от пиратов на трассе.`, 'info');
    return true;
  }
  const system = state.systems[ship.systemId];
  state.ships = state.ships.filter((s) => s.id !== ship.id);
  addToast(
    state,
    `${ship.name} уничтожен пиратами в системе ${system?.name ?? 'глубокий космос'}.`,
    'bad',
  );
  addNews(
    state,
    `${ship.name} погиб вместе с экипажем от пиратов рядом с системой ${system?.name ?? 'Фронтир'}.`,
    'piracy',
    system?.id ?? null,
    system?.factionId ?? null,
  );
  return false;
}

