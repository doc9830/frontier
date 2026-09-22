import type { AsteroidBelt } from '../types.ts';
import type { Rng } from '../rng.ts';
import { createRng } from '../rng.ts';

/**
 * Запасы поясов астероидов. Пояс — не бесконечная шахта: у него есть запас
 * единиц, который вычитается с каждой вахтой и восстанавливается только
 * медленно (см. sim/world.ts), поэтому «доить» один пояс вечно нельзя.
 */

/** Минимальный запас, ниже которого пояс считается выработанным. */
export const MIN_BELT_RESERVE = 1;

/** Запас, который получает пояс при генерации галактики. */
export function rollBeltReserve(rng: Rng, richness: number): number {
  const base = rng.range(240, 620) * (0.75 + richness * 0.55);
  return Math.round(base);
}

/** Запас пояса, у которого поля reserve нет (сейвы старых версий). */
export function fallbackBeltReserve(belt: AsteroidBelt): number {
  return rollBeltReserve(createRng(`belt:${belt.id}`), belt.richness);
}

export function beltReserve(belt: AsteroidBelt): number {
  const value = belt.reserve;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  return fallbackBeltReserve(belt);
}

/**
 * Насколько пояс выработан, 0..1. Оценка приблизительная: исходный запас
 * восстанавливается детерминированно по id, поэтому полоска не «дрожит».
 */
export function beltWear(belt: AsteroidBelt): number {
  const initial = Math.max(1, fallbackBeltReserve(belt), beltReserve(belt));
  return Math.max(0, Math.min(1, 1 - beltReserve(belt) / initial));
}
