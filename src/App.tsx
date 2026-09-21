import { useEffect, useRef, useState } from 'react';
import { useGame } from './game/state/store.ts';
import { playerShip } from './game/state/create.ts';
import { formatGameTime, gameDay } from './game/news/news.ts';
import { archetypeLabel } from './game/universe/generate.ts';
import { factionView } from './game/factions/reputation.ts';
import { cargoUsed, shipStats } from './game/ships/ship.ts';
import { travelTo, cancelTravel } from './game/actions/nav.ts';
import { atMarket } from './game/actions/trade.ts';
import { StationPanel } from './ui/panels/StationPanel.tsx';
import { SystemPanel } from './ui/panels/SystemPanel.tsx';
import { ExplorePanel } from './ui/panels/ExplorePanel.tsx';
import { CargoPanel } from './ui/panels/CargoPanel.tsx';
import { MarketPanel } from './ui/panels/MarketPanel.tsx';
import { ShipPanel } from './ui/panels/ShipPanel.tsx';
import { FleetPanel } from './ui/panels/FleetPanel.tsx';
import { ContractsPanel } from './ui/panels/ContractsPanel.tsx';
import { NewsPanel } from './ui/panels/NewsPanel.tsx';
import { SettingsPanel } from './ui/panels/SettingsPanel.tsx';
import type { TabId } from './ui/panels/NewsPanel.tsx';
import { GalaxyMap } from './ui/GalaxyMap.tsx';
import { EventModal } from './ui/EventModal.tsx';
import { JumpBar } from './ui/JumpBar.tsx';
import { JumpConfirm } from './ui/JumpConfirm.tsx';
import { Toaster } from './ui/Toaster.tsx';
import { IntroScreen } from './ui/IntroScreen.tsx';
import { STATUS_LABEL, cr, num } from './ui/format.ts';
import { Tag } from './ui/kit.tsx';
import { isAndroidShell, onShellBack } from './platform/android.ts';

/** The shell: intro screen, topbar, map, tab bar and the panel column. */

const TABS: { id: TabId; label: string; title: string }[] = [
  { id: 'system', label: 'СИСТЕМА', title: 'Текущая система, пояса астероидов и прыжки' },
  { id: 'explore', label: 'РАЗВЕДКА', title: 'Сканер: скан систем, разведка поясов, дальний скан' },
  { id: 'cargo', label: 'ГРУЗ', title: 'Что лежит в трюме и на складе станции' },
  { id: 'market', label: 'РЫНОК', title: 'Купить и продать товары' },
  { id: 'ship', label: 'КОРАБЛЬ', title: 'Модули, ремонт, заправка, покупка корпусов' },
  { id: 'station', label: 'СТАНЦИЯ', title: 'Участок, стройка, переработка, исследования' },
  { id: 'fleet', label: 'ФЛОТ', title: 'Задания для остальных кораблей' },
  { id: 'contracts', label: 'КОНТРАКТЫ', title: 'Доска контрактов: доставка грузов за награду' },
  { id: 'news', label: 'ЛЕНТА', title: 'Сводка, статистика и подсказки' },
  { id: 'settings', label: 'НАСТРОЙКИ', title: 'Пауза, темп времени, интерфейс и обновления' },
];

export function App() {
  const game = useGame();
  const settings = game.settings;
  const paused = game.paused;
  const [tab, setTab] = useState<TabId>('system');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Phone shell: the map owns the screen, panels slide up as one bottom sheet and
  // the dock plus the top HUD keep the numbers one tap away. Desktop ignores it all.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  /** Прыжок, ждущий подтверждения (настройка «подтверждать прыжок»). */
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const hudRef = useRef<HTMLElement | null>(null);

  const openSection = (id: TabId): void => {
    setTab(id);
    setMenuOpen(false);
    setSheetOpen(true);
  };

  /** Dock buttons toggle: tapping the section that is already open hides the sheet. */
  const toggleSection = (id: TabId): void => {
    if (sheetOpen && !menuOpen && tab === id) {
      setSheetOpen(false);
      return;
    }
    openSection(id);
  };

  const toggleMenu = (): void => {
    if (sheetOpen && menuOpen) {
      setSheetOpen(false);
      setMenuOpen(false);
      return;
    }
    setMenuOpen(true);
    setSheetOpen(true);
  };

  const closeSheet = (): void => {
    setSheetOpen(false);
    setMenuOpen(false);
  };

  // Esc closes the event modal? No — events must be answered. Esc closes the confirm dialog
  // and the sheet, else clears the selection. Digits jump straight to a section.
  const state = game.state;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Пока игрок печатает (имя корабля, ключ галактики), горячие клавиши молчат.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'Escape') {
        if (jumpTarget) {
          setJumpTarget(null);
        } else if (sheetOpen) {
          setSheetOpen(false);
          setMenuOpen(false);
        } else {
          setSelectedId(null);
        }
      }
      if (event.key >= '1' && event.key <= '9') setTab(TABS[Number(event.key) - 1].id);
      // Десятый раздел (настройки) живёт на клавише 0 — иначе он остался бы без горячей клавиши.
      if (event.key === '0' && TABS[9]) setTab(TABS[9].id);
      if (event.key === 'p' || event.key === 'P' || event.key === 'з') game.togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, jumpTarget, game.togglePause]);

  // The bottom sheet must never crawl under the floating HUD: the header reports its own
  // height and the sheet caps itself with --hud-bottom (defaults to the collapsed HUD).
  const hasGame = state !== null;
  useEffect(() => {
    const node = hudRef.current;
    const root = document.documentElement;
    if (!node) {
      root.style.removeProperty('--hud-bottom');
      return;
    }
    const apply = (): void => {
      root.style.setProperty('--hud-bottom', `${Math.round(node.getBoundingClientRect().bottom)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      root.style.removeProperty('--hud-bottom');
    };
  }, [hasGame, hudOpen]);

  // Android shell: it asks the game to save before reloading into a new bundle.
  useEffect(() => {
    if (!isAndroidShell()) return;
    window.__frontierFlush = () => game.save();
    return () => {
      window.__frontierFlush = undefined;
    };
  }, [game.save]);

  // Android shell: hardware back closes the sheet first, the shell quits second.
  useEffect(() => {
    if (!isAndroidShell()) return;
    return onShellBack(() => {
      if (menuOpen || sheetOpen) {
        closeSheet();
        return true;
      }
      if (selectedId) {
        setSelectedId(null);
        return true;
      }
      return false;
    });
  }, [menuOpen, sheetOpen, selectedId]);

  if (!state) {
    return (
      <IntroScreen
        hasSave={game.hasExistingSave}
        offlineReport={game.offlineReport}
        onNewGame={(seed, name) => game.newGame(seed, name)}
        onContinue={() => game.continueGame()}
      />
    );
  }

  const ship = playerShip(state);
  const stats = shipStats(ship);
  const system = state.systems[ship.systemId];
  const faction = factionView(state, system?.factionId ?? null);
  const latest = state.news[0];

  /** Bottom dock: the four screens used every minute, everything else lives behind "ЕЩЁ". */
  const dock: { id: TabId; label: string; hint: string }[] = [
    { id: 'system', label: 'СИСТЕМА', hint: `пояса ${system?.belts.length ?? 0}` },
    { id: 'market', label: 'РЫНОК', hint: atMarket(state) ? 'открыт' : 'закрыт' },
    { id: 'cargo', label: 'ГРУЗ', hint: `трюм ${num(cargoUsed(ship))}/${num(stats.cargo)}` },
    { id: 'ship', label: 'КОРАБЛЬ', hint: `топл ${Math.round(ship.fuel)}` },
  ];
  const sheetClass = ['panelcol'];
  if (sheetOpen) sheetClass.push('open');
  if (menuOpen) sheetClass.push('menu-mode');
  const sheetTitle = menuOpen ? 'РАЗДЕЛЫ' : TABS.find((entry) => entry.id === tab)?.label ?? '';

  /** Прыжок: топливо уходит сразу, дальше карта сама ведёт корабль по трассе. */
  const performJump = (id: string): void => {
    game.act((draft) => {
      travelTo(draft, id);
    });
    setSelectedId(null);
  };

  /** С подтверждением или сразу — решает настройка «подтверждать прыжок». */
  const requestJump = (id: string): void => {
    if (settings.confirmJump) {
      setJumpTarget(id);
      return;
    }
    performJump(id);
  };

  return (
    <div className={paused ? 'app paused' : 'app'}>
      <header ref={hudRef} className={hudOpen ? 'topbar hud-open' : 'topbar'}>
        <div className="brand">
          FRONTIER
          <small>
            {state.player.name} · ключ {state.seed.slice(0, 10)}
          </small>
        </div>
        <button
          type="button"
          className={paused ? 'pause-btn on' : 'pause-btn'}
          aria-pressed={paused}
          title={paused ? 'Продолжить: мир снова идёт' : 'Пауза: остановить время, перелёты и стройку'}
          onClick={game.togglePause}
        >
          {paused ? '▶' : '❚❚'}
        </button>
        <button
          type="button"
          className="hud-toggle"
          aria-expanded={hudOpen}
          title="Показать все показатели"
          onClick={() => setHudOpen((prev) => !prev)}
        >
          <span className="hud-line">
            {paused ? <b className="warn">ПАУЗА · </b> : null}
            <b>{cr(state.player.credits)}</b> · день {formatGameTime(state)} · топл{' '}
            {Math.round(ship.fuel)} · корпус {Math.round(ship.hull)}
          </span>
          <span className="hud-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className="topstats">
          <div className="tstat">
            <b>{cr(state.player.credits)}</b>
            <span>КРЕДИТЫ</span>
          </div>
          <div className="tstat">
            <b>{formatGameTime(state)}</b>
            <span>ДЕНЬ</span>
          </div>
          <div className="tstat">
            <b>{system?.name ?? '?'}</b>
            <span>{faction.short} · {archetypeLabel(system?.archetype)}</span>
          </div>
          <div className="tstat">
            <b>
              {ship.name} <span className="dim">{STATUS_LABEL[ship.status]}</span>
            </b>
            <span>
              топл {Math.round(ship.fuel)} · корпус {Math.round(ship.hull)} · трюм {num(cargoUsed(ship))}/
              {num(stats.cargo)}
            </span>
          </div>
        </div>

        <JumpBar state={state} paused={paused} onCancel={() => game.act((draft) => cancelTravel(draft))} />
      </header>

      <div className="main">
        <div className="mapside">
          <GalaxyMap
            state={state}
            selectedId={selectedId}
            animations={settings.animations}
            onSelect={setSelectedId}
            onJump={requestJump}
          />
        </div>

        <div className={sheetClass.join(' ')}>
          <div className="sheet-head">
            <b>{sheetTitle}</b>
            <button type="button" className="sheet-close" onClick={closeSheet} aria-label="Закрыть раздел">
              ✕
            </button>
          </div>
          <nav className="tabs">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === tab ? 'tab active' : 'tab'}
                title={entry.title}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="sidescroll">
            {tab === 'station' ? <StationPanel state={state} run={game.act} /> : null}
            {tab === 'system' ? <SystemPanel state={state} run={game.act} onJump={requestJump} /> : null}
            {tab === 'explore' ? <ExplorePanel state={state} run={game.act} /> : null}
            {tab === 'cargo' ? <CargoPanel state={state} run={game.act} /> : null}
            {tab === 'market' ? <MarketPanel state={state} run={game.act} /> : null}
            {tab === 'ship' ? <ShipPanel state={state} run={game.act} /> : null}
            {tab === 'fleet' ? <FleetPanel state={state} run={game.act} /> : null}
            {tab === 'contracts' ? <ContractsPanel state={state} run={game.act} /> : null}
            {tab === 'news' ? <NewsPanel state={state} onGoTo={openSection} /> : null}
            {tab === 'settings' ? (
              <SettingsPanel
                state={state}
                settings={settings}
                paused={paused}
                onTogglePause={game.togglePause}
                onChange={game.updateSettings}
                onReset={game.resetSettings}
                onSave={game.save}
              />
            ) : null}
          </div>
          {menuOpen ? (
            <div className="sheet-menu">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === tab ? 'sheet-tile active' : 'sheet-tile'}
                  onClick={() => openSection(entry.id)}
                >
                  <b>{entry.label}</b>
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <footer className="newsbar">
        <b>ЛЕНТА</b>
        {atMarket(state) ? <Tag color="#41f0c1">РЫНОК ОТКРЫТ</Tag> : null}
        <span className="newsbar-text">{latest ? latest.text : 'Тихий день на фронтире.'}</span>
        <span className="dim">день {gameDay(state).toFixed(2)}</span>
        <button
          type="button"
          className="newsbar-open"
          onClick={() => openSection('news')}
          aria-label="Открыть ленту событий"
        />
      </footer>

      {sheetOpen ? <div className="sheet-backdrop" onClick={closeSheet} /> : null}

      <nav className="dock">
        {dock.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={sheetOpen && !menuOpen && tab === entry.id ? 'dock-btn active' : 'dock-btn'}
            onClick={() => toggleSection(entry.id)}
          >
            <b>{entry.label}</b>
            <span>{entry.hint}</span>
          </button>
        ))}
        <button
          type="button"
          className={sheetOpen && menuOpen ? 'dock-btn menu active' : 'dock-btn menu'}
          onClick={toggleMenu}
        >
          <b>ЕЩЁ</b>
          <span>разделы</span>
        </button>
      </nav>

      {settings.toasts ? <Toaster state={state} /> : null}
      <EventModal state={state} onChoose={game.resolveEvent} />
      {jumpTarget ? (
        <JumpConfirm
          state={state}
          targetId={jumpTarget}
          onConfirm={() => {
            const id = jumpTarget;
            setJumpTarget(null);
            performJump(id);
          }}
          onCancel={() => setJumpTarget(null)}
        />
      ) : null}
    </div>
  );
}
