import type { Rng } from '../rng.ts';
import type { Contract, StarSystem } from '../types.ts';
import { RESOURCE_IDS, resource } from '../data/resources.ts';
import { marketPrice } from './market.ts';

/**
 * Station contract board. Contracts are a soft goal generator: "bring 40 Food to
 * K-184" pays a premium over the local market and gives reputation, which in
 * turn unlocks better prices and more contracts.
 */
export function createContracts(system: StarSystem, rng: Rng, day: number, count?: number): Contract[] {
  const hasBoard = system.stations.some((s) => s.hasContracts);
  if (!hasBoard) return [];
  const total = count ?? rng.int(2, 3);
  const contracts: Contract[] = [];
  const wants = system.consumes.length > 0 ? system.consumes : RESOURCE_IDS;
  for (let i = 0; i < total; i += 1) {
    const id = rng.pick(wants);
    const def = resource(id);
    const price = marketPrice(system.market, id);
    const amount = Math.max(
      5,
      Math.round((def.basePrice > 400 ? 4 : def.basePrice > 100 ? 12 : 30) * rng.range(0.7, 1.6)),
    );
    const reward = Math.round(price * amount * rng.range(1.35, 1.75));
    const repReward = Math.round(rng.range(3, 9) + amount / 8);
    const minRep = rng.chance(0.2) ? rng.int(5, 30) : -100;
    contracts.push({
      id: `${system.id}-C${day}-${i}-${Math.floor(rng.next() * 9999)}`,
      kind: 'delivery',
      systemId: system.id,
      factionId: system.factionId,
      resource: id,
      amount,
      reward,
      repReward,
      minRep,
      expiresDay: day + rng.int(30, 60),
      accepted: false,
    });
  }
  return contracts;
}

export function refreshContracts(system: StarSystem, rng: Rng, day: number): void {
  system.contracts = system.contracts.filter((c) => c.expiresDay > day);
  const wanted = system.stations.some((s) => s.hasContracts) ? rng.int(2, 3) : 0;
  if (system.contracts.length < wanted) {
    const fresh = createContracts(system, rng, day, wanted - system.contracts.length);
    system.contracts = system.contracts.concat(fresh);
  }
}
