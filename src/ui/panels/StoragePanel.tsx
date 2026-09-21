import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { resource } from '../../game/data/resources.ts';
import { cargoFree, cargoUsed, shipStats } from '../../game/ships/ship.ts';
import { allDepots, depotHere, depotRefusal } from '../../game/sim/depots.ts';
import { atMarket, loadFromStation, sellStoredResource, unloadToStation } from '../../game/actions/trade.ts';
import { barColor, num, pct } from '../format.ts';
import { Btn, Hint, Meter, Panel, Row, Tag } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Подэкран «Склады»: ящик, доступный кораблю сейчас (свой или арендованный), и
 * сводка остальных складов с адресами. Груз лежит именно на станции, поэтому
 * забрать или продать его можно только там, где стоит сам склад.
 */

export function StoragePanel({
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
  const depot = depotHere(state);
  const market = atMarket(state);
  const stats = shipStats(ship);
  const holdUsed = cargoUsed(ship);
  const others = allDepots(state).filter((entry) => entry.id !== depot?.id);

  if (!depot) {
    return (
      <Panel title="Склады">
        <Hint>{depotRefusal(state) ?? 'Склад недоступен.'}</Hint>
        <Hint>
          Свой склад открывается после закладки станции, а на станциях фракций можно арендовать ячейку: прыгайте к
          соседям и смотрите их услуги в разделе «Система».
        </Hint>
        <div className="row-actions">
          <Btn size="small" onClick={() => onOpen({ id: 'stations' })}>
            СТАНЦИИ СИСТЕМЫ
          </Btn>
        </div>
      </Panel>
    );
  }

  const rows = (Object.entries(depot.amounts) as [ResourceId, number][])
    .filter(([, qty]) => (qty ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <>
      <Panel
        title={`Склад · ${depot.name}`}
        actions={<Tag color={depot.own ? '#41f0c1' : undefined}>{depot.own ? 'СВОЙ' : 'АРЕНДА'}</Tag>}
      >
        <Meter
          label="ЗАПОЛНЕНО"
          value={depot.used}
          max={depot.capacity}
          color={barColor(depot.used / Math.max(1, depot.capacity))}
        />
        <div className="grid2">
          <Row label="Тип" value={depot.own ? 'свой склад базы' : 'арендованная ячейка'} />
          <Row label="Система" value={state.systems[depot.systemId]?.name ?? '—'} />
          <Row label="Занято" value={`${num(depot.used)} / ${num(depot.capacity)} ед.`} />
          <Row label="Свободно" value={`${num(depot.free)} ед.`} />
          <Row
            label="Трюм"
            value={`${num(holdUsed)} / ${num(stats.cargo)} (свободно ${num(cargoFree(ship))})`}
          />
          <Row label="Рынок рядом" value={market ? 'есть' : 'нет'} />
        </div>
        <div className="row-actions">
          <Btn
            size="small"
            kind="primary"
            disabled={holdUsed <= 0}
            title={holdUsed <= 0 ? 'Трюм пуст' : 'Перенести весь груз из трюма в этот склад'}
            onClick={() => run((draft) => unloadToStation(draft, null))}
          >
            ВЫГРУЗИТЬ ТРЮМ ({num(holdUsed)})
          </Btn>
          <Btn size="small" title="Открыть рынок станции" onClick={() => onOpen({ id: 'market' })}>
            РЫНОК
          </Btn>
        </div>
      </Panel>
      <Panel title="Содержимое склада" tight>
        {rows.length === 0 ? (
          <Hint>Склад пуст. Сначала выгрузите руду из трюма — потом её примет переработка.</Hint>
        ) : (
          rows.map(([id, qty]) => {
            const def = resource(id);
            const loadable = Math.min(qty, Math.max(0, cargoFree(ship)));
            return (
              <div className="list-row col" key={id}>
                <div className="list-main">
                  <b style={{ color: def.color }}>
                    {def.symbol} <span className="dim">{def.name}</span>
                  </b>
                  <span className="dim">
                    на складе {num(qty)} ед. · занимает {pct(qty / Math.max(1, depot.used))} хранения
                  </span>
                  <div className="row-actions">
                    <Btn
                      size="tiny"
                      disabled={loadable <= 0}
                      title={loadable > 0 ? 'Загрузить в трюм' : 'В трюме нет места'}
                      onClick={() => run((draft) => loadFromStation(draft, id, loadable))}
                    >
                      В ТРЮМ ({num(loadable)})
                    </Btn>
                    <Btn
                      size="tiny"
                      kind="good"
                      disabled={!market}
                      title={market ? 'Продать со склада по местной цене' : 'В этой системе нет рынка'}
                      onClick={() => run((draft) => sellStoredResource(draft, id, qty))}
                    >
                      ПРОДАТЬ ({num(qty)})
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      {others.length > 0 ? (
        <Panel title="Другие ваши склады" tight>
          {others.map((entry) => (
            <div className="list-row" key={entry.id}>
              <div className="list-main">
                <b>{entry.name}</b>
                <span className="dim">
                  {state.systems[entry.systemId]?.name ?? '—'} · {entry.own ? 'свой' : 'аренда'} ·{' '}
                  {num(entry.used)} / {num(entry.capacity)} ед.
                  {entry.used > 0 ? ` · ${pct(entry.used / Math.max(1, entry.capacity))}` : ''}
                </span>
              </div>
            </div>
          ))}
          <Hint>
            Забрать груз с чужого склада можно только на месте: склады не пересылают грузы между системами.
          </Hint>
        </Panel>
      ) : null}
    </>
  );
}

