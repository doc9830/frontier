import { useEffect, useState } from 'react';
import type { AsteroidBelt, GameState, ResourceId, Ship } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { factionView, reputationOf } from '../../game/factions/reputation.ts';
import { cancelTravel, jumpPlan, travelTo } from '../../game/actions/nav.ts';
import {
  MINING_CYCLE_SECONDS,
  amountsSummary,
  miningBonus,
  miningCapacity,
  miningStatus,
  miningYieldPerCycle,
  planFromTotal,
  startMining,
  stopMining,
  sumAmounts,
} from '../../game/sim/mining.ts';
import { currentHop, travelProgress } from '../../game/sim/travel.ts';
import { archetypeLabel } from '../../game/universe/generate.ts';
import { resource } from '../../game/data/resources.ts';
import { beltReserve, beltWear, MIN_BELT_RESERVE } from '../../game/data/belts.ts';
import { SERVICE_INFO, dockedStations } from '../../game/data/stations.ts';
import type { StationService } from '../../game/data/stations.ts';
import { stationPhase, stationPhaseLabel } from '../../game/site/site.ts';
import { shipStats } from '../../game/ships/ship.ts';
import { amountsText, duration, num, pct, riskText, threatColor } from '../format.ts';
import { hops } from '../../game/plural.ts';
import { Btn, Hint, Meter, Panel, Progress, Row, Stepper, Tag } from '../kit.tsx';

/** Everything that concerns the system you are parked in, plus the jump board. */

const STATION_TYPE_LABEL: Record<string, string> = {
  trade: 'торговая станция',
  industrial: 'промышленная станция',
  mining: 'добывающая станция',
  military: 'военная станция',
  research: 'научная станция',
  pirate: 'пиратская станция',
};

export function stationTypeLabel(type: string): string {
  return STATION_TYPE_LABEL[type] ?? type;
}

export function SystemPanel({
  state,
  run,
  onJump,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  /** Оболочка может перехватить прыжок (подтверждение из настроек). */
  onJump?: (id: string) => void;
}) {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!ship || !system) return null;

  const faction = factionView(state, system.factionId);
  const market = system.stations.find((station) => station.hasMarket);
  const liveShip = (draft: GameState): Ship => draft.ships.find((s) => s.id === ship.id) as Ship;
  const status = miningStatus(state, ship);
  const busy = !!ship.travel || ship.status === 'mining' || ship.status === 'survey';
  const freeHold = shipStats(ship).cargo - Object.values(ship.cargo).reduce((sum, qty) => sum + (qty ?? 0), 0);
  const stationsHere = dockedStations(state, ship.systemId);

  return (
    <>
      <Panel title={`Система · ${system.name}`} actions={<Tag color={faction.color}>{faction.name}</Tag>}>
        <div className="grid2">
          <Row label="Класс звезды" value={system.starClass} />
          <Row label="Тип системы" value={archetypeLabel(system.archetype)} />
          <Row label="Безопасность" value={pct(system.security)} />
          <Row label="Население" value={`${(system.population / 1_000_000).toFixed(1)} млн`} />
          <Row label="Ваша репутация" value={reputationOf(state, system.factionId)} />
          <Row
            label="Пояса"
            value={`нанесено на карты ${system.belts.filter((belt) => belt.discovered).length} из ${
              system.belts.length
            }`}
          />
        </div>
        <Hint>
          Производит: {system.produces.map((id) => resource(id).symbol).join(' ') || '—'} · потребляет:{' '}
          {system.consumes.map((id) => resource(id).symbol).join(' ') || '—'}
        </Hint>
        <Hint>
          {market
            ? `Рынок работает: ${market.name}. Торговля — во вкладке РЫНОК.`
            : 'Здесь нет торговой станции — рыночных услуг нет.'}
        </Hint>
      </Panel>


      {ship.travel ? (
        <Panel title="Идёт перелёт">
        <Meter
          label={`Прыжок к ${
            state.systems[ship.travel.path[ship.travel.path.length - 1]]?.name ?? '?'
          }`}
          value={travelProgress(state, ship)}
          max={1}
          suffix={` ${pct(travelProgress(state, ship))}`}
        />
        <Row label="Прибытие через" value={duration(Math.max(0, ship.travel.arriveAt - state.gameTime))} />
        <Row label="Следующий переход" value={currentHop(state, ship)?.name ?? '—'} />
        <Row label="Топливо в прыжке" value={num(ship.travel.fuel)} />
        <div>
          <Btn kind="bad" size="small" onClick={() => run((draft) => cancelTravel(draft))}>
            ПРЕРВАТЬ ПРЫЖОК
          </Btn>
        </div>
      </Panel>
    ) : null}

    {ship.status === 'mining' && status ? (
      <Panel
        title="Вахта"
        actions={<Tag color="#41f0c1">{status.phase === 'approach' ? 'ПОДХОД' : `ЗАХОД ${num(status.piece)}`}</Tag>}
      >
        <Progress
          label={
            status.phase === 'approach'
              ? `Подход к поясу ${status.belt.name}`
              : `Бур в поясе ${status.belt.name}`
          }
          fraction={status.phase === 'approach' ? status.approachProgress : status.pieceProgress}
          color="#ffd166"
          right={status.phase === 'approach' ? `подход ${duration(status.approachLeft)}` : `до захода ${duration(status.pieceLeft)}`}
        />
        <Row label="План вахты" value={amountsSummary(status.plan)} />
        <Row label="Уже в трюме" value={`${amountsSummary(status.hauled)}`} />
        <Row
          label="Прогресс вахты"
          value={status.plannedTotal > 0 ? `${num(status.hauledTotal)} / ${num(status.plannedTotal)} ед. (${pct(status.progress)})` : 'до полного трюма'}
        />
        <Row label="Свободный трюм" value={`${num(status.cargoFree)} ед.`} />
        <Row
          label="Запас пояса"
          value={
            status.exhausted
              ? 'выработан'
              : `${num(status.reserveLeft)} ед. · выработано ${pct(beltWear(status.belt))}`
          }
        />
        <Row
          label="Темп"
          value={`${amountsText(miningYieldPerCycle(ship, status.belt, miningBonus(state))) || '—'} за ${duration(MINING_CYCLE_SECONDS)}`}
        />
        <div className="row-actions">
          <Btn size="small" kind="bad" onClick={() => run((draft) => stopMining(draft, liveShip(draft)))}>
            ОСТАНОВИТЬ ДОБЫЧУ
          </Btn>
        </div>
      </Panel>
    ) : null}

      <Panel title="Куда можно прыгнуть" tight>
        {system.connections
          .map((id) => state.systems[id])
          .filter((target) => !!target?.discovered)
          .map((target) => {
            const plan = jumpPlan(state, target.id);
            const affordable = !!plan && ship.fuel >= plan.fuel;
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
                  disabled={!affordable || !!ship.travel || ship.status === 'mining'}
                  title={affordable ? 'Прыгнуть в эту систему' : 'Не хватает топлива (или корабль занят)'}
                  onClick={() => (onJump ? onJump(target.id) : run((draft) => travelTo(draft, target.id)))}
                >
                  ПРЫЖОК
                </Btn>
              </div>
            );
          })}
        {system.connections.length === 0 ? <Hint>Тупик: на сканере нет ни одной трассы.</Hint> : null}
      </Panel>

      <Panel title="Пояса астероидов" tight>
        <Hint>
          Свободный трюм: {num(freeHold)} ед. План вахты ограничен трюмом, запасом пояса и буром{' '}
          ({num(shipStats(ship).mining)}). Остановить вахту можно в любой момент.
        </Hint>
        {system.belts.map((belt) => (
          <BeltRow
            key={belt.id}
            state={state}
            belt={belt}
            shipId={ship.id}
            busy={busy}
            onMine={(plan) =>
              run((draft) => startMining(draft, liveShip(draft), belt.id, plan))
            }
          />
        ))}
        {system.belts.length === 0 ? (
          <Hint>Здесь поясов нет: руду придётся возить из соседних систем.</Hint>
        ) : null}
        <Hint>Неизученные пояса открывает сканер — вкладка РАЗВЕДКА.</Hint>
      </Panel>

      <Panel title="Станции системы" tight>
        {state.station.systemId === ship.systemId && stationPhase(state) !== 'planned' ? (
          <div className="list-row col">
            <div className="list-main">
              <b>
                {state.station.name} <span className="dim">· ваша станция</span>
              </b>
              <span className="dim">
                {stationPhaseLabel(stationPhase(state))} · КЦ Mk {state.station.level} · услуги:{' '}
                {[
                  state.station.buildings.warehouse > 0 ? 'СКЛАД' : null,
                  state.station.buildings.dock > 0 ? 'ТОПЛ/РЕМОНТ' : null,
                  state.station.buildings.shipyard > 0 ? 'ВЕРФЬ' : null,
                  state.station.buildings.refinery > 0 ? 'ПЕРЕРАБОТКА' : null,
                ]
                  .filter(Boolean)
                  .join(' ') || 'нет'}
              </span>
              <span className="dim">Рынок и контракты — только у станций фракций: своя база не торгует.</span>
            </div>
          </div>
        ) : null}
        {stationsHere.length === 0 ? <Hint>Здесь нет ни одной станции: только космос и вы.</Hint> : null}
        {stationsHere.map((entry) => (
          <div className="list-row col" key={entry.station.id}>
            <div className="list-main">
              <b>
                {entry.station.name}
                {entry.own ? <span className="dim"> · ваша станция</span> : null}
              </b>
              <span className="dim">
                {stationTypeLabel(entry.station.type)} ·{' '}
                {entry.station.factionId
                  ? state.factions[entry.station.factionId]?.short ?? entry.station.factionId
                  : 'безвластие'}{' '}
                · услуги:{' '}
                {(Object.keys(entry.services) as StationService[])
                  .filter((service) => entry.services[service])
                  .map((service) => SERVICE_INFO[service].short)
                  .join(' ') || 'нет'}
              </span>
              {entry.reason ? <span className="dim">{entry.reason}</span> : null}
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="Планеты" tight>
        {!system.scanned ? (
          <Hint>Планеты не нанесены на карты: проведите полный скан системы во вкладке РАЗВЕДКА.</Hint>
        ) : (
          system.planets.map((planet) => (
            <div className="list-row" key={planet.id}>
              <div className="list-main">
                <b>{planet.name}</b>
                <span className="dim">
                  {planet.type} ·{' '}
                  {planet.population > 0 ? `${num(planet.population)} жителей` : 'необитаема'}
                </span>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  );
}

/**
 * Строка пояса с выбором количества. План задаётся одним числом: сколько всего
 * единиц набурить, — а по ресурсам пояса он раскладывается сам.
 */
function BeltRow({
  state,
  belt,
  shipId,
  busy,
  onMine,
}: {
  state: GameState;
  belt: AsteroidBelt;
  shipId: string;
  busy: boolean;
  onMine: (plan: ReturnType<typeof planFromTotal> | null) => void;
}) {
  const ship = state.ships.find((s) => s.id === shipId);
  const capacity = ship ? sumAmounts(miningCapacity(state, ship, belt)) : 0;
  const [total, setTotal] = useState(Math.max(1, capacity));

  // Трюм мог измениться после разгрузки — тогда план подтягивается к новому максимуму.
  useEffect(() => {
    setTotal((current) => Math.max(1, Math.min(current || capacity, Math.max(1, capacity))));
  }, [capacity]);

  const grades = Object.keys(belt.grades) as ResourceId[];
  const reserve = beltReserve(belt);
  const exhausted = reserve <= MIN_BELT_RESERVE;
  const throughput = ship ? miningYieldPerCycle(ship, belt, miningBonus(state)) : {};
  const canMine = !!ship && capacity > 0 && belt.discovered && !exhausted && !busy;

  return (
    <div className="list-row col">
      <div className="list-main">
        <b>
          {belt.name} <span className="dim">{belt.discovered ? '' : '· не изучен'}</span>
        </b>
        <span className="dim">
          {belt.discovered
            ? `${grades.map((id) => resource(id).symbol).join(' ')} · богатство ${belt.richness.toFixed(2)}× · запас ${num(reserve)} ед.`
            : 'состав и запас неизвестны'}
        </span>
        {belt.discovered ? (
          <>
            <Progress
              label="Выработано"
              fraction={beltWear(belt)}
              color="#ffb347"
              right={exhausted ? 'выработан' : `осталось ${num(reserve)} ед.`}
            />
            <span className="dim">
              Бур поднимает {amountsText(throughput) || '—'} за {MINING_CYCLE_SECONDS} с · влезет за вахту{' '}
              {num(capacity)} ед.
            </span>
          </>
        ) : null}
        {canMine ? (
          <Stepper
            value={Math.min(total, Math.max(1, capacity))}
            onChange={setTotal}
            max={Math.max(1, capacity)}
            presets={[5, 10, 25, 50]}
            suffix="ед."
          />
        ) : null}
      </div>
      <div className="row-actions">
        <Btn
          size="small"
          kind="primary"
          disabled={!canMine}
          title={
            !belt.discovered
              ? 'Сначала разведайте пояс сканером'
              : exhausted
                ? 'Пояс выработан'
                : busy
                  ? 'Корабль занят'
                  : capacity <= 0
                    ? 'Нет свободного трюма или бурового оборудования'
                    : 'Начать вахту с выбранным количеством'
          }
          onClick={() => onMine(planFromTotal(state, ship as Ship, belt, total))}
        >
          БУРИТЬ {num(Math.min(total, Math.max(1, capacity)))}
        </Btn>
        <Btn
          size="small"
          disabled={!canMine}
          title="Работать, пока не заполнится трюм"
          onClick={() => onMine(null)}
        >
          ДО ПОЛНОГО ТРЮМА
        </Btn>
      </div>
    </div>
  );
}

