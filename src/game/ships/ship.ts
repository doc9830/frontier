import type { Amounts, ModuleType, ResourceId } from '../types.ts';
import type { Ship, ShipTypeId } from '../types.ts';
import { shipType } from '../data/ships.ts';
import { moduleLevel } from '../data/modules.ts';
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

  const engine = moduleLevel('engine', ship.modules.engine);
  if (engine) {
    speed += engine.effect;
    powerDraw += engine.power;
  }

  const jump = moduleLevel('jumpDrive', ship.modules.jumpDrive);
  if (jump) {
    jumpRange += jump.effect;
    powerDraw += jump.power;
    fuelEfficiency = [1, 0.85, 0.7, 0.5][jump.level] ?? 0.5;
  }

  const shield = moduleLevel('shield', ship.modules.shield);
  if (shield) {
    shieldMax += shield.effect;
    powerDraw += shield.power;
    speedMod += shield.speedMod ?? 0;
  }

  const reactor = moduleLevel('reactor', ship.modules.reactor);
  if (reactor) {
    powerCapacity += reactor.effect;
    powerDraw += reactor.power;
  }

  const cargoModule = moduleLevel('cargo', ship.modules.cargo);
  if (cargoModule) {
    cargo += cargoModule.effect;
    powerDraw += cargoModule.power;
    speedMod += cargoModule.speedMod ?? 0;
  }

  const scannerModule = moduleLevel('scanner', ship.modules.scanner);
  if (scannerModule) {
    scanner += scannerModule.effect;
    powerDraw += scannerModule.power;
  }

  const weapon = moduleLevel('weapon', ship.modules.weapon);
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
): { capacity: number; draw: number; ok: boolean; stats: ShipStats } {
  const merged: Record<ModuleType, number> = { ...ship.modules, ...changes };
  const stats = shipStats({ ...ship, modules: merged });
  return {
    capacity: stats.powerCapacity,
    draw: stats.powerDraw,
    ok: stats.powerDraw <= stats.powerCapacity,
    stats,
  };
}

export function moduleLabel(type: ModuleType, level: number): string {
  if (level <= 0) return 'пусто';
  return moduleLevel(type, level)?.name ?? `${type} Mk ${level}`;
}

export function mergeAmounts(target: Amounts, source: Amounts, factor = 1): void {
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    const id = key as ResourceId;
    target[id] = (target[id] ?? 0) + value * factor;
  }
}

export function shipTypeLabel(typeId: ShipTypeId): string {
  return shipType(typeId).name.toUpperCase();
}
