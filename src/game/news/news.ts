import type { GameState, NewsItem } from '../types.ts';
import { TICKS } from '../types.ts';

/**
 * Galactic news feed and world history. Text is generated from game state —
 * no LLM anywhere in the loop, but the shape allows swapping the text generator
 * later without touching the simulation.
 */

let newsCounter = 0;

export function gameDay(state: GameState): number {
  return 127 + state.gameTime / TICKS.secondsPerDay;
}

export function formatGameTime(state: GameState): string {
  const day = gameDay(state);
  const whole = Math.floor(day);
  const fraction = Math.floor((day - whole) * 100);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

export function addNews(
  state: GameState,
  text: string,
  tag: string,
  systemId: string | null = null,
  factionId: string | null = null,
): NewsItem {
  newsCounter += 1;
  const item: NewsItem = {
    id: `N${newsCounter}-${Math.floor(Math.random() * 100000)}`,
    day: Math.round(gameDay(state) * 100) / 100,
    text,
    tag,
    systemId,
    factionId,
  };
  state.news.unshift(item);
  if (state.news.length > 120) state.news.length = 120;
  return item;
}

