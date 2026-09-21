import type { ResourceDef, ResourceId } from '../types.ts';
import { plural } from '../plural.ts';

export const RESOURCES: ResourceDef[] = [
  {
    id: 'ore',
    name: 'Руда',
    symbol: 'РУДА',
    basePrice: 24,
    raw: true,
    industrial: false,
    color: '#8b9bb4',
  },
  {
    id: 'gas',
    name: 'Газ',
    symbol: 'ГАЗ',
    basePrice: 31,
    raw: true,
    industrial: false,
    color: '#7ec8e3',
  },
  {
    id: 'rareOre',
    name: 'Редкая руда',
    symbol: 'РЕДР',
    basePrice: 96,
    raw: true,
    industrial: false,
    color: '#c9a0ff',
  },
  {
    id: 'metal',
    name: 'Металл',
    symbol: 'МЕТ',
    basePrice: 82,
    raw: false,
    industrial: true,
    color: '#b8c2cc',
  },
  {
    id: 'fuel',
    name: 'Топливо',
    symbol: 'ТОПЛ',
    basePrice: 44,
    raw: false,
    industrial: true,
    color: '#ffb347',
  },
  {
    id: 'food',
    name: 'Продовольствие',
    symbol: 'ЕДА',
    basePrice: 17,
    raw: false,
    industrial: false,
    color: '#8fdf8f',
  },
  {
    id: 'electronics',
    name: 'Электроника',
    symbol: 'ЭЛЕК',
    basePrice: 220,
    raw: false,
    industrial: true,
    color: '#6ff0e0',
  },
  {
    id: 'medicine',
    name: 'Медикаменты',
    symbol: 'МЕД',
    basePrice: 130,
    raw: false,
    industrial: false,
    color: '#ff8fa3',
  },
  {
    id: 'artifacts',
    name: 'Артефакты',
    symbol: 'АРТ',
    basePrice: 620,
    raw: false,
    industrial: false,
    color: '#ffd166',
  },
];

/** "12 единиц", "1 единица" — used in toasts and summaries. */
export function units(count: number): string {
  return `${count} ${plural(count, 'единица', 'единицы', 'единиц')}`;
}

export const RESOURCE_IDS: ResourceId[] = RESOURCES.map((r) => r.id);

const RESOURCE_MAP: Record<string, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.id, r]),
);

export function resource(id: ResourceId): ResourceDef {
  return RESOURCE_MAP[id];
}

export function resourceName(id: ResourceId): string {
  return RESOURCE_MAP[id]?.name ?? id;
}

export function resourceSymbol(id: ResourceId): string {
  return RESOURCE_MAP[id]?.symbol ?? id;
}

/** Resources used as construction materials. */
export const MATERIALS: ResourceId[] = ['metal', 'electronics'];

/** Mineable raw resources and their yields from asteroid belts. */
export const MINEABLE: ResourceId[] = ['ore', 'gas', 'rareOre'];
