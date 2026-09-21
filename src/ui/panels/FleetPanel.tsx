import { useState } from 'react';
import type { GameState, ResourceId, Ship } from '../../game/types.ts';
import { RESOURCES, resource } from '../../game/data/resources.ts';
import { shipType } from '../../game/data/ships.ts';
import { cargoUsed, shipStats } from '../../game/ships/ship.ts';
import { renameShip, sellShip, shipResaleValue } from '../../game/actions/outfitting.ts';
import {
  assignEscortMission,
  assignMineMission,
  assignTradeMission,
  clearMission,
  fleetCap,
  fleetShips,
  missionSlots,
} from '../../game/sim/fleet.ts';
import { PHASE_LABEL, STATUS_LABEL, amountsText, cr, duration, num } from '../format.ts';
import { stationPhase } from '../../game/site/site.ts';
import { Btn, Hint, Panel, Row, Tag } from '../kit.tsx';

/** Fleet screen: mission assignment for every ship that is not the flagship. */

export function FleetPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ships = fleetShips(state);
  const cap = fleetCap(state);
  const slots = missionSlots(state);

  return (
    <Panel
      title="Флот"
      actions={
        <span className="dim">
          корабли {state.ships.length}/{cap} · задания {slots.used}/{slots.cap}
        </span>
      }
    >
      {ships.length === 0 ? (
        <Hint>
          Своих кораблей пока нет. Купите корпус на верфи (вкладка КОРАБЛЬ), поставьте буровое оборудование или
          отправьте его в торговый рейс. Задания выполняются, пока вы летаете сами.
        </Hint>
      ) : (
        ships.map((ship) => <FleetShipCard key={ship.id} state={state} ship={ship} run={run} />)
      )}
      <Hint>
        Для добычи нужны буры, для торговли — трюм. Эскорты летят за флагманом и снижают риск прыжка на 8%
        каждый.
      </Hint>
    </Panel>
  );
}


function FleetShipCard({
  state,
  ship,
  run,
}: {
  state: GameState;
  ship: Ship;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const stats = shipStats(ship);
  const type = shipType(ship.typeId);
  const [mode, setMode] = useState<'mine' | 'trade' | 'escort'>('mine');
  const [beltId, setBeltId] = useState('');
  const [resourceId, setResourceId] = useState<ResourceId>('ore');
  const [buyId, setBuyId] = useState('');
  const [sellId, setSellId] = useState('');
  const [cycles, setCycles] = useState(4);
  const [name, setName] = useState('');

  const systems = state.systemIds.map((id) => state.systems[id]).filter((system) => !!system?.discovered);
  const belts = systems.flatMap((system) => system.belts.filter((belt) => belt.discovered));
  const mission = ship.mission;
  const liveShip = (draft: GameState) => draft.ships.find((s) => s.id === ship.id)!;
  const systemHere = state.systems[ship.systemId];

  const remain = (() => {
    if (!mission) return 0;
    if (mission.kind === 'mine') return Math.max(0, mission.workUntil - state.gameTime);
    if (mission.kind === 'trade') return Math.max(0, mission.arriveAt - state.gameTime);
    return 0;
  })();

  return (
    <div className="list-row col">
      <div className="list-main">
        <b>
          {ship.name} <span className="dim">{type.name}</span>{' '}
          <Tag color={ship.status === 'docked' ? undefined : '#41f0c1'}>{STATUS_LABEL[ship.status]}</Tag>
        </b>
        <span className="dim">
          {systemHere?.name ?? '?'} · {type.role} · трюм {num(cargoUsed(ship))}/{num(stats.cargo)} · добыча{' '}
          {num(stats.mining)} · бой {num(stats.combat)}
        </span>
      </div>

      {mission ? (
        <>
          <span className="dim">
            {mission.kind === 'mine'
              ? `Бурит пояс ${
                  state.systems[mission.beltSystemId]?.belts.find((belt) => belt.id === mission.beltId)
                    ?.name ?? '?'
                } · ${PHASE_LABEL[mission.phase] ?? mission.phase} · добыто ${amountsText(mission.expected)}`
              : mission.kind === 'trade'
                ? `Возит ${resource(mission.resource).symbol}: ${
                    state.systems[mission.buySystemId]?.name ?? '?'
                  } → ${state.systems[mission.sellSystemId]?.name ?? '?'} · ${
                    PHASE_LABEL[mission.phase] ?? mission.phase
                  } · прибыль ${cr(mission.profit)}`
                : 'Эскортирует флагман'}
          </span>
          <Row label="Осталось" value={duration(remain)} />
          <div>
            <Btn size="tiny" kind="bad" onClick={() => run((draft) => clearMission(draft, liveShip(draft)))}>
              ОТОЗВАТЬ
            </Btn>
          </div>
        </>
      ) : (
        <>
          {stationPhase(state) === 'planned' ? (
            <Hint>Добычные рейсы требуют склада: грузить руду некуда — сначала заложите станцию (раздел СТАНЦИЯ).</Hint>
          ) : null}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="mine">ДОБЫЧА</option>
              <option value="trade">ТОРГОВЛЯ</option>
              <option value="escort">ЭСКОРТ</option>
            </select>
            {mode === 'mine' ? (
              <select value={beltId} onChange={(event) => setBeltId(event.target.value)}>
                <option value="">выберите пояс…</option>
                {belts.map((belt) => (
                  <option key={belt.id} value={belt.id}>
                    {belt.name} · {state.systems[belt.systemId]?.name}
                  </option>
                ))}
              </select>
            ) : null}
            {mode === 'trade' ? (
              <>
                <select value={resourceId} onChange={(event) => setResourceId(event.target.value as ResourceId)}>
                  {RESOURCES.map((def) => (
                    <option key={def.id} value={def.id}>
                      {def.symbol}
                    </option>
                  ))}
                </select>
                <select value={buyId} onChange={(event) => setBuyId(event.target.value)}>
                  <option value="">купить в…</option>
                  {systems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </select>
                <select value={sellId} onChange={(event) => setSellId(event.target.value)}>
                  <option value="">продать в…</option>
                  {systems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {mode !== 'escort' ? (
              <label className="dim">
                циклов{' '}
                <input
                  className="text"
                  style={{ width: 46 }}
                  type="number"
                  min={1}
                  max={20}
                  value={cycles}
                  onChange={(event) => setCycles(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                />
              </label>
            ) : null}
            <Btn
              size="small"
              kind="primary"
              disabled={
                (mode === 'mine' && !beltId) ||
                (mode === 'trade' && (!buyId || !sellId)) ||
                ship.status !== 'docked'
              }
              title={ship.status === 'docked' ? 'Отправить корабль' : 'Корабль уже занят'}
              onClick={() =>
                run((draft) => {
                  const live = liveShip(draft);
                  if (mode === 'mine' && beltId) assignMineMission(draft, live, beltId, cycles);
                  if (mode === 'trade' && buyId && sellId)
                    assignTradeMission(draft, live, resourceId, buyId, sellId, cycles);
                  if (mode === 'escort') assignEscortMission(draft, live);
                })
              }
            >
              ОТПРАВИТЬ
            </Btn>
          </div>
          <Row label="Цена продажи" value={cr(shipResaleValue(ship))} />
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="text"
              placeholder="новое имя"
              value={name}
              maxLength={18}
              onChange={(event) => setName(event.target.value)}
            />
            <Btn
              size="tiny"
              disabled={!name.trim()}
              onClick={() => run((draft) => renameShip(draft, ship.id, name.trim()))}
            >
              ПЕРЕИМЕНОВАТЬ
            </Btn>
            <Btn
              size="tiny"
              kind="bad"
              disabled={ship.status !== 'docked'}
              title={ship.status === 'docked' ? 'Продать этот корпус' : 'Сначала отзовите корабль'}
              onClick={() => run((draft) => sellShip(draft, ship.id))}
            >
              ПРОДАТЬ
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
