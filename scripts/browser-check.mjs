/**
 * Браузерная проверка: поднимает собранную игру в headless Chrome, стартует
 * новую галактику, проходит по вкладкам и собирает ошибки консоли.
 *
 *   node scripts/browser-check.mjs [url]
 *
 * Служит «живым» дополнением к smoke.ts и render-check.tsx: те гоняют логику и
 * серверный рендер, а этот прогон проверяет, что настоящая сборка открывается и
 * не сыпет исключениями.
 */
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME ?? 'google-chrome';
const PORT = 9333;

/** Сборка обслуживается либо уже запущенным preview, либо поднимается здесь. */
async function ensurePreview(base) {
  const origin = new URL(base).origin;
  try {
    const response = await fetch(origin);
    if (response.ok) return null;
  } catch {
    /* сервер ещё не поднят */
  }
  const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const child = spawn(process.execPath, [viteCli, 'preview', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(300);
    try {
      const response = await fetch(origin);
      if (response.ok) return child;
    } catch {
      /* ждём дальше */
    }
  }
  child.kill();
  throw new Error('vite preview did not start — run `npm run build` first');
}

const preview = await ensurePreview(url);

let checks = 0;
let failures = 0;
function check(label, condition, detail = '') {
  checks += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,900',
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function cdpUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      /* chrome is still booting */
    }
    await sleep(250);
  }
  throw new Error('chrome did not expose a debugging port');
}

await cdpUrl();

/** Одна вкладка CDP: send/evaluate живут в модуле, переключаются через attach(). */
const consoleErrors = [];
let messageId = 0;
let send;
let evaluate;
let lastTargetId = null;

async function attach(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.description ?? arg.value ?? '').join(' '));
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve) => {
      messageId += 1;
      pending.set(messageId, resolve);
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
  evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return response.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return socket;
}

async function newTab(targetUrl) {
  const created = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' })
  ).json();
  lastTargetId = created.id;
  return attach(created.webSocketDebuggerUrl);
}

const ws = await newTab('about:blank');
const mainTargetId = lastTargetId;

const clickButton = (label) =>
  evaluate(`
    (() => {
      const button = [...document.querySelectorAll('.panelcol button')]
        .find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!button) return 'missing';
      if (button.disabled) return 'disabled';
      button.click();
      return 'clicked';
    })()
  `);

const clickBack = () =>
  evaluate(`
    (() => {
      const button = document.querySelector('.panelcol .sheet-back');
      if (!button) return false;
      button.click();
      return true;
    })()
  `);

/** Заголовок листа без учёта CSS-видимости: на десктопе шапка скрыта. */
const sheetHeading = () =>
  evaluate("document.querySelector('.panelcol .sheet-title')?.textContent?.trim() ?? ''");

const panelText = () => evaluate("document.querySelector('.panelcol')?.innerText ?? ''");

const clickTab = (label) =>
  evaluate(`
    (() => {
      const button = [...document.querySelectorAll('nav.tabs button, .sheet-tile')]
        .find((b) => b.textContent.includes(${JSON.stringify(label)}));
      if (!button) return false;
      button.click();
      return true;
    })()
  `);

/** Тап по кнопке раздела в нижнем доке — так же, как пальцем на телефоне. */
const clickDock = (label) =>
  evaluate(`
    (() => {
      const button = [...document.querySelectorAll('.dock button')].find(
        (b) => b.textContent.trim() === ${JSON.stringify(label)},
      );
      if (!button) return 'missing';
      button.click();
      return 'clicked';
    })()
  `);

await send('Page.navigate', { url });
await sleep(3000);

console.log('\n[1] boot screen');
const introText = await evaluate('document.body.innerText');
check('intro screen renders', typeof introText === 'string' && introText.includes('FRONTIER'));
check(
  'intro quotes the starting capital',
  introText.includes('стартовый капитал'),
  introText.match(/стартовый капитал[^\n]*/)?.[0] ?? '',
);

console.log('\n[2] new galaxy');
const started = await evaluate(`
  (() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('НОВАЯ ГАЛАКТИКА'));
    if (!button) return false;
    button.click();
    return true;
  })()
`);
check('new game button clicked', started === true);
await sleep(1500);

const shell = await evaluate('document.body.innerText');
check('shell replaced the intro', !shell.includes('НОВАЯ ГАЛАКТИКА'));
check('dock is on screen', shell.includes('СИСТЕМА') && shell.includes('ГРУЗ') && shell.includes('НАСТРОЙКИ'));
check('credits are shown', /кр/.test(shell));
check('save was written', await evaluate("localStorage.getItem('frontier.save.v1') !== null"));

const tabs = ['СИСТЕМА', 'ГРУЗ', 'КОРАБЛЬ', 'ФЛОТ', 'ЛЕНТА', 'НАСТРОЙКИ'];
console.log('\n[3] every tab renders');
for (const tab of tabs) {
  const clicked = await clickTab(tab);
  await sleep(250);
  const panelText = await evaluate("document.querySelector('.panelcol')?.innerText ?? ''");
  check(`${tab} opens with content`, clicked === true && panelText.length > 40, `${panelText.length} chars`);
}

// Подэкраны: из раздела «Корабль» открывается верфь, из «Груза» — рынок и склад.
console.log('\n[3b] subscreens open from their tabs and come back');
await clickTab('КОРАБЛЬ');
await sleep(300);
const shipText = await panelText();
const shipLower = shipText.toLowerCase();
check('ship tab shows the flagship summary', shipLower.includes('сборка корабля'), shipText.slice(0, 90));
const yardTile = await clickButton('ВЕРФЬ');
if (yardTile === 'clicked') {
  await sleep(250);
  const yardText = (await panelText()).toLowerCase();
  check('shipyard screen opens inside the tab', yardText.includes('верфь'), yardText.slice(0, 90));
  check(
    'shipyard either lists modules or explains itself',
    yardText.includes('ход и прыжок') || yardText.includes('недоступна') || yardText.includes('нет верфи'),
  );
  const backed = await clickBack();
  await sleep(250);
  const backText = await panelText();
  check('back returns to the ship section', backed === true && backText.toLowerCase().includes('сборка корабля'));
} else {
  check('shipyard tile exists on the ship tab', false, yardTile);
}

await clickTab('ГРУЗ');
await sleep(300);
const cargoText = (await panelText()).toLowerCase();
check('cargo tab lists the hold', cargoText.includes('в трюме'), cargoText.slice(0, 90));
const depotTile = await clickButton('СКЛАД');
if (depotTile === 'clicked') {
  await sleep(250);
  const depotText = (await panelText()).toLowerCase();
  check('depot screen explains where the goods live', depotText.includes('склад'), depotText.slice(0, 90));
  await clickBack();
  await sleep(200);
} else {
  check('depot tile is offered (station must be nearby)', depotTile === 'disabled', depotTile);
}

await clickTab('СИСТЕМА');
await sleep(300);
const stationsTile = await clickButton('СТАНЦИИ');
check('system tab offers the station list', stationsTile === 'clicked', stationsTile);
await sleep(250);
const stationMenuText = (await panelText()).toLowerCase();
check(
  'station menu is reachable',
  stationMenuText.includes('услуг') || stationMenuText.includes('склад'),
  stationMenuText.slice(0, 120),
);
const contractTile = await clickButton('КОНТРАКТЫ');
if (contractTile === 'clicked') {
  await sleep(250);
  const contractText = (await panelText()).toLowerCase();
  check(
    'contract screen labels the kind of work',
    contractText.includes('поставка') || contractText.includes('курьер') || contractText.includes('доска'),
    contractText.slice(0, 120),
  );
  await clickBack();
  await sleep(200);
} else {
  console.log('  skip no contract board in the starting system');
}

console.log('\n[4] station funnel is reachable');
await clickTab('СИСТЕМА');
await sleep(300);
const funnelOpen = await clickButton('СТРОИТЕЛЬСТВО СТАНЦИИ');
check('the claim funnel opens from the system tab', funnelOpen === 'clicked', funnelOpen);
await sleep(350);
const funnelText = (await panelText()).toLowerCase();
check('funnel shows the claim steps', funnelText.includes('закладка станции'), funnelText.slice(0, 120));
check('funnel lists the steps', funnelText.includes('выбрать участок'));
check(
  'funnel asks for a haul',
  funnelText.includes('заложить склад') || funnelText.includes('требования закладки'),
);
const funnelBack = await clickBack();
await sleep(250);
check(
  'back leaves the funnel',
  funnelBack === true && (await panelText()).toLowerCase().includes('система ·'),
);

console.log('\n[5] mining controls');
await clickTab('СИСТЕМА');
await sleep(250);
const hubText = await panelText();
check('system hub offers research', hubText.includes('ИССЛЕДОВАНИЕ'), hubText.slice(0, 90));
const resourcesOpen = await clickButton('РЕСУРСЫ');
check('resources screen opens from the hub', resourcesOpen === 'clicked', resourcesOpen);
await sleep(300);
const systemText = (await panelText()).toLowerCase();
check('resources screen lists belts', systemText.includes('пояса'), systemText.slice(0, 120));
check(
  'belt rows show the reserve or ask for a scan',
  systemText.includes('запас') || systemText.includes('не изучен'),
  systemText.slice(0, 120),
);
check(
  'mining controls are offered',
  systemText.includes('бурить') || systemText.includes('до полного трюма') || systemText.includes('исследовать'),
);

console.log('\n[6] live mining stint');
await clickTab('НАСТРОЙКИ');
await sleep(200);
await evaluate(`
  (() => {
    const chip = [...document.querySelectorAll('.chip')].find((c) => c.textContent.trim() === '×4');
    chip?.click();
    return true;
  })()
`);
await clickTab('СИСТЕМА');
await sleep(250);
const resourcesAgain = await clickButton('РЕСУРСЫ');
check('resources screen is one tap away', resourcesAgain === 'clicked', resourcesAgain);
await sleep(300);
const drillStart = await clickButton('БУРИТЬ');
if (drillStart === 'clicked') {
  check('a belt can be drilled from the resources screen', true);
  await sleep(3500);
  const miningText = (await panelText()).toLowerCase();
  check('stint panel is live', miningText.includes('вахта'), miningText.slice(0, 100));
  check('stint reports a plan', miningText.includes('план вахты'));
  check('stint can be stopped', miningText.includes('остановить добычу'));
} else {
  check('undiscovered belts refuse drilling', drillStart === 'missing' || drillStart === 'disabled', drillStart);
  const research = await clickButton('ИССЛЕДОВАТЬ');
  check('research opens for un-scanned belts', research === 'clicked', research);
  await sleep(300);
  const researchText = (await panelText()).toLowerCase();
  check(
    'research screen offers a belt scan',
    researchText.includes('пояса') || researchText.includes('начать скан'),
    researchText.slice(0, 120),
  );
}

console.log('\n[7] claim a station through the UI');
const prepared = execFileSync(
  process.execPath,
  ['--experimental-strip-types', fileURLToPath(new URL('./prepare-save.ts', import.meta.url))],
  { encoding: 'utf8' },
).trim();
check('prepared save is a real blob', prepared.length > 1000, `${prepared.length} chars`);
// Свежая вкладка: в старой на перезагрузке сработает автосохранение и затрёт фикстуру.
await fetch(`http://127.0.0.1:${PORT}/json/close/${mainTargetId}`);
ws.close();
await sleep(600);
const freshTab = await newTab(url);
await sleep(2000);
await evaluate(`localStorage.setItem('frontier.save.v1', ${JSON.stringify(prepared)})`);
await send('Page.navigate', { url });
await sleep(2500);
const resume = await evaluate(`
  (() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('ПРОДОЛЖИТЬ'));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()
`);
check('saved game can be resumed', resume === true);
await sleep(1200);
await clickTab('СИСТЕМА');
await sleep(350);
const preparedFunnel = await clickButton('СТРОИТЕЛЬСТВО СТАНЦИИ');
check('prepared game keeps the funnel reachable', preparedFunnel === 'clicked', preparedFunnel);
await sleep(400);
const beforeText = (await panelText()).toLowerCase();
check('prepared site is shown', beforeText.includes('заложить склад'), beforeText.slice(0, 120));
const creditsBefore = await evaluate(`
  (() => {
    const text = document.body.innerText.match(/([\\d\\s]+) кр/);
    return text ? Number(text[1].replace(/\\s/g, '')) : 0;
  })()
`);
const founded = await evaluate(`
  (() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'ЗАЛОЖИТЬ СКЛАД');
    if (!button) return 'no button';
    if (button.disabled) return 'disabled';
    button.click();
    return 'clicked';
  })()
`);
check('foundation button is live', founded === 'clicked', founded);
await sleep(600);
const afterText = (await evaluate("document.querySelector('.panelcol')?.innerText ?? ''")).toLowerCase();
check('station moved to the foundation phase', afterText.includes('стройплощадка'), afterText.slice(0, 160));
await clickTab('СИСТЕМА');
await sleep(300);
const baseOpen = await clickButton('УПРАВЛЕНИЕ БАЗОЙ');
check('base screen opens after founding', baseOpen === 'clicked', baseOpen);
await sleep(400);
const baseText = (await panelText()).toLowerCase();
check(
  'construction bar started',
  baseText.includes('строится') || baseText.includes('progress'),
  baseText.slice(0, 120),
);
const creditsAfter = await evaluate(`
  (() => {
    const text = document.body.innerText.match(/([\\d\\s]+) кр/);
    return text ? Number(text[1].replace(/\\s/g, '')) : 0;
  })()
`);
check('foundation charged the credits', creditsAfter < creditsBefore, `${creditsBefore} → ${creditsAfter}`);
const toastText = (await evaluate("document.querySelector('.toaster')?.innerText ?? ''")).toLowerCase();
check('player got feedback', toastText.includes('склад') || afterText.includes('склад'), toastText.slice(0, 60));

console.log('\n[8] console health');
check('no uncaught exceptions', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// Телефонная раскладка: лист не накрывает док, «назад» всегда под рукой.
console.log('\n[9] phone layout and back stack');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await sleep(500);
// Лист закрыт: док — единственное, что висит внизу, и кнопки обязаны нажиматься.
await evaluate("document.querySelector('.sheet-close')?.click()");
await sleep(400);
const closedDock = await evaluate(`
  (() => {
    const dock = document.querySelector('.dock');
    const sheet = document.querySelector('.panelcol');
    const buttons = [...dock.querySelectorAll('button')];
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    return {
      open: !!sheet?.classList.contains('open'),
      hits: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return b === hit || b.contains(hit) ? 'dock-btn' : String(hit?.tagName ?? '?');
      }),
      labels: buttons.map((b) => b.textContent.trim()),
      spare: dock.querySelectorAll('button span').length,
      sheet: rect(sheet),
      vh: window.innerHeight,
    };
  })()
`);
check('the sheet closes on the phone', closedDock.open === false, JSON.stringify(closedDock.sheet));
check(
  'closed sheet leaves the dock buttons tappable',
  closedDock.hits.length === 6 && closedDock.hits.every((hit) => String(hit).includes('dock-btn')),
  closedDock.hits.join(' | '),
);
check(
  'closed sheet is off screen entirely',
  closedDock.sheet.top >= closedDock.vh - 1,
  `top ${closedDock.sheet.top} of ${closedDock.vh}`,
);
check(
  'dock keeps only the six tab labels',
  closedDock.labels.length === 6 && closedDock.spare === 0,
  `${closedDock.labels.join(' ')} · ${closedDock.hits.length} buttons`,
);

const openDock = await clickDock('СИСТЕМА');
await sleep(400);
const layout = await evaluate(`
  (() => {
    const sheet = document.querySelector('.panelcol');
    const dock = document.querySelector('.dock');
    const sheetRect = sheet?.getBoundingClientRect();
    const dockRect = dock?.getBoundingClientRect();
    const buttons = [...dock.querySelectorAll('button')];
    return {
      open: !!sheet?.classList.contains('open'),
      sheetBottom: Math.round(sheetRect?.bottom ?? -1),
      dockTop: Math.round(dockRect?.top ?? -1),
      dockHeight: Math.round(dockRect?.height ?? -1),
      hits: buttons.map((b) => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return b === hit || b.contains(hit) ? 'dock-btn' : String(hit?.tagName ?? '?');
      }),
    };
  })()
`);
check('dock tap opens the section', openDock === 'clicked', openDock);
check('sheet is open on the phone', layout.open === true, JSON.stringify(layout));
check(
  'sheet stops above the dock',
  layout.dockTop > 0 && layout.sheetBottom <= layout.dockTop + 1,
  JSON.stringify(layout),
);
check(
  'dock buttons stay tappable under the open sheet',
  layout.hits.every((hit) => String(hit).includes('dock-btn')),
  layout.hits.join(' | '),
);
const hiddenTabs = await evaluate(
  "(() => { const t = document.querySelector('.panelcol .tabs'); return !!t && getComputedStyle(t).display === 'none'; })()",
);
check('phone switches sections by the dock, not by an in-sheet strip', hiddenTabs === true);

// Повторный тап по активному разделу закрывает лист — кнопки снова свободны.
await clickDock('СИСТЕМА');
await sleep(400);
check(
  'tapping the active tab closes the sheet again',
  (await evaluate("document.querySelector('.panelcol')?.classList.contains('open')")) === false,
);
await clickDock('СИСТЕМА');
await sleep(400);
const phoneTile = await clickButton('СТАНЦИИ');
check('subscreen opens with the dock still on screen', phoneTile === 'clicked', phoneTile);
await sleep(400);
const backVisible = await evaluate(`
  (() => {
    const button = document.querySelector('.sheet-back');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return getComputedStyle(button).display !== 'none' && rect.width > 0 && rect.height > 0;
  })()
`);
check('back button is tappable in a subscreen', backVisible === true);
const escapeBack = await evaluate(`
  (() => {
    const before = document.querySelector('.panelcol .sheet-back') !== null;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return before;
  })()
`);
await sleep(300);
const afterEscape = await evaluate("document.querySelector('.panelcol .sheet-back') === null");
check('Escape pops the subscreen too', escapeBack === true && afterEscape === true);
const bridge = await evaluate("typeof window.__frontierBack");
check('browser build leaves the hardware back to the shell', bridge === 'undefined', bridge);
await send('Emulation.clearDeviceMetricsOverride');

freshTab.close();
ws.close();
chrome.kill();
preview?.kill();

console.log(`\n${checks - failures}/${checks} browser checks passed, ${failures} failed.`);
if (failures > 0) process.exit(1);

