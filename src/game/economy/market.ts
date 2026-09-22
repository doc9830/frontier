import type { Rng } from '../rng.ts';
import { TICKS } from '../types.ts';
import type { ResourceId, StarSystem, SystemMarket } from '../types.ts';
import { RESOURCES, resource } from '../data/resources.ts';
/**
 * Market model.
 *
 * Each system keeps a stock per resource and an equilibrium `target`. Price is
 * `base * bias * (target / stock) ^ 0.45`, so a system that produces metal sells
 * it cheap and a system that consumes it pays well. Player trades move stock,
 * which moves the price — small arbitrage is always possible, big hauls are not
 * free money.
 */

const PRICE_ELASTICITY = 0.45;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function emptyRecord(value = 0): Record<ResourceId, number> {
  const record = {} as Record<ResourceId, number>;
  for (const def of RESOURCES) record[def.id] = value;
  return record;
}

export function createMarket(system: StarSystem, rng: Rng): SystemMarket {
  const stock = emptyRecord();
  const target = emptyRecord();
  const bias = emptyRecord();

  const populationFactor = 0.75 + Math.min(2.2, system.population / 16000);
  const lawless = system.factionId === null;

  for (const def of RESOURCES) {
    const produces = system.produces.includes(def.id);
    const consumes = system.consumes.includes(def.id);

    let targetValue = 260 * populationFactor;
    if (def.raw) targetValue *= 1.7;
    if (produces) targetValue *= 2.3;
    if (consumes) targetValue *= 0.42;
    if (lawless) targetValue *= 0.7;
    targetValue *= rng.range(0.85, 1.2);

    let biasValue = 1;
    if (produces) biasValue -= 0.13;
    if (consumes) biasValue += 0.15;
    if (lawless) biasValue += 0.12;
    biasValue += rng.range(-0.07, 0.07);

    stock[def.id] = Math.round(targetValue * rng.range(0.55, 1.5));
    target[def.id] = Math.round(targetValue);
    bias[def.id] = clamp(biasValue, 0.72, 1.45);
  }

  return { stock, target, bias };
}

/** Neutral index price of a resource in this market. */
export function marketPrice(market: SystemMarket, id: ResourceId): number {
  const def = resource(id);
  const stock = Math.max(12, market.stock[id] ?? 0);
  const target = Math.max(12, market.target[id] ?? 0);
  const ratio = Math.pow(target / stock, PRICE_ELASTICITY);
  const price = def.basePrice * (market.bias[id] ?? 1) * clamp(ratio, 0.45, 2.6);
  return Math.max(1, Math.round(price));
}

/** Reputation shifts the spread: -100%00 policy, +1% per 8 points of standing. */
export function reputationPriceModifier(reputation: number): number {
  return clamp(1 - reputation * 0.0016, 0.82, 1.18);
}

export function playerBuyPrice(
  market: SystemMarket,
  id: ResourceId,
  reputation = 0,
): number {
  return Math.max(1, Math.round(marketPrice(market, id) * 1.06 * reputationPriceModifier(reputation)));
}

export function playerSellPrice(
  market: SystemMarket,
  id: ResourceId,
  reputation = 0,
): number {
  return Math.max(1, Math.round(marketPrice(market, id) * 0.94 * reputationPriceModifier(reputation)));
}

/** How much of the resource the market is willing to sell right now. */
export function availableStock(market: SystemMarket, id: ResourceId): number {
  return Math.floor(market.stock[id] ?? 0);
}

export function applyBuy(market: SystemMarket, id: ResourceId, qty: number): void {
  market.stock[id] = Math.max(0, (market.stock[id] ?? 0) - qty);
}

export function applySell(market: SystemMarket, id: ResourceId, qty: number): void {
  const cap = (market.target[id] ?? 0) * 3 + 400;
  market.stock[id] = Math.min(cap, (market.stock[id] ?? 0) + qty);
}

/**
 * Slow drift of supply and demand. Called from the main simulation loop with
 * the elapsed time, so prices recover after the player hauls a lot of cargo.
 */
export function simulateMarket(
  market: SystemMarket,
  seconds: number,
  rand: () => number = Math.random,
): void {
  const steps = Math.floor(seconds / TICKS.marketStepSeconds);
  if (steps <= 0) return;
  const capped = Math.min(steps, 120);
  for (let step = 0; step < capped; step += 1) {
    for (const def of RESOURCES) {
      const target = market.target[def.id] ?? 0;
      const stock = market.stock[def.id] ?? 0;
      const pull = (target - stock) * 0.05;
      const noise = (rand() - 0.5) * target * 0.02;
      market.stock[def.id] = Math.max(0, stock + pull + noise);
    }
  }
}
