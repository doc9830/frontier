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
import { acceptContract, contractsHere } from '../src/game/actions/contracts.ts';
import { purchaseShip, hullsForSale } from '../src/game/actions/outfitting.ts';
import { startMining } from '../src/game/sim/mining.ts';
import { startConstruction } from '../src/game/actions/build.ts';
import { GalaxyMap } from '../src/ui/GalaxyMap.tsx';
import { EventModal } from '../src/ui/EventModal.tsx';
import { Toaster } from '../src/ui/Toaster.tsx';
import { IntroScreen } from '../src/ui/IntroScreen.tsx';
import { StationPanel } from '../src/ui/panels/StationPanel.tsx';
import { SystemPanel } from '../src/ui/panels/SystemPanel.tsx';
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
import type { TabId } from '../src/ui/panels/NewsPanel.tsx';

let checks = 0;
let failures = 0;

const run = (_mutator: (draft: GameState) => void): void => {};
const goTo = (_tab: TabId): void => {};
const choose = (_choiceId: string): void => {};
const select = (_id: string | null): void => {};
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
  render('SystemPanel', <SystemPanel state={state} run={run} />);
  render('SystemPanel (jump routed)', <SystemPanel state={state} run={run} onJump={noop} />);
  render('MarketPanel', <MarketPanel state={state} run={run} />);
  render('CargoPanel', <CargoPanel state={state} run={run} />);
  render('ShipPanel', <ShipPanel state={state} run={run} />);
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

const buildTarget = startConstruction(state, 'warehouse');
console.log(`  info warehouse build started: ${buildTarget}`);
const hull = hullsForSale(state, ship).find((offer) => offer.affordable);
const bought = hull ? purchaseShip(state, hull.typeId) : null;
console.log(`  info second hull: ${bought ? bought.name : 'none bought'}`);
ship.cargo = { ore: 12, food: 4 };
const board = contractsHere(state);
if (board[0]) console.log(`  info contract accepted: ${acceptContract(state, board[0].id)}`);
renderShell(state, neighbour);
render('ShipPanel (cargo loaded)', <ShipPanel state={state} run={run} />);
render('FleetPanel (two hulls)', <FleetPanel state={state} run={run} />);
render('StationPanel (build running)', <StationPanel state={state} run={run} />);
const cargoView = render('CargoPanel (ore in hold)', <CargoPanel state={state} run={run} />);
expect('cargo panel names the hold', cargoView.includes('Трюм корабля'));
expect('cargo panel names the station storage', cargoView.includes('Склад станции'));
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

// --------------------------------------------------------------- mining
console.log('\n[5] mining at the belt');
const systemHere = state.systems[ship.systemId];
const belt = systemHere.belts.find((entry) => entry.discovered) ?? systemHere.belts[0];
if (belt) {
  console.log(`  info mining started: ${startMining(state, ship, belt.id)}`);
  render('SystemPanel (mining)', <SystemPanel state={state} run={run} />);
  render('ShipPanel (mining)', <ShipPanel state={state} run={run} />);
}
expect('event definitions stay addressable', !!eventDef('pirate_encounter'));

console.log(`\n${checks - failures}/${checks} renders/checks passed, ${failures} failed.`);
if (failures > 0) throw new Error(`${failures} render check(s) failed.`);

