/**
 * Headless smoke test. Builds a galaxy, drives the simulation for a while and
 * exercises the same action functions the UI calls, so a broken economy or sim
 * step fails loudly without opening a browser.
 *
 * Run with: npm run smoke
 */
import type { GameState, ResourceId } from '../src/game/types.ts';
import { createGameState, playerShip } from '../src/game/state/create.ts';
import { advance, catchUp, resolvePendingEvent } from '../src/game/sim/engine.ts';
import { eventDef, EVENT_DEFS, buildPayload } from '../src/game/events/events.ts';
import { jumpPlan, travelTo } from '../src/game/actions/nav.ts';
import { findPath } from '../src/game/exploration/travel.ts';
import { marketPrice } from '../src/game/economy/market.ts';
import {
  atMarket,
  buyPriceAt,
  buyResource,
  loadFromStation,
  refuelShip,
  sellPriceAt,
  sellResource,
  sellStoredResource,
  unloadToStation,
} from '../src/game/actions/trade.ts';
import { beltById, startMining, stopMining } from '../src/game/sim/mining.ts';
import {
  buildingOffers,
  buyResearch,
  recipeOffers,
  researchOffers,
  startConstruction,
} from '../src/game/actions/build.ts';
import {
  acceptContract,
  activeContracts,
  canDeliverContract,
  contractBlockedReason,
  contractsHere,
} from '../src/game/actions/contracts.ts';
import { hullsForSale, moduleOffers, purchaseShip, shipResaleValue } from '../src/game/actions/outfitting.ts';
import { fleetCap, missionSlots } from '../src/game/sim/fleet.ts';
import { storageCapacity, storageUsed } from '../src/game/sim/station.ts';
import { formatGameTime, gameDay } from '../src/game/news/news.ts';

let checks = 0;
let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function finite(label: string, value: number): void {
  check(`${label} is finite`, Number.isFinite(value), String(value));
}

/** Resolves a paused travel event with its first choice (what a player would do). */
function settle(state: GameState): number {
  let resolved = 0;
  let guard = 0;
  while (state.pendingEvent && guard < 50) {
    guard += 1;
    const def = eventDef(state.pendingEvent.eventId);
    const choice = def?.choices[0]?.id ?? 'leave';
    resolvePendingEvent(state, choice);
    resolved += 1;
  }
  return resolved;
}

/** Runs the sim in UI-sized ticks, answering any events on the way. */
function runFor(state: GameState, seconds: number, eventsRef: { count: number }): void {
  const step = 0.25;
  const steps = Math.ceil(seconds / step);
  for (let i = 0; i < steps; i += 1) {
    eventsRef.count += settle(state);
    if (state.pendingEvent) continue;
    advance(state, step);
  }
  eventsRef.count += settle(state);
}

const events = { count: 0 };

// --------------------------------------------------------------- generation
console.log('\n[1] world generation');
const state = createGameState('SMOKE-1', 'TESTER');
const ship = playerShip(state);
const homeFaction = state.systems[ship.systemId].factionId;
check('seed kept', state.seed === 'SMOKE-1');
check('galaxy has systems', state.systemIds.length >= 20, `${state.systemIds.length} systems`);
check('four factions', state.factionIds.length === 4, state.factionIds.join(', '));
check('home system charted', !!state.systems[state.player.homeSystemId]?.discovered);
check('player ship docked at home', ship.status === 'docked' && ship.systemId === state.player.homeSystemId);
check('home faction reputation seeded', homeFaction !== null && (state.player.reputation[homeFaction] ?? 0) > 0);
check(
  'home neighbourhood charted by the station radar',
  state.systemIds.filter((id) => state.systems[id].discovered).length >= 2,
  `${state.systemIds.filter((id) => state.systems[id].discovered).length} systems`,
);
check(
  'lanes are symmetric',
  state.systemIds.every((id) =>
    state.systems[id].connections.every((link) => state.systems[link]?.connections.includes(id)),
  ),
);
finite('credits', state.player.credits);
finite('hull', ship.hull);
finite('fuel', ship.fuel);
check('news seeded', state.news.length >= 3, `${state.news.length} items`);
check('start day reads 127.xx', gameDay(state) >= 127 && gameDay(state) < 128, formatGameTime(state));

// --------------------------------------------------------------- idle sim
console.log('\n[2] idle simulation (20 in-game minutes of world drift)');
const creditsBefore = state.player.credits;
runFor(state, 1200, events);
check('game time advanced', state.gameTime > 1000, `${state.gameTime.toFixed(1)} s`);
check('credits untouched by drift', state.player.credits === creditsBefore);
finite('credits after drift', state.player.credits);
const marketSane = state.systemIds.every((id) => {
  const market = state.systems[id].market;
  return Object.keys(market.stock).every((rid) => {
    const price = marketPrice(market, rid as ResourceId);
    return Number.isFinite(price) && price > 0;
  });
});
check('every market price is positive and finite', marketSane);

// --------------------------------------------------------------- mining
console.log('\n[3] mining and cargo (at home, where the belts are charted)');
const home = state.systems[ship.systemId];
const belts = home.belts.filter((belt) => belt.discovered);
check('home has a charted belt', belts.length > 0, `${belts.length} belts`);
if (belts.length > 0) {
  const belt = beltById(state, belts[0].id);
  check('belt lookup works', !!belt, belt ? belt.belt.name : 'missing');
  const started = startMining(state, ship, belts[0].id);
  check('mining started', started, started ? 'laser online' : 'no mining gear on the started ship');
  if (started) {
    runFor(state, 60, events);
    check('units mined', state.player.stats.mined > 0, `${state.player.stats.mined} units`);
    finite('hold total', Object.values(ship.cargo).reduce((sum, qty) => sum + (qty ?? 0), 0));
    stopMining(state, ship);
    check('mining stopped', ship.status !== 'mining', ship.status);
  }
}

// --------------------------------------------------------------- travel
console.log('\n[4] travel, fuel and events');
if (atMarket(state)) refuelShip(state, ship);
const reachable = state.systemIds
  .filter((id) => id !== home.id && state.systems[id].discovered)
  .map((id) => ({ id, hops: findPath(state, home.id, id).length - 1 }))
  .filter((entry) => entry.hops > 0 && entry.hops <= 3)
  .sort((a, b) => a.hops - b.hops);
check('at least one charted neighbour to jump to', reachable.length > 0, `${reachable.length} candidates`);

if (reachable.length > 0) {
  const target = reachable[0].id;
  const plan = jumpPlan(state, target);
  check('jump plan produced', !!plan, plan ? `${plan.hops} hops · ${plan.fuel} fuel` : 'no plan');
  const fuelBefore = ship.fuel;
  const ok = travelTo(state, target);
  check('travelTo accepted the jump', ok);
  runFor(state, 900, events);
  check('ship arrived', ship.systemId === target, `${state.systems[ship.systemId].name}`);
  check('travel cleared', !ship.travel);
  check('fuel burned', ship.fuel < fuelBefore, `${fuelBefore.toFixed(1)} → ${ship.fuel.toFixed(1)}`);
  check('jump counted', state.player.stats.jumps >= 1, `${state.player.stats.jumps}`);
  check(
    'radar charted the arrival neighbourhood',
    state.systemIds.filter((id) => state.systems[id].discovered).length >= 2,
    `${state.systemIds.filter((id) => state.systems[id].discovered).length} systems charted`,
  );
  console.log(`  info ${events.count} travel event(s) answered by the first choice`);
}

// --------------------------------------------------------------- market
console.log('\n[5] market round trip');
if (atMarket(state)) {
  const market = state.systems[ship.systemId].market;
  const pick = (Object.keys(market.stock) as ResourceId[])
    .filter((id) => market.stock[id] > 6)
    .sort((a, b) => buyPriceAt(state, a) - buyPriceAt(state, b))[0];
  check('a resource is in stock here', !!pick, pick ?? 'nothing tradeable');
  if (pick) {
    const before = state.player.credits;
    const bought = buyResource(state, pick, 4);
    const spent = before - state.player.credits;
    check('bought units', bought > 0, `${bought} × ${pick} for ${spent} cr`);
    check('buy price above sell price', buyPriceAt(state, pick) >= sellPriceAt(state, pick));
    const sold = sellResource(state, pick, bought);
    check('sold units back', sold > 0, `${sold} units`);
    check('round trip costs the spread', state.player.credits <= before, `${before} → ${state.player.credits}`);
    check('trades counted', state.player.stats.trades >= 2, `${state.player.stats.trades}`);
  }
} else {
  console.log('  skip no market in this system');
}

// --------------------------------------------------------------- inventory
console.log('\n[5b] inventory: hold → station storage → sale');
ship.travel = null;
ship.mission = null;
ship.status = 'docked';
ship.systemId = state.station.systemId;
ship.cargo = { ore: 6 };
const unloaded = unloadToStation(state, 'ore');
check('hold unloads into station storage', unloaded === 6, `${unloaded} of 6 units`);
check('cargo is emptied onto the station', (ship.cargo.ore ?? 0) === 0);
check('storage shows the goods', (state.station.storage.ore ?? 0) >= 6, `${state.station.storage.ore ?? 0} ore`);
const loadedBack = loadFromStation(state, 'ore', 2);
check('storage loads back into the hold', loadedBack === 2 && (ship.cargo.ore ?? 0) === 2);
const stored = state.station.storage.ore ?? 0;
if (atMarket(state)) {
  const beforeSale = state.player.credits;
  const soldStored = sellStoredResource(state, 'ore', stored);
  check(
    'selling straight from storage works',
    soldStored === stored && state.player.credits > beforeSale,
    `+${state.player.credits - beforeSale} cr`,
  );
} else {
  check('selling from storage needs a market', sellStoredResource(state, 'ore', stored) === 0);
}

// --------------------------------------------------------------- contracts
console.log('\n[6] contracts');
const board = contractsHere(state);
check('contract board exists for the system', Array.isArray(board), `${board.length} offers`);
if (board.length > 0) {
  const offer = board.find((contract) => !contractBlockedReason(state, contract));
  if (offer) {
    const activeBefore = activeContracts(state).length;
    const accepted = acceptContract(state, offer.id);
    check('contract accepted', accepted && activeContracts(state).length === activeBefore + 1, offer.id);
    check('flag "accepted" set', !!activeContracts(state).find((c) => c.contract.id === offer.id));
    const entry = activeContracts(state).find((c) => c.contract.id === offer.id);
    if (entry) check('deliverable flag is boolean', typeof canDeliverContract(state, entry.contract) === 'boolean');
  } else {
    console.log('  skip every offer is blocked at this reputation');
  }
} else {
  console.log('  skip no contracts offered in this system');
}

// --------------------------------------------------------------- station
console.log('\n[7] station, refinery, research');
check('storage capacity positive', storageCapacity(state.station) > 0, `${storageCapacity(state.station)}`);
check('storage usage sane', storageUsed(state.station) >= 0, `${storageUsed(state.station)}`);
const recipes = recipeOffers(state);
check('refinery recipes listed', recipes.length > 0, `${recipes.length} recipes`);
check('recipe flags are booleans', recipes.every((r) => typeof r.canRun === 'boolean' && typeof r.locked === 'boolean'));
const research = researchOffers(state);
check('three research fields', research.length === 3, research.map((r) => `${r.key}:${r.level}`).join(' '));
check('research gated behind a lab', research.every((entry) => entry.hasLab === (state.station.buildings.researchLab > 0)));
check('buyResearch refuses without a lab', (state.station.buildings.researchLab ?? 0) > 0 || buyResearch(state, 'mining') === false);

state.player.credits += 400000; // a budget so construction and hulls can be tested
state.station.storage.metal = Math.max(state.station.storage.metal ?? 0, 6000);
state.station.storage.electronics = Math.max(state.station.storage.electronics ?? 0, 600);
const buildings = buildingOffers(state);
check('building offers listed', buildings.length > 0, `${buildings.length} types`);
const buildable = buildings.find(
  (offer) => !offer.maxed && !offer.busy && offer.requirementsMet && offer.slotsFree && offer.affordable,
);
check('something is buildable with a stocked warehouse', !!buildable, buildable ? buildable.name : 'everything locked');
if (buildable) {
  const started = startConstruction(state, buildable.type);
  check('construction started', started && !!state.station.construction, buildable.name);
  check('construction paid for', state.player.credits >= 0);
  runFor(state, buildable.seconds + 10, events);
  check('construction finished', !state.station.construction);
  check(
    'building level went up',
    (state.station.buildings[buildable.type] ?? 0) === buildable.level + 1,
    `${buildable.name} Mk ${state.station.buildings[buildable.type]}`,
  );
}

// --------------------------------------------------------------- fleet & offline
console.log('\n[8] fleet, modules and offline catch-up');
check('fleet cap positive', fleetCap(state) > 0, `${fleetCap(state)} hulls`);
check('mission slots reported', missionSlots(state).cap > 0, `${missionSlots(state).used}/${missionSlots(state).cap}`);
const modules = moduleOffers(state, ship);
check('module offers listed', modules.length > 0, `${modules.length} modules`);
check('module flags are booleans', modules.every((m) => typeof m.owned === 'boolean' && typeof m.affordable === 'boolean'));
check('resale value positive', shipResaleValue(ship) > 0, `${shipResaleValue(ship)} cr`);
const hulls = hullsForSale(state, ship);
check('hull catalogue listed', hulls.length > 0, `${hulls.length} hulls`);
const hull = hulls.find((offer) => offer.affordable);
if (hull) {
  const bought = purchaseShip(state, hull.typeId);
  check('hull purchased', !!bought, bought ? bought.name : 'failed');
  check('fleet grew', state.ships.length === 2, `${state.ships.length} ships`);
} else {
  console.log('  skip no affordable hull at this shipyard');
}

const timeBefore = state.gameTime;
const simulated = catchUp(state, 3600);
check('offline catch-up ran', simulated > 0, `${simulated.toFixed(0)} s simulated`);
check('game time moved', state.gameTime > timeBefore, `${state.gameTime.toFixed(1)} s`);
finite('credits after catch-up', state.player.credits);
check('no pending event left behind', state.pendingEvent === null || !!eventDef(state.pendingEvent.eventId));

// --------------------------------------------------------------- events
console.log('\n[9] event layer and the blocking event modal');
const defs = EVENT_DEFS;
check('event definitions loaded', defs.length >= 5, `${defs.length} defs`);
check('every def resolves by id', defs.every((def) => eventDef(def.id) === def));
check(
  'interactive defs always offer at least one choice',
  defs.every((def) => !def.interactive || def.choices.length > 0),
);
check(
  'choice ids are unique inside a def',
  defs.every((def) => new Set(def.choices.map((c) => c.id)).size === def.choices.length),
);

const raid = createGameState('SMOKE-EVENT', 'TESTER');
const raidShip = playerShip(raid);
const hullBefore = raidShip.hull;
raid.pendingEvent = {
  id: 'smoke:1',
  eventId: 'pirate_encounter',
  shipId: raidShip.id,
  firedAt: raid.gameTime,
  payload: buildPayload(raid, raidShip, 'pirate_encounter'),
};
const pausedAt = raid.gameTime;
advance(raid, 60);
check('simulation is frozen while an event is pending', raid.gameTime === pausedAt, `${raid.gameTime} s`);
let guard = 0;
while (raid.pendingEvent && guard < 8) {
  guard += 1;
  resolvePendingEvent(raid, eventDef(raid.pendingEvent.eventId)?.choices[0]?.id ?? 'fight');
}
check('pirate encounter resolved and closed', raid.pendingEvent === null, `${guard} choice(s) taken`);
check('event left the ship in a known state', ['docked', 'transit', 'mining'].includes(raidShip.status));
check('combat resolved without NaN', Number.isFinite(raidShip.hull) && Number.isFinite(raidShip.shield));
check('event produced feedback for the player', !!raid.news[0], raid.news[0]?.text.slice(0, 60));
console.log(`  info hull ${hullBefore} → ${Math.round(raidShip.hull)}, news ${raid.news.length} items, toasts ${raid.toast ? 'yes' : 'no'}`);

console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed.`);
if (failures > 0) throw new Error(`${failures} smoke check(s) failed.`);
