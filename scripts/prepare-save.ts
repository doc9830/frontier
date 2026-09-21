/**
 * Готовит сохранение для браузерной проверки: игрок стоит в ничьей системе с
 * полным сканом, выбранным участком и металлом в трюме. Печатает SaveFile в
 * stdout, чтобы browser-check.mjs подложил его в localStorage.
 *
 *   node --experimental-strip-types scripts/prepare-save.ts
 */
import { createGameState, playerShip, SAVE_VERSION } from '../src/game/state/create.ts';
import { chooseSite } from '../src/game/actions/site.ts';
import { FOUNDATION_MATERIALS } from '../src/game/site/site.ts';
import { planetKindOf } from '../src/game/data/planets.ts';

const state = createGameState('BROWSER-E2E', 'TESTER');
const ship = playerShip(state);
const claim = state.systemIds
  .map((id) => state.systems[id])
  .find((system) => system.factionId === null && system.planets.some((p) => planetKindOf(p).buildable));
if (!claim) throw new Error('no lawless system to claim');
const planet = claim.planets.find((p) => planetKindOf(p).buildable);
if (!planet) throw new Error('no buildable planet');

claim.discovered = true;
claim.scanned = true;
for (const belt of claim.belts) belt.discovered = true;
ship.travel = null;
ship.mission = null;
ship.status = 'docked';
ship.systemId = claim.id;
// Металл уже в трюме: так выглядит финал перевозки перед закладкой склада.
ship.cargo = { ...FOUNDATION_MATERIALS };
if (!chooseSite(state, claim.id, planet.id)) throw new Error('chooseSite refused');

// Печатаем одной строкой: browser-check.mjs читает stdout и кладёт строку в localStorage.
console.log(
  JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), seed: state.seed, state }),
);
