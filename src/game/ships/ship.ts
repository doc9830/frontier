import type { MakerId, ModuleLevelDef, ModuleType, ResourceId } from '../types.ts';
import type { Ship } from '../types.ts';
import { shipType } from '../data/ships.ts';
import { tunedLevel } from '../data/makers.ts';
import { RESOURCES } from '../data/resources.ts';

/** Ship type plus every installed module, resolved into final numbers. */
export interface ShipStats {
  hullMax: number;
  shieldMax: number;
  cargo: number;
  fuelMax: number;
  jumpRange: number;
  speed: number;
  combat: number;
  mining: number;
  scanner: number;
  powerCapacity: number;
  powerDraw: number;
  /** 1.0 = no fuel saving, 0.5 = half fuel per hop */
  fuelEfficiency: number;
}

export function emptyModules(): Record<ModuleType, number> {
  return {
    engine: 0,
    jumpDrive: 0,
    shield: 0,
    reactor: 0,
    cargo: 0,
    scanner: 0,
    weapon: 0,
  };
}

export function emptyMakers(): Partial<Record<ModuleType, MakerId>> {
  return {};
}

/** Клеймо верфи на модуле: у старых сохранений его нет — считаем стандартным. */
export function makerOf(ship: Ship, type: ModuleType): MakerId {
  return ship.makers?.[type] ?? 'standard';
}

/** Уровень модуля в сборке той верфи, которая его ставила. */
export function equippedLevel(ship: Ship, type: ModuleType): ModuleLevelDef | null {
  return tunedLevel(type, ship.modules[type], makerOf(ship, type));
}

export function shipStats(ship: Ship): ShipStats {
  const base = shipType(ship.typeId);
  let hullMax = base.hull;
  let shieldMax = base.shield;
  let cargo = base.cargo;
  let jumpRange = base.jumpRange;
  let speed = base.speed;
  let combat = base.combat;
  let mining = base.mining;
  let scanner = base.scanner;
  let powerCapacity = base.power;
  let powerDraw = 0;
  let fuelEfficiency = 1;
  let speedMod = 0;

  const engine = equippedLevel(ship, 'engine');
  if (engine) {
    speed += engine.effect;
    powerDraw += engine.power;
  }

  const jump = equippedLevel(ship, 'jumpDrive');
  if (jump) {
    jumpRange += jump.effect;
    powerDraw += jump.power;
    fuelEfficiency = [1, 0.85, 0.7, 0.5][jump.level] ?? 0.5;
  }

  const shield = equippedLevel(ship, 'shield');
  if (shield) {
    shieldMax += shield.effect;
    powerDraw += shield.power;
    speedMod += shield.speedMod ?? 0;
  }

  const reactor = equippedLevel(ship, 'reactor');
  if (reactor) {
    powerCapacity += reactor.effect;
    powerDraw += reactor.power;
  }

  const cargoModule = equippedLevel(ship, 'cargo');
  if (cargoModule) {
    cargo += cargoModule.effect;
    powerDraw += cargoModule.power;
    speedMod += cargoModule.speedMod ?? 0;
  }

  const scannerModule = equippedLevel(ship, 'scanner');
  if (scannerModule) {
    scanner += scannerModule.effect;
    powerDraw += scannerModule.power;
  }

  const weapon = equippedLevel(ship, 'weapon');
  if (weapon) {
    combat += weapon.effect;
    powerDraw += weapon.power;
  }

  const finalSpeed = Math.max(0.25, speed * (1 + speedMod));
  return {
    hullMax,
    shieldMax,
    cargo: Math.round(cargo),
    fuelMax: base.fuel,
    jumpRange,
    speed: Math.round(finalSpeed * 100) / 100,
    combat,
    mining,
    scanner,
    powerCapacity,
    powerDraw,
    fuelEfficiency,
  };
}

export function cargoUsed(ship: Ship): number {
  let total = 0;
  for (const def of RESOURCES) total += ship.cargo[def.id] ?? 0;
  return total;
}

export function cargoFree(ship: Ship): number {
  return Math.max(0, shipStats(ship).cargo - cargoUsed(ship));
}

/** Единицы ресурса, которые лежат в трюме под контрактной пломбой. */
export function sealedUnits(ship: Ship, id: ResourceId): number {
  return ship.sealed?.[id] ?? 0;
}

export function sealedTotal(ship: Ship): number {
  let total = 0;
  if (!ship.sealed) return 0;
  for (const def of RESOURCES) total += ship.sealed[def.id] ?? 0;
  return total;
}

/** Сколько единиц ресурса игрок вправе продать: опечатанный груз не его. */
export function sellableUnits(ship: Ship, id: ResourceId): number {
  return Math.max(0, (ship.cargo[id] ?? 0) - sealedUnits(ship, id));
}

/** Ставит пломбу фракции на груз, который уже лежит в трюме. */
export function sealCargo(ship: Ship, id: ResourceId, qty: number): number {
  const available = sellableUnits(ship, id);
  const sealed = Math.min(available, Math.max(0, Math.trunc(qty)));
  if (sealed <= 0) return 0;
  ship.sealed = { ...(ship.sealed ?? {}) };
  ship.sealed[id] = (ship.sealed[id] ?? 0) + sealed;
  return sealed;
}

/** Снимает пломбу: груз снова становится обычным товаром в трюме. */
export function releaseSealed(ship: Ship, id: ResourceId, qty: number): number {
  const seal = sealedUnits(ship, id);
  const released = Math.min(seal, Math.max(0, Math.trunc(qty)));
  if (released <= 0) return 0;
  const left = seal - released;
  if (left <= 0) delete ship.sealed?.[id];
  else if (ship.sealed) ship.sealed[id] = left;
  return released;
}

export function addCargo(ship: Ship, id: ResourceId, qty: number): number {
  if (qty <= 0) return 0;
  const free = cargoFree(ship);
  const added = Math.min(qty, free);
  if (added <= 0) return 0;
  ship.cargo[id] = (ship.cargo[id] ?? 0) + added;
  return added;
}

export function removeCargo(ship: Ship, id: ResourceId, qty: number): number {
  const have = ship.cargo[id] ?? 0;
  const removed = Math.min(have, qty);
  if (removed <= 0) return 0;
  const left = have - removed;
  if (left <= 0) delete ship.cargo[id];
  else ship.cargo[id] = left;
  return removed;
}

/**
 * Resolves the ship with a proposed module loadout, so the UI can show the
 * power budget before the player spends a single credit.
 */
export function powerBudgetFor(
  ship: Ship,
  changes: Partial<Record<ModuleType, number>>,
  makerChanges: Partial<Record<ModuleType, MakerId>> = {},
): { capacity: number; draw: number; ok: boolean; stats: ShipStats } {
  const merged: Record<ModuleType, number> = { ...ship.modules, ...changes };
  const makers = { ...(ship.makers ?? {}), ...makerChanges };
  const stats = shipStats({ ...ship, modules: merged, makers });
  return {
    capacity: stats.powerCapacity,
    draw: stats.powerDraw,
    ok: stats.powerDraw <= stats.powerCapacity,
    stats,
  };
}

