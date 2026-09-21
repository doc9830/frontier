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
check('dock is on screen', shell.includes('СИСТЕМА') && shell.includes('РЫНОК'));
check('credits are shown', /кр/.test(shell));
check('save was written', await evaluate("localStorage.getItem('frontier.save.v1') !== null"));

const tabs = ['РАЗВЕДКА', 'ГРУЗ', 'РЫНОК', 'КОРАБЛЬ', 'СТАНЦИЯ', 'ФЛОТ', 'КОНТРАКТЫ', 'ЛЕНТА', 'НАСТРОЙКИ'];
console.log('\n[3] every tab renders');
for (const tab of tabs) {
  const clicked = await clickTab(tab);
  await sleep(250);
  const panelText = await evaluate("document.querySelector('.panelcol')?.innerText ?? ''");
  check(`${tab} opens with content`, clicked === true && panelText.length > 40, `${panelText.length} chars`);
}

// Верфь и доска контрактов: подписи о том, чьи доки ставят модули и куда везти груз.
console.log('\n[3b] outfitting and contract boards tell who is who');
await clickTab('КОРАБЛЬ');
await sleep(300);
const shipText = await evaluate("document.querySelector('.panelcol')?.innerText ?? ''");
check(
  'ship tab groups modules into sections',
  shipText.includes('ХОД И ПРЫЖОК') && shipText.includes('ВООРУЖЕНИЕ'),
  shipText.slice(0, 90),
);
check(
  'ship tab names the shipyard at work',
  shipText.includes('Верфь') && (shipText.includes('модули до Mk') || shipText.includes('верфи')),
);
await clickTab('КОНТРАКТЫ');
await sleep(300);
const contractText = await evaluate("document.querySelector('.panelcol')?.innerText ?? ''");
check(
  'contract tab labels the kind of work',
  contractText.includes('ПОСТАВКА') || contractText.includes('КУРЬЕР'),
  contractText.slice(0, 120),
);

// Телефонный путь: нижний док открывает те же разделы.
const dockWorks = await evaluate(`
  (() => {
    const dock = [...document.querySelectorAll('.dock .dock-btn')];
    if (dock.length === 0) return 'no dock';
    dock[0].click();
    return document.querySelector('.panelcol')?.innerText?.slice(0, 40) ?? '';
  })()
`);
check('bottom dock opens a section', typeof dockWorks === 'string' && dockWorks.length > 0, dockWorks);

console.log('\n[4] station funnel is reachable');
await clickTab('СТАНЦИЯ');
await sleep(300);
const stationText = (await evaluate("document.querySelector('.panelcol')?.innerText ?? ''")).toLowerCase();
check('station tab shows the claim funnel', stationText.includes('закладка станции'), stationText.slice(0, 120));
check('funnel lists the steps', stationText.includes('выбрать участок'));
check(
  'funnel asks for a haul',
  stationText.includes('заложить склад') || stationText.includes('требования закладки'),
);

console.log('\n[5] mining controls');
await clickTab('СИСТЕМА');
await sleep(300);
const systemText = (await evaluate("document.querySelector('.panelcol')?.innerText ?? ''")).toLowerCase();
check('system tab lists belts', systemText.includes('пояса астероидов'));
check('belt rows show the reserve', systemText.includes('запас'), systemText.slice(0, 120));
check('mining controls are offered', systemText.includes('бурить') || systemText.includes('до полного трюма'));

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
await sleep(200);
const drillStart = await evaluate(`
  (() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('БУРИТЬ'));
    if (!button) return 'no belt to drill';
    if (button.disabled) return 'button disabled';
    button.click();
    return 'clicked';
  })()
`);
check('a belt can be drilled from the panel', drillStart === 'clicked', drillStart);
await sleep(3500);
const miningText = (await evaluate("document.querySelector('.panelcol')?.innerText ?? ''")).toLowerCase();
check('stint panel is live', miningText.includes('вахта'), miningText.slice(0, 100));
check('stint reports a plan', miningText.includes('план вахты'));
check('stint can be stopped', miningText.includes('остановить добычу'));

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
await clickTab('СТАНЦИЯ');
await sleep(400);
const beforeText = (await evaluate("document.querySelector('.panelcol')?.innerText ?? ''")).toLowerCase();
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
check('station moved to the foundation phase', afterText.includes('заложен склад'), afterText.slice(0, 120));
check('construction bar started', afterText.includes('склад mk 1') || afterText.includes('progress'));
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

freshTab.close();
ws.close();
chrome.kill();
preview?.kill();

console.log(`\n${checks - failures}/${checks} browser checks passed, ${failures} failed.`);
if (failures > 0) process.exit(1);

