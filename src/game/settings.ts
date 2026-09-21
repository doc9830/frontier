/**
 * Настройки приложения. Они не входят в сохранение мира: «новая галактика»
 * сохраняет ваши привычки, а перенесённый сейв не тянет их за собой.
 */

export const SETTINGS_KEY = 'frontier.settings.v1';

export interface AppSettings {
  /** Множитель игрового времени: 0.5 замедляет мир, 4 ускоряет. */
  speed: number;
  /** Анимация прыжка на карте: корабль идёт по линии. */
  animations: boolean;
  /** Всплывающие сообщения в углу экрана. */
  toasts: boolean;
  /** Спрашивать подтверждение перед прыжком. */
  confirmJump: boolean;
  /** Автосохранение раз в 15 секунд. */
  autosave: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  speed: 1,
  animations: true,
  toasts: true,
  confirmJump: false,
  autosave: true,
};

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 8;

/** Скорости, которые предлагает панель настроек. */
export const SPEED_CHOICES: { value: number; label: string; hint: string }[] = [
  { value: 0.5, label: '×0.5', hint: 'медленнее: успеваете читать ленту' },
  { value: 1, label: '×1', hint: 'обычная скорость' },
  { value: 2, label: '×2', hint: 'быстрее: рейс и стройка идут вдвое скорее' },
  { value: 4, label: '×4', hint: 'максимум: длинный перелёт пролетает быстро' },
];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.speed;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
}

/**
 * Сколько секунд мира съедает один шаг таймера. Пауза возвращает ноль, поэтому
 * симуляция просто не двигается — это единственное место, где решается темп.
 */
export function tickSeconds(rawSeconds: number, settings: AppSettings, paused: boolean): number {
  if (paused) return 0;
  return Math.max(0, rawSeconds) * clampSpeed(settings.speed);
}

function readFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Незнакомые ключи отбрасываются, битые значения заменяются умолчаниями. */
export function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    speed: clampSpeed(typeof source.speed === 'number' ? source.speed : DEFAULT_SETTINGS.speed),
    animations: readFlag(source.animations, DEFAULT_SETTINGS.animations),
    toasts: readFlag(source.toasts, DEFAULT_SETTINGS.toasts),
    confirmJump: readFlag(source.confirmJump, DEFAULT_SETTINGS.confirmJump),
    autosave: readFlag(source.autosave, DEFAULT_SETTINGS.autosave),
  };
}

export function loadSettings(): AppSettings {
  const store = storage();
  if (!store) return { ...DEFAULT_SETTINGS };
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    /* ignore quota/privacy mode errors */
  }
}
