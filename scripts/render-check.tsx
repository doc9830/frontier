/**
 * Render smoke test: server-renders every panel against a real game state so
 * runtime crashes (missing fields, bad list access, broken JSX) surface without
 * opening a browser. Node cannot strip JSX, so esbuild bundles this first:
 *
 *   npm run render-check
 */
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameState } from '../src/game/types.ts';
import { createGameState, playerShip } from '../src/game/state/create.ts';
import { buildPayload, eventDef } from '../src/game/events/events.ts';
import { travelTo } from '../src/game/actions/nav.ts';
import { acceptContract, contractBlockedReason, contractRoute, contractsHere } from '../src/game/actions/contracts.ts';
import { purchaseShip, hullsForSale, shipyardHere } from '../src/game/actions/outfitting.ts';
import { loadFromStation, unloadToStation } from '../src/game/actions/trade.ts';
import { depotAmounts, depotHere, depotRefusal } from '../src/game/sim/depots.ts';
import { serviceAccess, stationServices } from '../src/game/data/stations.ts';

import { startMining } from '../src/game/sim/mining.ts';
import { startConstruction } from '../src/game/actions/build.ts';
import { cancelSurvey, startSurvey } from '../src/game/exploration/scan.ts';
import { FOUNDATION_MATERIALS, stationPhase } from '../src/game/site/site.ts';
import { chooseSite, foundStation } from '../src/game/actions/site.ts';
import { planetKindOf } from '../src/game/data/planets.ts';
import { GalaxyMap } from '../src/ui/GalaxyMap.tsx';
import { EventModal } from '../src/ui/EventModal.tsx';
import { Toaster } from '../src/ui/Toaster.tsx';
import { IntroScreen } from '../src/ui/IntroScreen.tsx';
import { StationPanel } from '../src/ui/panels/StationPanel.tsx';
import { SystemPanel } from '../src/ui/panels/SystemPanel.tsx';
import { ResearchPanel } from '../src/ui/panels/ResearchPanel.tsx';
import { ResourcesPanel } from '../src/ui/panels/ResourcesPanel.tsx';
import { StationServices } from '../src/ui/panels/StationServices.tsx';
import { StoragePanel } from '../src/ui/panels/StoragePanel.tsx';
import { ShipyardPanel } from '../src/ui/panels/ShipyardPanel.tsx';
import { MarketPanel } from '../src/ui/panels/MarketPanel.tsx';
import { CargoPanel } from '../src/ui/panels/CargoPanel.tsx';
import { ShipPanel } from '../src/ui/panels/ShipPanel.tsx';
import { FleetPanel } from '../src/ui/panels/FleetPanel.tsx';
import { ContractsPanel } from '../src/ui/panels/ContractsPanel.tsx';
import { NewsPanel } from '../src/ui/panels/NewsPanel.tsx';
import { SettingsPanel } from '../src/ui/panels/SettingsPanel.tsx';
import { JumpBar } from '../src/ui/JumpBar.tsx';
import { JumpConfirm } from '../src/ui/JumpConfirm.tsx';
import { DEFAULT_SETTINGS } from '../src/game/settings.ts';
import type { Destination, Screen } from '../src/ui/nav.ts';

let checks = 0;
let failures = 0;

const run = (_mutator: (draft: GameState) => void): void => {};
const goTo = (_dest: Destination): void => {};
const choose = (_choiceId: string): void => {};
const select = (_id: string | null): void => {};
const open = (_screen: Screen): void => {};
const jump = (_id: string): void => {};
const startGame = (_seed: string, _name: string): void => {};
const resume = (): void => {};
const noop = (): void => {};

function render(label: string, element: ReactElement, minChars = 60): string {
  checks += 1;
  try {
    const html = renderToString(element);
    if (html.length < minChars) throw new Error(`only ${html.length} chars of markup`);
    console.log(`  ok   ${label} — ${html.length} chars`);
    return html;
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${label} — ${(error as Error).message}`);
    return '';
  }
}

function expect(label: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function renderShell(state: GameState, selectedId: string | null): void {
  render('GalaxyMap', <GalaxyMap state={state} selectedId={selectedId} onSelect={select} onJump={jump} />);
  render('StationPanel', <StationPanel state={state} run={run} />);
  render('SystemPanel', <SystemPanel state={state} run={run} onOpen={open} />);
  render('SystemPanel (jump routed)', <SystemPanel state={state} run={run} onJump={noop} onOpen={open} />);
  render('ResearchPanel', <ResearchPanel state={state} run={run} onOpen={open} />);
  render('ResourcesPanel', <ResourcesPanel state={state} run={run} onOpen={open} />);
  render('StationServices', <StationServices state={state} run={run} onOpen={open} />);
  render('StoragePanel', <StoragePanel state={state} run={run} onOpen={open} />);
  render('ShipyardPanel', <ShipyardPanel state={state} run={run} />);
  render('MarketPanel', <MarketPanel state={state} run={run} />);
  render('CargoPanel', <CargoPanel state={state} run={run} onOpen={open} />);
  render('ShipPanel', <ShipPanel state={state} run={run} onOpen={open} />);
  render('FleetPanel', <FleetPanel state={state} run={run} />);
  render('ContractsPanel', <ContractsPanel state={state} run={run} />);
  render('NewsPanel', <NewsPanel state={state} onGoTo={goTo} />);
  render('Toaster', <Toaster state={state} />, state.toast ? 60 : 20);
  render('EventModal', <EventModal state={state} onChoose={choose} />, state.pendingEvent ? 60 : 0);
  render(
    'SettingsPanel',
    <SettingsPanel
      state={state}
      settings={DEFAULT_SETTINGS}
      paused={false}
      onTogglePause={noop}
      onChange={noop}
      onReset={noop}
      onSave={noop}
    />,
  );
  render('JumpBar', <JumpBar state={state} paused={false} onCancel={noop} />, 0);
}


// --------------------------------------------------------------- boot screen
console.log('\n[1] boot screen');
const freshSave = render(
  'IntroScreen (no save)',
  <IntroScreen hasSave={false} offlineReport={null} onNewGame={startGame} onContinue={resume} />,
);
expect('intro shows the seed field', freshSave.includes('ключ галактики'));
const offline = render(
  'IntroScreen (offline report)',
  <IntroScreen hasSave offlineReport="Офлайн-прогон: смоделировано 2.0 ч." onNewGame={startGame} onContinue={resume} />,
);
expect('offline report is surfaced', offline.includes('Офлайн-прогон'));

const state = createGameState('RENDER-1', 'RENDERER');
const ship = playerShip(state);
const neighbour = state.systemIds.find((id) => id !== ship.systemId && state.systems[id].discovered) ?? null;

// --------------------------------------------------------------- docked
console.log('\n[2] docked shell');
const docked = render(
  'GalaxyMap (system selected)',
  <GalaxyMap state={state} selectedId={neighbour} onSelect={select} onJump={jump} />,
);
renderShell(state, null);
expect('map draws charted systems', docked.includes(state.systems[ship.systemId].name));
expect('map draws its lanes', (docked.match(/<line/g) ?? []).length > 0);
console.log(`  info charted systems: ${state.systemIds.filter((id) => state.systems[id].discovered).length}`);

// рынок: количество выбирается счётчиком, поэтому проверяем оба состояния панели
const marketSystem = state.systemIds
  .map((id) => state.systems[id])
  .find((sys) => sys.stations.some((st) => st.hasMarket && serviceAccess(state, st, 'market').ok));
if (marketSystem) {
  ship.travel = null;
  ship.mission = null;
  ship.status = 'docked';
  ship.systemId = marketSystem.id;
  const marketOpen = render('MarketPanel (open market)', <MarketPanel state={state} run={run} />, 800);
  expect('market rows carry a quantity stepper', marketOpen.includes('stepper'));
  expect('market rows offer the max quantity', marketOpen.includes('МАКС'));
  expect('market names the station at work', marketOpen.includes(marketSystem.name) || marketOpen.includes('Рынок'));
  expect('market reports free hold space', marketOpen.includes('свободно'));
}

// settings tab: pause, speed, jump animation, update card
const settingsHtml = render(
  'SettingsPanel (paused)',
  <SettingsPanel
    state={state}
    settings={{ ...DEFAULT_SETTINGS, speed: 2, confirmJump: true }}
    paused
    onTogglePause={noop}
    onChange={noop}
    onReset={noop}
    onSave={noop}
  />,
);
expect('settings offer the pause toggle', settingsHtml.includes('ПРОДОЛЖИТЬ'));
expect('settings offer the time multiplier', settingsHtml.includes('×2'));
expect('settings carry the app summary', settingsHtml.includes('Ключ галактики'));
const confirm = render(
  'JumpConfirm',
  <JumpConfirm state={state} targetId={neighbour ?? ship.systemId} onConfirm={noop} onCancel={noop} />,
  20,
);
expect('jump confirmation quotes the fuel', confirm.includes('Топливо'));
expect('jump confirmation can be cancelled', confirm.includes('ОТМЕНА'));

// --------------------------------------------------------------- busy shell
console.log('\n[3] shell with jobs running');
state.player.credits += 300000;
state.station.storage.metal = Math.max(state.station.storage.metal ?? 0, 6000);
state.station.storage.electronics = Math.max(state.station.storage.electronics ?? 0, 600);
state.toast = { id: 1, text: 'Офлайн-прогон флота завершён: заработано 1 240 кр.', kind: 'good' };
const withToast = render('Toaster (message)', <Toaster state={state} />);
expect('toast text is rendered', withToast.includes('1 240 кр'));

// Стройка проверяется в разделе [3b]: до закладки склада станция строить не даёт.
const buildTarget = stationPhase(state) === 'planned' ? false : startConstruction(state, 'warehouse');
console.log(`  info warehouse build started: ${buildTarget}`);
const hull = hullsForSale(state, ship).find((offer) => offer.affordable);
const bought = hull ? purchaseShip(state, hull.typeId) : null;
console.log(`  info second hull: ${bought ? bought.name : 'none bought'}`);
ship.cargo = { ore: 12, food: 4 };
const board = contractsHere(state);
if (board[0]) console.log(`  info contract accepted: ${acceptContract(state, board[0].id)}`);
renderShell(state, neighbour);
render('ShipPanel (cargo loaded)', <ShipPanel state={state} run={run} onOpen={open} />);

// Верфь и курсорские доски проверяем там, где доки и доска реально есть.
const dockSystemId = ship.systemId;
const yardSystem = state.systemIds
  .map((id) => state.systems[id])
  .find(
    (sys) =>
      sys.discovered &&
      sys.stations.some((st) => st.hasShipyard && serviceAccess(state, st, 'shipyard').ok),
  );
if (yardSystem) {
  ship.systemId = yardSystem.id;
  const yardView = render('ShipyardPanel (at a shipyard)', <ShipyardPanel state={state} run={run} />);
  const yard = shipyardHere(state, ship);
  console.log(`  info shipyard: ${yard.label} (${yard.source})`);
  expect('ship panel names the shipyard at work', yardView.includes('модули до Mk'), yard.label);
  expect(
    'ship panel splits modules into sections',
    yardView.includes('ХОД И ПРЫЖОК') && yardView.includes('ВООРУЖЕНИЕ'),
  );
  expect(
    'ship panel offers a fitting button',
    yardView.includes('УСТАНОВИТЬ') || yardView.includes('УСТАНОВЛЕНО'),
  );
} else {
  console.log('  skip no charted system with a shipyard');
}

const galaxyCouriers = state.systemIds
  .flatMap((id) => state.systems[id].contracts)
  .filter((contract) => contract.kind === 'courier');
expect('galaxy boards carry courier work', galaxyCouriers.length > 0, `${galaxyCouriers.length} couriers`);
const courierSystem = state.systemIds
  .map((id) => state.systems[id])
  .find(
    (sys) =>
      sys.discovered &&
      sys.stations.some((st) => st.hasContracts && serviceAccess(state, st, 'contracts').ok) &&
      sys.contracts.some((c) => c.kind === 'courier' && !contractBlockedReason(state, c)),
  );
if (courierSystem) {
  ship.systemId = courierSystem.id;
  const courierOffer = contractsHere(state).find(
    (contract) => contract.kind === 'courier' && !contractBlockedReason(state, contract),
  );
  if (courierOffer) {
    console.log(`  info courier accepted: ${acceptContract(state, courierOffer.id)}`);
    const sealedView = render('ShipPanel (sealed cargo)', <ShipPanel state={state} run={run} onOpen={open} />);
    expect(
      'sealed contract cargo is shown in the hold',
      sealedView.includes('Опечатанный груз'),
      `${courierOffer.amount} sealed units`,
    );
    const courierView = render('ContractsPanel (courier board)', <ContractsPanel state={state} run={run} />);
    expect(
      'courier card names the route and the distance',
      courierView.includes('КУРЬЕР') && courierView.includes(contractRoute(state, courierOffer)),
      contractRoute(state, courierOffer),
    );
  }
} else {
  console.log('  skip no charted board with courier work');
}
ship.systemId = dockSystemId;
render('FleetPanel (two hulls)', <FleetPanel state={state} run={run} />);
render('StationPanel (build running)', <StationPanel state={state} run={run} />);
const cargoView = render('CargoPanel (ore in hold)', <CargoPanel state={state} run={run} onOpen={open} />);
expect('cargo panel names the hold', cargoView.includes('Трюм'));
expect('cargo panel names the storage next door', cargoView.includes('Склад'));
expect('cargo panel explains the loop', cargoView.includes('Как это устроено'));
expect('cargo panel shows the mined resource by name', cargoView.includes('Руда'));

// --------------------------------------------------------------- in transit
console.log('\n[4] in transit with a pending event');
if (neighbour) {
  console.log(`  info jumped out: ${travelTo(state, neighbour)}`);
  renderShell(state, neighbour);
  const destId = ship.travel?.path[ship.travel.path.length - 1] ?? '';
  const destName = state.systems[destId]?.name ?? '';
  const transitMap = render(
    'GalaxyMap (in transit)',
    <GalaxyMap state={state} selectedId={null} animations onSelect={select} onJump={jump} />,
  );
  expect('map draws the ship running along the lane', transitMap.includes('warp-marker'));
  expect('map highlights the jump route', transitMap.includes('warp-route'));
  const stillMap = render(
    'GalaxyMap (animation off)',
    <GalaxyMap state={state} selectedId={null} animations={false} onSelect={select} onJump={jump} />,
  );
  expect('jump animation can be switched off', stillMap.includes('warp still'));
  const bar = render('JumpBar (in transit)', <JumpBar state={state} paused={false} onCancel={noop} />, 40);
  expect('jump bar reports progress', bar.includes('осталось'));
  expect('jump bar names the destination', !!destName && bar.includes(destName));
  state.pendingEvent = {
    id: 'render:1',
    eventId: 'pirate_encounter',
    shipId: ship.id,
    firedAt: state.gameTime,
    payload: buildPayload(state, ship, 'pirate_encounter'),
  };
  const modal = render('EventModal (pirate)', <EventModal state={state} onChoose={choose} />);
  expect('modal renders every choice', (modal.match(/class="btn choice"/g) ?? []).length >= 2);
  expect('modal is a dialog', modal.includes('modal-backdrop'));
  state.pendingEvent = null;
}

// --------------------------------------------------------------- station funnel
console.log('\n[3b] station funnel: site → foundation → base');
ship.travel = null;
ship.mission = null;
ship.status = 'docked';
const claimSystem = state.systemIds
  .map((id) => state.systems[id])
  .find((system) => system.factionId === null);
if (claimSystem) {
  claimSystem.discovered = true;
  claimSystem.scanned = true;
  for (const claimBelt of claimSystem.belts) claimBelt.discovered = true;
  const claimPlanet = claimSystem.planets.find((planet) => planetKindOf(planet).buildable);
  const plannedSetup = render('StationPanel (site not chosen)', <StationPanel state={state} run={run} />);
  expect('site panel explains the funnel', plannedSetup.includes('Закладка станции'));
  expect('site panel lists the steps', plannedSetup.includes('step'));
  expect('site panel says where to claim', plannedSetup.includes('ничей') || plannedSetup.includes('ничья'));
  if (claimPlanet) {
    console.log(`  info site chosen: ${chooseSite(state, claimSystem.id, claimPlanet.id)}`);
    ship.systemId = claimSystem.id;
    const chosen = render('StationPanel (site chosen)', <StationPanel state={state} run={run} />);
    expect('chosen site is named in the panel', chosen.includes(claimSystem.name));
    expect('foundation requirements are listed', chosen.includes('Требования закладки склада'));
    ship.cargo = { metal: FOUNDATION_MATERIALS.metal };
    console.log(`  info foundation: ${foundStation(state)}`);
    const founded = render('StationPanel (foundation phase)', <StationPanel state={state} run={run} />);
    expect('foundation phase shows the build bar', founded.includes('progress'));
    expect('foundation phase names the warehouse', founded.includes('Склад'));
    state.station.storage.metal = 400;
    state.station.storage.electronics = 40;
    // Закладка склада уже достроена (её стройка занимает бригаду).
    state.station.construction = null;
    state.station.buildings.warehouse = 1;
    const buildStarted = startConstruction(state, 'commandCenter');
    console.log(`  info base station build started: ${buildStarted}`);
    expect('base station construction accepted', buildStarted === true);
    const building = render('StationPanel (base station building)', <StationPanel state={state} run={run} />);
    expect('construction progress bar renders', building.includes('progress-fill'));
    state.station.construction = null;
    state.station.buildings.commandCenter = 1;
    state.station.phase = 'operational';
    state.station.level = 1;
    const operational = render('StationPanel (operational)', <StationPanel state={state} run={run} />);
    expect('operational station shows the site row', operational.includes('Участок'));
  }
}

// --------------------------------------------------------------- mining
console.log('\n[5] mining at the belt');
const systemHere = state.systems[ship.systemId];
const belt = systemHere.belts.find((entry) => entry.discovered) ?? systemHere.belts[0];
if (belt) {
  // Разведка проверяется первой: сканер не работает на корабле, занятом добычей.
  const freshBelt = systemHere.belts[0];
  if (freshBelt) freshBelt.discovered = false;
  ship.status = 'docked';
  ship.mission = null;
  render('ResearchPanel (survey idle)', <ResearchPanel state={state} run={run} onOpen={open} />);
  if (freshBelt) {
    console.log(`  info survey started: ${startSurvey(state, 'belt', { beltId: freshBelt.id })}`);
    const surveying = render('ResearchPanel (survey running)', <ResearchPanel state={state} run={run} onOpen={open} />);
    expect('explore panel shows survey progress', surveying.includes('progress-fill'));
    expect('explore panel offers a cancel', surveying.includes('ПРЕРВАТЬ СКАН'));
    expect('surveying blocks mining', startMining(state, ship, freshBelt.id) === false);
    cancelSurvey(state);
    freshBelt.discovered = true;
    console.log(`  info survey cancelled: ${state.survey === null}`);
  }
  console.log(`  info mining started: ${startMining(state, ship, belt.id)}`);
  const mining = render('ResourcesPanel (mining)', <ResourcesPanel state={state} run={run} onOpen={open} />);
  expect('mining panel shows the stint progress', mining.includes('progress-fill'));
  expect('mining panel offers the stop button', mining.includes('ОСТАНОВИТЬ ДОБЫЧУ'));
  expect('mining panel reports free cargo', mining.includes('Свободный трюм'));
  expect('mining panel reports the belt reserve', mining.includes('Запас пояса'));
  render('ShipPanel (mining)', <ShipPanel state={state} run={run} onOpen={open} />);
}
expect('event definitions stay addressable', !!eventDef('pirate_encounter'));

// --------------------------------------------------------------- склады по станциям
console.log('\n[6] per-station depots');
{
  const ship = playerShip(state);
  ship.travel = null;
  ship.status = 'docked';
  ship.mission = null;
  // Ничейная система без станций: держать груз негде.
  const empty = state.systemIds
    .map((id) => state.systems[id])
    .find((sys) => sys.stations.length === 0 && sys.id !== state.station.systemId);
  // Система со станцией фракции, готовой принять груз на хранение.
  const host = state.systemIds
    .map((id) => state.systems[id])
    .find(
      (sys) =>
        sys.id !== state.station.systemId &&
        sys.stations.some((station) => !!station.factionId && stationServices(station).storage),
    );

  if (empty) {
    ship.systemId = empty.id;
    expect('no station means no depot', depotHere(state) === null, depotRefusal(state) ?? '');
  }

  if (host) {
    ship.systemId = host.id;
    const depot = depotHere(state);
    expect('a station offers its warehouse', !!depot, depot ? `${depot.name} — ${depot.capacity} ед.` : 'none');
    if (depot) {
      ship.cargo = { ore: 20 };
      const moved = unloadToStation(state, null);
      expect('hold unloads into the rented cells', moved === 20, `${moved} ед.`);
      const stored = depotAmounts(state, depot.id).ore ?? 0;
      expect('rented goods sit in the station depot', stored === 20, `${stored} ед. ore`);
      expect(
        'the home warehouse is untouched',
        depot.own ? true : (state.station.storage.ore ?? 0) === 0,
        `${state.station.storage.ore ?? 0} ore at home`,
      );
      const loaded = loadFromStation(state, 'ore', 5);
      expect('goods can be loaded back from the same station', loaded === 5, `${loaded} ед.`);
      const panel = render('StoragePanel (rented depot)', <StoragePanel state={state} run={run} onOpen={open} />);
      expect('storage panel names the depot', panel.includes(depot.name));
      expect('storage panel lists the goods', panel.includes('Содержимое склада') && panel.includes('Руда'));
      const hub = render('StationServices (station menu)', <StationServices state={state} run={run} onOpen={open} />);
      expect('station menu offers storage as a tile', hub.includes('СКЛАД'));
      expect('station menu lists the services of the station', hub.includes('Услуги'));
    }
  } else {
    console.log('  skip no charted station with storage');
  }
}

console.log(`\n${checks - failures}/${checks} renders/checks passed, ${failures} failed.`);
if (failures > 0) throw new Error(`${failures} render check(s) failed.`);

