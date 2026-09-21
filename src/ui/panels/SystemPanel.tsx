import type { GameState, ResourceId, Ship } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { factionView, reputationOf } from '../../game/factions/reputation.ts';
import { cancelTravel, jumpPlan, travelTo } from '../../game/actions/nav.ts';
import { MINING_CYCLE_SECONDS, miningBonus, miningYieldPerCycle, startMining, stopMining } from '../../game/sim/mining.ts';
import { currentHop, travelProgress } from '../../game/sim/travel.ts';
import { archetypeLabel } from '../../game/universe/generate.ts';
import { resource } from '../../game/data/resources.ts';
import { amountsText, duration, num, pct, riskText, threatColor } from '../format.ts';
import { hops } from '../../game/plural.ts';
import { Btn, Hint, Meter, Panel, Row, Tag } from '../kit.tsx';

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
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  const system = ship ? state.systems[ship.systemId] : null;
  if (!ship || !system) return null;

  const faction = factionView(state, system.factionId);
  const market = system.stations.find((station) => station.hasMarket);
  const liveShip = (draft: GameState): Ship => draft.ships.find((s) => s.id === ship.id) as Ship;
  const mineMission = ship.mission?.kind === 'mine' ? ship.mission : null;

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

    {ship.status === 'mining' ? (
      <Panel title="Добыча" actions={<Tag color="#41f0c1">БУРЕНИЕ</Tag>}>
          <Row
            label="Пояс"
            value={
              mineMission
                ? system.belts.find((belt) => belt.id === mineMission.beltId)?.name ?? '?'
                : '?'
            }
          />
          <Row
            label="Трюм"
            value={`${num(Object.values(ship.cargo).reduce((sum, qty) => sum + (qty ?? 0), 0))} ед.`}
          />
          <Row
            label="Добыча за цикл"
            value={(() => {
              const belt = mineMission
                ? system.belts.find((entry) => entry.id === mineMission.beltId)
                : null;
              if (!belt) return '—';
              return `${amountsText(miningYieldPerCycle(ship, belt, miningBonus(state)))} за ${MINING_CYCLE_SECONDS} с`;
            })()}
          />
          <div>
            <Btn size="small" onClick={() => run((draft) => stopMining(draft, liveShip(draft)))}>
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
                  onClick={() => run((draft) => travelTo(draft, target.id))}
                >
                  ПРЫЖОК
                </Btn>
              </div>
            );
          })}
        {system.connections.length === 0 ? <Hint>Тупик: на сканере нет ни одной трассы.</Hint> : null}
      </Panel>

      <Panel title="Пояса и станции" tight>
        {system.belts.map((belt) => {
          const grades = Object.keys(belt.grades) as ResourceId[];
          const ready = ship.systemId === belt.systemId && !ship.travel && ship.status !== 'mining';
          return (
            <div className="list-row" key={belt.id}>
              <div className="list-main">
                <b>{belt.name}</b>
                <span className="dim">
                  {belt.discovered
                    ? `${grades.map((id) => resource(id).symbol).join(' ')} · богатство ${belt.richness.toFixed(2)}×`
                    : 'не нанесён на карты'}
                </span>
              </div>
              <Btn
                size="small"
                disabled={!belt.discovered || !ready}
                title={belt.discovered ? 'Начать бурение этого пояса' : 'Пояс ещё не нанесён на карты'}
                onClick={() => run((draft) => startMining(draft, liveShip(draft), belt.id))}
              >
                БУРИТЬ
              </Btn>
            </div>
          );
        })}
        {system.belts.length === 0 ? <Hint>Здесь поясов астероидов нет.</Hint> : null}
        {system.stations.map((station) => (
          <div className="list-row" key={station.id}>
            <div className="list-main">
              <b>{station.name}</b>
              <span className="dim">
                {stationTypeLabel(station.type)} · {factionView(state, station.factionId).short}
                {station.hasMarket ? ' · рынок' : ''}
                {station.hasShipyard ? ' · верфь' : ''}
                {station.hasContracts ? ' · контракты' : ''}
              </span>
            </div>
          </div>
        ))}
        {system.planets.length > 0 ? (
          <Hint>
            Планеты: {system.planets.map((planet) => `${planet.name} (${planet.type})`).join(', ')}
          </Hint>
        ) : null}
      </Panel>
    </>
  );
}

