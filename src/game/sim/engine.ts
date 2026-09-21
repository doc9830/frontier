import type { GameState, Ship } from '../types.ts';
import { simulateWorld } from './world.ts';
import { processStation } from './station.ts';
import { processMining } from './mining.ts';
import { processFleetShip } from './fleet.ts';
import { currentHop, finishTravel, processTravelEvents, resumeTravel, revealAround } from './travel.ts';
import { resolveTravelEvent } from '../events/resolve.ts';
import { playerShip } from '../state/create.ts';
import { addToast } from './toast.ts';
import { addNews } from '../news/news.ts';
import { runtimeRng } from '../rng.ts';
import { shipStats } from '../ships/ship.ts';

/** Longest single simulation step. Bigger jumps are handled by catch-up steps. */
const MAX_STEP_SECONDS = 300;
/** Offline progress is capped: the fleet works, but the galaxy waits for you. */
export const MAX_OFFLINE_SECONDS = 8 * 3600;
const CATCHUP_STEP_SECONDS = 4;

/**
 * One simulation step. Time only advances while no event awaits the player, so
 * a modal decision genuinely pauses the game (same behaviour as the design doc).
 */
export function advance(state: GameState, seconds: number): void {
  if (state.pendingEvent) return;
  const dt = Math.min(seconds, MAX_STEP_SECONDS);
  if (dt <= 0) return;

  const previous = state.gameTime;
  state.gameTime += dt;
  simulateWorld(state, dt, previous);

  const player = playerShip(state);
  if (!player) return;

  for (const ship of state.ships.slice()) {
    if (ship.id === player.id) {
      if (ship.travel) {
        processTravelEvents(state, ship);
        if (state.pendingEvent) break;
        const travel = ship.travel;
        if (travel && travel.pausedAt === null && state.gameTime >= travel.arriveAt) {
          finishTravel(state, ship);
        }
      } else if (ship.status === 'mining') {
        processMining(state, ship);
      }
    } else {
      processFleetShip(state, ship);
    }
  }

  processStation(state);
  state.lastSimulationTime = Date.now();
}

/**
 * Catches up after the tab was closed. Runs in small steps so scheduled travel
 * events still fire in order; stops as soon as a modal needs the player.
 */
export function catchUp(state: GameState, seconds: number): number {
  const total = Math.max(0, Math.min(seconds, MAX_OFFLINE_SECONDS));
  let simulated = 0;
  while (simulated < total) {
    const step = Math.min(CATCHUP_STEP_SECONDS, total - simulated);
    advance(state, step);
    simulated += step;
    if (state.pendingEvent) break;
  }
  return simulated;
}

export function resolvePendingEvent(state: GameState, choiceId: string): void {
  const pending = state.pendingEvent;
  if (!pending) return;
  const ship = state.ships.find((s) => s.id === pending.shipId) ?? playerShip(state);
  if (!ship) {
    state.pendingEvent = null;
    return;
  }

  const outcome = resolveTravelEvent(state, ship, pending.eventId, choiceId, pending.payload);
  if (outcome.kind !== 'info') addToast(state, outcome.summary, outcome.kind);

  if (outcome.triggerCombat) {
    state.pendingEvent = {
      id: `${pending.id}:combat`,
      eventId: 'pirate_encounter',
      shipId: ship.id,
      firedAt: state.gameTime,
      payload: { ...pending.payload, enemy: outcome.triggerCombat },
    };
    return;
  }

  state.pendingEvent = null;

  if (outcome.shipDestroyed) {
    recoverFromLoss(state, ship);
    return;
  }
  if (outcome.emergencyJump) {
    emergencyJump(state, ship);
    return;
  }
  resumeTravel(state, ship);
}

/** Insurance: you lose the ship, the cargo and 10% of your account. */
export function recoverFromLoss(state: GameState, ship: Ship): void {
  const home = state.systems[state.player.homeSystemId];
  const stats = shipStats(ship);
  ship.travel = null;
  ship.mission = null;
  ship.systemId = home?.id ?? ship.systemId;
  ship.status = 'docked';
  ship.cargo = {};
  ship.hull = stats.hullMax;
  ship.shield = stats.shieldMax;
  ship.fuel = stats.fuelMax;
  const fee = Math.round(state.player.credits * 0.1);
  state.player.credits = Math.max(0, state.player.credits - fee);
  addNews(
    state,
    `Страховой случай оформлен: ${ship.name} заменён в системе ${home?.name ?? 'на форпосте'} за ${fee} кр.`,
    'personal',
    home?.id ?? null,
  );
  addToast(
    state,
    `Корабль уничтожен. Страховка выдала новый в системе ${home?.name ?? 'дома'} (−${fee} кр).`,
    'bad',
  );
}

/** Emergency jumps drop the ship into a neighbouring system, trip cancelled. */
export function emergencyJump(state: GameState, ship: Ship): void {
  const here = currentHop(state, ship) ?? state.systems[ship.systemId];
  const options = (here?.connections ?? []).filter((id) => state.systems[id]);
  const targetId = options.length > 0 ? runtimeRng.pick(options) : (here?.id ?? ship.systemId);
  ship.travel = null;
  ship.systemId = targetId;
  ship.status = 'docked';
  revealAround(state, targetId, 0);
  addToast(state, `Emergency jump complete: ${state.systems[targetId]?.name ?? targetId}.`, 'info');
}

/** Convenience for the UI: how many in-game days have passed. */
export function elapsedDays(state: GameState): number {
  return Math.floor(state.gameTime / 60);
}
