import type { Contract, GameState, StarSystem } from '../types.ts';
import { playerShip } from '../state/create.ts';
import {
  addCargo,
  cargoFree,
  releaseSealed,
  removeCargo,
  sealCargo,
  sealedUnits,
} from '../ships/ship.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { changeReputation, reputationOf } from '../factions/reputation.ts';
import { gameDay } from '../news/news.ts';
import { resource } from '../data/resources.ts';
import { hops } from '../plural.ts';
import { serviceHere } from './trade.ts';

/**
 * Contract board. Two kinds of work live here:
 *
 * - `supply` — привези свои товары в эту систему: премия к местному рынку;
 * - `courier` — забери опечатанный груз фракции и сдай его в другой системе.
 *   Платят за расстояние и число прыжков, поэтому дальние маршруты — основной
 *   заработок курьера.
 *
 * Договориться о работе можно только на станции с доской контрактов: у
 * фракционных узлов это отдельная услуга, которая закрыта до нейтралитета.
 */


/** Состояние доски контрактов в текущей системе. */
export function contractBoard(state: GameState): {
  available: boolean;
  reason: string | null;
  stationName: string | null;
} {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return { available: false, reason: 'Нет системы.', stationName: null };
  const service = serviceHere(state, 'contracts');
  if (!service) {
    return {
      available: false,
      reason: 'В этой системе нет доски контрактов: ищите станцию с услугой «Контракты».',
      stationName: null,
    };
  }
  return {
    available: service.ok,
    reason: service.ok ? null : service.reason,
    stationName: service.station.name,
  };
}

export function contractsHere(state: GameState): Contract[] {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return [];
  if (!contractBoard(state).available) return [];
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

function findContract(
  state: GameState,
  contractId: string,
): { contract: Contract; system: StarSystem } | null {
  for (const id of state.systemIds) {
    const system = state.systems[id];
    const contract = system?.contracts.find((c) => c.id === contractId);
    if (contract && system) return { contract, system };
  }
  return null;
}

/** Куда везти груз: для поставки это система выдачи, для курьера — точка сдачи. */
export function contractTargetId(contract: Contract): string {
  return contract.kind === 'courier' ? contract.targetSystemId : contract.systemId;
}

export function contractTargetName(state: GameState, contract: Contract): string {
  const id = contractTargetId(contract);
  return state.systems[id]?.name ?? id;
}

/** Строка маршрута для панели: «K-184 · 4 прыжка · ≈820 ед. карты». */
export function contractRoute(state: GameState, contract: Contract): string {
  const target = contractTargetName(state, contract);
  if (contract.kind !== 'courier') return `${target} · на месте`;
  return `${target} · ${hops(contract.hops)} · ≈${contract.distance} ед. карты`;
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
  if (contract.kind === 'courier' && contract.hops <= 0) {
    return 'Маршрут потерян: точка сдачи неизвестна.';
  }
  return null;
}


export function acceptContract(state: GameState, contractId: string): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  const board = contractBoard(state);
  if (!board.available) {
    addToast(state, board.reason ?? 'Доска контрактов недоступна.', 'bad');
    return false;
  }
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
  if (contract.kind === 'courier') {
    // Груз фракции едет в трюме под пломбой: продать или выгрузить его нельзя.
    const free = cargoFree(ship);
    if (free < contract.amount) {
      addToast(
        state,
        `Под опечатанный груз нужно ${contract.amount} ед. трюма, свободно ${free}.`,
        'bad',
      );
      return false;
    }
    const loaded = addCargo(ship, contract.resource, contract.amount);
    sealCargo(ship, contract.resource, loaded);
    contract.accepted = true;
    contract.cargoLoaded = true;
    const target = contractTargetName(state, contract);
    addToast(
      state,
      `Груз опечатан и погружен: сдать ${contract.amount} × ${resource(contract.resource).name} в системе ${target} — ${hops(contract.hops)}.`,
      'info',
    );
    addNews(
      state,
      `Курьерский контракт: «${resource(contract.resource).name}» доставить в ${target} за ${contract.reward} кр.`,
      'trade',
      system.id,
      system.factionId,
    );
    return true;
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
  const found = findContract(state, contractId);
  if (!found) return false;
  const { contract, system } = found;
  const ship = playerShip(state);
  contract.accepted = false;
  if (contract.kind === 'courier' && contract.cargoLoaded) {
    contract.cargoLoaded = false;
    if (ship) {
      releaseSealed(ship, contract.resource, sealedUnits(ship, contract.resource));
      removeCargo(ship, contract.resource, contract.amount);
    }
    changeReputation(state, contract.factionId, -3);
    addToast(state, 'Контракт расторгнут: опечатанный груз изъят, репутация −3.', 'bad');
    addNews(
      state,
      `Курьерский контракт на «${resource(contract.resource).name}» расторгнут; груз возвращён в ${system.name}.`,
      'trade',
      system.id,
      system.factionId,
    );
    return true;
  }
  addToast(state, 'Контракт расторгнут.', 'info');
  return true;
}

export function canDeliverContract(state: GameState, contract: Contract): boolean {
  const ship = playerShip(state);
  if (!ship || ship.travel) return false;
  if (!contract.accepted) return false;
  if (contract.kind === 'courier') {
    return (
      ship.systemId === contract.targetSystemId &&
      contract.cargoLoaded &&
      sealedUnits(ship, contract.resource) >= contract.amount
    );
  }
  return (
    ship.systemId === contract.systemId && contractUnitsInHold(state, contract) >= contract.amount
  );
}

export function deliverContract(state: GameState, contractId: string): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  const found = findContract(state, contractId);
  if (!found) {
    addToast(state, 'Такого контракта больше нет на доске.', 'bad');
    return false;
  }
  const { contract, system } = found;
  if (!contract.accepted) {
    addToast(state, 'Сначала примите контракт.', 'bad');
    return false;
  }
  if (contract.kind === 'courier') {
    const target = contractTargetName(state, contract);
    if (ship.systemId !== contract.targetSystemId) {
      addToast(state, `Груз сдают в системе ${target}, а не здесь.`, 'bad');
      return false;
    }
    if (sealedUnits(ship, contract.resource) < contract.amount) {
      addToast(
        state,
        `Опечатанного груза нет: нужно ${contract.amount} × ${resource(contract.resource).name}.`,
        'bad',
      );
      return false;
    }
    releaseSealed(ship, contract.resource, contract.amount);
    removeCargo(ship, contract.resource, contract.amount);
    return payContract(state, contract, system, `Груз доставлен в систему ${target}`);
  }
  if (contractUnitsInHold(state, contract) < contract.amount) {
    addToast(
      state,
      `В трюме нужно ${contract.amount} × ${resource(contract.resource).name} (сейчас ${contractUnitsInHold(state, contract)}).`,
      'bad',
    );
    return false;
  }
  removeCargo(ship, contract.resource, contract.amount);
  return payContract(state, contract, system, `Груз сдан в системе ${system.name}`);
}

/** Общая часть сдачи: деньги, репутация, статистика и новость. */
function payContract(
  state: GameState,
  contract: Contract,
  boardSystem: StarSystem,
  headline: string,
): boolean {
  state.player.credits += contract.reward;
  state.player.stats.earned += contract.reward;
  state.player.stats.contracts += 1;
  const rep = changeReputation(state, contract.factionId, contract.repReward);
  const system = state.systems[contractTargetId(contract)] ?? boardSystem;
  boardSystem.contracts = boardSystem.contracts.filter((c) => c.id !== contract.id);
  addToast(state, `Контракт выполнен: +${contract.reward} кр, +${rep} репутации.`, 'good');
  addNews(
    state,
    `${headline}: ${contract.amount} × ${resource(contract.resource).name} за ${contract.reward} кр.`,
    'trade',
    system.id,
    system.factionId,
  );
  return true;
}

/**
 * Просроченные активные контракты: за срыв репутация падает, а опечатанный
 * груз фракция забирает обратно. Возвращает число потерянных заказов.
 */
export function expireAcceptedContracts(state: GameState, day: number): number {
  const ship = playerShip(state);
  let lost = 0;
  for (const id of state.systemIds) {
    const system = state.systems[id];
    if (!system) continue;
    const expired = system.contracts.filter((c) => c.accepted && c.expiresDay <= day);
    if (expired.length === 0) continue;
    system.contracts = system.contracts.filter((c) => !(c.accepted && c.expiresDay <= day));
    for (const contract of expired) {
      lost += 1;
      const carried = contract.kind === 'courier' && contract.cargoLoaded && !!ship;
      if (carried && ship) {
        removeCargo(ship, contract.resource, contract.amount);
        releaseSealed(ship, contract.resource, sealedUnits(ship, contract.resource));
      }
      const penalty = carried ? -5 : -3;
      changeReputation(state, contract.factionId, penalty);
      addToast(
        state,
        carried
          ? 'Срок курьерского контракта истёк: груз изъят, репутация −5.'
          : 'Срок контракта истёк: репутация −3.',
        'bad',
      );
      addNews(
        state,
        `Срок контракта на «${resource(contract.resource).name}» истёк: заказчик недоволен.`,
        'trade',
        system.id,
        system.factionId,
      );
    }
  }
  return lost;
}

