import type {
  Amounts,
  EventPayload,
  GameState,
  ResourceId,
  Ship,
  TravelEvent,
  TravelPlan,
} from '../types.ts';
import { runtimeRng } from '../rng.ts';
import { createEncounter } from '../combat/combat.ts';
import { addCargo } from '../ships/ship.ts';
import { changeReputation, factionView } from '../factions/reputation.ts';
import { addNews } from '../news/news.ts';
import { resourceSymbol } from '../data/resources.ts';

/**
 * Travel events. They are rare on purpose: most jumps complete quietly, and the
 * player should never feel nagged by the game.
 */

export interface EventChoiceDef {
  id: string;
  label: string;
  hint?: string;
}

export interface TravelEventDef {
  id: string;
  title: string;
  /** base weight, used when an event is rolled */
  weight: number;
  /** events that open a modal and pause the trip */
  interactive: boolean;
  choices: EventChoiceDef[];
}

export const EVENT_DEFS: TravelEventDef[] = [
  {
    id: 'nothing',
    title: 'Спокойный перелёт',
    weight: 34,
    interactive: false,
    choices: [],
  },
  {
    id: 'abandoned_cargo',
    title: 'Брошенный контейнер',
    weight: 16,
    interactive: true,
    choices: [
      { id: 'take', label: 'ЗАБРАТЬ ГРУЗ', hint: 'бесплатный товар, но бывает ловушка' },
      { id: 'leave', label: 'ОСТАВИТЬ', hint: 'никакого риска' },
    ],
  },
  {
    id: 'distress_signal',
    title: 'Сигнал бедствия',
    weight: 12,
    interactive: true,
    choices: [
      { id: 'help', label: 'ПОМОЧЬ', hint: 'расход топлива, рост репутации' },
      { id: 'ignore', label: 'ИГНОРИРОВАТЬ', hint: 'ни риска, ни награды' },
    ],
  },
  {
    id: 'rare_signal',
    title: 'Редкий сигнал',
    weight: 14,
    interactive: true,
    choices: [
      { id: 'scan', label: 'ГЛУБОКОЕ СКАНИРОВАНИЕ', hint: 'результат зависит от сканера' },
      { id: 'skip', label: 'ПРОПУСТИТЬ', hint: 'продолжить путь' },
    ],
  },
  {
    id: 'derelict_ship',
    title: 'Брошенный корабль',
    weight: 12,
    interactive: true,
    choices: [
      { id: 'board', label: 'ОБЫСКАТЬ КОРПУС', hint: 'трофеи, небольшая вероятность пиратов' },
      { id: 'leave', label: 'ОСТАВИТЬ', hint: 'никакого риска' },
    ],
  },
  {
    id: 'trade_opportunity',
    title: 'Удачная сделка',
    weight: 10,
    interactive: true,
    choices: [
      { id: 'accept', label: 'КУПИТЬ НАВОДКУ', hint: 'дешёвая информация, небольшая прибыль' },
      { id: 'decline', label: 'ОТКАЗАТЬСЯ', hint: 'никакого риска' },
    ],
  },
  {
    id: 'unknown_anomaly',
    title: 'Неизвестная аномалия',
    weight: 8,
    interactive: true,
    choices: [
      { id: 'investigate', label: 'ИССЛЕДОВАТЬ', hint: 'большой риск, большая награда' },
      { id: 'avoid', label: 'ОБОЙТИ', hint: 'никакого риска' },
    ],
  },
  {
    id: 'pirate_encounter',
    title: 'Встреча с пиратами',
    weight: 22,
    interactive: true,
    choices: [
      { id: 'fight', label: 'В БОЙ', hint: 'решает боевой рейтинг' },
      { id: 'escape', label: 'УХОДИТЬ', hint: 'решает скорость' },
      { id: 'cargo', label: 'ОТДАТЬ ГРУЗ', hint: 'потеряете половину трюма' },
      { id: 'emergency', label: 'ЭКСТРЕННЫЙ ПРЫЖОК', hint: 'почти всегда работает, но бьёт по корпусу' },
    ],
  },
];

const EVENT_MAP: Record<string, TravelEventDef> = Object.fromEntries(
  EVENT_DEFS.map((e) => [e.id, e]),
);

export function eventDef(id: string): TravelEventDef | undefined {
  return EVENT_MAP[id];
}


function pickEvent(state: GameState, riskScore: number, allowCombat: boolean): TravelEventDef {
  const weighted = EVENT_DEFS.filter((def) => allowCombat || def.id !== 'pirate_encounter').map(
    (def) => {
      let weight = def.weight;
      if (def.id === 'pirate_encounter') weight *= 0.55 + riskScore * 2.4;
      if (def.id === 'nothing') weight *= 1.4;
      if (def.id === 'rare_signal') weight *= 0.7 + riskScore;
      return { item: def, weight };
    },
  );
  void state;
  return runtimeRng.weighted(weighted);
}

/**
 * Rolls the events of a whole trip at departure time, so the schedule is part
 * of the save file and survives a page reload.
 */
export function scheduleTravelEvents(
  state: GameState,
  plan: TravelPlan,
  departAt: number,
): TravelEvent[] {
  const events: TravelEvent[] = [];
  if (plan.hops < 2) return events;
  const perHopSeconds = plan.seconds / plan.hops;
  let combatUsed = false;
  for (let hop = 1; hop < plan.hops; hop += 1) {
    if (events.length >= 2) break;
    const chance = 0.03 + plan.riskScore * 0.08;
    if (!runtimeRng.chance(chance)) continue;
    const def = pickEvent(state, plan.riskScore, !combatUsed);
    if (def.id === 'nothing') continue;
    if (def.id === 'pirate_encounter') combatUsed = true;
    events.push({ at: Math.round(departAt + hop * perHopSeconds), eventId: def.id });
  }
  return events;
}

/** Rolls all concrete numbers at spawn time so the save stays consistent. */
export function buildPayload(state: GameState, ship: Ship, eventId: string): EventPayload {
  const systemId = ship.systemId;
  const payload: EventPayload = { systemId };
  switch (eventId) {
    case 'pirate_encounter':
      payload.enemy = createEncounter(state, systemId, 1);
      break;
    case 'abandoned_cargo': {
      const pool: Amounts[] = [
        { metal: runtimeRng.int(8, 26) },
        { food: runtimeRng.int(20, 60) },
        { fuel: runtimeRng.int(10, 30) },
        { electronics: runtimeRng.int(3, 10) },
      ];
      payload.cargo = runtimeRng.pick(pool);
      break;
    }
    case 'distress_signal':
      payload.credits = runtimeRng.int(700, 2600);
      break;
    case 'rare_signal': {
      const belts = state.systems[systemId]?.belts ?? [];
      const hidden = belts.find((b) => !b.discovered);
      payload.beltId = hidden?.id;
      payload.cargo = runtimeRng.chance(0.5)
        ? { rareOre: runtimeRng.int(4, 14) }
        : { artifacts: 1 };
      break;
    }
    case 'derelict_ship':
      payload.credits = runtimeRng.int(1200, 4200);
      payload.cargo = { metal: runtimeRng.int(12, 40) };
      break;
    case 'trade_opportunity':
      payload.credits = runtimeRng.int(300, 1400);
      break;
    case 'unknown_anomaly':
      payload.cargo = runtimeRng.chance(0.45)
        ? { artifacts: 1 }
        : { rareOre: runtimeRng.int(6, 18) };
      payload.credits = runtimeRng.int(0, 2500);
      break;
    default:
      break;
  }
  return payload;
}

/** Grants cargo without breaking the hold limit; returns what fitted. */
export function grantCargo(ship: Ship, cargo: Amounts): { added: number; lost: number } {
  let added = 0;
  let lost = 0;
  for (const [id, qty] of Object.entries(cargo) as [ResourceId, number][]) {
    if (!qty) continue;
    const fit = addCargo(ship, id, qty);
    added += fit;
    lost += qty - fit;
  }
  return { added, lost };
}

export function describeCargo(cargo: Amounts): string {
  return Object.entries(cargo)
    .filter(([, qty]) => (qty ?? 0) > 0)
    .map(([id, qty]) => `${qty} ${resourceSymbol(id as ResourceId)}`)
    .join(', ');
}

/** Reputation gain helper shared by several event outcomes. */
export function eventReputation(
  state: GameState,
  factionId: string | null,
  delta: number,
): string {
  const applied = changeReputation(state, factionId, delta);
  if (applied === 0) return '';
  const view = factionView(state, factionId);
  const sign = applied > 0 ? '+' : '';
  return ` ${view.short} ${sign}${applied} реп.`;
}

export { addNews };
