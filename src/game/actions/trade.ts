import type { GameState, ResourceId, Ship } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { resource } from '../data/resources.ts';
import {
  applyBuy,
  applySell,
  availableStock,
  marketPrice,
  playerBuyPrice,
  playerSellPrice,
} from '../economy/market.ts';
import { addCargo, cargoFree, cargoUsed, removeCargo, shipStats } from '../ships/ship.ts';
import { addStorage, removeStorage, storageFree } from '../sim/station.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import {
  changeReputation,
  reputationOf,
  tradeReputationGain,
} from '../factions/reputation.ts';
import { shipType } from '../data/ships.ts';

/** Docking rules: markets only answer when you are parked at their station. */
export function atMarket(state: GameState): boolean {
  const ship = playerShip(state);
  if (!ship || ship.travel || ship.status === 'mining' || ship.status === 'transit') return false;
  const system = state.systems[ship.systemId];
  return !!system?.stations.some((s) => s.hasMarket);
}

/** Market Analysis research improves both sides of the spread. */
export function researchPriceBonus(state: GameState): number {
  return 1 + state.station.research.trade * 0.02;
}

export function buyPriceAt(state: GameState, id: ResourceId): number {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return 0;
  return Math.round(
    playerBuyPrice(system.market, id, reputationOf(state, system.factionId)) /
      researchPriceBonus(state),
  );
}

export function sellPriceAt(state: GameState, id: ResourceId): number {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return 0;
  return Math.round(
    playerSellPrice(system.market, id, reputationOf(state, system.factionId)) *
      researchPriceBonus(state),
  );
}

export function buyResource(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  if (!atMarket(state)) {
    addToast(state, 'Здесь нет рынка. Пристыкуйтесь к торговой станции.', 'bad');
    return 0;
  }
  const price = Math.round(
    playerBuyPrice(system.market, id, reputationOf(state, system.factionId)) /
      researchPriceBonus(state),
  );
  const units = Math.max(
    0,
    Math.min(
      Math.floor(qty),
      availableStock(system.market, id),
      cargoFree(ship),
      Math.floor(state.player.credits / Math.max(1, price)),
    ),
  );
  if (units <= 0) {
    addToast(state, 'Купить не получится: нет запаса, места или кредитов.', 'bad');
    return 0;
  }
  applyBuy(system.market, id, units);
  state.player.credits -= units * price;
  addCargo(ship, id, units);
  state.player.stats.trades += 1;
  const rep = changeReputation(state, system.factionId, tradeReputationGain(units));
  addToast(
    state,
    `Куплено ${units} ${resource(id).name} за ${units * price} кр.${rep > 0 ? ` Репутация +${rep}.` : ''}`,
    'info',
  );
  return units;
}

export function sellResource(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  if (!atMarket(state)) {
    addToast(state, 'Здесь нет рынка. Пристыкуйтесь к торговой станции.', 'bad');
    return 0;
  }
  const price = Math.round(
    playerSellPrice(system.market, id, reputationOf(state, system.factionId)) *
      researchPriceBonus(state),
  );
  const units = Math.min(Math.floor(qty), ship.cargo[id] ?? 0);
  if (units <= 0) {
    addToast(state, `В трюме нет «${resource(id).name}».`, 'bad');
    return 0;
  }
  removeCargo(ship, id, units);
  applySell(system.market, id, units);
  const revenue = units * price;
  state.player.credits += revenue;
  state.player.stats.earned += revenue;
  state.player.stats.trades += 1;
  ship.tradedCredits += revenue;
  const rep = changeReputation(state, system.factionId, tradeReputationGain(units));
  addToast(
    state,
    `Продано ${units} ${resource(id).name} за ${revenue} кр.${rep > 0 ? ` Репутация +${rep}.` : ''}`,
    'good',
  );
  return units;
}

/**
 * Sells goods straight from station storage. Only possible where the market is
 * open and only at your own station, because the goods sit in its warehouse.
 */
export function sellStoredResource(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  if (!atMarket(state)) {
    addToast(state, 'Здесь нет рынка. Пристыкуйтесь к торговой станции.', 'bad');
    return 0;
  }
  if (state.station.systemId !== ship.systemId) {
    addToast(state, 'Продавать со склада можно только на своей станции.', 'bad');
    return 0;
  }
  const stored = state.station.storage[id] ?? 0;
  const units = Math.min(Math.floor(qty), stored);
  if (units <= 0) {
    addToast(state, `На складе нет «${resource(id).name}».`, 'bad');
    return 0;
  }
  const price = Math.round(
    playerSellPrice(system.market, id, reputationOf(state, system.factionId)) *
      researchPriceBonus(state),
  );
  removeStorage(state, { [id]: units });
  applySell(system.market, id, units);
  const revenue = units * price;
  state.player.credits += revenue;
  state.player.stats.earned += revenue;
  state.player.stats.trades += 1;
  const rep = changeReputation(state, system.factionId, tradeReputationGain(units));
  addToast(
    state,
    `Со склада продано ${units} × ${resource(id).name} за ${revenue} кр.${rep > 0 ? ` Репутация +${rep}.` : ''}`,
    'good',
  );
  return units;
}

export function sellEverything(state: GameState): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  let total = 0;
  for (const id of Object.keys(ship.cargo) as ResourceId[]) {
    const units = ship.cargo[id] ?? 0;
    if (units > 0) total += sellResource(state, id, units);
  }
  return total;
}

/** Ship cargo → station storage (requires being at the home station). */
export function unloadToStation(state: GameState, id: ResourceId | null): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  if (ship.systemId !== state.station.systemId) {
    addToast(state, 'Разгрузить можно только на своей станции.', 'bad');
    return 0;
  }
  const ids = id ? [id] : (Object.keys(ship.cargo) as ResourceId[]);
  let moved = 0;
  let lost = 0;
  for (const key of ids) {
    const units = removeCargo(ship, key, ship.cargo[key] ?? 0);
    if (units <= 0) continue;
    const result = addStorage(state, { [key]: units });
    moved += result.added;
    lost += result.lost;
  }
  if (lost > 0) addToast(state, `Склад переполнен: потеряно ${lost} ед.`, 'bad');
  if (moved > 0) addToast(state, `Разгружено ${moved} ед. на склад «${state.station.name}».`, 'good');
  return moved;
}

/** Station storage → ship cargo. */
export function loadFromStation(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  if (ship.systemId !== state.station.systemId) {
    addToast(state, 'Загрузить груз можно только на своей станции.', 'bad');
    return 0;
  }
  const units = Math.min(Math.floor(qty), state.station.storage[id] ?? 0, cargoFree(ship));
  if (units <= 0) {
    addToast(state, 'Загружать нечего.', 'bad');
    return 0;
  }
  removeStorage(state, { [id]: units });
  addCargo(ship, id, units);
  addToast(state, `В трюм загружено: ${units} × ${resource(id).name}.`, 'info');
  return units;
}

export function serviceDiscount(state: GameState): { repair: number; refuel: number } {
  const dock = state.station.buildings.dock ?? 0;
  const shipyard = state.station.buildings.shipyard ?? 0;
  const atHome = playerShip(state)?.systemId === state.station.systemId;
  if (!atHome) return { repair: 1, refuel: 1 };
  return {
    repair: Math.max(0.3, 1 - dock * 0.1 - shipyard * 0.05),
    refuel: Math.max(0.3, 1 - dock * 0.08),
  };
}

export function refuelCost(state: GameState, ship: Ship): number {
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  const stats = shipStats(ship);
  const missing = Math.max(0, stats.fuelMax - ship.fuel);
  const unit = marketPrice(system.market, 'fuel');
  return Math.ceil(missing * unit * serviceDiscount(state).refuel);
}

export function repairCost(state: GameState, ship: Ship): number {
  const stats = shipStats(ship);
  const missing =
    Math.max(0, stats.hullMax - ship.hull) + Math.max(0, stats.shieldMax - ship.shield) * 0.5;
  const perHull = shipType(ship.typeId).price / 420;
  return Math.ceil(missing * perHull * serviceDiscount(state).repair);
}

export function refuelShip(state: GameState, ship: Ship, topUp = 40): number {
  const stats = shipStats(ship);
  const full = stats.fuelMax - ship.fuel <= topUp;
  const cost = Math.ceil(refuelCost(state, ship) * (full ? 1 : topUp / Math.max(1, stats.fuelMax - ship.fuel)));
  if (stats.fuelMax - ship.fuel <= 0) {
    addToast(state, 'Баки уже полны.', 'info');
    return 0;
  }
  if (state.player.credits < cost) {
    addToast(state, `Refuelling costs ${cost} cr, you have ${state.player.credits}.`, 'bad');
    return 0;
  }
  state.player.credits -= cost;
  ship.fuel = full ? stats.fuelMax : Math.min(stats.fuelMax, ship.fuel + topUp);
  addToast(state, `${ship.name} заправлен за ${cost} кр.`, 'good');
  return cost;
}

export function repairShip(state: GameState, ship: Ship): number {
  const cost = repairCost(state, ship);
  if (cost <= 0) {
    addToast(state, `${ship.name} не нуждается в ремонте.`, 'info');
    return 0;
  }
  if (state.player.credits < cost) {
    addToast(state, `Repairs cost ${cost} cr, you have ${state.player.credits}.`, 'bad');
    return 0;
  }
  state.player.credits -= cost;
  const stats = shipStats(ship);
  ship.hull = stats.hullMax;
  ship.shield = stats.shieldMax;
  addToast(state, `${ship.name} полностью отремонтирован за ${cost} кр.`, 'good');
  return cost;
}

/** Summary line used by the dock panel. */
export function shipLoadSummary(ship: Ship): string {
  const stats = shipStats(ship);
  return `трюм ${cargoUsed(ship)}/${stats.cargo} · топливо ${Math.floor(ship.fuel)}/${stats.fuelMax} · корпус ${Math.round(ship.hull)}/${stats.hullMax}`;
}

export function stationStorageFree(state: GameState): number {
  return storageFree(state.station);
}

export function logTradeNews(state: GameState, text: string, systemId: string | null): void {
  addNews(state, text, 'trade', systemId);
}

