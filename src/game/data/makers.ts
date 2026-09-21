import type { Amounts, MakerId, ModuleLevelDef, ModuleType, ResourceId } from '../types.ts';
import { moduleLevel } from './modules.ts';

/**
 * Верфи-производители.
 *
 * Каждая фракция строит модули по своей политике: Хеликс продаёт объём (трюмы
 * и реакторы), Колонии — скорость, Союз — оружие, Федерация — щиты и конвои,
 * Безвластие — дёшево и без гарантий. Модуль запоминает клеймо верфи, поэтому
 * щит Федерации и трюм Хеликса спокойно живут на одном корабле: игрок собирает
 * корабль из того, что дают разные доки.
 */

export interface MakerTuning {
  /** Множитель эффекта: 1.25 = +25% к эффекту модуля. */
  effect?: number;
  /** Множитель энергопотребления. */
  power?: number;
  /** Множитель цены в кредитах. */
  cost?: number;
  /** Множитель объёма материалов. */
  materials?: number;
  /** Дополнительная строка в описании уровня. */
  note?: string;
}

export interface MakerDef {
  id: MakerId;
  name: string;
  short: string;
  color: string;
  motto: string;
  /** Ценовая политика доков: 0.9 = на 10% дешевле. */
  costScale: number;
  /** Сборка целиком: 1.12 = жрёт на 12% больше энергии. */
  powerScale: number;
  /** Качество сборки: у чёрного рынка ниже единицы. */
  effectScale: number;
  /** Чем эта верфь сильна — для интерфейса. */
  pitch: string;
  tuning: Partial<Record<ModuleType, MakerTuning>>;
}

export const MAKERS: MakerDef[] = [
  {
    id: 'standard',
    name: 'Стандартные доки',
    short: 'СТД',
    color: '#9aa4b2',
    motto: 'Серийная сборка без излишеств.',
    costScale: 1,
    powerScale: 1,
    effectScale: 1,
    pitch: 'Ровные характеристики без надбавок.',
    tuning: {},
  },
  {
    id: 'federation',
    name: 'Доки Федерации',
    short: 'ФЕД',
    color: '#5ec8ff',
    motto: 'Порядок, конвой, закон.',
    costScale: 1.05,
    powerScale: 1,
    effectScale: 1,
    pitch: 'Щиты и орудия конвойной сборки.',
    tuning: {
      shield: { effect: 1.25, power: 1.08, note: 'щит федеральной сборки +25%' },
      weapon: { effect: 1.15, note: 'орудия с лицензией +15%' },
      engine: { effect: 0.94, note: 'тяжёлый маршевый блок −6%' },
    },
  },
  {
    id: 'helix',
    name: 'Верфи «Хеликс»',
    short: 'ХЛК',
    color: '#ffd166',
    motto: 'Каждая орбита выставляется в счёт.',
    costScale: 1.08,
    powerScale: 1,
    effectScale: 1,
    pitch: 'Трюмы и реакторы: корпорация продаёт объём.',
    tuning: {
      cargo: { effect: 1.25, power: 1.15, note: 'грузовые секции Хеликса +25%' },
      reactor: { effect: 1.15, note: 'реактор корпоративной сборки +15%' },
      scanner: { effect: 1.08, cost: 1.1, note: 'сенсоры под заказ +8%' },
    },
  },
  {
    id: 'colonies',
    name: 'Верфи Свободных Колоний',
    short: 'СКЛ',
    color: '#7ef7b0',
    motto: 'Небо не принадлежит никому.',
    costScale: 0.95,
    powerScale: 1,
    effectScale: 1,
    pitch: 'Кустарные, зато быстрые движки.',
    tuning: {
      engine: { effect: 1.18, power: 0.95, cost: 0.95, note: 'разгонный блок колонистов +18%' },
      jumpDrive: { effect: 1.2, power: 0.9, materials: 0.9, note: 'прыжковый контур +20%' },
      shield: { effect: 0.85, note: 'щит кустарной сборки −15%' },
    },
  },
  {
    id: 'union',
    name: 'Доки Пограничного Союза',
    short: 'ПСЗ',
    color: '#ff8fa3',
    motto: 'Мы держим линию.',
    costScale: 1.02,
    powerScale: 1,
    effectScale: 1,
    pitch: 'Военная сборка для дальних рейдов.',
    tuning: {
      weapon: { effect: 1.3, power: 1.1, note: 'орудия Союза +30%' },
      shield: { effect: 1.1, note: 'щит пограничной сборки +10%' },
      cargo: { effect: 0.95, note: 'военный трюм −5%' },
      jumpDrive: { effect: 1.05, note: 'дальний контур +5%' },
    },
  },
  {
    id: 'lawless',
    name: 'Чёрный рынок',
    short: 'БЗВ',
    color: '#8a8f98',
    motto: 'Дёшево, сердито, без гарантий.',
    costScale: 0.78,
    powerScale: 1.12,
    effectScale: 0.88,
    pitch: 'Цена ниже, характеристики — как повезёт.',
    tuning: {},
  },
  {
    id: 'frontier',
    name: 'Верфь «Фронтир»',
    short: 'ФРН',
    color: '#41f0c1',
    motto: 'Своя верфь — свои правила.',
    costScale: 0.9,
    powerScale: 0.95,
    effectScale: 1,
    pitch: 'Сборка на своей базе: −10% цены и −5% энергии.',
    tuning: {},
  },
];

const MAKER_MAP: Record<string, MakerDef> = Object.fromEntries(MAKERS.map((m) => [m.id, m]));


export function makerDef(id: MakerId | string | null | undefined): MakerDef {
  return MAKER_MAP[id ?? 'standard'] ?? MAKER_MAP.standard;
}

/** Верфь фракции: у Безвластия (нет владельца) работает чёрный рынок. */
export function makerForFaction(factionId: string | null | undefined): MakerId {
  if (!factionId) return 'lawless';
  return (MAKER_MAP[factionId]?.id ?? 'standard') as MakerId;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Строка про конкретный модуль: чем верфь его усилила или ослабила. */
export function makerModuleNote(type: ModuleType, maker: MakerId): string | null {
  return makerDef(maker).tuning[type]?.note ?? null;
}

/**
 * Уровень модуля в сборке конкретной верфи. Цена, материалы, энергия и эффект
 * пересчитываются от базового уровня, поэтому баланс правится в одном месте —
 * `data/modules.ts`.
 */
export function tunedLevel(
  type: ModuleType,
  level: number,
  maker: MakerId = 'standard',
): ModuleLevelDef | null {
  const base = moduleLevel(type, level);
  if (!base) return null;
  const def = makerDef(maker);
  const tuning = def.tuning[type] ?? {};
  const effect = round2(base.effect * def.effectScale * (tuning.effect ?? 1));
  const power = Math.max(0, Math.round(base.power * def.powerScale * (tuning.power ?? 1)));
  const cost = Math.max(10, Math.round((base.cost * def.costScale * (tuning.cost ?? 1)) / 10) * 10);
  const materials: Amounts = {};
  for (const [id, qty] of Object.entries(base.materials) as [ResourceId, number][]) {
    if (!qty) continue;
    materials[id] = Math.max(1, Math.ceil(qty * (tuning.materials ?? 1)));
  }
  const note = [base.note, tuning.note].filter(Boolean).join(' · ');
  return { ...base, name: `${base.name} · ${def.short}`, cost, materials, power, effect, note };
}

/** Полное имя установленного модуля: с клеймом верфи, если оно нестандартное. */
export function equippedName(type: ModuleType, level: number, maker: MakerId): string {
  if (level <= 0) return 'пусто';
  const base = moduleLevel(type, level);
  if (!base) return `${type} Mk ${level}`;
  return maker === 'standard' ? base.name : `${base.name} · ${makerDef(maker).short}`;
}
