import type { Faction, GameState } from '../types.ts';
import { LAWLESS_COLOR, LAWLESS_NAME, LAWLESS_SHORT } from '../data/factions.ts';
import { clamp } from '../economy/market.ts';

export interface FactionView {
  id: string;
  name: string;
  short: string;
  color: string;
  motto: string;
}

/** Works for lawless space too, so the UI never has to special case null. */
export function factionView(state: GameState, factionId: string | null): FactionView {
  if (!factionId) {
    return {
      id: 'lawless',
      name: LAWLESS_NAME,
      short: LAWLESS_SHORT,
      color: LAWLESS_COLOR,
      motto: 'No patrols, no rules, no rescue.',
    };
  }
  const faction: Faction | undefined = state.factions[factionId];
  if (!faction) {
    return {
      id: 'unknown',
      name: 'Unknown',
      short: '???',
      color: LAWLESS_COLOR,
      motto: '',
    };
  }
  return {
    id: faction.id,
    name: faction.name,
    short: faction.short,
    color: faction.color,
    motto: faction.motto,
  };
}

export function reputationOf(state: GameState, factionId: string | null): number {
  if (!factionId) return 0;
  return state.player.reputation[factionId] ?? 0;
}

export function changeReputation(
  state: GameState,
  factionId: string | null,
  delta: number,
): number {
  if (!factionId || delta === 0) return 0;
  const current = state.player.reputation[factionId] ?? 0;
  const next = clamp(Math.round(current + delta), -100, 100);
  state.player.reputation[factionId] = next;
  return next - current;
}

/**
 * Small reputation drip for trading with a faction: the world notices that you
 * show up and pay your fees.
 */
export function tradeReputationGain(units: number): number {
  return clamp(Math.round(units / 40), 1, 3);
}

