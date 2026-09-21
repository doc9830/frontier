import type {
  BuildingType,
  GameState,
  PlayerStation,
  Ship,
  ShipTypeId,
} from '../types.ts';
import { generateUniverse } from '../universe/generate.ts';
import { emptyMakers, emptyModules, shipStats } from '../ships/ship.ts';
import { shipType } from '../data/ships.ts';
import { addNews } from '../news/news.ts';
import { createRng } from '../rng.ts';
import { radarReach, revealAround } from '../sim/travel.ts';
import { seedContractBoards } from '../economy/contracts.ts';
import { resourceName } from '../data/resources.ts';
import type { ResourceId } from '../types.ts';

export const SAVE_VERSION = 4;
export const START_CREDITS = 20000;
/** Имя, которое игрок даёт своей будущей станции. */
export const START_STATION_NAME = 'Станция «Фронтир»';

function emptyBuildings(): Record<BuildingType, number> {
  return {
    commandCenter: 0,
    warehouse: 0,
    dock: 0,
    miningHub: 0,
    refinery: 0,
    shipyard: 0,
    radar: 0,
    researchLab: 0,
    fleetOffice: 0,
  };
}

export function createShip(typeId: ShipTypeId, systemId: string, name: string): Ship {
  const def = shipType(typeId);
  const ship: Ship = {
    id: `SHIP-${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`,
    name,
    typeId,
    systemId,
    hull: def.hull,
    shield: def.shield,
    fuel: def.fuel,
    cargo: {},
    modules: emptyModules(),
    makers: emptyMakers(),
    status: 'docked',
    mission: null,
    travel: null,
    kills: 0,
    minedUnits: 0,
    tradedCredits: 0,
  };
  return ship;
}

/** The ship the player starts in: fast, comfortable range, thin hull. */
export function createStartingShip(systemId: string): Ship {
  const ship = createShip('scout', systemId, 'Странник');
  ship.modules.engine = 1;
  ship.modules.jumpDrive = 1;
  ship.modules.cargo = 1;
  ship.modules.scanner = 1;
  const stats = shipStats(ship);
  ship.hull = stats.hullMax;
  ship.shield = stats.shieldMax;
  ship.fuel = stats.fuelMax;
  return ship;
}

/**
 * Станция новой игры: пока это только лицензия на участок. Игрок сам найдёт
 * ничью систему, отсканирует её и заложит склад — до этого у него есть корабль,
 * кредиты и ничего больше.
 */
export function createStartingStation(name: string): PlayerStation {
  return {
    id: 'STATION-1',
    name,
    systemId: '',
    sitePlanetId: null,
    phase: 'planned',
    level: 0,
    buildings: emptyBuildings(),
    construction: null,
    production: [],
    storage: {},
    research: { mining: 0, trade: 0, logistics: 0 },
  };
}

/** Builds a brand new game world from a seed. */
export function createGameState(seed: string, playerName = 'CMDR'): GameState {
  const universe = generateUniverse(seed);
  const home = universe.systems[universe.homeSystemId];
  const rng = createRng(`${seed}:state`);

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    createdAt: Date.now(),
    lastSimulationTime: Date.now(),
    savedAt: Date.now(),
    systems: universe.systems,
    systemIds: universe.systemIds,
    factions: universe.factions,
    factionIds: universe.factionIds,
    player: {
      name: playerName,
      credits: START_CREDITS,
      shipId: '',
      homeSystemId: home.id,
      reputation: {},
      stats: { jumps: 0, trades: 0, mined: 0, earned: 0, built: 0, contracts: 0 },
    },
    ships: [],
    station: createStartingStation(START_STATION_NAME),
    depots: {},
    news: [],
    pendingEvent: null,
    survey: null,
    nextWorldEventAt: 240,
    toast: null,
    gameTime: 0,
  };

  const ship = createStartingShip(home.id);
  state.ships = [ship];
  state.player.shipId = ship.id;

  for (const id of state.factionIds) {
    state.player.reputation[id] = id === home.factionId ? 10 : 0;
  }

  // The station radar charts the home system and everything one hop out, which
  // is what gives the player their first set of jump targets.
  revealAround(state, home.id, radarReach(state));

  // Карты открыты — доски контрактов собираются заново, чтобы у курьеров были
  // маршруты по уже известным системам.
  seedContractBoards(state);

  addNews(
    state,
    `Корпорация выдала вам корабль класса «Скаут», ${START_CREDITS} кр подъёмных и лицензию на закладку станции. Ничья система ждёт на фронтире.`,
    'personal',
    home.id,
  );
  addNews(
    state,
    `${home.name}: диспетчерская открыла вам местные трассы. Рынки работают.`,
    'system',
    home.id,
    home.factionId,
  );
  if (home.factionId) {
    const faction = state.factions[home.factionId];
    addNews(
      state,
      `«${faction.name}» сообщает о стабильном спросе на ${faction.imports[0] ? resourceName(faction.imports[0] as ResourceId).toLowerCase() : 'товары'}.`,
      'faction',
      home.id,
      home.factionId,
    );
  }
  addNews(state, 'Индекс биржи Фронтира открылся без изменений. Ожидается волатильность.', 'market', null);

  // A small amount of flavour from the galaxy generator.
  const flavour = rng.picks(
    state.systemIds.filter((id) => id !== home.id),
    3,
  );
  for (const id of flavour) {
    const system = state.systems[id];
    const entry = system.history[system.history.length - 1];
    if (entry) addNews(state, `${entry.text} (${system.name})`, 'system', id, system.factionId);
  }

  return state;
}

export function playerShip(state: GameState): Ship {
  const ship = state.ships.find((s) => s.id === state.player.shipId);
  return ship ?? state.ships[0];
}

export function currentSystem(state: GameState) {
  const ship = playerShip(state);
  return state.systems[ship.systemId];
}
