import type { Faction, GameState, ResourceId } from '../types.ts';
import { FACTIONS, LAWLESS_COLOR, LAWLESS_NAME, LAWLESS_SHORT } from '../data/factions.ts';
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

export function reputationLabel(value: number): string {
  if (value >= 60) return 'ALLIED';
  if (value >= 25) return 'FRIENDLY';
  if (value >= 5) return 'WARM';
  if (value > -5) return 'NEUTRAL';
  if (value > -25) return 'COLD';
  if (value > -60) return 'HOSTILE';
  return 'WANTED';
}

export function reputationColor(value: number): string {
  if (value >= 25) return '#7ef7b0';
  if (value >= 5) return '#a8e6a3';
  if (value > -5) return '#9aa4b2';
  if (value > -25) return '#ffb347';
  return '#ff6b6b';
}

/**
 * Small reputation drip for trading with a faction: the world notices that you
 * show up and pay your fees.
 */
export function tradeReputationGain(units: number): number {
  return clamp(Math.round(units / 40), 1, 3);
}

export function factionSpecialities(_state: GameState, factionId: string | null) {
  if (!factionId) return null;
  const def = FACTIONS.find((f) => f.id === factionId);
  if (!def) return null;
  return { exports: def.exports as ResourceId[], imports: def.imports as ResourceId[] };
}
