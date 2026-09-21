import type { GameState } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { gameDay } from '../../game/news/news.ts';
import { factionView } from '../../game/factions/reputation.ts';
import { totalSlots } from '../../game/data/buildings.ts';
import { slotsUsed, storageCapacity, storageUsed } from '../../game/sim/station.ts';
import { fleetCap } from '../../game/sim/fleet.ts';
import { moduleOffers, shipyardHere } from '../../game/actions/outfitting.ts';
import { stationPhase, chosenSite, siteCandidates } from '../../game/site/site.ts';
import { foundationState } from '../../game/actions/site.ts';
import { cr, newsTag, num } from '../format.ts';
import { Btn, Hint, Panel, Row, Tag } from '../kit.tsx';

/** Feed, stats and the "what now" nudges that keep the sandbox readable. */

export type TabId =
  | 'system'
  | 'explore'
  | 'cargo'
  | 'market'
  | 'ship'
  | 'station'
  | 'fleet'
  | 'contracts'
  | 'news'
  | 'settings';

export function NewsPanel({
  state,
  onGoTo,
}: {
  state: GameState;
  onGoTo: (tab: TabId) => void;
}) {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  const market = system?.stations.find((station) => station.hasMarket);
  const phase = stationPhase(state);
  const site = chosenSite(state);

  // --- next steps ---------------------------------------------------------
  const nextUpgrade = ship
    ? moduleOffers(state, ship)
        .filter((offer) => !offer.owned && !offer.locked)
        .sort((a, b) => a.cost - b.cost)[0]
    : undefined;
  const yard = ship ? shipyardHere(state, ship) : null;
  const storageRatio = storageUsed(state.station) / Math.max(1, storageCapacity(state.station));
  const slotsFree = totalSlots(state.station.level) - slotsUsed(state.station);
  const fleetFree = fleetCap(state) - state.ships.length;
  const suggestions: { text: string; tab: TabId; label: string }[] = [];

  // Воронка станции идёт первой: пока база не введена в строй, остальные советы
  // бессмысленны.
  if (phase === 'planned') {
    if (!site) {
      const candidates = siteCandidates(state);
      suggestions.push({
        text: 'Участка нет: найдите ничью систему, просканируйте её и выберите планету с твёрдой корой.',
        tab: 'station',
        label: 'УЧАСТОК',
      });
      if (candidates.length === 0) {
        suggestions.push({
          text: 'Ничьих систем на карте не видно — расширьте карту сканером.',
          tab: 'explore',
          label: 'РАЗВЕДКА',
        });
      }
    } else {
      const info = foundationState(state);
      suggestions.push({
        text: info.ok
          ? `Всё готово для закладки склада у ${site.planet.name}.`
          : info.reasons[0] ?? 'Закладка пока невозможна.',
        tab: 'station',
        label: 'ЗАЛОЖИТЬ',
      });
    }
  }
  if (phase === 'foundation') {
    suggestions.push({
      text: 'Базовая станция ещё не введена в строй: привезите металл и электронику на склад и постройте КЦ Mk1.',
      tab: 'station',
      label: 'СТРОЙКА',
    });
  }
  if (state.survey) {
    suggestions.push({
      text: 'Сканер работает: прогресс и прерывание — во вкладке разведки.',
      tab: 'explore',
      label: 'РАЗВЕДКА',
    });
  }
  if (ship && ship.mission?.kind === 'mine') {
    suggestions.push({
      text: 'Идёт вахта в поясе: план, прогресс и остановка — во вкладке СИСТЕМА.',
      tab: 'system',
      label: 'ДОБЫЧА',
    });
  }
  if (!market)
    suggestions.push({
      text: 'Здесь нет рынка — прыгните в систему с торговой станцией.',
      tab: 'system',
      label: 'ПРЫЖКИ',
    });
  if (storageRatio > 0.85)
    suggestions.push({
      text: 'Склад станции почти полон: постройте ещё склад или запустите переработку.',
      tab: 'station',
      label: 'СТАНЦИЯ',
    });
  if (state.station.buildings.refinery > 0 && state.station.production.length === 0)
    suggestions.push({
      text: 'Переработка простаивает — запустите партию, чтобы превратить руду в металл.',
      tab: 'station',
      label: 'ПЕРЕРАБОТКА',
    });
  if (phase === 'operational' && slotsFree <= 1)
    suggestions.push({
      text: 'Остался один слот под постройку: уровень командного центра добавит ещё два.',
      tab: 'station',
      label: 'УЛУЧШИТЬ',
    });
  if (fleetFree > 0 && state.ships.length < 3)
    suggestions.push({
      text: `Свободно мест во флоте: ${fleetFree} — второй корпус сам будет добывать или торговать.`,
      tab: 'ship',
      label: 'ВЕРФЬ',
    });
  if (ship && ship.fuel < 25)
    suggestions.push({
      text: 'Мало топлива — заправьтесь на станции или запустите рецепт топлива.',
      tab: 'ship',
      label: 'СЛУЖБЫ',
    });
  if (nextUpgrade)
    suggestions.push({
      text: `«${nextUpgrade.name}» — следующее улучшение (${cr(nextUpgrade.cost)}) на «${yard?.label ?? 'верфи'}».`,
      tab: 'ship',
      label: 'МОДУЛИ',
    });
  if (ship && yard && yard.tier <= 0)
    suggestions.push({
      text:
        yard.blockedReason ??
        'Верфь ставит модули: у фракций она в узловых системах, свою можно построить на базе.',
      tab: 'ship',
      label: 'ВЕРФЬ',
    });


  return (
    <>
      <Panel title="Что делать дальше" tight>
        {suggestions.length === 0 ? (
          <Hint>Всё работает. Выбирайте трассу, контракт или корпус побольше.</Hint>
        ) : (
          suggestions.slice(0, 5).map((tip, index) => (
            <div className="list-row" key={index}>
              <div className="list-main">
                <span className="dim">{tip.text}</span>
              </div>
              <Btn size="tiny" onClick={() => onGoTo(tip.tab)}>
                {tip.label}
              </Btn>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Карьера" tight>
        <Row label="День" value={gameDay(state).toFixed(2)} />
        <Row label="Кредиты" value={cr(state.player.credits)} />
        <Row
          label="Прыжков / сделок"
          value={`${num(state.player.stats.jumps)} / ${num(state.player.stats.trades)}`}
        />
        <Row label="Добыто единиц" value={num(state.player.stats.mined)} />
        <Row label="Заработано" value={cr(state.player.stats.earned)} />
        <Row label="Построек завершено" value={num(state.player.stats.built)} />
        <Row label="Контрактов выполнено" value={num(state.player.stats.contracts)} />
        <Row label="На складе" value={`${num(storageUsed(state.station))} ед.`} />
        {state.factionIds.map((id) => {
          const faction = factionView(state, id);
          return (
            <Row key={id} label={faction.name} value={<Tag color={faction.color}>{state.player.reputation[id] ?? 0}</Tag>} />
          );
        })}
      </Panel>

      <Panel title="Лента" tight>
        {state.news.length === 0 ? (
          <Hint>Сегодня сигналов пока нет.</Hint>
        ) : (
          state.news.slice(0, 24).map((item) => (
            <div className="list-row" key={item.id}>
              <div className="list-main">
                <span>{item.text}</span>
                <span className="dim">
                  день {item.day.toFixed(2)} · {newsTag(item.tag)}
                  {item.systemId ? ` · ${state.systems[item.systemId]?.name ?? item.systemId}` : ''}
                </span>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
