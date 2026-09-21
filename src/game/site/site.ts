import type { Amounts, BuildingType, GameState, Planet, StarSystem, StationPhase } from '../types.ts';
import type { PlanetBonusKind, PlanetKindDef } from '../data/planets.ts';
import { planetKindOf, planetBonusText, sitePlanetScore } from '../data/planets.ts';
import { buildingDef, buildingTime, totalSlots } from '../data/buildings.ts';
import { findPath } from '../exploration/travel.ts';

/**
 * Участок под собственную станцию.
 *
 * Правила фронтира: фракции не отдают свои системы под частную закладку, а
 * станцию можно поставить только на планету с твёрдой корой. Поэтому сначала
 * нужно найти ничью систему, отсканировать её и выбрать планету — только потом
 * привозить металл на закладку склада.
 */

/** Закладка склада: кредиты и материалы, которые нужно привезти в трюме. */
export const FOUNDATION_CREDITS = 2500;
export const FOUNDATION_MATERIALS: Amounts = { metal: 24 };
export const FOUNDATION_SECONDS = 45;
export const FOUNDATION_BUILDING: BuildingType = 'warehouse';
/** Первый уровень Командного центра — это и есть базовая станция. */
export const BASE_STATION_BUILDING: BuildingType = 'commandCenter';
export const BASE_STATION_LEVEL = 1;

export interface SitePlanetInfo {
  planet: Planet;
  kind: PlanetKindDef;
  buildable: boolean;
  bonusText: string;
  score: number;
}

export interface SiteCandidate {
  system: StarSystem;
  /** Прыжков от текущего корабля, -1 если пути нет. */
  hops: number;
  /** Ничья система: только там разрешена частная закладка. */
  free: boolean;
  scanned: boolean;
  planets: SitePlanetInfo[];
  buildable: SitePlanetInfo[];
  ok: boolean;
  reasons: string[];
}

export function sitePlanetInfo(planet: Planet): SitePlanetInfo {
  const kind = planetKindOf(planet);
  return {
    planet,
    kind,
    buildable: kind.buildable,
    bonusText: planetBonusText(kind),
    score: sitePlanetScore(planet),
  };
}

export function systemSiteCandidate(state: GameState, system: StarSystem): SiteCandidate {
  const ship = state.ships.find((s) => s.id === state.player.shipId) ?? state.ships[0];
  const path = ship ? findPath(state, ship.systemId, system.id) : [];
  const hops = path.length > 0 ? path.length - 1 : -1;
  const free = system.factionId === null;
  const scanned = system.scanned === true;
  const planets = scanned ? system.planets.map(sitePlanetInfo) : [];
  const buildable = planets.filter((p) => p.buildable);
  const reasons: string[] = [];
  if (!free) {
    const owner = system.factionId ? state.factions[system.factionId]?.name ?? system.factionId : '—';
    reasons.push(`Система под контролем «${owner}»: частную станцию там не поставить.`);
  }
  if (!scanned) {
    reasons.push('Нужен полный скан системы: без него неизвестны планеты.');
  } else if (buildable.length === 0) {
    reasons.push('Нет планеты с твёрдой корой — закладку ставить не на что.');
  }
  return {
    system,
    hops,
    free,
    scanned,
    planets,
    buildable,
    ok: reasons.length === 0,
    reasons,
  };
}

/**
 * Участок под свою станцию ищут только там, где стоит корабль: закладку ставят с
 * борта, удалённых заявок фронтир не знает. Возвращает описание текущей системы
 * со всеми причинами отказа — для панели «Закладка станции».
 */
export function localSiteCandidate(state: GameState): SiteCandidate | null {
  const ship = state.ships.find((s) => s.id === state.player.shipId) ?? state.ships[0];
  const system = ship ? state.systems[ship.systemId] : null;
  if (!system) return null;
  return systemSiteCandidate(state, system);
}

export function stationPhase(state: GameState): StationPhase {
  return state.station.phase ?? 'operational';
}

export function stationPhaseLabel(phase: StationPhase): string {
  if (phase === 'planned') return 'участок выбирается';
  if (phase === 'foundation') return 'заложен склад';
  return 'действующая станция';
}

export interface SiteInfo {
  system: StarSystem;
  planet: Planet;
  kind: PlanetKindDef;
  planetInfo: SitePlanetInfo;
}

/** Выбранный участок: система + планета, если игрок уже определился. */
export function chosenSite(state: GameState): SiteInfo | null {
  const station = state.station;
  if (!station.sitePlanetId || !station.systemId) return null;
  const system = state.systems[station.systemId];
  if (!system) return null;
  const planet = system.planets.find((p) => p.id === station.sitePlanetId);
  if (!planet) return null;
  return { system, planet, kind: planetKindOf(planet), planetInfo: sitePlanetInfo(planet) };
}

/**
 * Бонусы площадки. Первые уровни станции дают только кров и склад — профильный
 * бонус планеты включается после ввода базовой станции (КЦ Mk1).
 */
export function siteBonuses(state: GameState): Record<PlanetBonusKind, number> {
  const zero: Record<PlanetBonusKind, number> = { mining: 0, trade: 0, industry: 0, logistics: 0 };
  if (stationPhase(state) !== 'operational') return zero;
  const site = chosenSite(state);
  if (!site?.kind.bonus) return zero;
  return { ...zero, [site.kind.bonus]: site.kind.bonusValue };
}

export function siteMiningBonus(state: GameState): number {
  return siteBonuses(state).mining;
}

export function siteTradeBonus(state: GameState): number {
  return siteBonuses(state).trade;
}

export function siteIndustryBonus(state: GameState): number {
  return siteBonuses(state).industry;
}

export function siteLogisticsBonus(state: GameState): number {
  return siteBonuses(state).logistics;
}

export interface PhaseStep {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  active: boolean;
}

/** Пять шагов становления станции — их же показывает панель «Станция». */
export function phaseSteps(state: GameState): PhaseStep[] {
  const phase = stationPhase(state);
  const station = state.station;
  const site = chosenSite(state);
  const warehouse = station.buildings.warehouse ?? 0;
  const cc = station.buildings.commandCenter ?? 0;
  return [
    {
      id: 'site',
      label: 'Выбрать участок',
      hint: 'Ничья система вне зоны фракций и планета с твёрдой корой (нужен полный скан).',
      done: !!site,
      active: !site,
    },
    {
      id: 'foundation',
      label: `Заложить склад: ${FOUNDATION_CREDITS} кр и ${FOUNDATION_MATERIALS.metal} металла в трюме`,
      hint: 'Склад — единственное, что можно построить на голом участке.',
      done: warehouse > 0,
      active: !!site && warehouse === 0,
    },
    {
      id: 'haul',
      label: 'Завезти материалы для базовой станции',
      hint: 'Металл, руду и электронику придётся привезти на склад кораблём.',
      done: cc >= BASE_STATION_LEVEL,
      active: phase === 'foundation' && cc === 0,
    },
    {
      id: 'base',
      label: `Построить базовую станцию (КЦ Mk${BASE_STATION_LEVEL})`,
      hint: `${buildingDef(BASE_STATION_BUILDING).cost.credits} кр и материалы на складе.`,
      done: phase === 'operational',
      active: phase === 'foundation' && cc === 0,
    },
    {
      id: 'expansion',
      label: 'Развернуть инфраструктуру',
      hint: `Свободных слотов построек: ${Math.max(0, totalSlots(station.level) - 1)}.`,
      done: (station.buildings.dock ?? 0) > 0 && (station.buildings.refinery ?? 0) > 0,
      active: phase === 'operational',
    },
  ];
}

/** Что разрешено строить на текущей стадии. */
export function phaseAllows(
  state: GameState,
  type: BuildingType,
  nextLevel: number,
): { ok: boolean; reason: string | null } {
  const phase = stationPhase(state);
  if (phase === 'operational') return { ok: true, reason: null };
  if (phase === 'planned') {
    if (state.station.construction) return { ok: true, reason: null };
    return { ok: false, reason: 'Сначала заложите склад на выбранной планете.' };
  }
  if (type === FOUNDATION_BUILDING) return { ok: true, reason: null };
  if (type === BASE_STATION_BUILDING && nextLevel === BASE_STATION_LEVEL) {
    return { ok: true, reason: null };
  }
  if (type === BASE_STATION_BUILDING) {
    return {
      ok: false,
      reason: 'Пока базовая станция не введена в строй, командный центр строится только до Mk1.',
    };
  }
  return {
    ok: false,
    reason: 'Остальные постройки открываются после ввода базовой станции (КЦ Mk1).',
  };
}

/** Стройка идёт быстрее на «промышленных» планетах (индустриальный бонус). */
export function siteBuildSeconds(state: GameState, seconds: number): number {
  return Math.max(5, Math.round(seconds * (1 - siteIndustryBonus(state))));
}

export function buildingSeconds(state: GameState, type: BuildingType, level: number): number {
  return siteBuildSeconds(state, buildingTime(type, level));
}
