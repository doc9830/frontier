import type { BuildingDef, BuildingType } from '../types.ts';
import { plural } from '../plural.ts';

/** 8 starting slots, +2 per Command Center level, as in the design doc. */
export function totalSlots(level: number): number {
  return 8 + 2 * (Math.max(1, level) - 1);
}

/** Storage capacity in cargo units contributed by a Warehouse level. */
export function warehouseCapacity(level: number): number {
  return 250 + level * 380;
}

/** Fleet size the player can command. */
export function fleetLimit(level: number, fleetOfficeLevel: number): number {
  return 3 + fleetOfficeLevel + (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0);
}

/** How many refinery batches can run at the same time. */
export function refinerySlots(level: number): number {
  return Math.max(0, level);
}

export const BUILDINGS: BuildingDef[] = [
  {
    type: 'commandCenter',
    name: 'Командный центр',
    short: 'КЦ',
    description:
      'Сердце станции «Фронтир». Каждый уровень даёт слоты построек, склад, лимит флота и производственные слоты.',
    maxLevel: 10,
    cost: { credits: 2000, materials: { metal: 120 } },
    buildTime: 40,
    requires: [],
    effect: (l) => `${totalSlots(l)} слотов построек · флот ${fleetLimit(l, 0)}+`,
  },
  {
    type: 'warehouse',
    name: 'Склад',
    short: 'СКЛ',
    description: 'Хранит добытую руду и купленные товары. Излишки остаются на причале и теряются.',
    maxLevel: 5,
    cost: { credits: 600, materials: { metal: 120 } },
    buildTime: 30,
    requires: [],
    effect: (l) => `склад ${warehouseCapacity(l)} ед.`,
  },
  {
    type: 'dock',
    name: 'Док',
    short: 'ДОК',
    description: 'Ремонт и заправка ваших кораблей. С каждым уровнем услуги дешевле.',
    maxLevel: 3,
    cost: { credits: 1200, materials: { metal: 200 } },
    buildTime: 45,
    requires: [],
    effect: (l) => `ремонт −${10 * l}% стоимости · заправка −${8 * l}% стоимости`,
  },
  {
    type: 'miningHub',
    name: 'Горный комплекс',
    short: 'ГОРН',
    description: 'Координирует добывающие миссии и повышает их отдачу.',
    maxLevel: 3,
    cost: { credits: 1600, materials: { metal: 240 } },
    buildTime: 50,
    requires: [{ building: 'dock', level: 1 }],
    effect: (l) => `+${15 * l}% к добыче · ${l} ${plural(l, 'слот', 'слота', 'слотов')} добычи`,
  },
  {
    type: 'refinery',
    name: 'Перерабатывающий комплекс',
    short: 'ПЕРЕР',
    description: 'Превращает сырьё в товары: руду в металл, газ в топливо, редкую руду в электронику.',
    maxLevel: 3,
    cost: { credits: 2500, materials: { metal: 300, electronics: 20 } },
    buildTime: 60,
    requires: [{ building: 'warehouse', level: 1 }],
    effect: (l) => `${l} ${plural(l, 'слот', 'слота', 'слотов')} производства`,
  },
  {
    type: 'shipyard',
    name: 'Верфь',
    short: 'ВЕРФЬ',
    description:
      'Ставит и улучшает модули кораблей. Высокие уровни открывают оборудование Mk II и Mk III.',
    maxLevel: 3,
    cost: { credits: 3000, materials: { metal: 320, electronics: 30 } },
    buildTime: 70,
    requires: [{ building: 'dock', level: 1 }],
    effect: (l) => `модули до Mk ${Math.min(3, l + 1)} · ремонт дешевле на ${5 * l}%`,
  },
  {
    type: 'radar',
    name: 'Радар',
    short: 'РАД',
    description:
      'Дальнее сканирование: открывает пояса астероидов в соседних системах и предупреждает о пиратах.',
    maxLevel: 3,
    cost: { credits: 1800, materials: { metal: 180, electronics: 25 } },
    buildTime: 48,
    requires: [{ building: 'warehouse', level: 1 }],
    effect: (l) =>
      `открывает ${l} ${plural(l, 'соседнюю систему', 'соседние системы', 'соседних систем')} · риск перелёта −${8 * l}%`,
  },
  {
    type: 'researchLab',
    name: 'Исследовательская лаборатория',
    short: 'ЛАБ',
    description: 'Небольшие постоянные улучшения за кредиты и электронику.',
    maxLevel: 3,
    cost: { credits: 2600, materials: { metal: 220, electronics: 60 } },
    buildTime: 65,
    requires: [{ building: 'commandCenter', level: 2 }],
    effect: (l) => `уровень исследований ${l} · добыча +${5 * l}% · торговля +${2 * l}%`,
  },
  {
    type: 'fleetOffice',
    name: 'Офис флота',
    short: 'ФЛОТ',
    description: 'Добавляет слот флота и открывает длинные торговые маршруты для грузовиков.',
    maxLevel: 3,
    cost: { credits: 2200, materials: { metal: 260, electronics: 20 } },
    buildTime: 55,
    requires: [{ building: 'commandCenter', level: 2 }],
    effect: (l) => `+${l} ${plural(l, 'слот', 'слота', 'слотов')} флота · торговые маршруты`,
  },
];

const BUILDING_MAP: Record<string, BuildingDef> = Object.fromEntries(
  BUILDINGS.map((b) => [b.type, b]),
);

export function buildingDef(type: BuildingType): BuildingDef {
  return BUILDING_MAP[type];
}

/**
 * Cost of one building level. Level 1 uses the base cost, higher levels scale
 * with a fixed exponent so the numbers stay readable.
 */
export function buildingCost(type: BuildingType, level: number): {
  credits: number;
  materials: Partial<Record<string, number>>;
} {
  const def = buildingDef(type);
  const step = Math.max(1, level);
  const credits = Math.round(def.cost.credits * Math.pow(step, 1.85));
  const materials: Record<string, number> = {};
  for (const [id, amount] of Object.entries(def.cost.materials)) {
    if (typeof amount === 'number') {
      materials[id] = Math.round(amount * Math.pow(step, 2.0));
    }
  }
  return { credits, materials };
}

export function buildingTime(type: BuildingType, level: number): number {
  const def = buildingDef(type);
  return Math.round(def.buildTime * Math.pow(Math.max(1, level), 1.45));
}
