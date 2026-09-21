import { createRng, type Rng } from '../rng.ts';
import type {
  AsteroidBelt,
  Faction,
  Grade,
  Planet,
  ResourceId,
  StarSystem,
  SystemStation,
  Vec2,
  WorldEvent,
} from '../types.ts';
import { FACTIONS } from '../data/factions.ts';
import { MINEABLE } from '../data/resources.ts';
import {
  beltName,
  planetName,
  starClass,
  stationName,
  systemName,
} from '../data/names.ts';
import { clamp, createMarket } from '../economy/market.ts';
import { createContracts, destinationsFrom } from '../economy/contracts.ts';
import { pickPlanetKind, PLANET_KINDS } from '../data/planets.ts';
import { rollBeltReserve } from '../data/belts.ts';

export interface Universe {
  systems: Record<string, StarSystem>;
  systemIds: string[];
  factions: Record<string, Faction>;
  factionIds: string[];
  homeSystemId: string;
}

export const FIELD = { width: 1240, height: 780 };
const MIN_DIST = 120;
const START_DAY = 127;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface ArchetypeDef {
  id: string;
  label: string;
  produces: ResourceId[];
  consumes: ResourceId[];
  weight: number;
  belts: [number, number];
}

const ARCHETYPES: ArchetypeDef[] = [
  {
    id: 'agricultural',
    label: 'Аграрная',
    produces: ['food'],
    consumes: ['fuel', 'medicine', 'electronics'],
    weight: 2,
    belts: [0, 1],
  },
  {
    id: 'industrial',
    label: 'Промышленная',
    produces: ['metal', 'electronics'],
    consumes: ['ore', 'gas', 'food'],
    weight: 2,
    belts: [0, 2],
  },
  {
    id: 'mining',
    label: 'Добывающая',
    produces: ['ore', 'gas', 'rareOre'],
    consumes: ['food', 'fuel', 'medicine'],
    weight: 2.4,
    belts: [2, 3],
  },
  {
    id: 'medical',
    label: 'Медицинская',
    produces: ['medicine'],
    consumes: ['electronics', 'food', 'rareOre'],
    weight: 1,
    belts: [0, 1],
  },
  {
    id: 'trade',
    label: 'Торговый узел',
    produces: [],
    consumes: ['food', 'fuel', 'medicine', 'metal', 'electronics'],
    weight: 1.4,
    belts: [0, 1],
  },
  {
    id: 'frontier',
    label: 'Фронтир',
    produces: ['fuel', 'gas'],
    consumes: ['food', 'medicine', 'electronics'],
    weight: 1.6,
    belts: [1, 2],
  },
  {
    id: 'research',
    label: 'Научная',
    produces: ['electronics'],
    consumes: ['rareOre', 'medicine', 'food'],
    weight: 0.8,
    belts: [1, 2],
  },
];

const GRADE_MULTIPLIER: Record<Grade, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };

/** System archetype ids are used by the sim; the UI shows the Russian label. */
const ARCHETYPE_LABELS: Record<string, string> = Object.fromEntries(
  ARCHETYPES.map((entry) => [entry.id, entry.label]),
);

export function archetypeLabel(id: string | undefined | null): string {
  if (!id) return 'неизвестно';
  return ARCHETYPE_LABELS[id] ?? id;
}

export function gradeMultiplier(grade: Grade): number {
  return GRADE_MULTIPLIER[grade];
}

function placePositions(rng: Rng, count: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    let placed: Vec2 | null = null;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const candidate: Vec2 = {
        x: rng.range(70, FIELD.width - 70),
        y: rng.range(70, FIELD.height - 70),
      };
      const minDist = attempt < 300 ? MIN_DIST : MIN_DIST * 0.55;
      const ok = points.every((p) => distance(p, candidate) > minDist);
      if (ok) {
        placed = candidate;
        break;
      }
    }
    points.push(
      placed ?? { x: rng.range(70, FIELD.width - 70), y: rng.range(70, FIELD.height - 70) },
    );
  }
  return points;
}

function createBelt(
  rng: Rng,
  systemId: string,
  usedNames: Set<string>,
  archetype: ArchetypeDef,
): AsteroidBelt {
  let name = beltName(rng);
  while (usedNames.has(name)) name = beltName(rng);
  usedNames.add(name);

  const gradePool =
    archetype.id === 'mining'
      ? MINEABLE
      : rng.chance(0.45)
        ? MINEABLE
        : (['ore', 'gas'] as ResourceId[]);
  const chosen = rng.picks(gradePool, rng.int(1, Math.min(3, gradePool.length)));
  const grades: Partial<Record<ResourceId, Grade>> = {};
  for (const id of chosen) {
    grades[id] = rng.weighted<Grade>([
      { item: 'HIGH', weight: 1.1 },
      { item: 'MEDIUM', weight: 2.2 },
      { item: 'LOW', weight: 2.6 },
    ]);
  }
  // every belt always has at least a little common ore
  if (!grades.ore && rng.chance(0.6)) grades.ore = 'MEDIUM';

  const richness = Math.round(rng.range(0.7, 1.6) * 100) / 100;

  return {
    id: `${systemId}:${name}`,
    name,
    systemId,
    grades,
    richness,
    // Пояс не бесконечен: запас вычитается вахтами и восстанавливается медленно.
    reserve: rollBeltReserve(rng, richness),
    discovered: false,
  };
}


function createStations(
  rng: Rng,
  archetype: ArchetypeDef,
  factionId: string | null,
  security: number,
): SystemStation[] {
  const stations: SystemStation[] = [];
  let counter = rng.int(100, 900);
  const nextId = (): string => {
    counter += 1;
    return `ST-${counter}`;
  };

  /** Станция фракции: услуги выводятся из типа, заправка есть везде. */
  const push = (
    type: SystemStation['type'],
    flags: { market: boolean; shipyard: boolean; contracts: boolean },
  ): void => {
    stations.push({
      id: nextId(),
      name: stationName(rng, type),
      type,
      factionId,
      hasMarket: flags.market,
      hasShipyard: flags.shipyard,
      hasContracts: flags.contracts,
      hasRefuel: true,
      hasRepair: type === 'military' ? rng.chance(0.7) : true,
      // Склад под аренду есть у любой станции: у пиратских объём скромнее.
      hasStorage: true,
    });
  };

  // «Почта» системы: рынок и доска контрактов есть в каждом узле.
  push('trade', {
    market: true,
    shipyard: archetype.id === 'industrial' || archetype.id === 'research',
    contracts: true,
  });

  if (archetype.id === 'mining' && rng.chance(0.8)) {
    // Добывающая станция работает складом руды: рынок только при высокой охране.
    push('mining', { market: rng.chance(0.35), shipyard: false, contracts: rng.chance(0.5) });
  }

  if (archetype.id === 'research' && rng.chance(0.9)) {
    push('research', { market: rng.chance(0.4), shipyard: true, contracts: rng.chance(0.6) });
  }

  if ((archetype.id === 'industrial' || archetype.id === 'frontier') && rng.chance(0.75)) {
    push('industrial', { market: rng.chance(0.3), shipyard: true, contracts: rng.chance(0.5) });
  }

  if (factionId && security > 0.62 && rng.chance(0.6)) {
    push('military', { market: false, shipyard: rng.chance(0.4), contracts: true });
  }

  if (!factionId) {
    // Безвластие: чёрный рынок обслуживает всех, доска контрактов — как повезёт.
    push('pirate', { market: true, shipyard: rng.chance(0.6), contracts: rng.chance(0.5) });
  }

  return stations;
}

function createPlanets(rng: Rng, population: number, ensureBuildable: boolean): Planet[] {
  const count = rng.int(1, 4);
  const planets: Planet[] = [];
  for (let i = 0; i < count; i += 1) {
    const kind = pickPlanetKind(rng);
    planets.push({
      id: `PL-${i}-${rng.int(100, 999)}`,
      name: planetName(rng, i),
      type: kind.name,
      population: Math.round(
        population * (rng.range(0.15, 0.5) * kind.habitability + rng.range(0.001, 0.03)) * (i === 0 ? 1.4 : 0.7),
      ),
    });
  }
  // Ничьи системы обязаны давать хотя бы одну площадку: иначе фронтир
  // превращается в тупик, а игроку негде заложить станцию.
  if (ensureBuildable && !planets.some((p) => isBuildable(p))) {
    const buildable = PLANET_KINDS.filter((k) => k.buildable);
    const kind = rng.pick(buildable);
    planets[0].type = kind.name;
    planets[0].population = Math.round(population * kind.habitability * rng.range(0.05, 0.25));
  }
  return planets;
}

function isBuildable(planet: Planet): boolean {
  return PLANET_KINDS.some((kind) => kind.name === planet.type && kind.buildable);
}

function connectSystems(rng: Rng, systems: StarSystem[]): void {
  if (systems.length < 2) return;
  const inTree = new Set<string>([systems[0].id]);

  // Prim's algorithm guarantees the map is fully connected.
  while (inTree.size < systems.length) {
    let best: { a: StarSystem; b: StarSystem; d: number } | null = null;
    for (const a of systems) {
      if (!inTree.has(a.id)) continue;
      for (const b of systems) {
        if (inTree.has(b.id)) continue;
        const d = distance(a.position, b.position);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    inTree.add(best.b.id);
    best.a.connections.push(best.b.id);
    best.b.connections.push(best.a.id);
  }

  // Local lanes, so the map has loops instead of being a pure tree.
  for (const sys of systems) {
    const targetDegree = rng.int(3, 4);
    const nearest = systems
      .filter((o) => o.id !== sys.id)
      .sort((x, y) => distance(sys.position, x.position) - distance(sys.position, y.position));
    for (const cand of nearest) {
      if (sys.connections.length >= targetDegree) break;
      if (cand.connections.includes(sys.id)) continue;
      if (distance(sys.position, cand.position) > 320) continue;
      sys.connections.push(cand.id);
      cand.connections.push(sys.id);
    }
  }

  // A few long range trade lanes connecting far corners.
  for (const sys of systems) {
    if (!rng.chance(0.14)) continue;
    const candidates = systems.filter(
      (o) =>
        o.id !== sys.id &&
        !sys.connections.includes(o.id) &&
        distance(sys.position, o.position) > 340,
    );
    if (candidates.length === 0) continue;
    const target = rng.pick(candidates);
    sys.connections.push(target.id);
    target.connections.push(sys.id);
  }
}

function initialHistory(rng: Rng, lawless: boolean): WorldEvent[] {
  const pool = [
    'Основана добывающая станция.',
    'Сообщение о нападении пиратов во внешнем поясе.',
    'Цены на топливо подскочили из-за задержки конвоя.',
    'Маршруты патрулей продлены.',
    'Подтверждено месторождение редкой руды.',
    'Брошенный грузовик отбуксирован в док.',
    'Объём торговли достиг нового местного рекорда.',
    'Прибыли колонисты из центральных миров.',
  ];
  const entries: WorldEvent[] = [];
  const count = rng.int(2, 4);
  let day = rng.int(112, 122);
  for (let i = 0; i < count; i += 1) {
    entries.push({ day, text: rng.pick(pool), tag: lawless ? 'lawless' : 'world' });
    day += rng.int(1, 4);
  }
  entries.push({ day: 126, text: 'Архив местных съёмок обновлён.', tag: 'survey' });
  return entries;
}

function emptyMarket(): StarSystem['market'] {
  return {
    stock: {} as StarSystem['market']['stock'],
    target: {} as StarSystem['market']['target'],
    bias: {} as StarSystem['market']['bias'],
  };
}

/** Generates the whole galaxy. Same seed -> identical universe. */
export function generateUniverse(seed: string): Universe {
  const rng = createRng(seed);
  const count = rng.int(22, 29);
  const positions = placePositions(rng, count);
  const usedNames = new Set<string>();
  const systems: StarSystem[] = [];
  const archetypes = new Map<string, ArchetypeDef>();

  for (let i = 0; i < count; i += 1) {
    const archetype = rng.weighted(ARCHETYPES.map((a) => ({ item: a, weight: a.weight })));
    const id = `SYS-${String(i + 1).padStart(2, '0')}`;
    const system: StarSystem = {
      id,
      name: systemName(rng, usedNames),
      position: positions[i],
      starClass: starClass(rng),
      factionId: null,
      population: 0,
      security: 0.2,
      archetype: archetype.id,
      produces: archetype.produces.slice(),
      consumes: archetype.consumes.slice(),
      stations: [],
      planets: [],
      belts: [],
      connections: [],
      market: emptyMarket(),
      contracts: [],
      discovered: false,
      scanned: false,
      history: [],
    };
    archetypes.set(id, archetype);
    systems.push(system);
  }

  // --- faction territory: capitals first, everything else by proximity ------
  const anchors: Vec2[] = [
    { x: FIELD.width * 0.24, y: FIELD.height * 0.24 },
    { x: FIELD.width * 0.78, y: FIELD.height * 0.28 },
    { x: FIELD.width * 0.2, y: FIELD.height * 0.78 },
    { x: FIELD.width * 0.78, y: FIELD.height * 0.76 },
  ];
  const shuffledAnchors = rng.shuffle(anchors);
  const capitalIds: Record<string, string> = {};
  const claimed = new Set<string>();
  FACTIONS.forEach((faction, index) => {
    const anchor = shuffledAnchors[index] ?? anchors[index];
    let best: StarSystem | null = null;
    let bestDist = Infinity;
    for (const sys of systems) {
      if (claimed.has(sys.id)) continue;
      const d = distance(sys.position, anchor);
      if (d < bestDist) {
        bestDist = d;
        best = sys;
      }
    }
    if (best) {
      claimed.add(best.id);
      best.factionId = faction.id;
      capitalIds[faction.id] = best.id;
    }
  });

  for (const sys of systems) {
    if (sys.factionId) continue;
    let nearestFaction: string | null = null;
    let nearestDist = Infinity;
    for (const faction of FACTIONS) {
      const capital = systems.find((s) => s.id === capitalIds[faction.id]);
      if (!capital) continue;
      const d = distance(sys.position, capital.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearestFaction = faction.id;
      }
    }
    const lawlessChance = nearestDist > 520 ? 0.5 : nearestDist > 400 ? 0.28 : 0.07;
    sys.factionId = nearestFaction && !rng.chance(lawlessChance) ? nearestFaction : null;
  }

  // --- гарантия фронтира -----------------------------------------------------
  // Ничьи системы — это «топливо» игры: только там ставят частные станции.
  // Если случайность оставила их слишком мало, отдаём под безвластие самые
  // далёкие окраины, чтобы воронка закладки всегда была проходимой.
  const capitals = Object.values(capitalIds)
    .map((id) => systems.find((s) => s.id === id))
    .filter((s): s is StarSystem => !!s);
  const remoteness = (sys: StarSystem): number => {
    if (capitals.length === 0) return 0;
    return Math.min(...capitals.map((c) => distance(sys.position, c.position)));
  };
  const MIN_LAWLESS = 3;
  let lawlessCount = systems.filter((s) => s.factionId === null).length;
  if (lawlessCount < MIN_LAWLESS) {
    const candidates = systems
      .filter((s) => s.factionId !== null)
      .sort((a, b) => remoteness(b) - remoteness(a));
    for (const sys of candidates) {
      if (lawlessCount >= MIN_LAWLESS) break;
      sys.factionId = null;
      lawlessCount += 1;
    }
  }

  // --- population / security ------------------------------------------------
  for (const sys of systems) {
    const factionDef = FACTIONS.find((f) => f.id === sys.factionId) ?? null;
    if (factionDef) {
      sys.security = clamp(0.42 + factionDef.securityBonus + rng.range(-0.16, 0.16), 0.12, 0.96);
      sys.population = Math.round(
        rng.range(4000, 24000) * (sys.archetype === 'trade' ? 1.7 : 1) * (0.6 + sys.security),
      );
    } else {
      sys.security = clamp(rng.range(0.02, 0.2), 0.02, 0.3);
      sys.population = Math.round(rng.range(150, 5000));
    }
  }

  // --- system content ------------------------------------------------------
  for (const sys of systems) {
    const archetype = archetypes.get(sys.id) ?? ARCHETYPES[0];
    const beltNames = new Set<string>();
    const beltCount = rng.int(archetype.belts[0], archetype.belts[1]);
    for (let i = 0; i < beltCount; i += 1) {
      sys.belts.push(createBelt(rng, sys.id, beltNames, archetype));
    }
    sys.planets = createPlanets(rng, sys.population, sys.factionId === null);
    sys.stations = createStations(rng, archetype, sys.factionId, sys.security);
    // Фракционные системы нанесены на карты: планеты и пояса там известны.
    // Дикий космос приходится разведывать сканером.
    sys.scanned = sys.factionId !== null;

    // Faction specialties shift local production a little.
    const factionDef = FACTIONS.find((f) => f.id === sys.factionId);
    if (factionDef) {
      if (rng.chance(0.5) && !sys.produces.includes(factionDef.exports[0])) {
        sys.produces.push(factionDef.exports[0]);
      }
      if (rng.chance(0.5) && !sys.consumes.includes(factionDef.imports[0])) {
        sys.consumes.push(factionDef.imports[0]);
      }
      sys.consumes = sys.consumes.filter((r) => !sys.produces.includes(r));
    }

    sys.market = createMarket(sys, rng);
    sys.history = initialHistory(rng, sys.factionId === null);
  }

  connectSystems(rng, systems);

  // --- faction records -----------------------------------------------------
  const factions: Record<string, Faction> = {};
  for (const def of FACTIONS) {
    const homeId = capitalIds[def.id] ?? systems[0].id;
    factions[def.id] = {
      id: def.id,
      name: def.name,
      short: def.short,
      color: def.color,
      motto: def.motto,
      exports: def.exports,
      imports: def.imports,
      homeSystemId: homeId,
      systems: systems.filter((s) => s.factionId === def.id).map((s) => s.id),
      history: [
        { day: 118, text: `«${def.name}» открыла новые торговые трассы.`, tag: 'faction' },
        { day: 123, text: `«${def.name}» усилила патрулирование.`, tag: 'faction' },
        { day: 126, text: `«${def.name}» опубликовала изменение тарифов.`, tag: 'faction' },
      ],
    };
  }

  // --- contracts -----------------------------------------------------------
  // Курьерские контракты ведут только в уже открытые системы; на старте карта
  // знает лишь фракционные узлы, остальное игрок открывает сканером.
  const systemMap: Record<string, StarSystem> = Object.fromEntries(
    systems.map((s) => [s.id, s]),
  );
  for (const sys of systems) {
    sys.contracts = createContracts(
      sys,
      rng,
      START_DAY,
      undefined,
      destinationsFrom(systemMap, sys.id),
    );
  }

  // --- player home system --------------------------------------------------
  let home: StarSystem | null = null;
  let bestScore = -Infinity;
  for (const sys of systems) {
    if (!sys.factionId || sys.belts.length === 0) continue;
    const hasShipyard = sys.stations.some((s) => s.hasShipyard);
    const centreDist = distance(sys.position, { x: FIELD.width / 2, y: FIELD.height / 2 });
    const score =
      sys.security * 3 +
      (hasShipyard ? 1.2 : 0) +
      (sys.archetype === 'trade' ? 0.3 : 0) -
      centreDist / 600;
    if (score > bestScore) {
      bestScore = score;
      home = sys;
    }
  }
  if (!home) home = systems[0];
  home.discovered = true;
  home.scanned = true;
  for (const belt of home.belts) belt.discovered = true;

  const systemRecord: Record<string, StarSystem> = {};
  for (const sys of systems) systemRecord[sys.id] = sys;

  return {
    systems: systemRecord,
    systemIds: systems.map((s) => s.id),
    factions,
    factionIds: FACTIONS.map((f) => f.id),
    homeSystemId: home.id,
  };
}

export const UNIVERSE_START_DAY = START_DAY;

