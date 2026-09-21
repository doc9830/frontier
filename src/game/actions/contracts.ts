import type { Contract, GameState } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { removeCargo } from '../ships/ship.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { changeReputation, reputationOf } from '../factions/reputation.ts';
import { gameDay } from '../news/news.ts';
import { resource } from '../data/resources.ts';

/**
 * Contract board. Delivery contracts are simple courier work: accept one, carry
 * the goods to the issuing system and get a premium plus reputation.
 */

export function contractsHere(state: GameState): Contract[] {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return [];
  return system.contracts;
}

export function activeContracts(state: GameState): { contract: Contract; shipSystemId: string }[] {
  const active: { contract: Contract; shipSystemId: string }[] = [];
  for (const id of state.systemIds) {
    const system = state.systems[id];
    if (!system) continue;
    for (const contract of system.contracts) {
      if (contract.accepted) active.push({ contract, shipSystemId: system.id });
    }
  }
  return active;
}

export function contractUnitsInHold(state: GameState, contract: Contract): number {
  const ship = playerShip(state);
  if (!ship) return 0;
  return ship.cargo[contract.resource] ?? 0;
}

export function contractBlockedReason(state: GameState, contract: Contract): string | null {
  if (contract.accepted) return null;
  const ship = playerShip(state);
  if (!ship) return 'Нет корабля.';
  const rep = reputationOf(state, contract.factionId);
  if (rep < contract.minRep) {
    return `Нужна репутация ${contract.minRep} (у вас: ${rep}).`;
  }
  if (contract.expiresDay <= gameDay(state)) return 'Срок истёк.';
  return null;
}

export function acceptContract(state: GameState, contractId: string): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  const system = state.systems[ship.systemId];
  const contract = system?.contracts.find((c) => c.id === contractId);
  if (!contract) {
    addToast(state, 'Этот контракт больше не предлагается.', 'bad');
    return false;
  }
  const blocked = contractBlockedReason(state, contract);
  if (blocked) {
    addToast(state, blocked, 'bad');
    return false;
  }
  contract.accepted = true;
  addToast(
    state,
    `Контракт принят: доставить ${contract.amount} × ${resource(contract.resource).name} в систему ${system.name}.`,
    'info',
  );
  addNews(
    state,
    `Вы подписали контракт на поставку «${resource(contract.resource).name}» в систему ${system.name} (${contract.reward} кр).`,
    'trade',
    system.id,
    system.factionId,
  );
  return true;
}

export function abandonContract(state: GameState, contractId: string): boolean {
  for (const id of state.systemIds) {
    const system = state.systems[id];
    const contract = system?.contracts.find((c) => c.id === contractId);
    if (!contract || !system) continue;
    contract.accepted = false;
    addToast(state, 'Контракт расторгнут.', 'info');
    return true;
  }
  return false;
}

export function canDeliverContract(state: GameState, contract: Contract): boolean {
  const ship = playerShip(state);
  if (!ship || ship.travel) return false;
  return (
    contract.accepted &&
    ship.systemId === contract.systemId &&
    (ship.cargo[contract.resource] ?? 0) >= contract.amount
  );
}

export function deliverContract(state: GameState, contractId: string): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  const system = state.systems[ship.systemId];
  const contract = system?.contracts.find((c) => c.id === contractId);
  if (!contract || !system) {
    addToast(state, 'Здесь этот контракт недоступен.', 'bad');
    return false;
  }
  if (!contract.accepted) {
    addToast(state, 'Сначала примите контракт.', 'bad');
    return false;
  }
  if ((ship.cargo[contract.resource] ?? 0) < contract.amount) {
    addToast(
      state,
      `В трюме нужно ${contract.amount} × ${resource(contract.resource).name} (сейчас ${ship.cargo[contract.resource] ?? 0}).`,
      'bad',
    );
    return false;
  }
  removeCargo(ship, contract.resource, contract.amount);
  state.player.credits += contract.reward;
  state.player.stats.earned += contract.reward;
  state.player.stats.contracts += 1;
  const rep = changeReputation(state, contract.factionId, contract.repReward);
  system.contracts = system.contracts.filter((c) => c.id !== contract.id);
  addToast(
    state,
    `Контракт выполнен: +${contract.reward} кр, +${rep} репутации.`,
    'good',
  );
  addNews(
    state,
    `${contract.amount} × ${resource(contract.resource).name} доставлено в систему ${system.name} за ${contract.reward} кр.`,
    'trade',
    system.id,
    system.factionId,
  );
  return true;
}
