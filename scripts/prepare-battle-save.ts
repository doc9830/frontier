/**
 * Готовит сохранение с пиратским событием, которое ждёт решения игрока:
 * browser-check.mjs открывает на нём боевой экран, стреляет по радару и отдаёт
 * бой автопилоту. Корабль здесь с орудием, иначе событие чаще всего кончалось бы
 * потерей корабля и проверка теряла бы смысл.
 *
 *   node --experimental-strip-types scripts/prepare-battle-save.ts
 */
import { createGameState, playerShip, SAVE_VERSION } from '../src/game/state/create.ts';
import { shipStats } from '../src/game/ships/ship.ts';
import { buildPayload } from '../src/game/events/events.ts';

const state = createGameState('BROWSER-BATTLE', 'GUNNER');
const ship = playerShip(state);
ship.travel = null;
ship.mission = null;
ship.status = 'docked';
ship.modules.weapon = 2;
ship.modules.shield = 1;
const stats = shipStats(ship);
ship.hull = stats.hullMax;
ship.shield = stats.shieldMax;
state.pendingEvent = {
  id: 'browser:battle',
  eventId: 'pirate_encounter',
  shipId: ship.id,
  firedAt: state.gameTime,
  payload: buildPayload(state, ship, 'pirate_encounter'),
};

// Печатаем одной строкой: browser-check.mjs читает stdout и кладёт строку в localStorage.
console.log(JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), seed: state.seed, state }));
