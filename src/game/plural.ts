/**
 * Russian plural helper: plural(2, 'тонна', 'тонны', 'тонн') → 'тонны'.
 * The game text is Russian only, so pluralisation lives here instead of in
 * every template string.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.round(count)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** "2 корабля" style helper: agree(text) returns a function for a count. */
export function agree(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}

/** "5 слотов", "1 слот", "3 слота". */
export function slots(count: number): string {
  return agree(count, 'слот', 'слота', 'слотов');
}

export function hops(count: number): string {
  return agree(count, 'прыжок', 'прыжка', 'прыжков');
}
