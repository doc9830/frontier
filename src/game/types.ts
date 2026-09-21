/**
 * FRONTIER — core game types.
 *
 * Everything in `src/game` is plain, serializable data + pure-ish functions so
 * that the whole world state can live in a single localStorage blob.
 */

export type ResourceId =
  | 'ore'
  | 'gas'
  | 'rareOre'
  | 'metal'
  | 'fuel'
  | 'food'
  | 'electronics'
  | 'medicine'
  | 'artifacts';

export type ModuleType =
  | 'engine'
  | 'jumpDrive'
  | 'shield'
  | 'reactor'
  | 'cargo'
  | 'scanner'
  | 'weapon';

/**
 * Производитель модуля. Модуль несёт клеймо верфи, которая его поставила, и
 * вместе с ним — фракционные особенности сборки. Это же поле делает верфи
 * разных фракций невзаимозаменяемыми: щит Федерации и трюм Хеликса можно
 * поставить на один корабль и комбинировать бонусы.
 */
export type MakerId =
  | 'standard'
  | 'federation'
  | 'helix'
  | 'colonies'
  | 'union'
  | 'lawless'
  | 'frontier';

/** Группа улучшений: верфь показывает модули разделами, а не одной простыней. */
export type ModuleGroupId = 'mobility' | 'defense' | 'logistics' | 'sensors' | 'arms';

export type ShipTypeId = 'scout' | 'miner' | 'hauler' | 'corvette';

export type BuildingType =
  | 'commandCenter'
  | 'warehouse'
  | 'dock'
  | 'miningHub'
  | 'refinery'
  | 'shipyard'
  | 'radar'
  | 'researchLab'
  | 'fleetOffice';

export type ShipStatus = 'docked' | 'transit' | 'mining' | 'trading' | 'escort' | 'survey';

/** Стадия строительства собственной станции. */
export type StationPhase = 'planned' | 'foundation' | 'operational';

/** Что именно сканирует корабль. */
export type SurveyKind = 'belt' | 'system' | 'deep';


export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export type Grade = 'LOW' | 'MEDIUM' | 'HIGH';

export type Amounts = Partial<Record<ResourceId, number>>;

export interface Vec2 {
  x: number;
  y: number;
}

export const TICKS = {
  /** real seconds per in-game day */
  secondsPerDay: 60,
  /** real seconds per jump hop for hull speed 1.0 */
  secondsPerHop: 9,
  /** fuel units burned per hop for a jumpDrive multiplier of 1.0 */
  fuelPerHop: 2.5,
  /** game seconds between market drift steps */
  marketStepSeconds: 20,
} as const;

// ---------------------------------------------------------------------------
// static content definitions
// ---------------------------------------------------------------------------

export interface ResourceDef {
  id: ResourceId;
  name: string;
  symbol: string;
  basePrice: number;
  /** raw material (comes out of asteroid belts) */
  raw: boolean;
  /** industrial goods usable as construction materials */
  industrial: boolean;
  color: string;
}

export interface FactionDef {
  id: string;
  name: string;
  short: string;
  color: string;
  motto: string;
  exports: ResourceId[];
  imports: ResourceId[];
  /** 0..1, higher means better patrols */
  securityBonus: number;
}

export interface ShipTypeDef {
  id: ShipTypeId;
  name: string;
  role: string;
  price: number;
  hull: number;
  shield: number;
  cargo: number;
  fuel: number;
  jumpRange: number;
  speed: number;
  combat: number;
  mining: number;
  scanner: number;
  /** reactor output; module power draw is subtracted from it */
  power: number;
  description: string;
}

export interface ModuleLevelDef {
  level: number;
  name: string;
  cost: number;
  materials: Amounts;
  power: number;
  buildTime: number;
  /** flat effect, meaning depends on the module type */
  effect: number;
  /** multiplicative speed modifier, e.g. -0.05 => 5% slower */
  speedMod?: number;
  note: string;
}

export interface ModuleDef {
  type: ModuleType;
  name: string;
  short: string;
  description: string;
  levels: ModuleLevelDef[];
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  short: string;
  description: string;
  maxLevel: number;
  cost: { credits: number; materials: Amounts };
  buildTime: number;
  requires: { building: BuildingType; level: number }[];
  effect: (level: number) => string;
}

// ---------------------------------------------------------------------------
// world state
// ---------------------------------------------------------------------------

export interface WorldEvent {
  day: number;
  text: string;
  tag: string;
}

export interface Planet {
  id: string;
  name: string;
  type: string;
  population: number;
}

export interface SystemStation {
  id: string;
  name: string;
  type: 'trade' | 'industrial' | 'mining' | 'military' | 'research' | 'pirate';
  factionId: string | null;
  hasMarket: boolean;
  hasShipyard: boolean;
  hasContracts: boolean;
  /** Заправка. Необязательное поле: старые сейвы выводят услугу из типа. */
  hasRefuel?: boolean;
  /** Ремонт корпуса. */
  hasRepair?: boolean;
  /** Аренда склада: у фракционных станций ячейки под груз есть всегда. */
  hasStorage?: boolean;
}

export interface AsteroidBelt {
  id: string;
  name: string;
  systemId: string;
  grades: Partial<Record<ResourceId, Grade>>;
  /** 0.7 .. 1.6 multiplier of mining output */
  richness: number;
  /** Сколько единиц руды ещё лежит в поясе. Пояс можно выработать. */
  reserve: number;
  discovered: boolean;
}

export interface SystemMarket {
  /** current stock in trade units */
  stock: Record<ResourceId, number>;
  /** equilibrium stock the market drifts towards */
  target: Record<ResourceId, number>;
  /** structural price bias, 0.75 .. 1.35 */
  bias: Record<ResourceId, number>;
}

/**
 * Контракт доски. `supply` — привези свои товары в эту же систему, `courier` —
 * фракция выдаёт опечатанный груз, и его надо доставить в другую (уже
 * открытую игроком) систему: чем дальше маршрут, тем больше платят.
 */
export type ContractKind = 'supply' | 'courier';

export interface Contract {
  id: string;
  kind: ContractKind;
  /** Система, где выдан контракт: там же он и сдаётся для supply. */
  systemId: string;
  /** Точка сдачи. Для supply совпадает с systemId. */
  targetSystemId: string;
  factionId: string | null;
  resource: ResourceId;
  amount: number;
  reward: number;
  repReward: number;
  minRep: number;
  expiresDay: number;
  /** true once the player has signed the contract */
  accepted: boolean;
  /** Прыжков от выдачи до точки сдачи — по ним считается награда и описание. */
  hops: number;
  /** Расстояние по карте в условных единицах: показывается в описании. */
  distance: number;
  /** Курьерский груз уже в трюме и запечатан: продать его нельзя. */
  cargoLoaded: boolean;
}

export interface StarSystem {
  id: string;
  name: string;
  position: Vec2;
  starClass: string;
  factionId: string | null;
  population: number;
  /** 0..1 */
  security: number;
  archetype: string;
  produces: ResourceId[];
  consumes: ResourceId[];
  stations: SystemStation[];
  planets: Planet[];
  belts: AsteroidBelt[];
  connections: string[];
  market: SystemMarket;
  contracts: Contract[];
  discovered: boolean;
  /** Полный скан системы: известны планеты, их типы и пригодность под станцию. */
  scanned: boolean;
  history: WorldEvent[];
}

export interface Faction {
  id: string;
  name: string;
  short: string;
  color: string;
  motto: string;
  exports: ResourceId[];
  imports: ResourceId[];
  homeSystemId: string;
  systems: string[];
  history: WorldEvent[];
}

export interface TravelPlan {
  path: string[];
  hops: number;
  fuel: number;
  seconds: number;
  risk: RiskLevel;
  riskScore: number;
  distance: number;
}

export interface TravelEvent {
  at: number;
  eventId: string;
}

export interface Travel {
  path: string[];
  departAt: number;
  arriveAt: number;
  fuel: number;
  events: TravelEvent[];
  fired: string[];
  pausedAt: number | null;
}

export type Mission =
  | {
      kind: 'mine';
      beltId: string;
      beltSystemId: string;
      homeSystemId: string;
      phase: 'outbound' | 'working' | 'inbound';
      arriveAt: number;
      workUntil: number;
      cyclesLeft: number;
      expected: Amounts;
      /** План вахты: сколько единиц каждого ресурса набурить. Пусто — «до полного трюма». */
      plan: Amounts;
      /** Уже поднято за эту вахту. */
      hauled: Amounts;
      /** Номер текущего захода бура, для анимации прогресса. */
      piece: number;
    }
  | {
      kind: 'trade';
      resource: ResourceId;
      buySystemId: string;
      sellSystemId: string;
      qty: number;
      cyclesLeft: number;
      phase: 'toBuy' | 'toSell';
      arriveAt: number;
      profit: number;
    }
  | {
      kind: 'escort';
      targetShipId: string;
    };

export interface Ship {
  id: string;
  name: string;
  typeId: ShipTypeId;
  systemId: string;
  hull: number;
  shield: number;
  fuel: number;
  cargo: Amounts;
  /**
   * Опечатанный груз: единицы, которые фракция выдала под контракт. Они лежат в
   * трюме, но их нельзя продать, выгрузить или переработать.
   */
  sealed?: Amounts;
  modules: Record<ModuleType, number>;
  /** Клеймо верфи на каждом модуле: от него зависят характеристики. */
  makers?: Partial<Record<ModuleType, MakerId>>;
  status: ShipStatus;
  mission: Mission | null;
  travel: Travel | null;
  kills: number;
  minedUnits: number;
  tradedCredits: number;
}

export interface ConstructionJob {
  building: BuildingType;
  targetLevel: number;
  startedAt: number;
  finishAt: number;
}

export interface ProductionJob {
  id: string;
  recipeId: string;
  startedAt: number;
  finishAt: number;
  repeat: boolean;
}

export interface ProductionRecipe {
  id: string;
  name: string;
  input: Amounts;
  output: Amounts;
  seconds: number;
  refineryLevel: number;
}

export interface PlayerStation {
  id: string;
  name: string;
  /** Пусто, пока участок не заложен: система выбирается игроком. */
  systemId: string;
  /** Планета, на которой стоит станция. */
  sitePlanetId: string | null;
  /** Этап строительства: закладка → склад → базовая станция. */
  phase: StationPhase;
  level: number;
  buildings: Record<BuildingType, number>;
  construction: ConstructionJob | null;
  production: ProductionJob[];
  storage: Amounts;
  research: { mining: number; trade: number; logistics: number };
}

export interface Player {
  name: string;
  credits: number;
  shipId: string;
  homeSystemId: string;
  reputation: Record<string, number>;
  stats: {
    jumps: number;
    trades: number;
    mined: number;
    earned: number;
    built: number;
    contracts: number;
  };
}

export interface NewsItem {
  id: string;
  day: number;
  text: string;
  tag: string;
  systemId: string | null;
  factionId: string | null;
}

export interface Encounter {
  name: string;
  threat: RiskLevel;
  combat: number;
  hull: number;
  hullMax: number;
  shield: number;
  shieldMax: number;
  speed: number;
  bounty: number;
  factionId: string | null;
}

export interface EventPayload {
  text?: string;
  credits?: number;
  cargo?: Amounts;
  enemy?: Encounter;
  systemId?: string;
  beltId?: string;
  contractId?: string;
}

export interface PendingEvent {
  id: string;
  eventId: string;
  shipId: string;
  firedAt: number;
  payload: EventPayload;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

/** Активная задача сканирования: одна за раз, привязана к кораблю. */
export interface SurveyJob {
  id: string;
  kind: SurveyKind;
  /** Система, в которой работает сканер. */
  systemId: string;
  /** Для kind = 'belt': какой пояс сканируем. */
  beltId: string | null;
  /** Для kind = 'deep': какую соседнюю систему открываем. */
  targetSystemId: string | null;
  startedAt: number;
  finishAt: number;
}

export interface GameState {
  version: number;
  seed: string;
  createdAt: number;
  lastSimulationTime: number;
  savedAt: number;
  systems: Record<string, StarSystem>;
  systemIds: string[];
  factions: Record<string, Faction>;
  factionIds: string[];
  player: Player;
  ships: Ship[];
  station: PlayerStation;
  /**
   * Арендованные склады: ключ — id станции, значение — груз в её ячейках.
   * Свой склад живёт в `station.storage`, потому что переработка, стройка и
   * верфь работают именно с базой; доступ к обоим идёт через sim/depots.ts.
   */
  depots: Record<string, Amounts>;
  news: NewsItem[];
  pendingEvent: PendingEvent | null;
  /** Идущее сканирование, если есть. */
  survey: SurveyJob | null;
  nextWorldEventAt: number;
  toast: Toast | null;
  gameTime: number;
}
