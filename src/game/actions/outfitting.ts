import type {
  Amounts,
  GameState,
  MakerId,
  ModuleGroupId,
  ModuleType,
  ResourceId,
  Ship,
  ShipTypeId,
  SystemStation,
} from '../types.ts';
import { createShip, playerShip } from '../state/create.ts';
import { MODULE_GROUPS, moduleDef, moduleGroupOf, moduleLevel } from '../data/modules.ts';
import { shipType } from '../data/ships.ts';
import { resource } from '../data/resources.ts';
import { makerDef, makerForFaction, makerModuleNote, tunedLevel } from '../data/makers.ts';
import { makerOf, powerBudgetFor, removeCargo, shipStats } from '../ships/ship.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { fleetCap, fleetShips } from '../sim/fleet.ts';
import { depotHere, depotRecord, takeFromDepot } from '../sim/depots.ts';
import { serviceAccess } from '../data/stations.ts';

/**
 * Outfitting and hull trading. Верфь — это объект: у фракционных станций она
 * ставит модули своей сборки (щиты Федерации, трюмы Хеликса, движки Колоний),
 * а на своей базе можно построить собственную верфь «Фронтир» и не зависеть от
 * репутации. Модули разных верфей комбинируются на одном корпусе, поэтому
 * корабль можно собирать по частям.
 */

/** Уровень верфи фракционной станции: военные и промышленные доки выше классом. */
const STATION_YARD_TIER: Record<SystemStation['type'], number> = {
  trade: 1,
  mining: 1,
  industrial: 2,
  research: 2,
  military: 2,
  pirate: 2,
};

export interface ShipyardHere {
  /** Доступный уровень: 0 — верфи рядом нет, 1..3 — что можно ставить. */
  tier: number;
  /** Откуда услуга: станция системы, своя база или ничего. */
  source: 'station' | 'own' | 'none';
  /** Кто ставит модули и чьё клеймо получит оборудование. */
  maker: MakerId;
  label: string;
  hint: string;
  station: SystemStation | null;
  /** Сколько уровней у своей верфи в этой системе (0, если не построена). */
  ownLevel: number;
  /** Верфь рядом есть, но закрыта: причина для интерфейса. */
  blockedReason: string | null;
}

export function shipyardHere(state: GameState, ship: Ship): ShipyardHere {
  const system = state.systems[ship.systemId];
  let stationTier = 0;
  let station: SystemStation | null = null;
  let blockedReason: string | null = null;
  for (const candidate of system?.stations ?? []) {
    if (!candidate.hasShipyard) continue;
    const access = serviceAccess(state, candidate, 'shipyard');
    if (!access.ok) {
      blockedReason = blockedReason ?? access.reason;
      continue;
    }
    const tier = STATION_YARD_TIER[candidate.type] ?? 1;
    if (tier > stationTier) {
      stationTier = tier;
      station = candidate;
    }
  }

  const ownLevel =
    ship.systemId === state.station.systemId && state.station.phase === 'operational'
      ? state.station.buildings.shipyard ?? 0
      : 0;

  if (ownLevel > 0 && ownLevel >= stationTier) {
    const def = makerDef('frontier');
    return {
      tier: ownLevel,
      source: 'own',
      maker: 'frontier',
      label: `Ваша верфь Mk${ownLevel}`,
      hint: def.pitch,
      station: null,
      ownLevel,
      blockedReason: null,
    };
  }

  if (station) {
    const maker = makerForFaction(station.factionId);
    const def = makerDef(maker);
    return {
      tier: stationTier,
      source: 'station',
      maker,
      label: `${def.name} · уровень ${stationTier}`,
      hint: def.pitch,
      station,
      ownLevel,
      blockedReason: null,
    };
  }

  return {
    tier: 0,
    source: 'none',
    maker: 'standard',
    label: 'Верфи нет',
    hint: 'Фракции держат верфи в узловых системах; свою можно построить на базе.',
    station: null,
    ownLevel,
    blockedReason,
  };
}

export interface MaterialNeed {
  id: ResourceId;
  name: string;
  need: number;
  /** Сколько уже есть: трюм плюс свой склад, если он в этой системе. */
  have: number;
  ok: boolean;
}

export interface ModuleOffer {
  type: ModuleType;
  group: ModuleGroupId;
  level: number;
  maker: MakerId;
  name: string;
  cost: number;
  materials: Amounts;
  /** Те же материалы, но с русскими именами и наличием — для панели верфи. */
  needs: MaterialNeed[];
  power: number;
  note: string;
  owned: boolean;
  locked: boolean;
  affordable: boolean;
  powered: boolean;
  hasMaterials: boolean;
  tierNeeded: number;
  /** Энергопотребление и лимит после установки — для полосы бюджета. */
  powerAfter: number;
  powerCapacity: number;
  /** Строка верфи про этот модуль: чем сборка отличается от серийной. */
  makerNote: string | null;
}



export function moduleOffers(state: GameState, ship: Ship): ModuleOffer[] {
  const yard = shipyardHere(state, ship);
  const offers: ModuleOffer[] = [];
  for (const group of MODULE_GROUPS) {
    for (const type of group.types) {
      for (const levelDef of moduleDef(type).levels) {
        offers.push(offerFor(state, ship, yard, type, levelDef.level));
      }
    }
  }
  return offers;
}

function offerFor(
  state: GameState,
  ship: Ship,
  yard: ShipyardHere,
  type: ModuleType,
  level: number,
): ModuleOffer {
  // Числа берём из сборки той верфи, которая стоит в системе: она же поставит
  // модуль и поставит на нём своё клеймо.
  const tuned = tunedLevel(type, level, yard.maker) ?? moduleLevel(type, level)!;
  const tierNeeded = Math.max(1, level - 1);
  const budget = powerBudgetFor(ship, { [type]: level }, { [type]: yard.maker });
  return {
    type,
    group: moduleGroupOf(type).id,
    level,
    maker: yard.maker,
    name: tuned.name,
    cost: tuned.cost,
    materials: tuned.materials,
    needs: materialNeeds(state, ship, tuned.materials),
    power: tuned.power,
    note: tuned.note,
    owned: (ship.modules[type] ?? 0) >= level,
    locked: yard.tier < tierNeeded,
    affordable: state.player.credits >= tuned.cost,
    powered: budget.ok,
    hasMaterials: hasMaterials(state, ship, tuned.materials),
    tierNeeded,
    powerAfter: budget.draw,
    powerCapacity: budget.capacity,
    makerNote: makerModuleNote(type, yard.maker),
  };
}

export interface ModuleOfferGroup {
  id: ModuleGroupId;
  label: string;
  hint: string;
  offers: ModuleOffer[];
  /** Что уже стоит в этой группе: уровень и клеймо верфи. */
  installed: { type: ModuleType; level: number; maker: MakerId }[];
  /** Максимальный уровень в группе — для строки «установлено». */
  maxInstalled: number;
}

/** Те же предложения, но разложенные по разделам верфи — так их читает UI. */
export function moduleOfferGroups(state: GameState, ship: Ship): ModuleOfferGroup[] {
  const offers = moduleOffers(state, ship);
  return MODULE_GROUPS.map((group) => {
    const installed = group.types.map((type) => ({
      type,
      level: ship.modules[type] ?? 0,
      maker: makerOf(ship, type),
    }));
    return {
      id: group.id,
      label: group.label,
      hint: group.hint,
      offers: offers.filter((offer) => offer.group === group.id),
      installed,
      maxInstalled: installed.reduce((max, entry) => Math.max(max, entry.level), 0),
    };
  });
}


/** Сколько материалов уже под рукой: трюм плюс склад, у которого стоит корабль. */
function availableUnits(state: GameState, ship: Ship, id: ResourceId): number {
  const inHold = ship.cargo[id] ?? 0;
  return inHold + (depotHere(state)?.amounts[id] ?? 0);
}

/**
 * Требования верфи по материалам с именами и наличием. Панель показывает это
 * списком, потому что внутренние id вроде «metal» игроку ничего не говорят.
 */
function materialNeeds(state: GameState, ship: Ship, materials: Amounts): MaterialNeed[] {
  const needs: MaterialNeed[] = [];
  for (const [id, need] of Object.entries(materials) as [ResourceId, number][]) {
    if (!need) continue;
    const have = availableUnits(state, ship, id);
    needs.push({ id, name: resource(id).name, need, have, ok: have >= need });
  }
  return needs;
}

function hasMaterials(state: GameState, ship: Ship, materials: Amounts): boolean {
  for (const [id, qty] of Object.entries(materials) as [ResourceId, number][]) {
    if (!qty) continue;
    if (availableUnits(state, ship, id) < qty) return false;
  }
  return true;
}


/** Materials are taken from the hold first and topped up from the depot here. */
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
  if (Object.keys(fromStation).length > 0) {
    const depot = depotHere(state);
    const record = depot ? depotRecord(state, depot.id) : null;
    if (record) takeFromDepot(state, record, fromStation);
  }
}

export function installModule(state: GameState, ship: Ship, type: ModuleType, level: number): boolean {
  if (ship.travel || ship.status === 'transit') {
    addToast(state, 'Модули ставят в доке, а не на ходу.', 'bad');
    return false;
  }
  const yard = shipyardHere(state, ship);
  if (yard.tier <= 0) {
    addToast(
      state,
      yard.blockedReason ??
        'Здесь нет верфи. Летите к верфи фракции или постройте свою на базе.',
      'bad',
    );
    return false;
  }
  // Модуль ставится по спецификации местной верфи: её цена, материалы и клеймо.
  const def = tunedLevel(type, level, yard.maker);
  if (!def) return false;
  const required = Math.max(1, level - 1);
  if (yard.tier < required) {
    addToast(state, `Для Mk ${level} нужна верфь уровня ${required}; здесь доступен ${yard.tier}.`, 'bad');
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
    const missing = materialNeeds(state, ship, def.materials).filter((need) => !need.ok);
    addToast(
      state,
      `Для «${def.name}» не хватает: ${missing
        .map((need) => `${need.name} ${need.have}/${need.need}`)
        .join(', ')}. Купите материалы на рынке или возьмите со своего склада.`,
      'bad',
    );
    return false;
  }
  const budget = powerBudgetFor(ship, { [type]: level }, { [type]: yard.maker });
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
  ship.makers = { ...(ship.makers ?? {}), [type]: yard.maker };
  const stats = shipStats(ship);
  ship.hull = Math.min(ship.hull, stats.hullMax);
  ship.shield = Math.min(ship.shield, stats.shieldMax);
  ship.fuel = Math.min(ship.fuel, stats.fuelMax);
  addToast(state, `${ship.name}: установлено «${def.name}» за ${def.cost} кр.`, 'good');
  addNews(
    state,
    `${ship.name} прошёл переоборудование на «${yard.label}»: установлено «${def.name}».`,
    'station',
    ship.systemId,
  );
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
  const yard = shipyardHere(state, ship);
  if (yard.tier <= 0) return [];
  const available: ShipTypeId[] =
    yard.tier >= 2 ? ['scout', 'miner', 'hauler', 'corvette'] : ['scout', 'miner', 'hauler'];
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
  const yard = shipyardHere(state, flagship);
  if (yard.tier <= 0) {
    addToast(
      state,
      yard.blockedReason ?? 'Здесь нет верфи. Летите к верфи или постройте свою.',
      'bad',
    );
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
  // Корпус выходит из доков с двигателем местной сборки — остальное докупается.
  ship.modules.engine = 1;
  ship.makers = { ...(ship.makers ?? {}), engine: yard.maker };
  state.ships.push(ship);
  addToast(state, `${name} введён в строй за ${def.price} кр.`, 'good');
  addNews(
    state,
    `${name} сошёл со стапелей «${yard.label}» в системе ${state.systems[flagship.systemId]?.name ?? 'станция'}.`,
    'station',
    flagship.systemId,
  );
  return ship;
}

/** Resale value: 60% of the hull, scaled by condition, plus 40% of the hardware. */
export function shipResaleValue(ship: Ship): number {
  let modules = 0;
  for (const [type, level] of Object.entries(ship.modules) as [ModuleType, number][]) {
    // Считаем по сборке той верфи, что ставила модули: у Хеликса они дороже.
    const maker = makerOf(ship, type);
    for (let l = 1; l <= level; l += 1) {
      modules += (tunedLevel(type, l, maker)?.cost ?? 0) * 0.4;
    }
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

