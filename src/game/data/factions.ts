import type { FactionDef } from '../types.ts';

export const FACTIONS: FactionDef[] = [
  {
    id: 'federation',
    name: 'Федерация',
    short: 'ФЕД',
    color: '#5ec8ff',
    motto: 'Порядок, закон и длинные патрульные маршруты.',
    exports: ['food', 'fuel'],
    imports: ['medicine', 'electronics'],
    securityBonus: 0.22,
  },
  {
    id: 'helix',
    name: 'Корпорация «Хеликс»',
    short: 'ХЛК',
    color: '#ffd166',
    motto: 'Каждая орбита выставляется в счёт.',
    exports: ['electronics', 'medicine'],
    imports: ['ore', 'rareOre'],
    securityBonus: 0.08,
  },
  {
    id: 'colonies',
    name: 'Свободные Колонии',
    short: 'СКЛ',
    color: '#7ef7b0',
    motto: 'Небо не принадлежит никому.',
    exports: ['ore', 'gas'],
    imports: ['metal', 'food', 'medicine'],
    securityBonus: 0.04,
  },
  {
    id: 'union',
    name: 'Пограничный Союз',
    short: 'ПСЗ',
    color: '#ff8fa3',
    motto: 'Мы держим линию.',
    exports: ['metal', 'fuel'],
    imports: ['fuel', 'artifacts'],
    securityBonus: 0.14,
  },
];

/** Display name for lawless space (systems owned by nobody). */
export const LAWLESS_NAME = 'Безвластие';
export const LAWLESS_COLOR = '#8a8f98';
export const LAWLESS_SHORT = 'БЕЗВЛ';

