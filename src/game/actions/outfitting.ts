import type { Amounts, GameState, ModuleType, ResourceId, Ship, ShipTypeId } from '../types.ts';
import { createShip, playerShip } from '../state/create.ts';
import { moduleDef, moduleLevel } from '../data/modules.ts';
import { shipType } from '../data/ships.ts';
import { powerBudgetFor, removeCargo, shipStats } from '../ships/ship.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { fleetCap, fleetShips } from '../sim/fleet.ts';
import { removeStorage } from '../sim/station.ts';

/**
 * Outfitting and hull trading. Upgrades need a shipyard: either the local system
 * shipyard or the player's own Shipyard building, whichever is better.
 */

export function shipyardTierHere(state: GameState, ship: Ship): number {
  const system = state.systems[ship.systemId];
  const station = system?.stations.find((s) => s.hasShipyard);
  let tier = 0;
  if (station) {
    switch (station.type) {
      case 'pirate':
      case 'industrial':
      case 'military':
      case 'research':
        tier = 2;
        break;
      default:
        tier = 1;
        break;
    }
  }
  if (ship.systemId === state.station.systemId) {
    tier = Math.max(tier, state.station.buildings.shipyard ?? 0);
  }
  return tier;
}

export interface ModuleOffer {
  type: ModuleType;
  level: number;
  name: string;
  cost: number;
  materials: Amounts;
  power: number;
  note: string;
  owned: boolean;
  locked: boolean;
  affordable: boolean;
  powered: boolean;
  hasMaterials: boolean;
  tierNeeded: number;
}

export function moduleOffers(state: GameState, ship: Ship): ModuleOffer[] {
  const tier = shipyardTierHere(state, ship);
  const offers: ModuleOffer[] = [];
  for (const type of Object.keys(ship.modules) as ModuleType[]) {
    const def = moduleDef(type);
    for (const levelDef of def.levels) {
      const owned = (ship.modules[type] ?? 0) >= levelDef.level;
      const tierNeeded = Math.max(1, levelDef.level - 1);
      const affordable = state.player.credits >= levelDef.cost;
      offers.push({
        type,
        level: levelDef.level,
        name: levelDef.name,
        cost: levelDef.cost,
        materials: levelDef.materials,
        power: levelDef.power,
        note: levelDef.note,
        owned,
        locked: tier < tierNeeded,
        affordable,
        powered: powerBudgetFor(ship, { [type]: levelDef.level }).ok,
        hasMaterials: hasMaterials(state, ship, levelDef.materials),
        tierNeeded,
      });
    }
  }
  return offers;
}

function hasMaterials(state: GameState, ship: Ship, materials: Amounts): boolean {
  for (const [id, qty] of Object.entries(materials) as [ResourceId, number][]) {
    if (!qty) continue;
    const inHold = ship.cargo[id] ?? 0;
    const inStation = ship.systemId === state.station.systemId ? state.station.storage[id] ?? 0 : 0;
    if (inHold + inStation < qty) return false;
  }
  return true;
}

/** Materials are taken from the hold first and topped up from station storage. */
function spendMaterials(state: GameState, ship: Ship, materials: Amounts): void {
  const fromHold: Amounts = {};
  const fromStation: Amounts = {};
  for (const [id, qty] of Object.entries(materials) as [ResourceId, number][]) {
    if (!qty) continue;
    const useHold = Math.min(ship.cargo[id] ?? 0, qty);
    if (useHold > 0) fromHold[id] = useHold;
    if (qty - useHold > 0) fromStation[id] = qty - useHold;
  }
  for (const [id, qty] of Object.entries(fromHold) as [ResourceId, number][]) {
    removeCargo(ship, id, qty);
  }
  if (Object.keys(fromStation).length > 0) removeStorage(state, fromStation);
}

export function installModule(state: GameState, ship: Ship, type: ModuleType, level: number): boolean {
  if (ship.travel || ship.status === 'transit') {
    addToast(state, 'Модули ставят в доке, а не на ходу.', 'bad');
    return false;
  }
  const def = moduleLevel(type, level);
  if (!def) return false;
  const tier = shipyardTierHere(state, ship);
  const required = Math.max(1, level - 1);
  if (tier < required) {
    addToast(state, `Для Mk ${level} нужна верфь уровня ${required}; здесь доступен ${tier}.`, 'bad');
    return false;
  }
  if (level <= (ship.modules[type] ?? 0)) {
    addToast(state, `«${moduleDef(type).name} Mk ${level}» — это не улучшение.`, 'info');
    return false;
  }
  if (state.player.credits < def.cost) {
    addToast(state, `Нужно ${def.cost} кр для «${def.name}».`, 'bad');
    return false;
  }
  if (!hasMaterials(state, ship, def.materials)) {
    addToast(state, `Не хватает материалов для «${def.name}».`, 'bad');
    return false;
  }
  const budget = powerBudgetFor(ship, { [type]: level });
  if (!budget.ok) {
    addToast(
      state,
      `Перегрузка реактора: ${budget.draw}/${budget.capacity} энергии. Сначала поставьте реактор мощнее.`,
      'bad',
    );
    return false;
  }
  spendMaterials(state, ship, def.materials);
  state.player.credits -= def.cost;
  ship.modules[type] = level;
  const stats = shipStats(ship);
  ship.hull = Math.min(ship.hull, stats.hullMax);
  ship.shield = Math.min(ship.shield, stats.shieldMax);
  ship.fuel = Math.min(ship.fuel, stats.fuelMax);
  addToast(state, `${ship.name}: установлено «${def.name}» за ${def.cost} кр.`, 'good');
  addNews(state, `${ship.name} прошёл переоборудование: установлено «${def.name}».`, 'station', ship.systemId);
  return true;
}

export interface HullOffer {
  typeId: ShipTypeId;
  name: string;
  role: string;
  price: number;
  affordable: boolean;
  slotFree: boolean;
}

export function hullsForSale(state: GameState, ship: Ship): HullOffer[] {
  const tier = shipyardTierHere(state, ship);
  if (tier <= 0) return [];
  const available: ShipTypeId[] =
    tier >= 2 ? ['scout', 'miner', 'hauler', 'corvette'] : ['scout', 'miner', 'hauler'];
  const slotFree = state.ships.length < fleetCap(state);
  return available.map((typeId) => {
    const def = shipType(typeId);
    return {
      typeId,
      name: def.name,
      role: def.role,
      price: def.price,
      affordable: state.player.credits >= def.price,
      slotFree,
    };
  });
}

export function purchaseShip(state: GameState, typeId: ShipTypeId): Ship | null {
  const flagship = playerShip(state);
  if (!flagship) return null;
  if (shipyardTierHere(state, flagship) <= 0) {
    addToast(state, 'Здесь нет верфи. Летите к верфи или постройте свою.', 'bad');
    return null;
  }
  if (state.ships.length >= fleetCap(state)) {
    addToast(
      state,
      `Флот заполнен (${fleetCap(state)}). Улучшите командный центр или офис флота.`,
      'bad',
    );
    return null;
  }
  const def = shipType(typeId);
  if (!def) {
    addToast(state, 'Такого корпуса нет на рынке.', 'bad');
    return null;
  }
  if (state.player.credits < def.price) {
    addToast(state, `«${def.name}» стоит ${def.price} кр.`, 'bad');
    return null;
  }
  state.player.credits -= def.price;
  const count = fleetShips(state).length + 1;
  const name = `${def.name.toUpperCase()}-${String(count).padStart(2, '0')}`;
  const ship = createShip(typeId, flagship.systemId, name);
  ship.modules.engine = 1;
  state.ships.push(ship);
  addToast(state, `${name} введён в строй за ${def.price} кр.`, 'good');
  addNews(
    state,
    `${name} присоединился к флоту в системе ${state.systems[flagship.systemId]?.name ?? 'станция'}.`,
    'station',
    flagship.systemId,
  );
  return ship;
}

/** Resale value: 60% of the hull, scaled by condition, plus 40% of the hardware. */
export function shipResaleValue(ship: Ship): number {
  let modules = 0;
  for (const [type, level] of Object.entries(ship.modules) as [ModuleType, number][]) {
    for (let l = 1; l <= level; l += 1) modules += (moduleLevel(type, l)?.cost ?? 0) * 0.4;
  }
  const stats = shipStats(ship);
  const condition = 0.6 + 0.4 * (ship.hull / Math.max(1, stats.hullMax));
  return Math.round(shipType(ship.typeId).price * 0.6 * condition + modules);
}

export function sellShip(state: GameState, shipId: string): number {
  if (shipId === state.player.shipId) {
    addToast(state, 'Флагман продать нельзя.', 'bad');
    return 0;
  }
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return 0;
  if (ship.travel || ship.mission) {
    addToast(state, 'Верните корабль из полёта, прежде чем продавать.', 'bad');
    return 0;
  }
  const value = shipResaleValue(ship);
  state.ships = state.ships.filter((s) => s.id !== shipId);
  state.player.credits += value;
  addToast(state, `${ship.name} продан за ${value} кр.`, 'good');
  return value;
}

export function renameShip(state: GameState, shipId: string, name: string): void {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship) return;
  const clean = name.trim().slice(0, 18);
  if (clean.length === 0) return;
  ship.name = clean;
}

