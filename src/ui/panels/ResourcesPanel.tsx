import { useEffect, useState } from 'react';
import type { AsteroidBelt, GameState, ResourceId, Ship } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
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
import { resource } from '../../game/data/resources.ts';
import { beltReserve, beltWear, MIN_BELT_RESERVE } from '../../game/data/belts.ts';
import { shipStats } from '../../game/ships/ship.ts';
import { amountsText, duration, num, pct } from '../format.ts';
import { Btn, Hint, Panel, Progress, Row, Stepper, Tag } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Подэкран «Ресурсы»: пояса текущей системы и вахта.
 *
 * Пояс, не нанесённый на карты, бурить нельзя — вместо кнопки добычи строка
 * ведёт в «Исследование», где его и открывает сканер.
 */

export function ResourcesPanel({
  state,
  run,
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;
  const system = state.systems[ship.systemId];
  if (!system) return null;

  const stats = shipStats(ship);
  const status = miningStatus(state, ship);
  const busy = !!ship.travel || ship.status === 'mining' || ship.status === 'survey';
  const freeHold = stats.cargo - Object.values(ship.cargo).reduce((sum, qty) => sum + (qty ?? 0), 0);
  const liveShip = (draft: GameState): Ship => draft.ships.find((s) => s.id === ship.id) as Ship;

  return (
    <>
      {status && ship.status === 'mining' ? (
        <Panel
          title="Вахта"
          actions={
            <Tag color="#41f0c1">{status.phase === 'approach' ? 'ПОДХОД' : `ЗАХОД ${num(status.piece)}`}</Tag>
          }
        >
          <Progress
            label={
              status.phase === 'approach'
                ? `Подход к поясу ${status.belt.name}`
                : `Бур в поясе ${status.belt.name}`
            }
            fraction={status.phase === 'approach' ? status.approachProgress : status.pieceProgress}
            color="#ffd166"
            right={
              status.phase === 'approach'
                ? `подход ${duration(status.approachLeft)}`
                : `до захода ${duration(status.pieceLeft)}`
            }
          />
          <Row label="План вахты" value={amountsSummary(status.plan)} />
          <Row label="Уже в трюме" value={amountsSummary(status.hauled)} />
          <Row
            label="Прогресс вахты"
            value={
              status.plannedTotal > 0
                ? `${num(status.hauledTotal)} / ${num(status.plannedTotal)} ед. (${pct(status.progress)})`
                : 'до полного трюма'
            }
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
            value={`${amountsText(miningYieldPerCycle(ship, status.belt, miningBonus(state))) || '—'} за ${duration(
              MINING_CYCLE_SECONDS,
            )}`}
          />
          <div className="row-actions">
            <Btn size="small" kind="bad" onClick={() => run((draft) => stopMining(draft, liveShip(draft)))}>
              ОСТАНОВИТЬ ДОБЫЧУ
            </Btn>
          </div>
        </Panel>
      ) : null}

      <Panel
        title={`Пояса · ${system.name}`}
        actions={<span className="dim">{system.belts.length} шт.</span>}
        tight
      >
        <Hint>
          Свободный трюм: {num(freeHold)} ед. План вахты ограничен трюмом, запасом пояса и буром (
          {num(stats.mining)}). Остановить вахту можно в любой момент.
        </Hint>
        {system.belts.map((belt) => (
          <BeltRow
            key={belt.id}
            state={state}
            belt={belt}
            shipId={ship.id}
            busy={busy}
            onMine={(plan) => run((draft) => startMining(draft, liveShip(draft), belt.id, plan))}
            onResearch={() => onOpen({ id: 'research' })}
          />
        ))}
        {system.belts.length === 0 ? (
          <Hint>Здесь поясов нет: руду придётся возить из соседних систем.</Hint>
        ) : null}
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
  onResearch,
}: {
  state: GameState;
  belt: AsteroidBelt;
  shipId: string;
  busy: boolean;
  onMine: (plan: ReturnType<typeof planFromTotal> | null) => void;
  onResearch: () => void;
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
          {belt.name} {belt.discovered ? null : <span className="dim">· не изучен</span>}
        </b>
        <span className="dim">
          {belt.discovered
            ? `${grades.map((id) => resource(id).symbol).join(' ')} · богатство ${belt.richness.toFixed(
                2,
              )}× · запас ${num(reserve)} ед.`
            : 'состав и запас неизвестны: нужен скан пояса'}
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
        {belt.discovered ? (
          <>
            <Btn
              size="small"
              kind="primary"
              disabled={!canMine}
              title={
                exhausted
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
          </>
        ) : (
          <Btn size="small" kind="primary" title="Открыть пояс сканером" onClick={onResearch}>
            ИССЛЕДОВАТЬ
          </Btn>
        )}
      </div>
    </div>
  );
}
