import type { Rng } from '../rng.ts';

const SECTOR_LETTERS = ['K', 'N', 'H', 'R', 'T', 'V', 'Z', 'A', 'M', 'S', 'D', 'L', 'Y', 'P'];

const STATION_PREFIX = [
  'Врата',
  'Гелиос',
  'Якорь',
  'Кряж',
  'Сияние',
  'Ключ',
  'Бастион',
  'Полярис',
  'Пламя',
  'Наковальня',
  'Маяк',
  'Меридиан',
  'Решётка',
  'Тессера',
];

const STATION_SUFFIX = ['Станция', 'Депо', 'Терминал', 'Форпост', 'Верфь', 'Ретранслятор'];

const PLANET_PREFIX = [
  'Kir',
  'Mar',
  'Vel',
  'Tho',
  'Zar',
  'Eos',
  'Nyx',
  'Ari',
  'Tau',
  'Cal',
  'Orin',
  'Sel',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const STAR_CLASSES = ['M', 'K', 'G', 'F', 'A', 'B', 'K-гигант', 'M-карлик', 'белый карлик'];

export function systemName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const letter = rng.pick(SECTOR_LETTERS);
    const digits = rng.int(10, 999);
    const num = String(digits).padStart(3, '0');
    const name = `${letter}-${num}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `X-${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

export function stationName(rng: Rng, type: string): string {
  const name = `${rng.pick(STATION_SUFFIX)} «${rng.pick(STATION_PREFIX)}»`;
  return type === 'pirate' ? `${name} (чёрный рынок)` : name;
}

export function planetName(rng: Rng, index: number): string {
  return `${rng.pick(PLANET_PREFIX)} ${ROMAN[index % ROMAN.length]}`;
}

export function starClass(rng: Rng): string {
  return rng.pick(STAR_CLASSES);
}

export function beltName(rng: Rng): string {
  const letter = rng.pick(['A', 'B', 'C', 'D']);
  return `${letter}-${rng.int(1, 99)}`;
}

export function shipName(typeId: string, index: number): string {
  const prefix =
    typeId === 'scout'
      ? 'СКАУТ'
      : typeId === 'miner'
        ? 'РУДОКОП'
        : typeId === 'hauler'
          ? 'ТЯЖЕЛОВОЗ'
          : 'КОРВЕТ';
  return `${prefix}-${String(index).padStart(2, '0')}`;
}

const PLANET_TYPES = [
  'терранского типа',
  'океаническая',
  'пустынная',
  'ледяная',
  'газовый гигант',
  'бесплодная',
  'вулканическая',
  'радиоактивная',
];

export function planetType(rng: Rng): string {
  return rng.pick(PLANET_TYPES);
}
