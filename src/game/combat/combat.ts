import { clamp } from '../economy/market.ts';
import type { Encounter, GameState, RiskLevel, Ship } from '../types.ts';
import { runtimeRng } from '../rng.ts';
import { shipStats } from '../ships/ship.ts';

/**
 * Turning based, stat driven combat. The player never pilots anything: the
 * result comes from combat rating, shield, hull and speed, and the log tells the
 * story round by round.
 */

const PIRATE_NAMES = [
  'Пиратский перехватчик',
  'Пиратский рейдер',
  'Пиратский корсар',
  'Пиратский ганшип',
  'Пиратский мародёр',
];

export function createEncounter(state: GameState, systemId: string, strength = 1): Encounter {
  const system = state.systems[systemId];
  const lawless = !system?.factionId;
  const threatRoll = runtimeRng.next() * (lawless ? 1.25 : 0.95) * strength;
  const threat: RiskLevel =
    threatRoll < 0.3 ? 'LOW' : threatRoll < 0.62 ? 'MEDIUM' : threatRoll < 0.88 ? 'HIGH' : 'EXTREME';
  const tier = threat === 'LOW' ? 1 : threat === 'MEDIUM' ? 2 : threat === 'HIGH' ? 3 : 4;
  const name = PIRATE_NAMES[Math.min(PIRATE_NAMES.length - 1, tier - 1)];
  const hull = Math.round(220 + tier * 190);

  return {
    name: name.toUpperCase(),
    threat,
    combat: Math.round(2 + tier * 2.4 + (lawless ? 1.5 : 0)),
    hull,
    hullMax: hull,
    shield: Math.round(90 + tier * 130),
    shieldMax: Math.round(90 + tier * 130),
    speed: Math.round((0.8 + tier * 0.25) * 100) / 100,
    bounty: Math.round(900 * tier * runtimeRng.range(0.8, 1.4)),
    factionId: system?.factionId ?? null,
  };
}

export interface FightResult {
  log: string[];
  outcome: 'victory' | 'defeat' | 'stalemate';
  playerHull: number;
  playerShield: number;
  bounty: number;
  repChange: number;
  repFactionId: string | null;
}

export function resolveFight(state: GameState, ship: Ship, enemy: Encounter): FightResult {
  void state;
  const stats = shipStats(ship);
  let hull = ship.hull;
  let shield = ship.shield;
  let enemyHull = enemy.hull;
  let enemyShield = enemy.shield;
  const log: string[] = [];

  const playerPower = Math.max(1, stats.combat);
  const enemyPower = Math.max(1, enemy.combat);
  const playerSpeedFactor = 0.85 + Math.min(0.5, stats.speed / 3);

  for (let round = 1; round <= 8; round += 1) {
    const playerHit = playerPower * runtimeRng.range(0.75, 1.35) * playerSpeedFactor;
    const enemyHit =
      enemyPower * runtimeRng.range(0.7, 1.3) * (enemy.speed > stats.speed ? 1.08 : 0.96);

    const shieldAbsorbed = Math.min(enemyShield, playerHit);
    enemyShield -= shieldAbsorbed;
    const hullDamage = Math.max(0, playerHit - shieldAbsorbed);
    enemyHull -= hullDamage;

    const myShieldAbsorbed = Math.min(shield, enemyHit);
    shield -= myShieldAbsorbed;
    const myHullDamage = Math.max(0, enemyHit - myShieldAbsorbed);
    hull -= myHullDamage;

    log.push(
      `Р${round}: ваш удар ${Math.round(playerHit)} [щ ${Math.round(shieldAbsorbed)} / к ${Math.round(hullDamage)}]` +
        ` · удар врага ${Math.round(enemyHit)} [щ ${Math.round(myShieldAbsorbed)} / к ${Math.round(myHullDamage)}]`,
    );
    if (enemyHull <= 0 || hull <= 0) break;
  }

  hull = Math.max(0, Math.round(hull));
  shield = Math.max(0, Math.round(shield));

  if (enemyHull <= 0 && hull > 0) {
    log.push(`${enemy.name} разлетается на обломки. Трофеи собраны.`);
    return {
      log,
      outcome: 'victory',
      playerHull: hull,
      playerShield: shield,
      bounty: enemy.bounty,
      repChange: 4,
      repFactionId: enemy.factionId,
    };
  }
  if (hull <= 0) {
    log.push(`${enemy.name} подавляет ваш корабль. Разгерметизация корпуса!`);
    return {
      log,
      outcome: 'defeat',
      playerHull: 0,
      playerShield: 0,
      bounty: 0,
      repChange: 0,
      repFactionId: null,
    };
  }
  log.push('Оба корабля расходятся, двигатели раскалены. Ничья.');
  return {
    log,
    outcome: 'stalemate',
    playerHull: hull,
    playerShield: shield,
    bounty: 0,
    repChange: 0,
    repFactionId: null,
  };
}

export interface EscapeAttempt {
  success: boolean;
  hull: number;
  shield: number;
  log: string[];
}

/**
 * Stat driven escape. Speed buys you room, shields pay for the parting shots.
 * An emergency jump always works, but the drive dumps heat into the hull.
 */
export function tryEscape(ship: Ship, enemy: Encounter, emergency: boolean): EscapeAttempt {
  const stats = shipStats(ship);
  const log: string[] = [];
  let hull = ship.hull;
  let shield = ship.shield;

  const chance = emergency ? 1 : clamp(0.34 + stats.speed * 0.16 - enemy.speed * 0.1, 0.12, 0.92);
  const rounds = emergency ? 1 : 2;

  for (let round = 1; round <= rounds; round += 1) {
    const hit = enemy.combat * runtimeRng.range(0.55, 1.15) * 0.7;
    const absorbed = Math.min(shield, hit);
    shield -= absorbed;
    const damage = Math.max(0, hit - absorbed) * (emergency ? 1.15 : 1);
    hull -= damage;
    log.push(
      `Р${round}: прощальный залп ${Math.round(hit)} [щ ${Math.round(absorbed)} / к ${Math.round(damage)}]`,
    );
    if (hull <= 0) break;
  }

  hull = Math.max(0, Math.round(hull));
  shield = Math.max(0, Math.round(shield));
  const success = hull > 0 && (emergency || runtimeRng.chance(chance));
  log.push(
    success
      ? emergency
        ? 'Прыжковый двигатель сработал на аварийном режиме.'
        : 'Вектор ухода подтверждён, дистанция растёт.'
      : `${enemy.name} повторяет ваш манёвр и держит дистанцию.`,
  );
  return { success, hull, shield, log };
}
