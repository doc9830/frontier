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

export type ShipStatus = 'docked' | 'transit' | 'mining' | 'trading' | 'escort';

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
}

export interface AsteroidBelt {
  id: string;
  name: string;
  systemId: string;
  grades: Partial<Record<ResourceId, Grade>>;
  /** 0.7 .. 1.6 multiplier of mining output */
  richness: number;
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

export interface Contract {
  id: string;
  kind: 'delivery';
  systemId: string;
  factionId: string | null;
  resource: ResourceId;
  amount: number;
  reward: number;
  repReward: number;
  minRep: number;
  expiresDay: number;
  /** true once the player has signed the contract */
  accepted: boolean;
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
  modules: Record<ModuleType, number>;
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
  systemId: string;
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
  news: NewsItem[];
  pendingEvent: PendingEvent | null;
  nextWorldEventAt: number;
  toast: Toast | null;
  gameTime: number;
}
