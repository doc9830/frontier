import type { Encounter, Ship } from '../types.ts';
import { createRng, runtimeRng } from '../rng.ts';
import type { Rng } from '../rng.ts';
import { clamp } from '../economy/market.ts';
import { shipStats } from '../ships/ship.ts';
import type { FightResult } from './combat.ts';

/**
 * Боевая мини-игра: радар, метки и залпы. Числа берутся из того же боя, что
 * считает `resolveFight` (боевой рейтинг, корпус, щиты), но исход решает уже не
 * бросок кубика, а попадания игрока. Поэтому прогноз, живой бой и «АВТОБОЙ»
 * считают одну модель: авторежим — это тот же бой с базовой меткостью.
 *
 * Правила на экране:
 *  - метка пирата видна только после того, как по её сектору прошёл луч радара;
 *  - тап по сектору — выстрел: попадание снимает щит, затем корпус противника;
 *  - залп летит в вас по прямой: его видно всегда, но успеть надо до центра;
 *  - перезарядка не даёт стрелять чаще, чем раз в `RELOAD_SECONDS`.
 */

export const BATTLE_SECONDS = 60;
/** Оборот луча радара: метка светится ровно один проход. */
export const SWEEP_SECONDS = 2.4;
export const RELOAD_SECONDS = 0.5;
/** Сколько метка остаётся видимой после прохода луча. */
export const GLOW_SECONDS = 1.8;
/** Время полёта залпа от окраины экрана до вашего корабля. */
export const VOLLEY_SECONDS = 1.9;
/** Допуск тапа: по углу и по дистанции от центра. */
export const TAP_ARC = 0.24;
export const TAP_RADIUS = 0.14;
/** Меткость и перехват среднего пилота: на них опирается прогноз и автобой. */
export const BASELINE_ACCURACY = 0.58;
export const BASELINE_INTERCEPT = 0.62;
/**
 * База баланса: сколько попаданий нужно при равных рейтингах и сколько пробитий
 * корпуса корабль терпит. Перевес в рейтинге двигает обе цифры, поэтому при
 * равных силах бой — почти монетка, а с перевесом становится увереннее.
 */
const BASE_HITS = 14;
const BASE_LOSSES = 2.5;

export interface CombatBalance {
  playerPower: number;
  enemyPower: number;
  playerHp: number;
  enemyHp: number;
  /** Попаданий до победы и пропущенных залпов до катастрофы. */
  hitsToWin: number;
  lossesAllowed: number;
  shotDamage: number;
  volleyDamage: number;
  /** Сколько выстрелов и залпов сторона успевает сделать за бой. */
  shots: number;
  volleys: number;
  volleyPeriod: number;
  /** Сколько меток пиратов держится на экране. */
  raiders: number;
  verdict: 'easy' | 'go' | 'risky' | 'hopeless';
}

export function combatBalance(ship: Ship, enemy: Encounter): CombatBalance {
  const stats = shipStats(ship);
  // Скорость добавляет рейтинг: быстрый корабль проще доводит прицел.
  const playerPower = Math.max(1, stats.combat) * (0.9 + Math.min(0.35, stats.speed / 6));
  const enemyPower = Math.max(1, enemy.combat);
  const playerHp = Math.max(1, ship.hull + ship.shield);
  const enemyHp = Math.max(1, enemy.hull + enemy.shield);
  const ratio = playerPower / enemyPower;
  const hitsToWin = Math.round(clamp(BASE_HITS / ratio, 4, 60));
  const lossesAllowed = Math.round(clamp(BASE_LOSSES * ratio, 2, 8));
  const volleyPeriod = Math.round(clamp(4.4 - enemy.speed * 1.2, 2.2, 4) * 100) / 100;
  const verdict = ratio >= 1.6 ? 'easy' : ratio >= 0.95 ? 'go' : ratio >= 0.6 ? 'risky' : 'hopeless';

  return {
    playerPower: Math.round(playerPower * 10) / 10,
    enemyPower,
    playerHp,
    enemyHp,
    hitsToWin,
    lossesAllowed,
    shotDamage: Math.max(1, Math.round(enemyHp / hitsToWin)),
    volleyDamage: Math.max(1, Math.round(playerHp / lossesAllowed)),
    shots: Math.floor(BATTLE_SECONDS / RELOAD_SECONDS),
    volleys: Math.max(1, Math.ceil(BATTLE_SECONDS / volleyPeriod)),
    volleyPeriod,
    raiders: clamp(Math.round(2 + enemyPower / 6), 2, 3),
    verdict,
  };
}


/** Метка пирата на радаре: угол в радианах (0 — вправо), радиус 0..1. */
export interface RaiderBlip {
  id: number;
  angle: number;
  radius: number;
  drift: number;
  approach: number;
  glow: number;
}

/** Залп противника: летит к центру, пока не перехватят. */
export interface VolleyBlip {
  id: number;
  angle: number;
  radius: number;
  fuse: number;
  glow: number;
}

export interface BattleState {
  enemy: Encounter;
  balance: CombatBalance;
  enemyHull: number;
  enemyShield: number;
  enemyHits: number;
  playerHull: number;
  playerShield: number;
  timeLeft: number;
  charge: number;
  sweep: number;
  volleyTimer: number;
  raiders: RaiderBlip[];
  volleys: VolleyBlip[];
  shots: number;
  misses: number;
  intercepted: number;
  breached: number;
  over: boolean;
  outcome: FightResult['outcome'] | null;
  log: string[];
  nextId: number;
}

/** Точка радара в тех же координатах, в которых рисует экран (0..1). */
export function radarPoint(angle: number, radius: number): { x: number; y: number } {
  return { x: 0.5 + Math.cos(angle) * radius * 0.5, y: 0.5 + Math.sin(angle) * radius * 0.5 };
}

function spawnRaider(battle: BattleState, far: boolean): RaiderBlip {
  const blip: RaiderBlip = {
    id: battle.nextId,
    angle: runtimeRng.range(0, Math.PI * 2),
    radius: far ? runtimeRng.range(0.78, 0.96) : runtimeRng.range(0.45, 0.8),
    drift: runtimeRng.range(-0.32, 0.32),
    approach: -runtimeRng.range(0.03, 0.07),
    glow: 0,
  };
  battle.nextId += 1;
  return blip;
}

export function createBattle(ship: Ship, enemy: Encounter): BattleState {
  const balance = combatBalance(ship, enemy);
  const battle: BattleState = {
    enemy,
    balance,
    enemyHull: enemy.hull,
    enemyShield: enemy.shield,
    enemyHits: 0,
    playerHull: ship.hull,
    playerShield: ship.shield,
    timeLeft: BATTLE_SECONDS,
    charge: 1,
    sweep: 0,
    volleyTimer: balance.volleyPeriod,
    raiders: [],
    volleys: [],
    shots: 0,
    misses: 0,
    intercepted: 0,
    breached: 0,
    over: false,
    outcome: null,
    log: [`Боевой контакт: ${enemy.name}. Нужно попаданий: ${balance.hitsToWin}.`],
    nextId: 1,
  };
  for (let i = 0; i < balance.raiders; i += 1) battle.raiders.push(spawnRaider(battle, i > 0));
  return battle;
}

function damagePlayer(battle: BattleState, amount: number): void {
  const absorbed = Math.min(battle.playerShield, amount);
  battle.playerShield -= absorbed;
  battle.playerHull = Math.max(0, battle.playerHull - (amount - absorbed));
}

function spendHit(battle: BattleState): void {
  const amount = battle.balance.shotDamage;
  const absorbed = Math.min(battle.enemyShield, amount);
  battle.enemyShield -= absorbed;
  battle.enemyHull = Math.max(0, battle.enemyHull - (amount - absorbed));
  battle.enemyHits += 1;
}

function finish(battle: BattleState, outcome: FightResult['outcome']): void {
  if (battle.over) return;
  battle.over = true;
  battle.outcome = outcome;
  if (outcome === 'victory') {
    battle.log.push(`${battle.enemy.name} разлетается на обломки. Трофеи собраны.`);
    return;
  }
  if (outcome === 'defeat') {
    battle.log.push('Разгерметизация корпуса: бой проигран.');
    return;
  }
  battle.log.push('Бой прерван: обе стороны расходятся по своим курсам.');
}

/** Продолжает бой на дельту времени. Важна сумма кадров, а не их разбивка. */
export function tickBattle(battle: BattleState, delta: number): void {
  if (battle.over) return;
  // Кадр после свернувшейся вкладки не должен телепортировать метки.
  const step = clamp(delta, 0, 0.25);
  const full = Math.PI * 2;
  const previousSweep = battle.sweep;
  battle.sweep = (battle.sweep + (full / SWEEP_SECONDS) * step) % full;
  battle.charge = Math.min(1, battle.charge + step / RELOAD_SECONDS);
  battle.timeLeft = Math.max(0, battle.timeLeft - step);

  // Луч прошёл по сектору — метки в нём засветились на пару секунд.
  const crossed = (angle: number): boolean =>
    previousSweep <= battle.sweep
      ? angle >= previousSweep && angle < battle.sweep
      : angle >= previousSweep || angle < battle.sweep;

  for (const raider of battle.raiders) {
    raider.angle = (raider.angle + raider.drift * step + full) % full;
    raider.radius = clamp(raider.radius + raider.approach * step, 0.3, 0.98);
    raider.glow = Math.max(0, raider.glow - step);
    if (crossed(raider.angle)) raider.glow = GLOW_SECONDS;
    // Метка подошла вплотную: она уходит на новый галс, не вставая в центр.
    if (raider.radius <= 0.3) {
      raider.radius = 0.62;
      raider.approach = -runtimeRng.range(0.03, 0.07);
      raider.drift = runtimeRng.range(-0.32, 0.32);
    }
  }

  for (const volley of battle.volleys) {
    volley.glow = Math.max(0, volley.glow - step);
    if (crossed(volley.angle)) volley.glow = GLOW_SECONDS;
  }

  battle.volleyTimer -= step;
  if (battle.volleyTimer <= 0) {
    let shooter: RaiderBlip | null = null;
    for (const raider of battle.raiders) {
      if (shooter === null || raider.radius < shooter.radius) shooter = raider;
    }
    if (shooter) {
      battle.volleys.push({
        id: battle.nextId,
        angle: shooter.angle,
        radius: 0.78,
        fuse: VOLLEY_SECONDS,
        glow: 0,
      });
      battle.nextId += 1;
      shooter.radius = Math.max(shooter.radius, 0.7);
    }
    battle.volleyTimer = battle.balance.volleyPeriod;
  }

  const closing = 0.78 / VOLLEY_SECONDS;
  const landed: VolleyBlip[] = [];
  for (const volley of battle.volleys) {
    volley.radius -= closing * step;
    volley.fuse -= step;
    if (volley.radius <= 0 || volley.fuse <= 0) landed.push(volley);
  }
  if (landed.length > 0) {
    battle.volleys = battle.volleys.filter((volley) => !landed.includes(volley));
    for (let i = 0; i < landed.length; i += 1) {
      damagePlayer(battle, battle.balance.volleyDamage);
      battle.breached += 1;
      battle.log.push(`Залп прошёл: −${battle.balance.volleyDamage} по щиту и корпусу.`);
      if (battle.playerHull <= 0) {
        finish(battle, 'defeat');
        return;
      }
    }
  }

  if (battle.timeLeft <= 0) finish(battle, 'stalemate');
}

export type TapKind = 'hit' | 'intercept' | 'miss' | 'reload' | 'over';

export interface TapResult {
  kind: TapKind;
  text: string;
}

/** Ближайшая к тапу цель: сначала залпы (их перехват важнее), потом метки. */
function nearest<T extends { angle: number; radius: number }>(
  items: readonly T[],
  angle: number,
  radius: number,
): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const turn = Math.abs(((item.angle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const distance = Math.abs(item.radius - radius);
    if (turn > TAP_ARC || distance > TAP_RADIUS) continue;
    const score = turn + distance * 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

/** Выстрел по сектору радара. Перезарядка не даёт стрелять чаще нормы. */
export function fireAt(battle: BattleState, angle: number, radius: number): TapResult {
  if (battle.over) return { kind: 'over', text: 'Бой уже кончился.' };
  if (battle.charge < 1) return { kind: 'reload', text: 'Орудие перезаряжается.' };
  battle.charge = 0;
  battle.shots += 1;

  const volley = nearest(battle.volleys, angle, radius);
  if (volley) {
    battle.volleys = battle.volleys.filter((entry) => entry !== volley);
    battle.intercepted += 1;
    battle.log.push('Залп перехвачен прямо перед корпусом.');
    return { kind: 'intercept', text: 'Залп перехвачен.' };
  }

  const raider = nearest(battle.raiders, angle, radius);
  if (!raider) {
    battle.misses += 1;
    return { kind: 'miss', text: 'Промах: в секторе пусто.' };
  }

  spendHit(battle);
  // Попадание сбивает пирата с курса: он уходит с этой отметки.
  raider.angle = (raider.angle + runtimeRng.range(-0.9, 0.9) + Math.PI * 2) % (Math.PI * 2);
  raider.radius = clamp(raider.radius + runtimeRng.range(0.06, 0.16), 0.3, 0.98);
  raider.glow = GLOW_SECONDS;
  battle.log.push(`Попадание ${battle.enemyHits}/${battle.balance.hitsToWin}.`);
  if (battle.enemyHits >= battle.balance.hitsToWin) {
    finish(battle, 'victory');
    return { kind: 'hit', text: 'Противник уничтожен.' };
  }
  return { kind: 'hit', text: `Попадание ${battle.enemyHits}/${battle.balance.hitsToWin}.` };
}

export interface SimRun {
  outcome: FightResult['outcome'];
  hits: number;
  losses: number;
  shots: number;
  volleys: number;
}

/**
 * Тот же бой, но без радара: выстрелы идут по таймеру перезарядки, залпы — по
 * таймеру противника, каждый с базовой вероятностью. Модель детерминирована для
 * данного генератора, поэтому прогноз и «АВТОБОЙ» опираются на неё, а не на
 * отдельные догадки о балансе.
 */
export function simulateBattle(
  balance: CombatBalance,
  accuracy: number,
  intercept: number,
  rng: Rng,
): SimRun {
  let hits = 0;
  let losses = 0;
  let shots = 0;
  let volleys = 0;
  let shotAt = 0;
  let volleyAt = balance.volleyPeriod;
  const horizon = BATTLE_SECONDS;

  let outcome: FightResult['outcome'] = 'stalemate';
  while (true) {
    if (shotAt <= volleyAt) {
      if (shotAt > horizon) break;
      shotAt += RELOAD_SECONDS;
      shots += 1;
      if (rng.chance(accuracy)) {
        hits += 1;
        if (hits >= balance.hitsToWin) {
          outcome = 'victory';
          break;
        }
      }
      continue;
    }
    if (volleyAt > horizon) break;
    volleyAt += balance.volleyPeriod;
    volleys += 1;
    if (!rng.chance(intercept)) {
      losses += 1;
      if (losses >= balance.lossesAllowed) {
        outcome = 'defeat';
        break;
      }
    }
  }
  return { outcome, hits, losses, shots, volleys };
}

/** Урон по вашему кораблю от пропущенных залпов: сначала щит, потом корпус. */
function afterLosses(ship: Ship, losses: number, balance: CombatBalance): { hull: number; shield: number } {
  const damage = losses * balance.volleyDamage;
  const absorbed = Math.min(ship.shield, damage);
  return {
    hull: Math.max(0, Math.round(ship.hull - (damage - absorbed))),
    shield: Math.max(0, Math.round(ship.shield - absorbed)),
  };
}

export function battleResult(battle: BattleState): FightResult {
  const log = battle.log.slice(-40);
  const hull = Math.max(0, Math.round(battle.playerHull));
  const shield = Math.max(0, Math.round(battle.playerShield));
  if (battle.outcome === 'victory') {
    return {
      log,
      outcome: 'victory',
      playerHull: hull,
      playerShield: shield,
      bounty: battle.enemy.bounty,
      repChange: 4,
      repFactionId: battle.enemy.factionId,
    };
  }
  if (battle.outcome === 'defeat') {
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
  return { log, outcome: 'stalemate', playerHull: hull, playerShield: shield, bounty: 0, repChange: 0, repFactionId: null };
}

/** Автобой: тот же бой, но за пультом — пилот средней меткости. */
export function autoBattle(
  ship: Ship,
  enemy: Encounter,
  accuracy = BASELINE_ACCURACY,
  intercept = BASELINE_INTERCEPT,
): FightResult {
  const balance = combatBalance(ship, enemy);
  const run = simulateBattle(balance, accuracy, intercept, runtimeRng);
  const log = [
    `Автобой: меткость ${Math.round(accuracy * 100)}%, перехват залпов ${Math.round(intercept * 100)}%.`,
    `Попаданий ${run.hits} из ${balance.hitsToWin} нужных, выстрелов ${run.shots}.`,
    `Залпов по вам: ${run.volleys}, пробило ${run.losses} из ${balance.lossesAllowed} допустимых.`,
  ];
  const damage = afterLosses(ship, run.losses, balance);
  if (run.outcome === 'victory') {
    log.push(`${enemy.name} разлетается на обломки. Трофеи собраны.`);
    return {
      log,
      outcome: 'victory',
      playerHull: damage.hull,
      playerShield: damage.shield,
      bounty: enemy.bounty,
      repChange: 4,
      repFactionId: enemy.factionId,
    };
  }
  if (run.outcome === 'defeat') {
    log.push(`${enemy.name} подавляет ваш корабль. Разгерметизация корпуса!`);
    return { log, outcome: 'defeat', playerHull: 0, playerShield: 0, bounty: 0, repChange: 0, repFactionId: null };
  }
  log.push('Оба корабля расходятся, двигатели раскалены. Ничья.');
  return {
    log,
    outcome: 'stalemate',
    playerHull: damage.hull,
    playerShield: damage.shield,
    bounty: 0,
    repChange: 0,
    repFactionId: null,
  };
}

export interface BattleForecast {
  balance: CombatBalance;
  win: number;
  draw: number;
  loss: number;
  runs: number;
  verdict: string;
}

function forecastVerdict(win: number): string {
  if (win >= 0.66) return 'победа вероятна';
  if (win >= 0.4) return 'шансы равны';
  if (win >= 0.15) return 'рискованно';
  return 'почти безнадёжно';
}

/**
 * Честный прогноз: прогоняем модель много раз с базовой меткостью. Генератор
 * сеяный, иначе цифры на кнопке дёргались бы при каждой перерисовке панели.
 */
export function battleForecast(ship: Ship, enemy: Encounter, runs = 40): BattleForecast {
  const balance = combatBalance(ship, enemy);
  const seed = `${enemy.name}|${enemy.threat}|${enemy.hull}|${Math.round(ship.hull)}|${balance.hitsToWin}`;
  const rng = createRng(seed);
  let win = 0;
  let loss = 0;
  for (let i = 0; i < runs; i += 1) {
    const run = simulateBattle(balance, BASELINE_ACCURACY, BASELINE_INTERCEPT, rng);
    if (run.outcome === 'victory') win += 1;
    else if (run.outcome === 'defeat') loss += 1;
  }
  return {
    balance,
    win: win / runs,
    loss: loss / runs,
    draw: (runs - win - loss) / runs,
    runs,
    verdict: forecastVerdict(win / runs),
  };
}


