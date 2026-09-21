import { TICKS } from '../types.ts';
import type { GameState, RiskLevel, Ship, StarSystem, TravelPlan } from '../types.ts';
import { shipStats } from '../ships/ship.ts';
import { distance } from '../universe/generate.ts';

/**
 * Travel is jump based: the player picks a system and the ship follows the
 * shortest lane path, burning fuel and time per hop. No manual piloting.
 */

export function findPath(state: GameState, fromId: string, toId: string): string[] {
  if (fromId === toId) return [fromId];
  const prev = new Map<string, string>();
  const queue: string[] = [fromId];
  const seen = new Set<string>([fromId]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === toId) break;
    const system = state.systems[current];
    if (!system) continue;
    for (const next of system.connections) {
      if (seen.has(next) || !state.systems[next]) continue;
      seen.add(next);
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!prev.has(toId)) return [];
  const path: string[] = [toId];
  let cursor = toId;
  while (cursor !== fromId) {
    const parent = prev.get(cursor);
    if (!parent) return [];
    path.unshift(parent);
    cursor = parent;
  }
  return path;
}

export function riskLabel(score: number): RiskLevel {
  if (score < 0.22) return 'LOW';
  if (score < 0.45) return 'MEDIUM';
  if (score < 0.68) return 'HIGH';
  return 'EXTREME';
}

/** Risk of the route: lawless space, weak patrols and long hauls are dangerous. */
export function routeRisk(state: GameState, path: string[], radarLevel = 0): number {
  if (path.length <= 1) return 0.04;
  let total = 0;
  let legLength = 0;
  for (let i = 1; i < path.length; i += 1) {
    const system = state.systems[path[i]];
    if (!system) continue;
    total += 1 - system.security;
    legLength += 1;
  }
  let score = total / Math.max(1, legLength);
  score += 0.02 * (path.length - 2);
  score -= radarLevel * 0.06;
  return Math.max(0.02, Math.min(0.95, score));
}

export function planTravel(
  state: GameState,
  ship: Ship,
  targetSystemId: string,
  radarLevel = 0,
): TravelPlan | null {
  const path = findPath(state, ship.systemId, targetSystemId);
  if (path.length < 2) return null;
  const stats = shipStats(ship);
  const hops = path.length - 1;
  const speedFactor = Math.max(0.35, stats.speed);
  const seconds = Math.round((hops * TICKS.secondsPerHop) / speedFactor);
  const fuel = Math.max(1, Math.round(hops * TICKS.fuelPerHop * stats.fuelEfficiency));
  const riskScore = routeRisk(state, path, radarLevel);
  const straight = distance(
    state.systems[path[0]].position,
    state.systems[path[path.length - 1]].position,
  );
  return {
    path,
    hops,
    fuel,
    seconds,
    risk: riskLabel(riskScore),
    riskScore,
    distance: Math.round(straight),
  };
}

export function fuelAvailable(ship: Ship): number {
  return Math.floor(ship.fuel);
}

export function canAffordJump(ship: Ship, plan: TravelPlan): boolean {
  return fuelAvailable(ship) >= plan.fuel;
}

/** Travel time between two systems for an AI ship of the given speed. */
export function missionTravelSeconds(from: StarSystem, to: StarSystem, speed: number): number {
  const lanes = Math.max(1, Math.round(distance(from.position, to.position) / 190));
  return Math.round((lanes * TICKS.secondsPerHop) / Math.max(0.35, speed));
}
