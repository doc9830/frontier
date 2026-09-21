import type { Rng } from '../rng.ts';
import { createRng } from '../rng.ts';
import type { Contract, GameState, StarSystem } from '../types.ts';
import { TICKS } from '../types.ts';
import { RESOURCE_IDS, resource } from '../data/resources.ts';
import { marketPrice } from './market.ts';

/**
 * Station contract board. Two kinds of work live here:
 *
 * - `supply` — привези свои товары в эту же систему: премия к местному рынку;
 * - `courier` — фракция выдаёт опечатанный груз, который надо доставить в
 *   другую уже открытую систему. Платят за расстояние и за число прыжков, так
 *   что дальние маршруты окупаются.
 */
export interface ContractDestination {
  id: string;
  name: string;
  /** Прыжков от выдачи до точки сдачи. */
  hops: number;
  /** Расстояние по карте в условных единицах. */
  distance: number;
  factionId: string | null;
}

/** Куда можно отвезти груз: открытые системы со станцией, по возрастанию прыжков. */
export function destinationsFrom(
  systems: Record<string, StarSystem>,
  fromSystemId: string,
): ContractDestination[] {
  const from = systems[fromSystemId];
  if (!from) return [];
  const hopsById = new Map<string, number>([[fromSystemId, 0]]);
  const found: ContractDestination[] = [];
  let frontier = [fromSystemId];
  while (frontier.length > 0 && found.length < 24) {
    const next: string[] = [];
    for (const id of frontier) {
      const system = systems[id];
      if (!system) continue;
      const depth = hopsById.get(id) ?? 0;
      if (id !== fromSystemId && system.discovered === true && system.stations.length > 0) {
        found.push({
          id,
          name: system.name,
          hops: depth,
          distance: Math.round(
            Math.hypot(system.position.x - from.position.x, system.position.y - from.position.y),
          ),
          factionId: system.factionId,
        });
        // Нашли узел: дальше по этой ветке идти незачем, прыжков будет больше.
        continue;
      }
      for (const link of system.connections) {
        if (hopsById.has(link) || !systems[link]) continue;
        hopsById.set(link, depth + 1);
        next.push(link);
      }
    }
    frontier = next;
  }
  return found.sort((a, b) => a.hops - b.hops || a.id.localeCompare(b.id));
}

export function discoveredDestinations(state: GameState, fromSystemId: string): ContractDestination[] {
  return destinationsFrom(state.systems, fromSystemId);
}

/**
 * Разовая сборка досок после открытия карт: только теперь у курьеров есть
 * маршруты в уже открытые системы. Новая игра вызывает это один раз, когда
 * радар нарисовал окрестности базы.
 */
export function seedContractBoards(state: GameState): void {
  const day = Math.floor(state.gameTime / TICKS.secondsPerDay) + 127;
  for (const id of state.systemIds) {
    const system = state.systems[id];
    if (!system?.stations.some((s) => s.hasContracts)) continue;
    system.contracts = createContracts(
      system,
      createRng(`${state.seed}:contracts:init:${id}`),
      day,
      undefined,
      discoveredDestinations(state, id),
    );
  }
}

export function createContracts(
  system: StarSystem,
  rng: Rng,
  day: number,
  count?: number,
  destinations: ContractDestination[] = [],
): Contract[] {
  const hasBoard = system.stations.some((s) => s.hasContracts);
  if (!hasBoard) return [];
  const total = count ?? rng.int(2, 3);
  const contracts: Contract[] = [];
  const wants = system.consumes.length > 0 ? system.consumes : RESOURCE_IDS;
  for (let i = 0; i < total; i += 1) {
    const id = `${system.id}-C${day}-${i}-${Math.floor(rng.next() * 9999)}`;
    if (destinations.length > 0 && rng.chance(0.45)) {
      contracts.push(
        createCourier(system, rng, day, id, rng.pick(destinations)),
      );
      continue;
    }
    const resourceId = rng.pick(wants);
    const def = resource(resourceId);
    const price = marketPrice(system.market, resourceId);
    const amount = Math.max(
      5,
      Math.round((def.basePrice > 400 ? 4 : def.basePrice > 100 ? 12 : 30) * rng.range(0.7, 1.6)),
    );
    const reward = Math.round(price * amount * rng.range(1.35, 1.75));
    contracts.push({
      id,
      kind: 'supply',
      systemId: system.id,
      targetSystemId: system.id,
      factionId: system.factionId,
      resource: resourceId,
      amount,
      reward,
      repReward: Math.round(rng.range(3, 9) + amount / 8),
      minRep: rng.chance(0.2) ? rng.int(5, 30) : -100,
      expiresDay: day + rng.int(30, 60),
      accepted: false,
      hops: 0,
      distance: 0,
      cargoLoaded: false,
    });
  }
  return contracts;
}

/** Курьерский контракт: груз фракции лежит в трюме под пломбой до сдачи. */
function createCourier(
  system: StarSystem,
  rng: Rng,
  day: number,
  id: string,
  destination: ContractDestination,
): Contract {
  // Под пломбу идёт компактный дорогой груз: трюм флагмана небольшой.
  const compact = RESOURCE_IDS.filter((r) => resource(r).basePrice >= 100);
  const resourceId = rng.pick(compact.length > 0 ? compact : RESOURCE_IDS);
  const def = resource(resourceId);
  const price = marketPrice(system.market, resourceId);
  const amount = Math.min(
    12,
    Math.max(3, Math.round((def.basePrice > 400 ? 3 : 6) * rng.range(0.7, 1.3))),
  );
  const premium = price * amount * rng.range(1.2, 1.5);
  const travelPay = destination.hops * (320 + amount * 22);
  const distancePay = destination.distance * 0.6;
  const reward = Math.round((premium + travelPay + distancePay) * rng.range(0.95, 1.1));
  return {
    id,
    kind: 'courier',
    systemId: system.id,
    targetSystemId: destination.id,
    factionId: system.factionId,
    resource: resourceId,
    amount,
    reward,
    repReward: Math.round(rng.range(4, 11) + destination.hops * 1.5),
    minRep: rng.chance(0.25) ? rng.int(5, 30) : -100,
    expiresDay: day + Math.max(16, 16 + destination.hops * 7),
    accepted: false,
    hops: destination.hops,
    distance: destination.distance,
    cargoLoaded: false,
  };
}

export function refreshContracts(
  system: StarSystem,
  rng: Rng,
  day: number,
  destinations: ContractDestination[] = [],
): void {
  system.contracts = system.contracts.filter((c) => c.expiresDay > day);
  const wanted = system.stations.some((s) => s.hasContracts) ? rng.int(2, 3) : 0;
  if (system.contracts.length < wanted) {
    const fresh = createContracts(
      system,
      rng,
      day,
      wanted - system.contracts.length,
      destinations,
    );
    system.contracts = system.contracts.concat(fresh);
  }
}

