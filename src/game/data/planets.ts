import type { Planet } from '../types.ts';
import type { Rng } from '../rng.ts';
import { createRng } from '../rng.ts';

/**
 * Виды планет. Тип планеты решает две вещи: можно ли заложить на ней станцию
 * и какой профильный бонус получит площадка после ввода в строй.
 *
 * Строка `name` лежит прямо в `Planet.type`, поэтому старые сейвы читаются
 * без миграции: незнакомое название разбирается по детерминированному весу.
 */

export type PlanetBonusKind = 'mining' | 'trade' | 'industry' | 'logistics';

export interface PlanetKindDef {
  id: string;
  /** Строка, которая хранится в Planet.type. */
  name: string;
  /** Короткое название для интерфейса. */
  label: string;
  /** Годится ли планета под закладку станции. */
  buildable: boolean;
  /** 0..1 — пригодность для жизни, задаёт население системы. */
  habitability: number;
  /** Множитель стоимости закладки склада (изоляция, опоры, буровые). */
  buildCostModifier: number;
  bonus: PlanetBonusKind | null;
  /** 0.12 = +12 % к профильному показателю станции. */
  bonusValue: number;
  note: string;
  /** Вес при генерации галактики. */
  weight: number;
}

export const PLANET_KINDS: PlanetKindDef[] = [
  {
    id: 'terran',
    name: 'терранского типа',
    label: 'Терранская',
    buildable: true,
    habitability: 0.95,
    buildCostModifier: 1,
    bonus: 'trade',
    bonusValue: 0.06,
    note: 'Плотное население рядом: торговые операции станции на 6 % выгоднее.',
    weight: 1.2,
  },
  {
    id: 'oceanic',
    name: 'океаническая',
    label: 'Океаническая',
    buildable: true,
    habitability: 0.8,
    buildCostModifier: 1.1,
    bonus: 'industry',
    bonusValue: 0.12,
    note: 'Биосфера и вода: производство и стройка быстрее на 12 %.',
    weight: 1.2,
  },
  {
    id: 'desert',
    name: 'пустынная',
    label: 'Пустынная',
    buildable: true,
    habitability: 0.4,
    buildCostModifier: 0.95,
    bonus: 'mining',
    bonusValue: 0.14,
    note: 'Сухие шахты и близкие пояса: +14 % к добыче.',
    weight: 2,
  },
  {
    id: 'ice',
    name: 'ледяная',
    label: 'Ледяная',
    buildable: true,
    habitability: 0.3,
    buildCostModifier: 1.05,
    bonus: 'logistics',
    bonusValue: 0.15,
    note: 'Криотуманность: перелёты и сканирование быстрее на 15 %.',
    weight: 2,
  },
  {
    id: 'volcanic',
    name: 'вулканическая',
    label: 'Вулканическая',
    buildable: true,
    habitability: 0.15,
    buildCostModifier: 1.2,
    bonus: 'industry',
    bonusValue: 0.18,
    note: 'Геотермальные мощности: +18 % к производству, участок дороже.',
    weight: 1.3,
  },
  {
    id: 'barren',
    name: 'бесплодная',
    label: 'Бесплодная',
    buildable: true,
    habitability: 0.05,
    buildCostModifier: 0.9,
    bonus: null,
    bonusValue: 0,
    note: 'Голая скала: дешёвый участок и никаких бонусов.',
    weight: 2.2,
  },
  {
    id: 'crystal',
    name: 'кристаллическая',
    label: 'Кристаллическая',
    buildable: true,
    habitability: 0.2,
    buildCostModifier: 1.15,
    bonus: 'mining',
    bonusValue: 0.2,
    note: 'Кристаллические породы: +20 % к добыче, сложная закладка.',
    weight: 0.9,
  },
  {
    id: 'gasGiant',
    name: 'газовый гигант',
    label: 'Газовый гигант',
    buildable: false,
    habitability: 0,
    buildCostModifier: 1,
    bonus: null,
    bonusValue: 0,
    note: 'Нет твёрдой коры: станцию ставить не на что.',
    weight: 1.6,
  },
  {
    id: 'radioactive',
    name: 'радиоактивная',
    label: 'Радиоактивная',
    buildable: false,
    habitability: 0,
    buildCostModifier: 1,
    bonus: null,
    bonusValue: 0,
    note: 'Радиационный фон выжигает оборудование и людей.',
    weight: 1,
  },
  {
    id: 'toxic',
    name: 'токсичная',
    label: 'Токсичная',
    buildable: false,
    habitability: 0,
    buildCostModifier: 1,
    bonus: null,
    bonusValue: 0,
    note: 'Атмосфера разъедает обшивку за недели.',
    weight: 1,
  },
];

const KIND_BY_NAME: Record<string, PlanetKindDef> = Object.fromEntries(
  PLANET_KINDS.map((k) => [k.name, k]),
);

const KIND_BY_ID: Record<string, PlanetKindDef> = Object.fromEntries(
  PLANET_KINDS.map((k) => [k.id, k]),
);

export const PLANET_BONUS_LABEL: Record<PlanetBonusKind, string> = {
  mining: 'добыча',
  trade: 'торговля',
  industry: 'производство',
  logistics: 'логистика',
};

/** Человекочитаемый список бонусов площадки. */
export function planetBonusText(kind: PlanetKindDef): string {
  if (!kind.bonus || kind.bonusValue <= 0) return 'без бонуса площадки';
  return `+${Math.round(kind.bonusValue * 100)} % к показателю «${PLANET_BONUS_LABEL[kind.bonus]}»`;
}

export function planetKindByName(name: string): PlanetKindDef | null {
  return KIND_BY_NAME[name] ?? KIND_BY_ID[name] ?? null;
}

/** Случайный вид планеты по весам генерации. */
export function pickPlanetKind(rng: Rng): PlanetKindDef {
  return rng.weighted(PLANET_KINDS.map((kind) => ({ item: kind, weight: kind.weight })));
}

/**
 * Вид планеты для уже сгенерированного объекта. Старые сейвы хранят только
 * строку типа, поэтому при промахе берём детерминированный выбор по id —
 * планета не будет «менять тип» между загрузками.
 */
export function planetKindOf(planet: Planet): PlanetKindDef {
  const direct = planetKindByName(planet.type);
  if (direct) return direct;
  const rng = createRng(`planet:${planet.id}`);
  return pickPlanetKind(rng);
}

/** Пригодность системы под станцию: свободна и есть хоть одна годная планета. */
export function sitePlanetScore(planet: Planet): number {
  const kind = planetKindOf(planet);
  return kind.bonusValue * 100 + kind.habitability * 10;
}
