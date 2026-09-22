import { useEffect, useRef, useState } from 'react';
import { useGame } from './game/state/store.ts';
import { playerShip } from './game/state/create.ts';
import { formatGameTime, gameDay } from './game/news/news.ts';
import { archetypeLabel } from './game/universe/generate.ts';
import { factionView } from './game/factions/reputation.ts';
import { cargoUsed, shipStats } from './game/ships/ship.ts';
import { travelTo, cancelTravel } from './game/actions/nav.ts';
import { atMarket } from './game/actions/trade.ts';
import { SystemPanel } from './ui/panels/SystemPanel.tsx';
import { ResearchPanel } from './ui/panels/ResearchPanel.tsx';
import { ResourcesPanel } from './ui/panels/ResourcesPanel.tsx';
import { StationServices } from './ui/panels/StationServices.tsx';
import { StationPanel } from './ui/panels/StationPanel.tsx';
import { SiteSetup } from './ui/panels/SiteSetup.tsx';
import { CargoPanel } from './ui/panels/CargoPanel.tsx';
import { MarketPanel } from './ui/panels/MarketPanel.tsx';
import { StoragePanel } from './ui/panels/StoragePanel.tsx';
import { ShipPanel } from './ui/panels/ShipPanel.tsx';
import { ShipyardPanel } from './ui/panels/ShipyardPanel.tsx';
import { FleetPanel } from './ui/panels/FleetPanel.tsx';
import { ContractsPanel } from './ui/panels/ContractsPanel.tsx';
import { NewsPanel } from './ui/panels/NewsPanel.tsx';
import { SettingsPanel } from './ui/panels/SettingsPanel.tsx';
import { GalaxyMap } from './ui/GalaxyMap.tsx';
import { EventModal } from './ui/EventModal.tsx';
import { CombatScreen } from './ui/CombatScreen.tsx';
import { JumpBar } from './ui/JumpBar.tsx';
import { JumpConfirm } from './ui/JumpConfirm.tsx';
import { Toaster } from './ui/Toaster.tsx';
import { MainMenu } from './ui/MainMenu.tsx';
import { STATUS_LABEL, cr, num } from './ui/format.ts';
import { Btn, Tag } from './ui/kit.tsx';
import { TABS, tabDef, screenTitle } from './ui/nav.ts';
import type { Destination, Screen, TabId } from './ui/nav.ts';
import { isAndroidShell, onShellBack } from './platform/android.ts';
import type { Encounter } from './game/types.ts';

/**
 * Оболочка игры: интро, HUD, карта, нижний док на шесть разделов и лист с
 * содержимым. Док — это только кнопки разделов: закрытый лист целиком уезжает
 * под экран, поэтому кнопки всегда видны и нажимаются. Внутри раздела живёт стек
 * подэкранов (станция, рынок, верфь, склад, исследование, ресурсы): «назад»
 * возвращает на шаг, а на пустом экране отдаёт управление оболочке Android — она
 * закрывает приложение двойным тапом.
 */

export function App() {
  const game = useGame();
  const settings = game.settings;
  const paused = game.paused;
  const [tab, setTab] = useState<TabId>('system');
  /** Подэкраны поверх раздела: последний — то, что видно на экране. */
  const [screens, setScreens] = useState<Screen[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);
  /** Прыжок, ждущий подтверждения (настройка «подтверждать прыжок»). */
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  /** Противник, с которым идёт бой на радаре: экран заменяет окно события. */
  const [battleWith, setBattleWith] = useState<Encounter | null>(null);
  const hudRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);

  const screen = screens.length > 0 ? screens[screens.length - 1] : null;

  /** Открывает раздел «с нуля»: подэкраны сбрасываются. */
  const openTab = (id: TabId): void => {
    setTab(id);
    setScreens([]);
    setSheetOpen(true);
  };

  /** Тап по активной вкладке закрывает лист, по другой — переключает раздел. */
  const toggleTab = (id: TabId): void => {
    if (sheetOpen && id === tab && screens.length === 0) {
      setSheetOpen(false);
      return;
    }
    openTab(id);
  };

  /** Закрыть лист целиком: подэкраны сбрасываются, чтобы «назад» не молчало. */
  const closeSheet = (): void => {
    setSheetOpen(false);
    setScreens([]);
  };

  /** Вход в подэкран: он ложится на стек, «назад» снимает верхний. */
  const openScreen = (next: Screen): void => {
    setScreens((prev) => [...prev, next]);
    setSheetOpen(true);
  };

  /** Переход по подсказке из ленты: сразу на нужный раздел и экран. */
  const goTo = (dest: Destination): void => {
    setTab(dest.tab);
    setScreens(dest.screen ? [dest.screen] : []);
    setSheetOpen(true);
  };

  /**
   * Один шаг назад. Порядок: подтверждение прыжка → подэкран → лист → выделение на
   * карте. Если ничего не открыто, возвращаем false — тогда Android-оболочка
   * закроет приложение (она ждёт второго нажатия за две секунды).
   */
  const goBack = (): boolean => {
    if (battleWith) {
      // Бой решает исход события: свернуть его нельзя, только доиграть.
      return true;
    }
    if (jumpTarget) {
      setJumpTarget(null);
      return true;
    }
    if (screens.length > 0) {
      setScreens((prev) => prev.slice(0, -1));
      return true;
    }
    if (sheetOpen) {
      setSheetOpen(false);
      return true;
    }
    if (selectedId) {
      setSelectedId(null);
      return true;
    }
    return false;
  };

  const state = game.state;

  // Esc — это «назад» для десктопа: он закрывает подэкран, потом лист, потом
  // снимает выделение на карте. Цифры 1..6 переключают разделы, «P» — пауза.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Пока игрок печатает (имя корабля, ключ галактики), горячие клавиши молчат.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'Escape') {
        if (jumpTarget) {
          setJumpTarget(null);
          return;
        }
        goBack();
        return;
      }
      if (event.key >= '1' && event.key <= String(TABS.length)) openTab(TABS[Number(event.key) - 1].id);
      if (event.key === 'p' || event.key === 'P' || event.key === 'з') game.togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screens, sheetOpen, selectedId, jumpTarget, battleWith, game.togglePause]);

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

  // Высота дока меряется так же, как HUD: лист, затемнение, лента и всплывающие
  // сообщения отсчитываются от --dock-h, поэтому кнопки разделов никогда не
  // оказываются под панелью — даже с системной навигацией телефона.
  useEffect(() => {
    const node = dockRef.current;
    const root = document.documentElement;
    if (!node) {
      root.style.removeProperty('--dock-h');
      return;
    }
    const apply = (): void => {
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty('--dock-h', `${height}px`);
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
      root.style.removeProperty('--dock-h');
    };
  }, [hasGame]);

  // Android shell: it asks the game to save before reloading into a new bundle.
  useEffect(() => {
    if (!isAndroidShell()) return;
    window.__frontierFlush = () => game.save();
    return () => {
      window.__frontierFlush = undefined;
    };
  }, [game.save]);

  // Аппаратная кнопка «назад»: сначала закрываем свои экраны, в самом конце
  // разрешаем оболочке обработать нажатие (двойной тап — выход).
  useEffect(() => {
    if (!isAndroidShell()) return;
    return onShellBack(() => goBack());
  }, [screens, sheetOpen, selectedId, jumpTarget, battleWith]);

  if (!state) {
    return (
      <MainMenu
        slots={game.slots}
        offlineReport={game.offlineReport}
        onPlay={game.continueGame}
        onCreate={game.newGame}
        onDelete={game.deleteSlot}
      />
    );
  }

  const ship = playerShip(state);
  const stats = shipStats(ship);
  const system = state.systems[ship.systemId];
  const faction = factionView(state, system?.factionId ?? null);
  const latest = state.news[0];
  const sheetClass = ['panelcol'];
  if (sheetOpen) sheetClass.push('open');
  if (screen) sheetClass.push('subscreen');
  const sheetTitle = screen ? screenTitle(state, screen) : tabDef(tab).title;


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

  /**
   * Выбор в окне события. «В бой» уходит на радар: бой ведёт игрок, а решение по
   * событию закрывается уже после боя — с готовым результатом мини-игры.
   */
  const chooseEvent = (choiceId: string): void => {
    const pending = state.pendingEvent;
    const foe = pending?.payload.enemy;
    if (choiceId === 'fight' && pending?.eventId === 'pirate_encounter' && foe) {
      setBattleWith(foe);
      return;
    }
    game.resolveEvent(choiceId);
  };

  /** Содержимое текущего раздела: либо корень вкладки, либо верхний подэкран. */
  const renderBody = () => {
    if (screen) {
      switch (screen.id) {
        case 'research':
          return <ResearchPanel state={state} run={game.act} onOpen={openScreen} />;
        case 'resources':
          return <ResourcesPanel state={state} run={game.act} onOpen={openScreen} />;
        case 'stations':
        case 'station':
          return (
            <StationServices state={state} run={game.act} stationId={screen.stationId} onOpen={openScreen} />
          );
        case 'base':
          return <StationPanel state={state} run={game.act} />;
        case 'site':
          return <SiteSetup state={state} run={game.act} />;
        case 'market':
          return <MarketPanel state={state} run={game.act} />;
        case 'storage':
          return <StoragePanel state={state} run={game.act} onOpen={openScreen} />;
        case 'shipyard':
          return <ShipyardPanel state={state} run={game.act} />;
        case 'contracts':
          return <ContractsPanel state={state} run={game.act} />;
        default:
          return null;
      }
    }
    switch (tab) {
      case 'system':
        return <SystemPanel state={state} run={game.act} onJump={requestJump} onOpen={openScreen} />;
      case 'cargo':
        return <CargoPanel state={state} run={game.act} onOpen={openScreen} />;
      case 'ship':
        return <ShipPanel state={state} run={game.act} onOpen={openScreen} />;
      case 'fleet':
        return <FleetPanel state={state} run={game.act} />;
      case 'news':
        return <NewsPanel state={state} onGoTo={goTo} />;
      case 'settings':
        return (
          <SettingsPanel
            state={state}
            settings={settings}
            paused={paused}
            onTogglePause={game.togglePause}
            onChange={game.updateSettings}
            onReset={game.resetSettings}
            onSave={game.save}
            onMenu={game.backToMenu}
          />
        );
      default:
        return null;
    }
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
            <b>{cr(state.player.credits)}</b> · день {formatGameTime(state)} · топл {Math.round(ship.fuel)} · корпус{' '}
            {Math.round(ship.hull)}
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
            <span>
              {faction.short} · {archetypeLabel(system?.archetype)}
            </span>
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

        {/* Офлайн-прогон: доклад висит в HUD, пока игрок его не закроет. */}
        {game.offlineReport ? (
          <div className="warn hud-warn">
            <span>{game.offlineReport}</span>
            <Btn size="tiny" onClick={game.dismissOfflineReport}>
              ОК
            </Btn>
          </div>
        ) : null}
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
            {screen ? (
              <button type="button" className="sheet-back" onClick={() => goBack()} aria-label="Назад">
                ←
              </button>
            ) : null}
            <div className="sheet-title">
              <b>{sheetTitle}</b>
              {screen ? <span className="dim">{tabDef(tab).label}</span> : null}
            </div>
            <button
              type="button"
              className="sheet-close"
              onClick={closeSheet}
              aria-label="Закрыть раздел"
            >
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
                onClick={() => openTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="sidescroll">{renderBody()}</div>
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
          onClick={() => openTab('news')}
          aria-label="Открыть ленту событий"
        />
      </footer>

      {sheetOpen ? <div className="sheet-backdrop" onClick={closeSheet} /> : null}

      <nav className="dock" ref={dockRef}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={sheetOpen && tab === entry.id ? 'dock-btn active' : 'dock-btn'}
            title={entry.title}
            aria-label={entry.title}
            onClick={() => toggleTab(entry.id)}
          >
            <b>{entry.label}</b>
          </button>
        ))}
      </nav>

      {settings.toasts ? <Toaster state={state} /> : null}
      {battleWith ? (
        <CombatScreen
          ship={ship}
          enemy={battleWith}
          onFinish={(result) => {
            setBattleWith(null);
            game.resolveEvent('fight', result);
          }}
        />
      ) : (
        <EventModal state={state} onChoose={chooseEvent} />
      )}
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
