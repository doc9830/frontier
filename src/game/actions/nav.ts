import type { GameState, TravelPlan } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { planTravel, riskLabel } from '../exploration/travel.ts';
import { abortTravel, radarReach, startTravel } from '../sim/travel.ts';
import { escortBonus } from '../sim/fleet.ts';
import { addToast } from '../sim/toast.ts';

/** Jump preview shown by the map screen: distance, time, fuel and risk. */
export function jumpPlan(state: GameState, targetSystemId: string): TravelPlan | null {
  const ship = playerShip(state);
  if (!ship) return null;
  const plan = planTravel(state, ship, targetSystemId, radarReach(state));
  if (!plan) return null;
  plan.seconds = Math.round(plan.seconds * (1 - state.station.research.logistics * 0.03));
  const escorts = escortBonus(state, ship.systemId);
  if (escorts > 0) {
    plan.riskScore = Math.max(0.02, plan.riskScore - escorts);
    plan.risk = riskLabel(plan.riskScore);
  }
  return plan;
}

export function travelTo(state: GameState, targetSystemId: string): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  if (ship.travel) {
    addToast(state, 'Прыжок уже идёт. Сначала прервите перелёт.', 'bad');
    return false;
  }
  if (ship.status === 'mining') {
    addToast(state, 'Остановите добычу перед прыжком.', 'bad');
    return false;
  }
  if (ship.systemId === targetSystemId) {
    addToast(state, 'Вы уже в этой системе.', 'info');
    return false;
  }
  const target = state.systems[targetSystemId];
  if (!target || !target.discovered) {
    addToast(state, 'Нет проложенного маршрута в эту систему.', 'bad');
    return false;
  }
  const plan = jumpPlan(state, targetSystemId);
  if (!plan) {
    addToast(state, `Нет трассы из системы ${state.systems[ship.systemId]?.name ?? '?'}.`, 'bad');
    return false;
  }
  return startTravel(state, ship, plan);
}

export function cancelTravel(state: GameState): void {
  const ship = playerShip(state);
  if (!ship?.travel) return;
  abortTravel(state, ship, 'Прыжок прерван. Корабль остаётся в текущей системе.');
}

export function canJump(state: GameState, targetSystemId: string): boolean {
  const plan = jumpPlan(state, targetSystemId);
  if (!plan) return false;
  const ship = playerShip(state);
  return !!ship && ship.fuel >= plan.fuel;
}
