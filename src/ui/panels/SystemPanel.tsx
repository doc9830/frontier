import type { GameState } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { factionView, reputationOf } from '../../game/factions/reputation.ts';
import { cancelTravel, jumpPlan, travelTo } from '../../game/actions/nav.ts';
import { currentHop, travelProgress } from '../../game/sim/travel.ts';
import { archetypeLabel } from '../../game/universe/generate.ts';
import { resource } from '../../game/data/resources.ts';
import { planetKindOf, PLANET_BONUS_LABEL } from '../../game/data/planets.ts';
import { SERVICE_INFO, dockedStations, stationTypeLabel } from '../../game/data/stations.ts';
import type { StationService } from '../../game/data/stations.ts';
import { stationPhaseLabel } from '../../game/site/site.ts';
import { miningStatus } from '../../game/sim/mining.ts';
import { duration, num, pct, riskText, threatColor } from '../format.ts';
import { hops } from '../../game/plural.ts';
import { Btn, Hint, Hub, Meter, Panel, Progress, Row, Tag, Tile } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Раздел «Система» — главный хаб: описание системы, планеты, станции, входы в
 * исследование и добычу и список соседей для прыжка. Всё, что раньше жило в
 * отдельных вкладках (разведка, рынок, верфь), открывается отсюда подэкранами.
 */

export function SystemPanel({
  state,
  run,
  onJump,
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  /** Оболочка может перехватить прыжок (подтверждение из настроек). */
  onJump?: (id: string) => void;
  /** Открыть подэкран внутри раздела. */
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!ship || !system) return null;

  const faction = factionView(state, system.factionId);
  const status = miningStatus(state, ship);
  const beltsKnown = system.belts.filter((belt) => belt.discovered).length;
  const stationsHere = dockedStations(state, ship.systemId);
  const ownRecord = stationsHere.find((entry) => entry.own) ?? null;

  return (
    <>
      <Panel title={`Система · ${system.name}`} actions={<Tag color={faction.color}>{faction.name}</Tag>}>
        <div className="grid2">
          <Row label="Класс звезды" value={system.starClass} />
          <Row label="Тип системы" value={archetypeLabel(system.archetype)} />
          <Row label="Безопасность" value={pct(system.security)} />
          <Row label="Население" value={`${(system.population / 1_000_000).toFixed(1)} млн`} />
          <Row label="Ваша репутация" value={reputationOf(state, system.factionId)} />
          <Row label="Пояса" value={`нанесено на карты ${beltsKnown} из ${system.belts.length}`} />
        </div>
        <Hint>
          Производит: {system.produces.map((id) => resource(id).symbol).join(' ') || '—'} · потребляет:{' '}
          {system.consumes.map((id) => resource(id).symbol).join(' ') || '—'}
        </Hint>
        <Hub>
          <Tile
            label="ИССЛЕДОВАНИЕ"
            hint={
              system.scanned
                ? beltsKnown >= system.belts.length
                  ? 'система изучена'
                  : `не изучено поясов: ${system.belts.length - beltsKnown}`
                : 'нужен полный скан'
            }
            onClick={() => onOpen({ id: 'research' })}
          />
          <Tile
            label="РЕСУРСЫ"
            hint={
              system.belts.length === 0
                ? 'поясов нет'
                : `поясов изучено: ${beltsKnown} из ${system.belts.length}`
            }
            tone={system.belts.length > 0 && beltsKnown > 0 ? 'primary' : undefined}
            note={status ? 'идёт вахта' : undefined}
            onClick={() => onOpen({ id: 'resources' })}
          />
          <Tile
            label="СТАНЦИИ"
            hint={stationsHere.length > 0 ? `в системе: ${stationsHere.length}` : 'станций нет'}
            onClick={() => onOpen({ id: 'stations' })}
          />
        </Hub>
      </Panel>


      {ship.travel ? (
        <Panel title="Идёт перелёт">
          <Meter
            label={`Прыжок к ${state.systems[ship.travel.path[ship.travel.path.length - 1]]?.name ?? '?'}`}
            value={travelProgress(state, ship)}
            max={1}
            suffix={` ${pct(travelProgress(state, ship))}`}
          />
          <Row label="Прибытие через" value={duration(Math.max(0, ship.travel.arriveAt - state.gameTime))} />
          <Row label="Следующий переход" value={currentHop(state, ship)?.name ?? '—'} />
          <Row label="Топливо в прыжке" value={num(ship.travel.fuel)} />
          <div className="row-actions">
            <Btn kind="bad" size="small" onClick={() => run((draft) => cancelTravel(draft))}>
              ПРЕРВАТЬ ПРЫЖОК
            </Btn>
          </div>
        </Panel>
      ) : null}

      {status && ship.status === 'mining' ? (
        <Panel title="Вахта идёт" actions={<Tag color="#41f0c1">{pct(status.progress)}</Tag>}>
          <Progress
            label={status.belt.name}
            fraction={status.phase === 'approach' ? status.approachProgress : status.pieceProgress}
            color="#ffd166"
            right={status.phase === 'approach' ? 'подход к поясу' : `заход ${num(status.piece)}`}
          />
          <div className="row-actions">
            <Btn size="small" kind="primary" onClick={() => onOpen({ id: 'resources' })}>
              ОТКРЫТЬ ДОБЫЧУ
            </Btn>
          </div>
        </Panel>
      ) : null}

      <Panel title="Ваша станция" tight>
        {ownRecord ? (
          <div className="list-row col">
            <div className="list-main">
              <b>
                {ownRecord.station.name}{' '}
                <span className="dim">· {stationPhaseLabel(state.station.phase)}</span>
              </b>
              <span className="dim">
                КЦ Mk {state.station.level} · услуги:{' '}
                {(Object.keys(ownRecord.services) as StationService[])
                  .filter((service) => ownRecord.services[service])
                  .map((service) => SERVICE_INFO[service].short)
                  .join(' ') || 'пока нет'}
              </span>
              <span className="dim">{ownRecord.reason ?? 'Ваша база в этой системе: склад и доки под рукой.'}</span>
            </div>
            <div className="row-actions">
              <Btn size="small" kind="primary" onClick={() => onOpen({ id: 'base' })}>
                УПРАВЛЕНИЕ БАЗОЙ
              </Btn>
            </div>
          </div>
        ) : (
          <>
            <Hint>
              {state.station.phase === 'planned'
                ? 'Своей станции ещё нет: выберите ничью отсканированную систему и заложите склад.'
                : `Ваша база стоит в системе ${
                    state.systems[state.station.systemId]?.name ?? '—'
                  } — управление и стройка доступны отсюда.`}
            </Hint>
            <div className="row-actions">
              <Btn size="small" kind="primary" onClick={() => onOpen({ id: 'site' })}>
                {state.station.phase === 'planned' ? 'СТРОИТЕЛЬСТВО СТАНЦИИ' : 'УЧАСТОК И ЗАКЛАДКА'}
              </Btn>
              {state.station.phase !== 'planned' ? (
                <Btn size="small" onClick={() => onOpen({ id: 'base' })}>
                  УПРАВЛЕНИЕ БАЗОЙ
                </Btn>
              ) : null}
            </div>
          </>
        )}
      </Panel>


      <Panel title="Станции системы" tight>
        {stationsHere.length === 0 ? (
          <Hint>В этой системе станций нет: только космос и вы.</Hint>
        ) : (
          stationsHere.map((entry) => (
            <div className="list-row col" key={entry.station.id}>
              <div className="list-main">
                <b>
                  {entry.station.name}
                  {entry.own ? <span className="dim"> · ваша база</span> : null}
                </b>
                <span className="dim">
                  {entry.own ? 'частная станция' : stationTypeLabel(entry.station.type)} ·{' '}
                  {entry.station.factionId
                    ? state.factions[entry.station.factionId]?.short ?? entry.station.factionId
                    : entry.own
                      ? 'частное владение'
                      : 'безвластие'}{' '}
                  · услуги:{' '}
                  {(Object.keys(entry.services) as StationService[])
                    .filter((service) => entry.services[service])
                    .map((service) => SERVICE_INFO[service].short)
                    .join(' ') || 'нет'}
                </span>
                {entry.reason ? <span className="dim">{entry.reason}</span> : null}
              </div>
              <div className="row-actions">
                <Btn
                  size="small"
                  kind="primary"
                  disabled={!!ship.travel}
                  title={ship.travel ? 'Сначала завершите перелёт' : 'Открыть меню станции'}
                  onClick={() => onOpen({ id: 'station', stationId: entry.station.id })}
                >
                  СТАНЦИЯ
                </Btn>
              </div>
            </div>
          ))
        )}
        <Hint>
          Меню станции — это её услуги: рынок, контракты, верфь, склад. Своя база открывается там же.
        </Hint>
      </Panel>

      <Panel title="Планеты" tight>
        {!system.scanned ? (
          <Hint>Планеты не нанесены на карты: проведите полный скан в разделе «Исследование».</Hint>
        ) : (
          system.planets.map((planet) => {
            const kind = planetKindOf(planet);
            return (
              <div className="list-row" key={planet.id}>
                <div className="list-main">
                  <b>{planet.name}</b>
                  <span className="dim">
                    {kind.label} · {kind.buildable ? 'годится под станцию' : 'закладка невозможна'} ·{' '}
                    {kind.bonus
                      ? `+${Math.round(kind.bonusValue * 100)} % ${PLANET_BONUS_LABEL[kind.bonus]}`
                      : 'без бонуса'}
                  </span>
                  <span className="dim">
                    {planet.population > 0 ? `${num(planet.population)} жителей` : 'необитаема'} ·{' '}
                    {pct(kind.habitability)} пригодности
                  </span>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel title="Куда можно прыгнуть" tight>
        {system.connections
          .map((id) => state.systems[id])
          .filter((target) => !!target?.discovered)
          .map((target) => {
            const plan = jumpPlan(state, target.id);
            const affordable = !!plan && ship.fuel >= plan.fuel;
            const blocked =
              !plan || !affordable || !!ship.travel || ship.status === 'mining' || ship.status === 'survey';
            return (
              <div className="list-row" key={target.id}>
                <div className="list-main">
                  <b>{target.name}</b>
                  <span className="dim">
                    {plan ? `${hops(plan.hops)} · ${duration(plan.seconds)} · ${plan.fuel} топл. · ` : ''}
                    <span style={{ color: plan ? threatColor(plan.risk) : '#6d8a92' }}>
                      {plan ? riskText(plan.risk) : 'маршрут неизвестен'}
                    </span>
                  </span>
                </div>
                <Btn
                  size="small"
                  kind={affordable ? 'primary' : undefined}
                  disabled={blocked}
                  title={
                    !plan
                      ? 'Маршрут неизвестен'
                      : !affordable
                        ? 'Не хватает топлива'
                        : 'Лететь в эту систему'
                  }
                  onClick={() => (onJump ? onJump(target.id) : run((draft) => travelTo(draft, target.id)))}
                >
                  ПРЫЖОК
                </Btn>
              </div>
            );
          })}
        {system.connections.length === 0 ? <Hint>Тупик: на сканере нет ни одной трассы.</Hint> : null}
      </Panel>
    </>
  );
}
