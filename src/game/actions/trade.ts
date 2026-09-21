import type { GameState, ResourceId, Ship, SystemStation } from '../types.ts';
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
import {
  addCargo,
  cargoFree,
  cargoUsed,
  removeCargo,
  sealedTotal,
  sealedUnits,
  sellableUnits,
  shipStats,
} from '../ships/ship.ts';
import { addToDepot, depotHere, depotRecord, depotRefusal, takeFromDepot } from '../sim/depots.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import {
  changeReputation,
  reputationOf,
  tradeReputationGain,
} from '../factions/reputation.ts';
import { shipType } from '../data/ships.ts';
import type { StationService } from '../data/stations.ts';
import { SERVICE_INFO, serviceAccess, stationServices } from '../data/stations.ts';
import { siteTradeBonus, stationPhase } from '../site/site.ts';

/** Услуга ближайшей станции системы вместе с допуском по репутации. */
export interface ServiceHere {
  station: SystemStation;
  label: string;
  ok: boolean;
  reason: string | null;
}

/**
 * Ищет станцию с нужной услугой в системе корабля. Возвращает null, если
 * корабль занят (в перелёте, добыче, сканировании) или такого сервиса рядом нет.
 */
export function serviceHere(state: GameState, service: StationService): ServiceHere | null {
  const ship = playerShip(state);
  if (!ship || ship.travel || ship.status === 'mining' || ship.status === 'survey') return null;
  const system = state.systems[ship.systemId];
  if (!system) return null;
  const station = system.stations.find((s) => stationServices(s)[service]);
  if (!station) return null;
  const access = serviceAccess(state, station, service);
  return { station, label: SERVICE_INFO[service].label, ok: access.ok, reason: access.reason };
}

/** Docking rules: markets only answer when you are parked at their station. */
export function atMarket(state: GameState): boolean {
  return serviceHere(state, 'market')?.ok === true;
}

/** Станция корабля занята разведкой — блокирует любые рыночные операции. */
export function busyReason(state: GameState): string | null {
  const ship = playerShip(state);
  if (!ship) return 'Нет корабля.';
  if (ship.travel) return 'Корабль в перелёте.';
  if (ship.status === 'mining') return 'Корабль на добыче.';
  if (ship.status === 'survey') return 'Корабль занят сканированием.';
  return null;
}

/** Кошелёк торговца: своя станция в этой системе даёт бонус площадки. */
export function atOwnStation(state: GameState): boolean {
  const ship = playerShip(state);
  if (!ship || !state.station.systemId) return false;
  return ship.systemId === state.station.systemId && stationPhase(state) === 'operational';
}

/** Market Analysis research improves both sides of the spread. */
export function researchPriceBonus(state: GameState): number {
  return 1 + state.station.research.trade * 0.02;
}

export function buyPriceAt(state: GameState, id: ResourceId): number {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return 0;
  const site = atOwnStation(state) ? 1 - siteTradeBonus(state) : 1;
  return Math.round(
    (playerBuyPrice(system.market, id, reputationOf(state, system.factionId)) /
      researchPriceBonus(state)) *
      site,
  );
}

export function sellPriceAt(state: GameState, id: ResourceId): number {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return 0;
  const site = atOwnStation(state) ? 1 + siteTradeBonus(state) : 1;
  return Math.round(
    playerSellPrice(system.market, id, reputationOf(state, system.factionId)) *
      researchPriceBonus(state) *
      site,
  );
}

/** Сколько единиц рынок готов продать вам прямо сейчас. */
export function maxBuyable(state: GameState, id: ResourceId): number {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!ship || !system) return 0;
  const price = Math.max(1, buyPriceAt(state, id));
  return Math.max(
    0,
    Math.min(availableStock(system.market, id), cargoFree(ship), Math.floor(state.player.credits / price)),
  );
}

/** Сколько единиц вы можете продать с трюма и со склада под ногами. */
export function maxSellable(state: GameState, id: ResourceId, fromStorage = false): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  // Опечатанный контрактный груз продаже не подлежит.
  const inHold = sellableUnits(ship, id);
  if (!fromStorage) return inHold;
  return inHold + (depotHere(state)?.amounts[id] ?? 0);
}

/** Доступ к рынку конкретной системы (для торговых маршрутов флота). */
export function marketAccessInSystem(
  state: GameState,
  systemId: string,
): { ok: boolean; reason: string | null } {
  const system = state.systems[systemId];
  if (!system) return { ok: false, reason: 'Система не найдена.' };
  const station = system.stations.find((s) => stationServices(s).market);
  if (!station) return { ok: false, reason: `${system.name}: станции с рынком нет.` };
  const access = serviceAccess(state, station, 'market');
  return { ok: access.ok, reason: access.reason };
}

/** Причина, по которой рынок сейчас не отвечает (или null, если всё открыто). */
export function marketRefusal(state: GameState): string | null {
  const busy = busyReason(state);
  if (busy) return busy;
  const service = serviceHere(state, 'market');
  if (!service) return 'В этой системе нет рынка: прыгните туда, где у станции указан рынок.';
  if (!service.ok) return service.reason;
  return null;
}

export function buyResource(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  const refusal = marketRefusal(state);
  if (refusal) {
    addToast(state, refusal, 'bad');
    return 0;
  }
  const price = Math.max(1, buyPriceAt(state, id));
  const units = Math.max(0, Math.min(Math.floor(qty), maxBuyable(state, id)));
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
  const refusal = marketRefusal(state);
  if (refusal) {
    addToast(state, refusal, 'bad');
    return 0;
  }
  const price = Math.max(1, sellPriceAt(state, id));
  const seal = sealedUnits(ship, id);
  const units = Math.min(Math.floor(qty), sellableUnits(ship, id));
  if (units <= 0) {
    addToast(
      state,
      seal > 0
        ? `«${resource(id).name}» лежит под пломбой контракта: продать нельзя, пока груз не сдан.`
        : `В трюме нет «${resource(id).name}».`,
      'bad',
    );
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
 * Продаёт товар прямо со склада, у которого стоит корабль. Склад может быть
 * своим или арендованным — важно лишь, чтобы в этой же системе был рынок.
 */
export function sellStoredResource(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const system = state.systems[ship.systemId];
  if (!system) return 0;
  const refusal = marketRefusal(state);
  if (refusal) {
    addToast(state, refusal, 'bad');
    return 0;
  }
  const depot = depotHere(state);
  const record = depot ? depotRecord(state, depot.id) : null;
  if (!depot || !record) {
    addToast(state, depotRefusal(state) ?? 'Продавать со склада здесь нечего.', 'bad');
    return 0;
  }
  const stored = depot.amounts[id] ?? 0;
  const units = Math.min(Math.floor(qty), stored);
  if (units <= 0) {
    addToast(state, `В складе «${depot.name}» нет «${resource(id).name}».`, 'bad');
    return 0;
  }
  const price = Math.max(1, sellPriceAt(state, id));
  takeFromDepot(state, record, { [id]: units });
  applySell(system.market, id, units);
  const revenue = units * price;
  state.player.credits += revenue;
  state.player.stats.earned += revenue;
  state.player.stats.trades += 1;
  const rep = changeReputation(state, system.factionId, tradeReputationGain(units));
  addToast(
    state,
    `Со склада «${depot.name}» продано ${units} × ${resource(id).name} за ${revenue} кр.${
      rep > 0 ? ` Репутация +${rep}.` : ''
    }`,
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

/** Трюм → склад той станции, у которой стоит корабль (своя база или аренда). */
export function unloadToStation(state: GameState, id: ResourceId | null): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const depot = depotHere(state);
  if (!depot) {
    addToast(state, depotRefusal(state) ?? 'Разгружать здесь некуда.', 'bad');
    return 0;
  }
  const record = depotRecord(state, depot.id);
  if (!record) return 0;
  const ids = id ? [id] : (Object.keys(ship.cargo) as ResourceId[]);
  let moved = 0;
  let lost = 0;
  for (const key of ids) {
    const units = removeCargo(ship, key, sellableUnits(ship, key));
    if (units <= 0) continue;
    const result = addToDepot(state, record, { [key]: units });
    moved += result.added;
    lost += result.lost;
  }
  if (lost > 0) addToast(state, `Склад «${depot.name}» переполнен: потеряно ${lost} ед.`, 'bad');
  const sealedLeft = sealedTotal(ship);
  if (sealedLeft > 0) {
    addToast(state, `Опечатанный груз (${sealedLeft} ед.) остаётся в трюме: его сдают по контракту.`, 'info');
  }
  if (moved > 0) addToast(state, `Разгружено ${moved} ед. в склад «${depot.name}».`, 'good');
  return moved;
}

/** Склад → трюм корабля. */
export function loadFromStation(state: GameState, id: ResourceId, qty: number): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  const depot = depotHere(state);
  const record = depot ? depotRecord(state, depot.id) : null;
  if (!depot || !record) {
    addToast(state, depotRefusal(state) ?? 'Загружать здесь нечего.', 'bad');
    return 0;
  }
  const units = Math.min(Math.floor(qty), depot.amounts[id] ?? 0, cargoFree(ship));
  if (units <= 0) {
    addToast(state, 'Загружать нечего.', 'bad');
    return 0;
  }
  takeFromDepot(state, record, { [id]: units });
  addCargo(ship, id, units);
  addToast(state, `В трюм загружено: ${units} × ${resource(id).name} со склада «${depot.name}».`, 'info');
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
  const service = serviceHere(state, 'refuel');
  if (!service || !service.ok) {
    addToast(state, service?.reason ?? 'Здесь негде заправиться: нужна станция с услугой заправки.', 'bad');
    return 0;
  }
  const stats = shipStats(ship);
  const full = stats.fuelMax - ship.fuel <= topUp;
  const cost = Math.ceil(refuelCost(state, ship) * (full ? 1 : topUp / Math.max(1, stats.fuelMax - ship.fuel)));
  if (stats.fuelMax - ship.fuel <= 0) {
    addToast(state, 'Баки уже полны.', 'info');
    return 0;
  }
  if (state.player.credits < cost) {
    addToast(state, `Заправка стоит ${cost} кр, у вас ${state.player.credits}.`, 'bad');
    return 0;
  }
  state.player.credits -= cost;
  ship.fuel = full ? stats.fuelMax : Math.min(stats.fuelMax, ship.fuel + topUp);
  addToast(state, `${ship.name} заправлен за ${cost} кр.`, 'good');
  return cost;
}

export function repairShip(state: GameState, ship: Ship): number {
  const service = serviceHere(state, 'repair');
  if (!service || !service.ok) {
    addToast(state, service?.reason ?? 'Здесь нет ремонтной службы.', 'bad');
    return 0;
  }
  const cost = repairCost(state, ship);
  if (cost <= 0) {
    addToast(state, `${ship.name} не нуждается в ремонте.`, 'info');
    return 0;
  }
  if (state.player.credits < cost) {
    addToast(state, `Ремонт стоит ${cost} кр, у вас ${state.player.credits}.`, 'bad');
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
  return depotHere(state)?.free ?? 0;
}

export function logTradeNews(state: GameState, text: string, systemId: string | null): void {
  addNews(state, text, 'trade', systemId);
}

