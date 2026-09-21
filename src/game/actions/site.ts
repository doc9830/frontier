import type { Amounts, GameState, Planet, ResourceId } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { cargoFree, removeCargo } from '../ships/ship.ts';
import { resourceName } from '../data/resources.ts';
import { buildingDef } from '../data/buildings.ts';
import type { PlanetKindDef } from '../data/planets.ts';
import { planetKindOf } from '../data/planets.ts';
import {
  BASE_STATION_BUILDING,
  BASE_STATION_LEVEL,
  FOUNDATION_BUILDING,
  FOUNDATION_CREDITS,
  FOUNDATION_MATERIALS,
  FOUNDATION_SECONDS,
  chosenSite,
  stationPhase,
} from '../site/site.ts';

/**
 * Действия с участком: выбор планеты и закладка склада.
 *
 * Пока склад не заложен, станции не существует: игрок выбирает ничью
 * отсканированную систему, ставит на планете с твёрдой корой закладку и должен
 * привезти металл в трюме. Только после этого открывается стройка.
 */

/** «24 × Металл, 4 × Электроника» — короткая сводка требований. */
export function materialsText(amounts: Amounts): string {
  const parts = (Object.entries(amounts) as [ResourceId, number][])
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${qty} × ${resourceName(id)}`);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}

/** Планеты системы: годится ли каждая под закладку станции. */
export function systemPlanets(
  state: GameState,
  systemId: string,
): { planet: Planet; kind: PlanetKindDef; buildable: boolean }[] {
  const system = state.systems[systemId];
  if (!system) return [];
  return system.planets.map((planet) => {
    const kind = planetKindOf(planet);
    return { planet, kind, buildable: kind.buildable };
  });
}

export interface FoundationState {
  /** Стадия станции на момент проверки. */
  phase: ReturnType<typeof stationPhase>;
  siteName: string | null;
  systemName: string | null;
  credits: number;
  materials: Amounts;
  /** Что уже лежит в трюме корабля. */
  haveMaterials: Amounts;
  creditsOk: boolean;
  materialsOk: boolean;
  atSite: boolean;
  reasons: string[];
  ok: boolean;
}

/** Что мешает заложить склад — по пунктам, для панели «Станция». */
export function foundationState(state: GameState): FoundationState {
  const ship = playerShip(state);
  const site = chosenSite(state);
  const phase = stationPhase(state);
  const haveMaterials: Amounts = {};
  const reasons: string[] = [];
  if (!site) reasons.push('Участок не выбран: нужна ничья система под кораблём, полный скан и планета с твёрдой корой.');
  if (site && site.system.scanned !== true) {
    reasons.push(`Система ${site.system.name} без полного скана: проведите сканирование.`);
  }
  const atSite = !!site && !!ship && ship.systemId === site.system.id;
  if (!atSite) reasons.push('Корабль должен стоять в выбранной системе.');
  if (ship?.travel) reasons.push('Сначала завершите перелёт.');
  if (ship?.status === 'mining') reasons.push('Сначала остановите добычу.');
  if (ship?.status === 'survey') reasons.push('Сначала завершите сканирование.');
  const creditsOk = state.player.credits >= FOUNDATION_CREDITS;
  if (!creditsOk) reasons.push(`Нужно ${FOUNDATION_CREDITS} кр (у вас ${state.player.credits}).`);
  let materialsOk = true;
  for (const [id, qty] of Object.entries(FOUNDATION_MATERIALS) as [ResourceId, number][]) {
    const inHold = ship?.cargo[id] ?? 0;
    haveMaterials[id] = inHold;
    if (inHold < qty) {
      materialsOk = false;
      reasons.push(`В трюме нужно ${qty} × ${resourceName(id)} (сейчас ${inHold}).`);
    }
  }
  if (phase !== 'planned') reasons.push('Станция уже заложена.');
  return {
    phase,
    siteName: site?.planet.name ?? null,
    systemName: site?.system.name ?? null,
    credits: FOUNDATION_CREDITS,
    materials: { ...FOUNDATION_MATERIALS },
    haveMaterials,
    creditsOk,
    materialsOk,
    atSite,
    reasons,
    ok: reasons.length === 0,
  };
}

/** Выбор участка: только в текущей системе, ничьей и отсканированной. */
export function chooseSite(state: GameState, systemId: string, planetId: string): boolean {
  if (stationPhase(state) !== 'planned') {
    addToast(state, 'Станция уже заложена: участок не меняется.', 'bad');
    return false;
  }
  const system = state.systems[systemId];
  if (!system) {
    addToast(state, 'Система не найдена.', 'bad');
    return false;
  }
  const ship = playerShip(state);
  if (!ship || ship.systemId !== system.id) {
    addToast(state, 'Участок выбирают с борта: сначала перелетите в эту систему.', 'bad');
    return false;
  }
  if (system.factionId !== null) {
    addToast(state, 'Фракции не отдают свои системы под частную закладку.', 'bad');
    return false;
  }
  if (system.scanned !== true) {
    addToast(state, 'Сначала проведите полный скан системы.', 'bad');
    return false;
  }
  const planet = system.planets.find((p) => p.id === planetId);
  if (!planet) {
    addToast(state, 'Планета не найдена.', 'bad');
    return false;
  }
  const kind = planetKindOf(planet);
  if (!kind.buildable) {
    addToast(state, `На планете «${planet.name}» станцию не поставить: ${kind.note}`, 'bad');
    return false;
  }
  state.station.systemId = system.id;
  state.station.sitePlanetId = planet.id;
  addToast(
    state,
    `Участок выбран: ${planet.name} в системе ${system.name} (${kind.label}). Осталось заложить склад.`,
    'good',
  );
  addNews(
    state,
    `Вы заявили права на участок у ${planet.name} в системе ${system.name}. Основание — склад с вашего корабля.`,
    'station',
    system.id,
  );
  return true;
}

export function clearSite(state: GameState): void {
  if (stationPhase(state) !== 'planned') return;
  state.station.systemId = '';
  state.station.sitePlanetId = null;
  addToast(state, 'Участок освобождён: можно выбрать другую планету.', 'info');
}



/** Закладка склада: списывает кредиты и металл из трюма, запускает стройку. */
export function foundStation(state: GameState): boolean {
  const info = foundationState(state);
  if (!info.ok) {
    addToast(state, info.reasons[0] ?? 'Закладка невозможна.', 'bad');
    return false;
  }
  const ship = playerShip(state);
  const site = chosenSite(state);
  if (!ship || !site) return false;
  state.player.credits -= FOUNDATION_CREDITS;
  for (const [id, qty] of Object.entries(FOUNDATION_MATERIALS) as [ResourceId, number][]) {
    removeCargo(ship, id, qty);
  }
  state.station.phase = 'foundation';
  state.station.construction = {
    building: FOUNDATION_BUILDING,
    targetLevel: 1,
    startedAt: state.gameTime,
    finishAt: state.gameTime + FOUNDATION_SECONDS,
  };
  ship.status = 'docked';
  addToast(state, `Склад заложен на ${site.planet.name}. Стройка займёт ${FOUNDATION_SECONDS} с.`, 'good');
  addNews(
    state,
    `${state.station.name}: на ${site.planet.name} заложен первый склад. Дальше — материалы на склад и командный центр.`,
    'station',
    site.system.id,
  );
  return true;
}

/** Во что обойдётся базовая станция: кредиты и материалы со склада. */
export function baseStationHaul(state: GameState): { credits: number; materials: Amounts; storage: Amounts } {
  const def = buildingDef(BASE_STATION_BUILDING);
  const materials: Amounts = {};
  const storage: Amounts = {};
  for (const [id, qty] of Object.entries(def.cost.materials) as [ResourceId, number][]) {
    if (!qty) continue;
    materials[id] = qty;
    storage[id] = state.station.storage[id] ?? 0;
  }
  return { credits: def.cost.credits, materials, storage };
}

/** Чего ещё не хватает для ввода базовой станции в строй. */
export function baseStationMissing(state: GameState): string[] {
  const haul = baseStationHaul(state);
  const reasons: string[] = [];
  if ((state.station.buildings.warehouse ?? 0) < 1) reasons.push('Сначала достройте склад.');
  if (state.player.credits < haul.credits) reasons.push(`Нужно ${haul.credits} кр на стройку.`);
  for (const [id, qty] of Object.entries(haul.materials) as [ResourceId, number][]) {
    if ((haul.storage[id] ?? 0) < qty) {
      reasons.push(`На складе нужно ${qty} × ${resourceName(id)} (есть ${haul.storage[id] ?? 0}).`);
    }
  }
  return reasons;
}

/** Свободное место в трюме — подсказка для перевозки материалов. */
export function haulFreeCargo(state: GameState): number {
  const ship = playerShip(state);
  return ship ? cargoFree(ship) : 0;
}

/** Сколько уровней КЦ считается базовой станцией (маркер воронки). */
export const BASE_STATION_MARK = BASE_STATION_LEVEL;

/** Подсказка «что делать дальше» на стадии закладки — для панели «Станция». */
export function foundationHint(state: GameState): string {
  const info = foundationState(state);
  if (stationPhase(state) !== 'planned') return 'Склад заложен: везите материалы для базовой станции.';
  if (!info.siteName) return 'Выберите участок в этой системе: нужна ничья система, полный скан и планета.';
  if (!info.atSite) return `Перелетите в систему ${info.systemName ?? '—'}: закладку ставят с корабля.`;
  if (!info.materialsOk) return `Не хватает материалов в трюме: ${materialsText(info.materials)}.`;
  if (!info.creditsOk) return `Нужно ${FOUNDATION_CREDITS} кредитов на закладку.`;
  return 'Всё готово: ставьте закладку склада.';
}
