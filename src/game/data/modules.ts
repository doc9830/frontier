import type { ModuleDef, ModuleGroupId, ModuleType } from '../types.ts';

/**
 * Modules are the only ship upgrade system in the prototype. Each module has
 * three levels; higher levels cost more reactor power and usually slow the hull
 * down, so the player has to balance the ship instead of maxing everything.
 */
export const MODULES: ModuleDef[] = [
  {
    type: 'engine',
    name: 'Двигатель',
    short: 'ДВГ',
    description: 'Основной маршевый двигатель. Повышает скорость на каждом переходе.',
    levels: [
      {
        level: 1,
        name: 'Двигатель Mk I',
        cost: 4200,
        materials: { metal: 40 },
        power: 18,
        buildTime: 20,
        effect: 0.2,
        note: '+20% к скорости',
      },
      {
        level: 2,
        name: 'Двигатель Mk II',
        cost: 14500,
        materials: { metal: 120, electronics: 25 },
        power: 32,
        buildTime: 45,
        effect: 0.45,
        note: '+45% к скорости, больше энергопотребление',
      },
      {
        level: 3,
        name: 'Двигатель Mk III',
        cost: 38000,
        materials: { metal: 320, electronics: 90 },
        power: 46,
        buildTime: 90,
        effect: 0.75,
        note: '+75% к скорости, сильно грузит реактор',
      },
    ],
  },
  {
    type: 'jumpDrive',
    name: 'Прыжковый двигатель',
    short: 'ПРЫЖ',
    description: 'Увеличивает дальность прыжка и снижает расход топлива на переход.',
    levels: [
      {
        level: 1,
        name: 'Прыжковый двигатель Mk I',
        cost: 3600,
        materials: { metal: 30, electronics: 10 },
        power: 14,
        buildTime: 18,
        effect: 4,
        note: '+4 к дальности прыжка, −15% расхода топлива',
      },
      {
        level: 2,
        name: 'Прыжковый двигатель Mk II',
        cost: 13000,
        materials: { metal: 110, electronics: 40 },
        power: 25,
        buildTime: 40,
        effect: 8,
        note: '+8 к дальности прыжка, −30% расхода топлива',
      },
      {
        level: 3,
        name: 'Прыжковый двигатель Mk III',
        cost: 34000,
        materials: { metal: 300, electronics: 120 },
        power: 42,
        buildTime: 85,
        effect: 14,
        note: '+14 к дальности прыжка, −50% расхода топлива',
      },
    ],
  },
  {
    type: 'shield',
    name: 'Генератор щита',
    short: 'ЩИТ',
    description: 'Добавляет запас щита, чтобы выжить при встрече с пиратами.',
    levels: [
      {
        level: 1,
        name: 'Щит Mk I',
        cost: 4000,
        materials: { metal: 35, electronics: 15 },
        power: 24,
        buildTime: 22,
        effect: 120,
        speedMod: -0.02,
        note: '+120 к щиту, −2% к скорости',
      },
      {
        level: 2,
        name: 'Щит Mk II',
        cost: 15000,
        materials: { metal: 140, electronics: 55 },
        power: 42,
        buildTime: 50,
        effect: 300,
        speedMod: -0.04,
        note: '+300 к щиту, −4% к скорости',
      },
      {
        level: 3,
        name: 'Щит Mk III',
        cost: 40000,
        materials: { metal: 380, electronics: 150 },
        power: 64,
        buildTime: 100,
        effect: 600,
        speedMod: -0.06,
        note: '+600 к щиту, −6% к скорости',
      },
    ],
  },
  {
    type: 'reactor',
    name: 'Реактор',
    short: 'РЕАКТ',
    description: 'Повышает лимит энергии. Нужен, чтобы ставить много модулей сразу.',
    levels: [
      {
        level: 1,
        name: 'Реактор Mk I',
        cost: 3000,
        materials: { metal: 45 },
        power: 0,
        buildTime: 16,
        effect: 40,
        note: '+40 к энергии',
      },
      {
        level: 2,
        name: 'Реактор Mk II',
        cost: 11000,
        materials: { metal: 160, electronics: 30 },
        power: 0,
        buildTime: 38,
        effect: 90,
        note: '+90 к энергии',
      },
      {
        level: 3,
        name: 'Реактор Mk III',
        cost: 30000,
        materials: { metal: 420, electronics: 95 },
        power: 0,
        buildTime: 80,
        effect: 160,
        note: '+160 к энергии',
      },
    ],
  },
  {
    type: 'cargo',
    name: 'Грузовой модуль',
    short: 'ГРУЗ',
    description: 'Больше места в трюме, но в ущерб скорости и энергии.',
    levels: [
      {
        level: 1,
        name: 'Трюм Mk I',
        cost: 3400,
        materials: { metal: 60 },
        power: 9,
        buildTime: 18,
        effect: 20,
        speedMod: -0.05,
        note: '+20 к трюму, −5% к скорости',
      },
      {
        level: 2,
        name: 'Трюм Mk II',
        cost: 12500,
        materials: { metal: 200, electronics: 20 },
        power: 16,
        buildTime: 42,
        effect: 55,
        speedMod: -0.1,
        note: '+55 к трюму, −10% к скорости',
      },
      {
        level: 3,
        name: 'Трюм Mk III',
        cost: 32000,
        materials: { metal: 520, electronics: 70 },
        power: 26,
        buildTime: 88,
        effect: 110,
        speedMod: -0.18,
        note: '+110 к трюму, −18% к скорости',
      },
    ],
  },
  {
    type: 'scanner',
    name: 'Сканер',
    short: 'СКАН',
    description: 'Находит пояса астероидов, брошенные корабли и аномалии.',
    levels: [
      {
        level: 1,
        name: 'Сканер Mk I',
        cost: 3200,
        materials: { metal: 25, electronics: 12 },
        power: 9,
        buildTime: 16,
        effect: 4,
        note: '+4 к радиусу сканирования, выше шанс находок',
      },
      {
        level: 2,
        name: 'Сканер Mk II',
        cost: 11500,
        materials: { metal: 90, electronics: 45 },
        power: 17,
        buildTime: 36,
        effect: 9,
        note: '+9 к радиусу сканирования',
      },
      {
        level: 3,
        name: 'Сканер Mk III',
        cost: 29000,
        materials: { metal: 240, electronics: 130 },
        power: 26,
        buildTime: 74,
        effect: 15,
        note: '+15 к радиусу сканирования',
      },
    ],
  },
  {
    type: 'weapon',
    name: 'Оружейная система',
    short: 'ОРУЖ',
    description: 'Боевой рейтинг для схваток и эскортной службы.',
    levels: [
      {
        level: 1,
        name: 'Оружие Mk I',
        cost: 5000,
        materials: { metal: 50, electronics: 15 },
        power: 24,
        buildTime: 24,
        effect: 4,
        note: '+4 к бою',
      },
      {
        level: 2,
        name: 'Оружие Mk II',
        cost: 17000,
        materials: { metal: 180, electronics: 60 },
        power: 40,
        buildTime: 54,
        effect: 9,
        note: '+9 к бою',
      },
      {
        level: 3,
        name: 'Оружие Mk III',
        cost: 44000,
        materials: { metal: 460, electronics: 180 },
        power: 62,
        buildTime: 108,
        effect: 16,
        note: '+16 к бою',
      },
    ],
  },
];

export const MODULE_TYPES: ModuleType[] = [
  'engine',
  'jumpDrive',
  'shield',
  'reactor',
  'cargo',
  'scanner',
  'weapon',
];

const MODULE_MAP: Record<string, ModuleDef> = Object.fromEntries(
  MODULES.map((m) => [m.type, m]),
);

export function moduleDef(type: ModuleType): ModuleDef {
  return MODULE_MAP[type];
}

export function moduleLevel(type: ModuleType, level: number) {
  if (level <= 0) return null;
  const def = MODULE_MAP[type];
  return def.levels.find((l) => l.level === level) ?? null;
}

/** Shipyard level required to install a module of the given level. */
export function requiredShipyardLevel(level: number): number {
  return Math.max(0, level - 1);
}

export interface ModuleGroupDef {
  id: ModuleGroupId;
  label: string;
  hint: string;
  types: ModuleType[];
}

/**
 * Разделы верфи: вместо одной простыни из семи модулей игрок видит пять
 * осмысленных групп и сравнивает варианты внутри группы.
 */
export const MODULE_GROUPS: ModuleGroupDef[] = [
  {
    id: 'mobility',
    label: 'ХОД И ПРЫЖОК',
    hint: 'Скорость перехода, дальность прыжка и расход топлива.',
    types: ['engine', 'jumpDrive'],
  },
  {
    id: 'defense',
    label: 'ЗАЩИТА И ЭНЕРГИЯ',
    hint: 'Щит для схваток и реактор, который даёт лимит под остальные модули.',
    types: ['shield', 'reactor'],
  },
  {
    id: 'logistics',
    label: 'ГРУЗ',
    hint: 'Объём трюма: и торговля, и руда с поясов.',
    types: ['cargo'],
  },
  {
    id: 'sensors',
    label: 'СЕНСОРЫ',
    hint: 'Радиус разведки и шанс найти пояс, обломки или аномалию.',
    types: ['scanner'],
  },
  {
    id: 'arms',
    label: 'ВООРУЖЕНИЕ',
    hint: 'Боевой рейтинг: пираты, эскорт и рейды по контрактам.',
    types: ['weapon'],
  },
];

const GROUP_MAP: Record<string, ModuleGroupDef> = Object.fromEntries(
  MODULE_GROUPS.flatMap((group) => group.types.map((type) => [type, group])),
);

export function moduleGroupOf(type: ModuleType): ModuleGroupDef {
  return GROUP_MAP[type] ?? MODULE_GROUPS[0];
}
