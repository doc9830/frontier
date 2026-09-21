import type { GameState, Ship, StarSystem, TravelPlan } from '../types.ts';
import { addNews } from '../news/news.ts';
import { addToast } from './toast.ts';
import { hops } from '../plural.ts';
import { shipStats } from '../ships/ship.ts';
import { buildPayload, eventDef, scheduleTravelEvents } from '../events/events.ts';

/**
 * Jump travel bookkeeping: fuel, per-hop progress, event schedule and arrival.
 * The engine calls these; the UI only starts and cancels trips.
 */

export function revealAround(state: GameState, systemId: string, hops: number): string[] {
  const revealed: string[] = [];
  const seen = new Set<string>([systemId]);
  let frontier = [systemId];
  for (let depth = 0; depth <= hops; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const system = state.systems[id];
      if (!system) continue;
      if (!system.discovered) {
        system.discovered = true;
        revealed.push(id);
      }
      if (depth === hops) continue;
      for (const link of system.connections) {
        if (!seen.has(link) && state.systems[link]) {
          seen.add(link);
          next.push(link);
        }
      }
    }
    frontier = next;
  }
  return revealed;
}

export function radarReach(state: GameState): number {
  return 1 + (state.station.buildings.radar ?? 0);
}

export function startTravel(state: GameState, ship: Ship, plan: TravelPlan): boolean {
  if (ship.fuel < plan.fuel) {
    addToast(state, `Not enough fuel: need ${plan.fuel}, have ${Math.floor(ship.fuel)}.`, 'bad');
    return false;
  }
  ship.fuel = Math.max(0, ship.fuel - plan.fuel);
  ship.status = 'transit';
  ship.mission = null;
  const departAt = state.gameTime;
  // The schedule is rolled here so reloading the page cannot reroll the trip.
  const events = scheduleTravelEvents(state, plan, departAt);
  ship.travel = {
    path: plan.path.slice(),
    departAt,
    arriveAt: departAt + plan.seconds,
    fuel: plan.fuel,
    events,
    fired: [],
    pausedAt: null,
  };
  const destination = state.systems[plan.path[plan.path.length - 1]];
  addToast(state, `Прыжок к ${destination?.name ?? '?'} — ${hops(plan.hops)}, ${plan.fuel} топлива.`, 'info');
  return true;
}

export function travelProgress(state: GameState, ship: Ship): number {
  const travel = ship.travel;
  if (!travel) return 1;
  const span = Math.max(0.001, travel.arriveAt - travel.departAt);
  return Math.min(1, Math.max(0, (state.gameTime - travel.departAt) / span));
}

export function currentHop(state: GameState, ship: Ship): StarSystem | null {
  const travel = ship.travel;
  if (!travel) return null;
  const progress = travelProgress(state, ship);
  const index = Math.min(travel.path.length - 1, Math.floor(progress * (travel.path.length - 1)));
  return state.systems[travel.path[index]] ?? null;
}

/** Cancels the trip and parks the ship in its current hop. */
export function abortTravel(state: GameState, ship: Ship, reason: string): void {
  const travel = ship.travel;
  if (!travel) return;
  ship.travel = null;
  ship.status = 'docked';
  const here = state.systems[ship.systemId];
  if (here) revealAround(state, here.id, Math.min(1, radarReach(state)));
  addToast(state, reason, 'info');
  addNews(
    state,
    `${ship.name} прервал прыжок и пристыковался в системе ${here?.name ?? 'неизвестная система'}.`,
    'travel',
    here?.id ?? null,
  );
}

export function finishTravel(state: GameState, ship: Ship): void {
  const travel = ship.travel;
  if (!travel) return;
  const destinationId = travel.path[travel.path.length - 1];
  ship.systemId = destinationId;
  ship.travel = null;
  ship.status = 'docked';
  state.player.stats.jumps += travel.path.length - 1;
  const system = state.systems[destinationId];
  const revealed = revealAround(state, destinationId, radarReach(state));
  addToast(state, `Прибытие в систему ${system?.name ?? destinationId}.`, 'good');
  if (revealed.length > 0) {
    addNews(
      state,
      `Карты обновлены: открыто новых систем — ${revealed.length} (из системы ${system?.name}).`,
      'exploration',
      destinationId,
      system?.factionId ?? null,
    );
  }
  if (system) {
    for (const belt of system.belts) {
      if (!belt.discovered && shipStats(ship).scanner >= 16) {
        belt.discovered = true;
        addToast(state, `Сканер нашёл пояс: ${belt.name}.`, 'good');
      }
    }
  }
}

/** Fires the next scheduled event of the trip, pausing the ship if needed. */
export function processTravelEvents(state: GameState, ship: Ship): void {
  const travel = ship.travel;
  if (!travel || travel.pausedAt !== null || state.pendingEvent) return;
  for (const event of travel.events) {
    const key = `${event.at}:${event.eventId}`;
    if (travel.fired.includes(key)) continue;
    if (state.gameTime < event.at) return;
    travel.fired.push(key);
    const def = eventDef(event.eventId);
    if (!def || !def.interactive) continue;
    travel.pausedAt = state.gameTime;
    state.pendingEvent = {
      id: `${key}`,
      eventId: def.id,
      shipId: ship.id,
      firedAt: state.gameTime,
      payload: buildPayload(state, ship, def.id),
    };
    return;
  }
}

/** Called after an event is resolved: the trip continues where it stopped. */
export function resumeTravel(state: GameState, ship: Ship, extraSeconds = 0): void {
  const travel = ship.travel;
  if (!travel) return;
  const paused = travel.pausedAt;
  if (paused !== null) {
    const shift = state.gameTime - paused + extraSeconds;
    travel.arriveAt += shift;
    travel.events = travel.events.map((e) => ({ ...e, at: e.at + shift }));
    travel.pausedAt = null;
  }
}
