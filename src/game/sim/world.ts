import type { GameState, StarSystem } from '../types.ts';
import { TICKS } from '../types.ts';
import { RESOURCES } from '../data/resources.ts';
import { clamp, simulateMarket } from '../economy/market.ts';
import { createRng, runtimeRng } from '../rng.ts';
import { refreshContracts } from '../economy/contracts.ts';
import { addNews } from '../news/news.ts';
import { addToast } from './toast.ts';
import { factionView } from '../factions/reputation.ts';

/**
 * Background simulation: market drift, contract boards and the occasional world
 * event that moves prices or security. All of it runs on game time, so it also
 * happens while the tab is closed.
 */

export function simulateWorld(state: GameState, seconds: number, previousTime: number): void {
  if (seconds > 0) {
    const bucket = Math.floor(state.gameTime / TICKS.marketStepSeconds);
    const rand = createRng(`${state.seed}:market:${bucket}`);
    const roll = (): number => rand.next();
    for (const id of state.systemIds) {
      const system = state.systems[id];
      if (system) simulateMarket(system.market, seconds, roll);
    }
  }

  const previousDay = Math.floor(previousTime / TICKS.secondsPerDay);
  const currentDay = Math.floor(state.gameTime / TICKS.secondsPerDay);
  if (currentDay > previousDay) refreshContractBoards(state, currentDay);

  if (state.gameTime >= state.nextWorldEventAt) fireWorldEvent(state);
}

function refreshContractBoards(state: GameState, day: number): void {
  const absoluteDay = Math.floor(day + 127);
  for (const id of state.systemIds) {
    const system = state.systems[id];
    if (!system?.stations.some((s) => s.hasContracts)) continue;
    refreshContracts(system, createRng(`${state.seed}:contracts:${id}:${absoluteDay}`), absoluteDay);
  }
}

const EVENT_INTERVAL: [number, number] = [240, 540];

function pickRandomSystem(state: GameState): StarSystem {
  const id = runtimeRng.pick(state.systemIds);
  return state.systems[id];
}

function fireWorldEvent(state: GameState): void {
  state.nextWorldEventAt = state.gameTime + runtimeRng.int(EVENT_INTERVAL[0], EVENT_INTERVAL[1]);
  const roll = runtimeRng.next();

  if (roll < 0.28) {
    // demand spike: one resource becomes expensive in one system
    const system = pickRandomSystem(state);
    const def = runtimeRng.pick(RESOURCES);
    system.market.target[def.id] = Math.round((system.market.target[def.id] ?? 100) * 1.45);
    const text = `${system.name}: зафиксирована нехватка «${def.name}». Цены растут.`;
    addNews(state, text, 'market', system.id, system.factionId);
    addToast(state, text, 'info');
    return;
  }
  if (roll < 0.5) {
    const system = pickRandomSystem(state);
    const def = runtimeRng.pick(RESOURCES);
    system.market.target[def.id] = Math.round((system.market.target[def.id] ?? 100) * 0.7);
    const text = `Избыток «${def.name}» затоваривает доки системы ${system.name}.`;
    addNews(state, text, 'market', system.id, system.factionId);
    return;
  }
  if (roll < 0.72) {
    const system = pickRandomSystem(state);
    system.security = clamp(system.security - runtimeRng.range(0.04, 0.12), 0.02, 0.98);
    const text = `Всплеск пиратской активности в системе ${system.name}. Конвои меняют маршруты.`;
    addNews(state, text, 'piracy', system.id, system.factionId);
    if (system.id === state.systems[state.player.homeSystemId]?.id) addToast(state, text, 'bad');
    return;
  }
  if (roll < 0.88) {
    const system = pickRandomSystem(state);
    system.security = clamp(system.security + runtimeRng.range(0.03, 0.09), 0.02, 0.98);
    const faction = factionView(state, system.factionId);
    const text = `Патрули «${faction.name}» усилены вокруг системы ${system.name}.`;
    addNews(state, text, 'faction', system.id, system.factionId);
    return;
  }

  // exploration: reveal a neighbour of a charted system
  const charted = state.systemIds.filter((id) => state.systems[id].discovered);
  if (charted.length === 0) return;
  const anchor = state.systems[runtimeRng.pick(charted)];
  const hidden = anchor.connections
    .map((id) => state.systems[id])
    .find((s) => s && !s.discovered);
  if (!hidden) return;
  hidden.discovered = true;
  const text = `Разведка нанесла на карты систему ${hidden.name}. Возможно, там открылись новые рынки.`;
  addNews(state, text, 'exploration', hidden.id, hidden.factionId);
  addToast(state, text, 'good');
}
