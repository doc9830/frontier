import type { Amounts, BuildingType, GameState, ResourceId } from '../types.ts';
import {
  buildingCost,
  buildingDef,
  totalSlots,
} from '../data/buildings.ts';
import { phaseAllows, buildingSeconds } from '../site/site.ts';
import { recipe, recipesForLevel } from '../data/recipes.ts';
import { removeStorage, slotsUsed, stationPhaseOf } from '../sim/station.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';

/**
 * Station building actions: construction, refinery production and research.
 * All three are timestamp jobs, so they keep running while the player flies on.
 */

export interface BuildingOffer {
  type: BuildingType;
  name: string;
  level: number;
  maxed: boolean;
  cost: { credits: number; materials: Partial<Record<ResourceId, number>> };
  seconds: number;
  requirements: string[];
  requirementsMet: boolean;
  slotsFree: boolean;
  affordable: boolean;
  built: boolean;
  busy: boolean;
  /** Разрешено ли на текущей стадии станции (закладка → база → развитие). */
  phaseOk: boolean;
  phaseReason: string | null;
}

function requirementsState(
  state: GameState,
  type: BuildingType,
  level: number,
): { met: boolean; missing: string[] } {
  const def = buildingDef(type);
  const missing: string[] = [];
  for (const req of def.requires) {
    if (req.building === type) {
      if ((state.station.buildings[type] ?? 0) < req.level) {
        missing.push(`${buildingDef(req.building).name} Mk ${req.level}`);
      }
      continue;
    }
    if ((state.station.buildings[req.building] ?? 0) < req.level) {
      missing.push(`${buildingDef(req.building).name} Mk ${req.level}`);
    }
  }
  if (level > 1) {
    const own = def.requires.some((r) => r.building === type);
    const currentLevel = state.station.buildings[type] ?? 0;
    if (!own && currentLevel !== level - 1) missing.push(`${def.name} Mk ${level - 1}`);
  }
  return { met: missing.length === 0, missing };
}

function stationHas(state: GameState, materials: Partial<Record<ResourceId, number>>): boolean {
  for (const [id, qty] of Object.entries(materials) as [ResourceId, number][]) {
    if (!qty) continue;
    if ((state.station.storage[id] ?? 0) < qty) return false;
  }
  return true;
}

export function buildingOffers(state: GameState): BuildingOffer[] {
  const station = state.station;
  const used = slotsUsed(station);
  const slots = totalSlots(station.level);
  const busy = station.construction;
  return (Object.keys(station.buildings) as BuildingType[]).map((type) => {
    const def = buildingDef(type);
    const current = station.buildings[type] ?? 0;
    const nextLevel = current + 1;
    const maxed = current >= def.maxLevel;
    const cost = maxed
      ? { credits: 0, materials: {} }
      : buildingCost(type, nextLevel);
    const req = requirementsState(state, type, nextLevel);
    const isNew = current === 0 && type !== 'commandCenter';
    const pending = busy?.building === type;
    const phase = phaseAllows(state, type, nextLevel);
    return {
      type,
      name: def.name,
      level: current,
      maxed,
      cost,
      seconds: maxed ? 0 : buildingSeconds(state, type, nextLevel),
      requirements: req.missing,
      requirementsMet: req.met,
      slotsFree: !isNew || used < slots,
      affordable: state.player.credits >= cost.credits && stationHas(state, cost.materials),
      built: current > 0 || pending,
      busy: pending,
      phaseOk: phase.ok,
      phaseReason: phase.reason,
    };
  });
}

export function startConstruction(state: GameState, type: BuildingType): boolean {
  if (state.station.construction) {
    addToast(state, 'Строительство уже идёт: дождитесь окончания.', 'bad');
    return false;
  }
  const offer = buildingOffers(state).find((o) => o.type === type);
  if (!offer) return false;
  const def = buildingDef(type);
  if (offer.maxed) {
    addToast(state, `«${def.name}» уже на максимальном уровне.`, 'bad');
    return false;
  }
  if (!offer.phaseOk) {
    addToast(state, offer.phaseReason ?? 'На этой стадии станции постройка недоступна.', 'bad');
    return false;
  }
  if (!offer.requirementsMet) {
    addToast(state, `Не хватает: ${offer.requirements.join(', ')}.`, 'bad');
    return false;
  }
  if (!offer.slotsFree) {
    addToast(state, `Свободных слотов построек нет (всего ${totalSlots(state.station.level)}).`, 'bad');
    return false;
  }
  if (state.player.credits < offer.cost.credits) {
    addToast(state, `Для «${def.name} Mk ${offer.level + 1}» нужно ${offer.cost.credits} кр.`, 'bad');
    return false;
  }
  if (!stationHas(state, offer.cost.materials)) {
    addToast(state, `На складе не хватает материалов для «${def.name}». Привезите их кораблём.`, 'bad');
    return false;
  }
  removeStorage(state, offer.cost.materials);
  state.player.credits -= offer.cost.credits;
  state.station.construction = {
    building: type,
    targetLevel: offer.level + 1,
    startedAt: state.gameTime,
    finishAt: state.gameTime + offer.seconds,
  };
  addToast(state, `«${def.name} Mk ${offer.level + 1}» строится: ${offer.seconds} с.`, 'info');
  addNews(
    state,
    `${state.station.name}: начата стройка «${def.name} Mk ${offer.level + 1}».`,
    'station',
    state.station.systemId,
  );
  return true;
}

export function cancelConstruction(state: GameState): void {
  const job = state.station.construction;
  if (!job) return;
  const cost = buildingCost(job.building, job.targetLevel);
  state.player.credits += Math.round(cost.credits * 0.6);
  for (const [id, qty] of Object.entries(cost.materials) as [ResourceId, number][]) {
    if (!qty) continue;
    state.station.storage[id] = (state.station.storage[id] ?? 0) + Math.round(qty * 0.6);
  }
  state.station.construction = null;
  // Стадия — производная от построек: склад не заложен и стройки нет — снова участок.
  state.station.phase = stationPhaseOf(state.station);
  if (state.station.phase === 'planned') {
    addToast(state, 'Закладка отменена: станция снова на стадии выбора участка.', 'info');
    return;
  }
  addToast(state, 'Строительство отменено. Возвращено 60% стоимости.', 'info');
}


// ---------------------------------------------------------------------------
// refinery production
// ---------------------------------------------------------------------------

export interface RecipeOffer {
  id: string;
  name: string;
  input: Amounts;
  output: Amounts;
  seconds: number;
  locked: boolean;
  neededRefinery: number;
  runs: number;
  canRun: boolean;
}

/** All recipes, flagged with what still blocks them (level, inputs, slots). */
export function recipeOffers(state: GameState): RecipeOffer[] {
  const level = state.station.buildings.refinery ?? 0;
  return recipesForLevel(99).map((r) => {
    let runs = Number.POSITIVE_INFINITY;
    for (const [rid, qty] of Object.entries(r.input) as [ResourceId, number][]) {
      if (!qty) continue;
      runs = Math.min(runs, Math.floor((state.station.storage[rid] ?? 0) / qty));
    }
    const affordable = Number.isFinite(runs) ? runs : 0;
    const locked = r.refineryLevel > level;
    const slotsFree = state.station.production.length < productionSlots(state);
    return {
      id: r.id,
      name: r.name,
      input: r.input,
      output: r.output,
      seconds: r.seconds,
      locked,
      neededRefinery: r.refineryLevel,
      runs: affordable,
      canRun: !locked && affordable >= 1 && slotsFree,
    };
  });
}

export function productionSlots(state: GameState): number {
  return Math.max(0, state.station.buildings.refinery ?? 0);
}

export function productionSlotsUsed(state: GameState): number {
  return state.station.production.length;
}

export function startProduction(state: GameState, recipeId: string, repeat = false): boolean {
  const station = state.station;
  const level = station.buildings.refinery ?? 0;
  const def = recipe(recipeId);
  if (!def) return false;
  if (level <= 0) {
    addToast(state, 'Сначала постройте перерабатывающий комплекс.', 'bad');
    return false;
  }
  if (def.refineryLevel > level) {
    addToast(state, `«${def.name}» требует перерабатывающий комплекс Mk ${def.refineryLevel}.`, 'bad');
    return false;
  }
  if (station.production.length >= productionSlots(state)) {
    addToast(state, `Все слоты производства заняты (${level}).`, 'bad');
    return false;
  }
  if (!stationHas(state, def.input)) {
    addToast(state, `Не хватает сырья для «${def.name}».`, 'bad');
    return false;
  }
  removeStorage(state, def.input);
  station.production.push({
    id: `JOB-${state.gameTime}-${station.production.length}-${Math.floor(Math.random() * 1000)}`,
    recipeId: def.id,
    startedAt: state.gameTime,
    finishAt: state.gameTime + def.seconds,
    repeat,
  });
  addToast(
    state,
    `«${def.name}» запущено${repeat ? ' (цикл повторяется)' : ''} — ${def.seconds} сек.`,
    'info',
  );
  return true;
}

export function cancelProduction(state: GameState, jobId: string): void {
  const index = state.station.production.findIndex((j) => j.id === jobId);
  if (index < 0) return;
  const job = state.station.production[index];
  const def = recipe(job.recipeId);
  state.station.production.splice(index, 1);
  if (def) {
    for (const [id, qty] of Object.entries(def.input) as [ResourceId, number][]) {
      if (!qty) continue;
      state.station.storage[id] = (state.station.storage[id] ?? 0) + qty;
    }
  }
  addToast(state, 'Производство отменено, сырьё возвращено на склад.', 'info');
}

// ---------------------------------------------------------------------------
// research
// ---------------------------------------------------------------------------

export type ResearchKey = 'mining' | 'trade' | 'logistics';

export const RESEARCH_TABLE: Record<
  ResearchKey,
  { name: string; effect: string; costs: number[]; electronics: number[] }
> = {
  mining: {
    name: 'Теория добычи',
    effect: '+5% к добыче за уровень',
    costs: [2400, 6800, 16000],
    electronics: [20, 55, 140],
  },
  trade: {
    name: 'Анализ рынка',
    effect: '+2% к ценам торговли за уровень',
    costs: [2800, 7200, 17000],
    electronics: [25, 60, 150],
  },
  logistics: {
    name: 'Логистика трасс',
    effect: '−3% ко времени перелёта за уровень',
    costs: [2200, 6400, 15000],
    electronics: [18, 50, 130],
  },
};

export interface ResearchOffer {
  key: ResearchKey;
  name: string;
  effect: string;
  level: number;
  maxed: boolean;
  cost: number;
  electronics: number;
  affordable: boolean;
  hasLab: boolean;
}

export function researchOffers(state: GameState): ResearchOffer[] {
  const lab = state.station.buildings.researchLab ?? 0;
  return (Object.keys(RESEARCH_TABLE) as ResearchKey[]).map((key) => {
    const entry = RESEARCH_TABLE[key];
    const level = state.station.research[key];
    const maxed = level >= 3 || level >= lab;
    const cost = maxed ? 0 : entry.costs[level] ?? 0;
    const electronics = maxed ? 0 : entry.electronics[level] ?? 0;
    return {
      key,
      name: entry.name,
      effect: entry.effect,
      level,
      maxed,
      cost,
      electronics,
      affordable:
        !maxed &&
        state.player.credits >= cost &&
        (state.station.storage.electronics ?? 0) >= electronics,
      hasLab: lab > 0,
    };
  });
}

export function buyResearch(state: GameState, key: ResearchKey): boolean {
  const offer = researchOffers(state).find((o) => o.key === key);
  if (!offer) return false;
  if (!offer.hasLab) {
    addToast(state, 'Сначала постройте исследовательскую лабораторию.', 'bad');
    return false;
  }
  if (offer.maxed) {
    addToast(state, `«${offer.name}» уже на максимуме.`, 'info');
    return false;
  }
  if (!offer.affordable) {
    addToast(
      state,
      `Для «${offer.name}» нужно ${offer.cost} кр и ${offer.electronics} электроники.`,
      'bad',
    );
    return false;
  }
  state.player.credits -= offer.cost;
  removeStorage(state, { electronics: offer.electronics });
  state.station.research[key] += 1;
  addToast(state, `«${offer.name}» теперь уровня ${state.station.research[key]}.`, 'good');
  addNews(
    state,
    `${state.station.name}: исследование «${offer.name}» доведено до уровня ${state.station.research[key]}.`,
    'station',
    state.station.systemId,
  );
  return true;
}

