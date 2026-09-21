/**
 * Headless smoke test. Builds a galaxy, drives the simulation for a while and
 * exercises the same action functions the UI calls, so a broken economy or sim
 * step fails loudly without opening a browser.
 *
 * Run with: npm run smoke
 */
import type { GameState, ResourceId } from '../src/game/types.ts';
import { createGameState, playerShip, SAVE_VERSION } from '../src/game/state/create.ts';
import { SYSTEM_COUNT } from '../src/game/universe/generate.ts';
import { exportSave, importSave } from '../src/game/save.ts';
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
  marketRefusal,
  maxBuyable,
  maxSellable,
  refuelShip,
  sellPriceAt,
  sellResource,
  sellStoredResource,
  serviceHere,
  unloadToStation,
} from '../src/game/actions/trade.ts';
import { serviceAccess, stationServices } from '../src/game/data/stations.ts';
import { depotAmounts, depotHere } from '../src/game/sim/depots.ts';
import {
  amountsSummary,
  beltById,
  miningStatus,
  startMining,
  stopMining,
} from '../src/game/sim/mining.ts';
import { beltReserve } from '../src/game/data/belts.ts';
import { planetKindOf } from '../src/game/data/planets.ts';
import {
  localSiteCandidate,
  FOUNDATION_MATERIALS,
  FOUNDATION_SECONDS,
  buildingSeconds,
  stationPhase,
} from '../src/game/site/site.ts';
import {
  baseStationHaul,
  chooseSite,
  foundationHint,
  foundationState,
  foundStation,
} from '../src/game/actions/site.ts';
import { startSurvey, surveyBlockedReason, surveySeconds } from '../src/game/exploration/scan.ts';
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
  contractBoard,
  contractRoute,
  contractTargetName,
  contractsHere,
  deliverContract,
  expireAcceptedContracts,
} from '../src/game/actions/contracts.ts';
import {
  hullsForSale,
  installModule,
  moduleOfferGroups,
  moduleOffers,
  purchaseShip,
  shipResaleValue,
  shipyardHere,
} from '../src/game/actions/outfitting.ts';
import { moduleLevel } from '../src/game/data/modules.ts';
import { MAKERS, tunedLevel } from '../src/game/data/makers.ts';
import { shipType } from '../src/game/data/ships.ts';
import { makerOf, sealedUnits, sellableUnits, shipStats } from '../src/game/ships/ship.ts';

import { fleetCap, missionSlots } from '../src/game/sim/fleet.ts';
import { storageCapacity, storageUsed } from '../src/game/sim/station.ts';
import { formatGameTime, gameDay } from '../src/game/news/news.ts';
import { DEFAULT_SETTINGS, clampSpeed, loadSettings, normalizeSettings, tickSeconds } from '../src/game/settings.ts';

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
check('galaxy holds 128 systems', state.systemIds.length === SYSTEM_COUNT, `${state.systemIds.length} systems`);
const spacings: number[] = [];
for (let i = 0; i < state.systemIds.length; i += 1) {
  for (let j = i + 1; j < state.systemIds.length; j += 1) {
    const a = state.systems[state.systemIds[i]].position;
    const b = state.systems[state.systemIds[j]].position;
    spacings.push(Math.hypot(a.x - b.x, a.y - b.y));
  }
}
check(
  'systems keep their distance on the map',
  Math.min(...spacings) >= 100,
  `min ${Math.round(Math.min(...spacings))} units`,
);
check(
  'every system has at least one lane',
  state.systemIds.every((id) => state.systems[id].connections.length > 0),
);
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
  const reserveBefore = belt ? beltReserve(belt.belt) : 0;
  const started = startMining(state, ship, belts[0].id);
  check('mining started', started, started ? 'laser online' : 'no mining gear on the started ship');
  if (started) {
    runFor(state, 60, events);
    check('units mined', state.player.stats.mined > 0, `${state.player.stats.mined} units`);
    finite('hold total', Object.values(ship.cargo).reduce((sum, qty) => sum + (qty ?? 0), 0));
    const status = miningStatus(state, ship);
    check('mining status is exposed for the UI', !!status, status ? amountsSummary(status.hauled) : 'missing');
    if (status) {
      check('вaxта has a plan', status.plannedTotal > 0, `${status.plannedTotal} units planned`);
      check('progress stays inside 0..1', status.progress >= 0 && status.progress <= 1, `${status.progress.toFixed(2)}`);
      check('free cargo is reported', status.cargoFree >= 0, `${status.cargoFree} free`);
      check('belt reserve is finite', Number.isFinite(status.reserveLeft), `${status.reserveLeft}`);
    }
    if (belt) check('belt reserve was consumed', beltReserve(belt.belt) < reserveBefore, `${reserveBefore} → ${beltReserve(belt.belt)}`);
    stopMining(state, ship);
    check('mining stopped', ship.status !== 'mining', ship.status);

    // План по количеству: вахта заканчивается сама, когда план выполнен.
    const planned = startMining(state, ship, belts[0].id, { ore: 2 });
    check('planned stint accepted a quantity', planned);
    if (planned) {
      runFor(state, 120, events);
      check('planned stint stopped by itself', ship.mission === null && ship.status === 'docked', ship.status);
    }
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

// Количество и гейт по репутации — то, что видит игрок на панели «Рынок».
if (atMarket(state)) {
  const tradeId = (Object.keys(state.systems[ship.systemId].market.stock) as ResourceId[])[0];
  check('max buyable is capped by hold and credits', maxBuyable(state, tradeId) >= 0, `${maxBuyable(state, tradeId)}`);
  check('max sellable follows the hold', maxSellable(state, tradeId) === (ship.cargo[tradeId] ?? 0));
  check('market service is exposed to the UI', serviceHere(state, 'market')?.ok === true);
}
const homeFactionId = state.systems[state.player.homeSystemId].factionId;
if (homeFactionId) {
  const saved = state.player.reputation[homeFactionId] ?? 0;
  ship.systemId = state.player.homeSystemId;
  ship.status = 'docked';
  state.player.reputation[homeFactionId] = -40;
  check('hostile faction closes its market', atMarket(state) === false, `rep ${state.player.reputation[homeFactionId]}`);
  check('refusal explains itself', typeof marketRefusal(state) === 'string', marketRefusal(state) ?? '');
  state.player.reputation[homeFactionId] = saved;
}

// --------------------------------------------------------------- site funnel
console.log('\n[5a] station funnel: free system → survey → foundation → base station');
const lawless = state.systemIds
  .map((id) => state.systems[id])
  .filter((system) => system.factionId === null);
check('galaxy has lawless systems to claim', lawless.length > 0, `${lawless.length} systems`);
const claim = lawless.find((system) => system.planets.some((planet) => planetKindOf(planet).buildable)) ?? lawless[0];
if (claim) {
  claim.discovered = true;
  // Ничья система с пригодной планетой: закладка возможна только после скана.
  ship.travel = null;
  ship.mission = null;
  ship.status = 'docked';
  ship.cargo = {};
  ship.systemId = claim.id;

  const beforeScan = surveyBlockedReason(state, ship, 'system');
  check('fresh lawless system can be scanned', beforeScan === null, beforeScan ?? 'ready');
  const secondsNeeded = surveySeconds(state, ship, 'system');
  check('system survey started', startSurvey(state, 'system'), `${secondsNeeded} s`);
  check('ship reports survey status', state.survey !== null && ship.mission === null);
  check('mining is blocked while the scanner runs', startMining(state, ship, claim.belts[0]?.id ?? '') === false);
  runFor(state, secondsNeeded + 15, events);
  check('survey finished and cleared the scanner', state.survey === null && ship.status === 'docked');
  check('system is charted after the survey', claim.scanned === true);
  check('belts came with the scan', claim.belts.every((belt) => belt.discovered));

  const planet = claim.planets.find((entry) => planetKindOf(entry).buildable);
  check('lawless system offers a buildable planet', !!planet, planet ? `${planet.name} (${planet.type})` : 'none');
  if (planet) {
    // Удалённую закладку фронтир не знает: участок выбирают только с борта.
    const away = state.systemIds.find((id) => id !== claim.id && state.systems[id].factionId !== null);
    if (away) {
      ship.systemId = away;
      const remote = localSiteCandidate(state);
      check('site cannot be picked remotely', chooseSite(state, claim.id, planet.id) === false);
      check(
        'a remote system explains why it does not qualify',
        remote?.ok === false && (remote.reasons[0] ?? '').includes('контроле'),
        remote?.reasons[0] ?? 'no reason',
      );
      ship.systemId = claim.id;
    }
    // Без полного скана планет не видно — и участок не закрепить.
    claim.scanned = false;
    check(
      'site needs a full scan',
      chooseSite(state, claim.id, planet.id) === false &&
        (localSiteCandidate(state)?.reasons ?? []).some((reason) => reason.includes('скан')),
      localSiteCandidate(state)?.reasons[0] ?? 'no reason',
    );
    claim.scanned = true;
    check('the local candidate is ready', localSiteCandidate(state)?.ok === true);
    check('site chosen', chooseSite(state, claim.id, planet.id));
    check('phase is planned with a fixed site', stationPhase(state) === 'planned' && state.station.sitePlanetId === planet.id);
    check('site is locked to a free system', chooseSite(state, state.player.homeSystemId, planet.id) === false);
    const blocked = foundationState(state);
    check('foundation needs metal in the hold', !blocked.ok, blocked.reasons[0] ?? 'ready');
    ship.cargo = { metal: FOUNDATION_MATERIALS.metal };
    state.player.credits += 20000;
    check('foundation is possible with metal in the hold', foundationState(state).ok, foundationHint(state));
    check('foundation started', foundStation(state));
    check('phase moved to foundation', stationPhase(state) === 'foundation');
    check('the haul left the hold', (ship.cargo.metal ?? 0) === 0);
    runFor(state, FOUNDATION_SECONDS + 15, events);
    check('warehouse completed on the site', (state.station.buildings.warehouse ?? 0) === 1);
    check('station storage opened up', storageCapacity(state.station) > 0, `${storageCapacity(state.station)}`);
    const refineryOffer = buildingOffers(state).find((offer) => offer.type === 'refinery');
    check(
      'development is gated until the base station exists',
      !!refineryOffer && !refineryOffer.phaseOk,
      refineryOffer?.phaseReason ?? 'no offer',
    );
    state.station.storage.metal = 400;
    state.station.storage.electronics = 40;
    const haulPlan = baseStationHaul(state);
    check('base station haul is described for the UI', haulPlan.credits > 0 && Object.keys(haulPlan.materials).length > 0);
    check('base station build started', startConstruction(state, 'commandCenter'));
    runFor(state, buildingSeconds(state, 'commandCenter', 1) + 15, events);
    check(
      'base station is operational',
      stationPhase(state) === 'operational',
      `КЦ Mk ${state.station.buildings.commandCenter}`,
    );
    check('site bonus is live now', stationPhase(state) === 'operational');
  }
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

// --------------------------------------------------------------- per-station depots
console.log('\n[5c] depots: каждая станция держит свой склад');
{
  const host = state.systemIds
    .map((id) => state.systems[id])
    .find(
      (sys) =>
        sys.id !== state.station.systemId &&
        sys.stations.some((station) => !!station.factionId && stationServices(station).storage),
    );
  if (host) {
    ship.travel = null;
    ship.mission = null;
    ship.status = 'docked';
    ship.systemId = host.id;
    ship.cargo = { ore: 8 };
    const depot = depotHere(state);
    check('faction station rents a warehouse', !!depot, depot ? `${depot.name}: ${depot.capacity} ед.` : 'none');
    const homeOreBefore = state.station.storage.ore ?? 0;
    const rented = depotHere(state);
    if (rented && !rented.own) {
      const moved = unloadToStation(state, null);
      check('hold unloads into the rented cells', moved === 8, `${moved} of 8 units`);
      check('rented goods keep their own accounting', (depotAmounts(state, rented.id).ore ?? 0) === 8);
      check(
        'the home warehouse stays untouched',
        (state.station.storage.ore ?? 0) === homeOreBefore,
        `${state.station.storage.ore ?? 0} ore at home`,
      );
      const back = loadFromStation(state, 'ore', 3);
      check('goods load back on the spot', back === 3 && (ship.cargo.ore ?? 0) === 3);
      const left = depotAmounts(state, rented.id).ore ?? 0;
      check('the rest stays in the rented cells', left === 5, `${left} ore left`);
      // Груз, оставленный здесь, не виден на других складах.
      ship.systemId = state.station.systemId;
      const home = depotHere(state);
      check(
        'another system sees its own (empty) depot',
        !!home && home.id !== rented.id && (home.amounts.ore ?? 0) === 0,
        home ? `${home.name}: ${home.amounts.ore ?? 0} ore` : 'no depot at home',
      );
      ship.cargo = {};
    }
  } else {
    console.log('  skip no charted faction station with storage');
  }
}

// --------------------------------------------------------------- contracts
console.log('\n[6] contracts');
const boardSystem = state.systemIds
  .map((id) => state.systems[id])
  .find((sys) => sys.stations.some((st) => st.hasContracts && serviceAccess(state, st, 'contracts').ok));
if (boardSystem) {
  ship.travel = null;
  ship.mission = null;
  ship.status = 'docked';
  ship.systemId = boardSystem.id;
}
check('contract board reports its state', typeof contractBoard(state).available === 'boolean');
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

// --------------------------------------------------------------- courier work
console.log('\n[6b] courier contracts, sealed cargo and distance pay');
const courierState = createGameState('SMOKE-COURIER', 'TESTER');
const courierShip = playerShip(courierState);
const courierBoards = courierState.systemIds
  .map((id) => courierState.systems[id])
  .filter((sys) => sys.stations.some((st) => st.hasContracts));
const allOffers = courierBoards.flatMap((sys) => sys.contracts);
const couriers = allOffers.filter((contract) => contract.kind === 'courier');
check('boards mix supply and courier work', couriers.length > 0, `${couriers.length} of ${allOffers.length}`);
check(
  'couriers point at other discovered systems',
  couriers.every(
    (c) =>
      c.targetSystemId !== c.systemId &&
      c.hops > 0 &&
      c.distance > 0 &&
      courierState.systems[c.targetSystemId]?.discovered === true,
  ),
);
check(
  'supply contracts stay in their own system',
  allOffers.filter((c) => c.kind === 'supply').every((c) => c.targetSystemId === c.systemId),
);
check('every hop is covered by the fee', couriers.every((c) => c.reward >= c.hops * 300));
check('distance also pays', couriers.every((c) => c.reward > c.distance * 0.5));

// Курьер, которого можно взять прямо здесь: доска и рынок фракция не закрыла.
const accessibleCouriers = courierBoards
  .filter(
    (sys) =>
      sys.stations.some((st) => st.hasContracts && serviceAccess(courierState, st, 'contracts').ok) &&
      sys.stations.some((st) => st.hasMarket && serviceAccess(courierState, st, 'market').ok),
  )
  .flatMap((sys) => sys.contracts.filter((c) => c.kind === 'courier' && c.minRep <= 0));
const pickup = accessibleCouriers[0];
if (pickup) {
  courierShip.travel = null;
  courierShip.mission = null;
  courierShip.status = 'docked';
  courierShip.systemId = pickup.systemId;
  courierShip.cargo = {};
  courierShip.sealed = {};
  const creditsBefore = courierState.player.credits;
  check('courier contract accepted', acceptContract(courierState, pickup.id));
  check(
    'sealed cargo is loaded into the hold',
    sealedUnits(courierShip, pickup.resource) === pickup.amount,
    `${sealedUnits(courierShip, pickup.resource)}/${pickup.amount}`,
  );
  check('sealed cargo is not for sale', sellableUnits(courierShip, pickup.resource) === 0);
  check('trade refuses to sell sealed cargo', sellResource(courierState, pickup.resource, pickup.amount) === 0);
  check(
    'sealed cargo stays in the hold',
    (courierShip.cargo[pickup.resource] ?? 0) === pickup.amount,
    `${courierShip.cargo[pickup.resource] ?? 0} units`,
  );
  const route = contractRoute(courierState, pickup);
  check(
    'route names the target and the hops',
    route.includes(contractTargetName(courierState, pickup)) && route.includes('прыж'),
    route,
  );
  check('hand-over is refused in the wrong system', !canDeliverContract(courierState, pickup));
  courierShip.systemId = pickup.targetSystemId;
  check('hand-over is allowed at the target', canDeliverContract(courierState, pickup));
  check(
    'contract pays out on delivery',
    deliverContract(courierState, pickup.id) && courierState.player.credits === creditsBefore + pickup.reward,
    `+${pickup.reward} cr`,
  );
  check(
    'sealed cargo is gone after delivery',
    sealedUnits(courierShip, pickup.resource) === 0 && (courierShip.cargo[pickup.resource] ?? 0) === 0,
  );
} else {
  console.log('  skip no accessible courier contract on the boards');
}

const failed = accessibleCouriers[1];
if (failed) {
  courierShip.systemId = failed.systemId;
  if (acceptContract(courierState, failed.id)) {
    failed.expiresDay = gameDay(courierState) - 1;
    const lost = expireAcceptedContracts(courierState, failed.expiresDay);
    check(
      'expired courier work is written off',
      lost >= 1 && !courierState.systems[failed.systemId].contracts.some((c) => c.id === failed.id),
      `${lost} lost`,
    );
    check('failed courier loses the cargo', sealedUnits(courierShip, failed.resource) === 0);
  }
} else {
  console.log('  skip no second courier contract to expire');
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
if (hulls.length === 0) {
  // Верфь есть не в каждой системе: переходим туда, где она работает.
  const yard = state.systemIds
    .map((id) => state.systems[id])
    .find((sys) => sys.stations.some((st) => st.hasShipyard && serviceAccess(state, st, 'shipyard').ok));
  if (yard) {
    ship.travel = null;
    ship.mission = null;
    ship.status = 'docked';
    ship.systemId = yard.id;
  }
}
const yardHulls = hullsForSale(state, ship);
check('hull catalogue listed', yardHulls.length > 0, `${yardHulls.length} hulls`);
const hull = yardHulls.find((offer) => offer.affordable);
if (hull) {
  const bought = purchaseShip(state, hull.typeId);
  check('hull purchased', !!bought, bought ? bought.name : 'failed');
  check('fleet grew', state.ships.length === 2, `${state.ships.length} ships`);
} else {
  console.log('  skip no affordable hull at this shipyard');
}

// --------------------------------------------------------------- shipyards & makers
console.log('\n[8b] shipyards, makers and module sections');
const yardState = createGameState('SMOKE-YARD', 'TESTER');
const yardShip = playerShip(yardState);
yardState.player.credits += 500000;
yardShip.cargo = { metal: 4000, electronics: 800 };

const yardHere = (id: string) =>
  yardState.systems[id].stations.find(
    (st) => st.hasShipyard && serviceAccess(yardState, st, 'shipyard').ok,
  );
const yardSystems = yardState.systemIds.filter((id) => !!yardHere(id));
check('faction systems run shipyards', yardSystems.length > 0, `${yardSystems.length} systems`);
/** Сборки разных доков проверяются на верфях фракций: у них есть клеймо. */
const factionYards = yardSystems.filter((id) => !!yardHere(id)?.factionId);
const homeYard = shipyardHere(yardState, yardShip);
check(
  'the start system bolts on modules',
  homeYard.tier > 0 && homeYard.source === 'station',
  `${homeYard.label} (${homeYard.maker})`,
);
check('shipyard report carries a known maker', MAKERS.some((m) => m.id === homeYard.maker), homeYard.maker);

const yardlessId = yardState.systemIds.find(
  (id) =>
    id !== yardState.station.systemId &&
    !yardState.systems[id].stations.some(
      (st) => st.hasShipyard && serviceAccess(yardState, st, 'shipyard').ok,
    ),
);
if (yardlessId) {
  yardShip.travel = null;
  yardShip.mission = null;
  yardShip.status = 'docked';
  yardShip.systemId = yardlessId;
  const none = shipyardHere(yardState, yardShip);
  check('no shipyard means no upgrades', none.tier === 0 && none.source === 'none');
  check('every offer is locked without a shipyard', moduleOffers(yardState, yardShip).every((o) => o.locked));
  check('fitting is refused without a shipyard', installModule(yardState, yardShip, 'shield', 1) === false);
} else {
  console.log('  skip every system has a shipyard');
}

const yardSystemId = factionYards[0] ?? yardSystems[0];
yardShip.systemId = yardSystemId;
const yard = shipyardHere(yardState, yardShip);
check('module installs at a faction shipyard', installModule(yardState, yardShip, 'shield', 1) === true);
check('installed module carries the yard mark', makerOf(yardShip, 'shield') === yard.maker, yard.maker);
check(
  'stats follow that yard build',
  shipStats(yardShip).shieldMax ===
    shipType('scout').shield + (tunedLevel('shield', 1, yard.maker)?.effect ?? 0),
  `${shipStats(yardShip).shieldMax}`,
);

// Модули разных верфей должны уживаться на одном корпусе.
const yardFaction = yardHere(yardSystemId)?.factionId ?? null;
const otherYardId = yardSystems.find((id) => {
  const other = yardHere(id);
  return !!yardFaction && !!other?.factionId && other.factionId !== yardFaction;
});
if (otherYardId) {
  yardShip.systemId = otherYardId;
  const other = shipyardHere(yardState, yardShip);
  const fitted = installModule(yardState, yardShip, 'reactor', 1);
  check('a second faction fits its own module', fitted === true, yardState.toast?.text ?? 'no toast');
  check(
    'one hull carries two yard marks',
    makerOf(yardShip, 'shield') !== makerOf(yardShip, 'reactor'),
    `${makerOf(yardShip, 'shield')} + ${makerOf(yardShip, 'reactor')}`,
  );
  check(
    'each module keeps its own numbers',
    shipStats(yardShip).powerCapacity ===
      shipType('scout').power + (tunedLevel('reactor', 1, other.maker)?.effect ?? 0),
    `capacity ${shipStats(yardShip).powerCapacity}`,
  );
} else {
  console.log('  skip only one faction shipyard in reach');
}

const hostileSystemId = yardSystems.find((id) => (yardState.systems[id].factionId ?? null) !== null);
if (hostileSystemId) {
  const hostileFaction = yardState.systems[hostileSystemId].factionId as string;
  yardState.player.reputation[hostileFaction] = -40;
  yardShip.systemId = hostileSystemId;
  const closed = shipyardHere(yardState, yardShip);
  check(
    'a hostile faction closes its shipyard',
    closed.tier === 0 && !!closed.blockedReason,
    closed.blockedReason ?? 'no reason given',
  );
  check('fitting is refused by a hostile yard', installModule(yardState, yardShip, 'scanner', 1) === false);
  yardState.player.reputation[hostileFaction] = 0;
} else {
  console.log('  skip no faction shipyard to upset');
}

const ownSystemId = yardlessId ?? yardState.station.systemId;
yardState.station.phase = 'operational';
yardState.station.systemId = ownSystemId;
yardState.station.buildings.shipyard = 1;
yardShip.systemId = ownSystemId;
const ownSmall = shipyardHere(yardState, yardShip);
check(
  'own shipyard is a fallback, not a downgrade',
  ownSmall.tier >= 1 && (ownSmall.source === 'own' || !yardlessId),
  `${ownSmall.label} (${ownSmall.source})`,
);
if (yardlessId) {
  check('Mk III stays locked at shipyard level 1', installModule(yardState, yardShip, 'weapon', 3) === false);
  check(
    'offers mark Mk III as locked',
    moduleOffers(yardState, yardShip)
      .filter((o) => o.level === 3)
      .every((o) => o.locked),
  );
}
yardState.station.buildings.shipyard = 3;
const own = shipyardHere(yardState, yardShip);
check(
  'own shipyard grows to Mk III',
  own.tier === 3 && own.source === 'own' && own.maker === 'frontier',
  own.label,
);
const ownWeapon = moduleOffers(yardState, yardShip).find((o) => o.type === 'weapon' && o.level === 1);
check(
  'own shipyard undercuts the list price',
  !!ownWeapon && ownWeapon.cost < (moduleLevel('weapon', 1)?.cost ?? 0),
  `${ownWeapon?.cost} vs ${moduleLevel('weapon', 1)?.cost}`,
);
check(
  'own shipyard stamps its own build',
  installModule(yardState, yardShip, 'weapon', 1) === true && makerOf(yardShip, 'weapon') === 'frontier',
  yardState.toast?.text ?? 'no toast',
);
check(
  'the purchase is registered in the offer list',
  moduleOffers(yardState, yardShip).some((o) => o.type === 'weapon' && o.level === 1 && o.owned),
);

// Пустой трюм и пустой склад: верфь обязана объяснить, чего не хватает.
const bareState = createGameState('SMOKE-BARE', 'TESTER');
const bareShip = playerShip(bareState);
bareState.player.credits += 100000;
const bareOffer = moduleOffers(bareState, bareShip).find((o) => !o.owned && !o.locked);
if (bareOffer) {
  check(
    'material needs come with names and counts',
    bareOffer.needs.length > 0 &&
      bareOffer.needs.every((need) => need.name.length > 2 && typeof need.ok === 'boolean' && need.need > 0),
    bareOffer.needs.map((need) => `${need.name} ${need.have}/${need.need}`).join(', '),
  );
  check('an empty hold shows the shortfall', bareOffer.needs.every((need) => !need.ok));
  check(
    'fitting is refused with an empty hold',
    installModule(bareState, bareShip, bareOffer.type, bareOffer.level) === false,
  );
  check(
    'the refusal names the missing material',
    (bareState.toast?.text ?? '').includes(bareOffer.needs[0]?.name ?? ''),
    bareState.toast?.text ?? 'no toast',
  );
  check(
    'a refused purchase leaves the ship untouched',
    (bareShip.modules[bareOffer.type] ?? 0) < bareOffer.level && bareState.player.credits >= 100000,
  );
} else {
  console.log('  skip no unlocked module offer in the start system');
}

const moduleGroups = moduleOfferGroups(yardState, yardShip);
check('offers are split into five sections', moduleGroups.length === 5, moduleGroups.map((g) => g.label).join(' · '));
check('every section has offers', moduleGroups.every((g) => g.offers.length > 0));
check(
  'sections cover all module types',
  new Set(moduleGroups.flatMap((g) => g.offers.map((o) => o.type))).size === 7,
  `${moduleGroups.flatMap((g) => g.offers).length} offers`,
);
check('each section lists what is installed', moduleGroups.every((g) => g.installed.length > 0));
check(
  'offers keep the yard stamp',
  moduleGroups.flatMap((g) => g.offers).every((o) => o.maker === own.maker),
);
check(
  'tier gating is visible in the offers',
  moduleGroups
    .flatMap((g) => g.offers)
    .filter((o) => o.level === 3)
    .every((o) => o.tierNeeded === 2 && !o.locked),
);

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

// --------------------------------------------------------------- app settings
console.log('\n[10] app settings and pause');
const defaults = loadSettings();
check('settings fall back to defaults without storage', defaults.speed === 1 && defaults.animations);
check('every default key is present', (Object.keys(DEFAULT_SETTINGS) as string[]).every((key) => key in defaults));
check('broken settings blob is repaired', normalizeSettings({ speed: 'fast', toasts: 'yes' }).speed === 1);
check('unknown settings keys are dropped', !('nope' in normalizeSettings({ nope: 1 })));
check(
  'speed stays inside sane bounds',
  clampSpeed(100) === 8 && clampSpeed(0) === 0.25 && clampSpeed(Number.NaN) === 1,
  `100→${clampSpeed(100)}, 0→${clampSpeed(0)}`,
);
check('pause freezes the simulation step', tickSeconds(2.5, defaults, true) === 0);
check('time multiplier scales the step', tickSeconds(2, { ...defaults, speed: 4 }, false) === 8);
check('a negative frame never rewinds time', tickSeconds(-5, defaults, false) === 0);

// --------------------------------------------------------------- миграция сейва
console.log('\n[11] save migration (v3 → v4)');
{
  // Сейв до арендуемых складов: у станций нет флага «склад», у мира нет depots.
  const legacy = JSON.parse(exportSave(state)) as { version: number; state: GameState };
  legacy.version = 3;
  delete (legacy.state as Partial<GameState>).depots;
  for (const id of legacy.state.systemIds) {
    for (const station of legacy.state.systems[id]?.stations ?? []) delete station.hasStorage;
  }
  const restored = importSave(JSON.stringify(legacy));
  check('legacy save still loads', !!restored);
  check('depots table appears empty', !!restored && typeof restored.depots === 'object');
  check(
    'old stations start renting storage',
    !!restored && restored.systemIds.every((id) => restored.systems[id].stations.every((st) => st.hasStorage !== false)),
  );
  check('save version is up to date', !!restored && restored.version === SAVE_VERSION);
}

console.log(`\n${checks - failures}/${checks} checks passed, ${failures} failed.`);
if (failures > 0) throw new Error(`${failures} smoke check(s) failed.`);
