import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { RESOURCES } from '../../game/data/resources.ts';
import { availableStock, marketPrice } from '../../game/economy/market.ts';
import { storageCapacity, storageUsed } from '../../game/sim/station.ts';
import { cargoUsed, shipStats } from '../../game/ships/ship.ts';
import {
  atMarket,
  buyPriceAt,
  buyResource,
  loadFromStation,
  researchPriceBonus,
  sellEverything,
  sellPriceAt,
  sellResource,
  unloadToStation,
} from '../../game/actions/trade.ts';
import { amountsText, cr, num } from '../format.ts';
import { Btn, Hint, Panel, Row } from '../kit.tsx';

/** The trade screen: one row per resource, both sides of the spread visible. */

export function MarketPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;
  const system = state.systems[ship.systemId];
  const stats = shipStats(ship);
  const open = atMarket(state);
  const stationHere = state.station.systemId === ship.systemId;
  const bonus = researchPriceBonus(state);

  return (
    <Panel title="Рынок" actions={<span className="dim">анализ ×{bonus.toFixed(2)}</span>}>
      <Row label="Трюм" value={`${num(cargoUsed(ship))} / ${num(stats.cargo)}`} />
      <Row label="Кредиты" value={cr(state.player.credits)} />
      <Row
        label="Склад станции"
        value={`${num(storageUsed(state.station))} / ${num(storageCapacity(state.station))}`}
      />
      {!open ? (
        <Hint>
          В системе {system?.name ?? 'здесь'} нет рынка. Рынки есть на торговых, промышленных, добывающих и
          научных станциях — прыгните к соседу, где у станции указан рынок.
        </Hint>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn size="small" kind="primary" onClick={() => run((draft) => sellEverything(draft))}>
              ПРОДАТЬ ВСЁ ИЗ ТРЮМА
            </Btn>
            <Btn
              size="small"
              disabled={!stationHere}
              title={stationHere ? 'Перенести трюм на свою станцию' : 'Только на своей станции'}
              onClick={() => run((draft) => unloadToStation(draft, null))}
            >
              ВЫГРУЗИТЬ НА СКЛАД
            </Btn>
          </div>


          {RESOURCES.map((def) => {
            const id: ResourceId = def.id;
            const buy = buyPriceAt(state, id);
            const sell = sellPriceAt(state, id);
            const current = system ? marketPrice(system.market, id) : def.basePrice;
            const drift = current / Math.max(1, def.basePrice);
            const trend = drift > 1.08 ? '▲' : drift < 0.92 ? '▼' : '·';
            const trendColor = drift > 1.08 ? '#7ef7b0' : drift < 0.92 ? '#ff6b6b' : '#6d8a92';
            const stock = system ? availableStock(system.market, id) : 0;
            const held = ship.cargo[id] ?? 0;
            const stored = state.station.storage[id] ?? 0;
            return (
              <div className="list-row" key={id}>
                <div className="list-main">
                  <b style={{ color: def.color }}>
                    {def.symbol} <span className="dim">{def.name}</span>
                  </b>
                  <span className="dim">
                    покупка {cr(buy)} · продажа {cr(sell)}{' '}
                    <span style={{ color: trendColor }} title={`рынок против базовой цены ${def.basePrice} кр`}>
                      {trend}
                    </span>
                    <br />
                    в продаже {num(stock)} · в трюме {num(held)} · на складе {num(stored)}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="row-actions">
                    <Btn
                      size="tiny"
                      disabled={stock <= 0}
                      title="Купить 5 единиц"
                      onClick={() => run((draft) => buyResource(draft, id, 5))}
                    >
                      КУПИТЬ 5
                    </Btn>
                    <Btn
                      size="tiny"
                      disabled={stock <= 0}
                      title="Купить столько, сколько влезет"
                      onClick={() => run((draft) => buyResource(draft, id, stats.cargo))}
                    >
                      КУПИТЬ МАКС
                    </Btn>
                  </div>
                  <div className="row-actions">
                    <Btn
                      size="tiny"
                      kind="good"
                      disabled={held <= 0}
                      title="Продать весь этот товар из трюма"
                      onClick={() => run((draft) => sellResource(draft, id, held))}
                    >
                      ПРОДАТЬ
                    </Btn>
                    <Btn
                      size="tiny"
                      disabled={!stationHere || stored <= 0}
                      title={stationHere ? 'Взять со склада в трюм' : 'Только на своей станции'}
                      onClick={() => run((draft) => loadFromStation(draft, id, stats.cargo))}
                    >
                      СО СКЛАДА
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })}
          <Hint>
            Цены реагируют на вашу торговлю: если вывалить полный трюм в одну систему, цена там падает. Развозите
            продажи по разным системам, а исследование «Анализ рынка» улучшает обе стороны спреда.
          </Hint>
          <Hint>
            Склад вашей станции: {amountsText(state.station.storage)}. Перерабатывающий комплекс берёт сырьё
            прямо оттуда, а не из трюма.
          </Hint>
        </>
      )}
    </Panel>
  );
}
