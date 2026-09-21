import type { Amounts, GameState, ResourceId, SystemStation } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { ownStationRecord, rentedStorageCapacity, serviceAccess, stationServices } from '../data/stations.ts';
import { addStorage, removeStorage, storageCapacity } from './station.ts';

/**
 * Склады по станциям.
 *
 * Каждое место, где игроку разрешено хранить груз, — отдельный ящик: своя база
 * (её объём растёт с постройками) и арендованные ячейки на станциях фракций.
 * Груз не телепортируется: чтобы забрать или продать его, корабль должен стоять
 * в той же системе, где стоит этот склад.
 */

export interface Depot {
  id: string;
  name: string;
  own: boolean;
  /** Система, в которой стоит склад. */
  systemId: string;
  amounts: Amounts;
  capacity: number;
  used: number;
  free: number;
}

/** Груз конкретного склада: свой склад живёт в station.storage. */
export function depotAmounts(state: GameState, stationId: string): Amounts {
  if (stationId === state.station.id) return state.station.storage;
  return state.depots[stationId] ?? {};
}

export function depotCapacity(state: GameState, station: SystemStation): number {
  return station.id === state.station.id ? storageCapacity(state.station) : rentedStorageCapacity(station);
}

export function depotUsed(amounts: Amounts): number {
  let total = 0;
  for (const value of Object.values(amounts)) total += value ?? 0;
  return total;
}

/** Кладёт груз в склад, отбрасывая то, что не влезло. */
export function addToDepot(
  state: GameState,
  station: SystemStation,
  amounts: Amounts,
): { added: number; lost: number } {
  if (station.id === state.station.id) return addStorage(state, amounts);
  const store = (state.depots[station.id] = state.depots[station.id] ?? {});
  let added = 0;
  let lost = 0;
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    const fit = Math.min(qty, Math.max(0, depotCapacity(state, station) - depotUsed(store)));
    if (fit > 0) {
      store[id] = (store[id] ?? 0) + fit;
      added += fit;
    }
    lost += qty - fit;
  }
  return { added, lost };
}

/** Списывает груз со склада. false — чего-то не хватило. */
export function takeFromDepot(state: GameState, station: SystemStation, amounts: Amounts): boolean {
  if (station.id === state.station.id) return removeStorage(state, amounts);
  const store = state.depots[station.id];
  if (!store) return false;
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    if ((store[id] ?? 0) < qty) return false;
  }
  for (const [id, qty] of Object.entries(amounts) as [ResourceId, number][]) {
    if (!qty || qty <= 0) continue;
    const left = (store[id] ?? 0) - qty;
    if (left <= 0) delete store[id];
    else store[id] = left;
  }
  return true;
}


function depotView(state: GameState, station: SystemStation, systemId: string): Depot {
  const amounts = depotAmounts(state, station.id);
  const capacity = depotCapacity(state, station);
  const used = depotUsed(amounts);
  return {
    id: station.id,
    name: station.name,
    own: station.id === state.station.id,
    systemId,
    amounts,
    capacity,
    used,
    free: Math.max(0, capacity - used),
  };
}

/**
 * Склад, доступный кораблю прямо сейчас: сначала своя база, потом арендованная
 * ячейка станции, которая вас обслуживает. null — хранить здесь негде.
 */
export function depotHere(state: GameState): Depot | null {
  const ship = playerShip(state);
  if (!ship) return null;
  const system = state.systems[ship.systemId];
  if (!system) return null;
  const own = ownStationRecord(state);
  if (own && state.station.systemId === ship.systemId && own.hasStorage) {
    return depotView(state, own, system.id);
  }
  const station = system.stations.find(
    (s) => stationServices(s).storage && serviceAccess(state, s, 'storage').ok,
  );
  return station ? depotView(state, station, system.id) : null;
}

/** Запись станции для склада: своя база или станция фракции. */
export function depotRecord(state: GameState, stationId: string): SystemStation | null {
  if (stationId === state.station.id) return ownStationRecord(state);
  for (const id of state.systemIds) {
    const station = state.systems[id]?.stations.find((s) => s.id === stationId);
    if (station) return station;
  }
  return null;
}

/** Все склады игрока с адресами: для сводки «где что лежит». */
export function allDepots(state: GameState): Depot[] {
  const list: Depot[] = [];
  const own = ownStationRecord(state);
  if (own && own.hasStorage) list.push(depotView(state, own, state.station.systemId));
  for (const [stationId, amounts] of Object.entries(state.depots ?? {})) {
    if (depotUsed(amounts) <= 0) continue;
    for (const id of state.systemIds) {
      const station = state.systems[id]?.stations.find((s) => s.id === stationId);
      if (station) {
        list.push(depotView(state, station, id));
        break;
      }
    }
  }
  return list;
}

/** Причина, по которой склад недоступен, — готовая строка для интерфейса. */
export function depotRefusal(state: GameState): string | null {
  const ship = playerShip(state);
  if (!ship) return 'Нет корабля.';
  if (ship.travel) return 'Корабль в перелёте: склады работают только у станции.';
  if (ship.status === 'mining') return 'Корабль на добыче: сначала завершите вахту.';
  if (ship.status === 'survey') return 'Корабль занят сканированием.';
  if (depotHere(state)) return null;
  if (state.station.systemId === ship.systemId) {
    return 'На вашей базе ещё нет склада: достройте его на станции.';
  }
  return 'В этой системе нет станции, которая примет ваш груз на хранение.';
}
