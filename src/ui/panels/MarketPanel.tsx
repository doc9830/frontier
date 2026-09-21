import { useEffect, useState } from 'react';
import type { GameState, ResourceDef, ResourceId, Ship } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { RESOURCES } from '../../game/data/resources.ts';
import { availableStock, marketPrice } from '../../game/economy/market.ts';
import { SERVICE_INFO, stationOwnerName } from '../../game/data/stations.ts';
import { storageCapacity, storageUsed } from '../../game/sim/station.ts';
import { cargoFree, cargoUsed, shipStats } from '../../game/ships/ship.ts';
import { siteTradeBonus } from '../../game/site/site.ts';
import {
  atMarket,
  atOwnStation,
  buyPriceAt,
  buyResource,
  loadFromStation,
  marketRefusal,
  maxBuyable,
  researchPriceBonus,
  sellEverything,
  sellPriceAt,
  sellResource,
  serviceHere,
  unloadToStation,
} from '../../game/actions/trade.ts';
import { amountsText, cr, num, pct } from '../format.ts';
import { Btn, Hint, Panel, Row, Stepper, Tag } from '../kit.tsx';

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
  const stats = shipStats(ship);
  const open = atMarket(state);
  const board = serviceHere(state, 'market');
  const refusal = marketRefusal(state);
  const stationHere = atOwnStation(state);
  const siteBonus = siteTradeBonus(state);
  const bonus = researchPriceBonus(state);

  return (
    <Panel title="Рынок" actions={<Tag color={open ? '#41f0c1' : undefined}>{open ? 'ОТКРЫТ' : 'ЗАКРЫТ'}</Tag>}>
      <div className="grid2 summary-grid">
        <Row
          label="Трюм"
          value={`${num(cargoUsed(ship))} / ${num(stats.cargo)} (свободно ${num(cargoFree(ship))})`}
        />
        <Row label="Кредиты" value={cr(state.player.credits)} />
        <Row
          label="Склад станции"
          value={`${num(storageUsed(state.station))} / ${num(storageCapacity(state.station))}`}
        />
        <Row label="Анализ рынка" value={`×${bonus.toFixed(2)} к ценам`} />
      </div>
      {board ? (
        <Row
          label="Кто торгует"
          value={`${board.station.name} · ${stationOwnerName(state, board.station)} · ${SERVICE_INFO.market.label}`}
        />
      ) : null}
      {stationHere ? <Row label="Своя станция" value={`бонус площадки ±${pct(siteBonus)} к спреду`} /> : null}

      {!open ? (
        <Hint>
          {refusal ?? 'Рынок закрыт.'} Рынки есть на торговых станциях и на чёрных рынках безвластия: прыгните к
          соседу или проверьте список услуг во вкладке СИСТЕМА.
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

          {RESOURCES.map((def) => (
            <MarketRow
              key={def.id}
              state={state}
              resource_={def}
              shipId={ship.id}
              stationHere={stationHere}
              run={run}
            />
          ))}
          <Hint>
            Количество задаётся счётчиком: быстрые варианты и «МАКС» берут столько, сколько позволяют запас рынка,
            свободный трюм и кредиты. Цены реагируют на вашу торговлю — вывалив полный трюм в одну систему, вы
            обрушите там цену.
          </Hint>
          <Hint>
            Склад вашей станции: {amountsText(state.station.storage)}. Переработка берёт сырьё прямо оттуда, а не из
            трюма.
          </Hint>
        </>
      )}
    </Panel>
  );
}

/** Одна строка товара: цены, остатки и счётчик количества. */
function MarketRow({
  state,
  resource_,
  shipId,
  stationHere,
  run,
}: {
  state: GameState;
  resource_: ResourceDef;
  shipId: string;
  stationHere: boolean;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = state.ships.find((s) => s.id === shipId) as Ship;
  const system = state.systems[ship.systemId];
  const id: ResourceId = resource_.id;
  const buy = buyPriceAt(state, id);
  const sell = sellPriceAt(state, id);
  const current = system ? marketPrice(system.market, id) : resource_.basePrice;
  const drift = current / Math.max(1, resource_.basePrice);
  const trend = drift > 1.08 ? '▲' : drift < 0.92 ? '▼' : '·';
  const trendColor = drift > 1.08 ? '#7ef7b0' : drift < 0.92 ? '#ff6b6b' : '#6d8a92';
  const stock = system ? availableStock(system.market, id) : 0;
  const held = ship.cargo[id] ?? 0;
  const stored = state.station.storage[id] ?? 0;
  const maxBuy = maxBuyable(state, id);
  const limit = Math.max(1, maxBuy, held);
  const [qty, setQty] = useState(() => Math.max(1, Math.min(10, limit)));

  // Трюм, кредиты и запас рынка меняются каждый рейс: план подтягивается следом.
  useEffect(() => {
    setQty((value) => Math.max(1, Math.min(value || limit, limit)));
  }, [limit]);

  return (
    <div className="list-row col">
      <div className="list-main">
        <b style={{ color: resource_.color }}>
          {resource_.symbol} <span className="dim">{resource_.name}</span>
        </b>
        <span className="dim">
          покупка {cr(buy)} · продажа {cr(sell)}{' '}
          <span style={{ color: trendColor }} title={`рынок против базовой цены ${resource_.basePrice} кр`}>
            {trend}
          </span>
          <br />
          в продаже {num(stock)} · можно купить {num(maxBuy)} · в трюме {num(held)} · на складе {num(stored)}
        </span>
        <Stepper value={Math.min(qty, limit)} onChange={setQty} max={limit} presets={[5, 10, 25, 50]} suffix="ед." />
      </div>
      <div className="row-actions">
        <Btn
          size="tiny"
          kind="primary"
          disabled={maxBuy <= 0}
          title={maxBuy <= 0 ? 'Нет запаса, свободного места или кредитов' : `Купить ${Math.min(qty, maxBuy)} ед.`}
          onClick={() => run((draft) => buyResource(draft, id, qty))}
        >
          КУПИТЬ {num(Math.min(qty, maxBuy))}
        </Btn>
        <Btn
          size="tiny"
          kind="good"
          disabled={held <= 0}
          title="Продать выбранное количество из трюма"
          onClick={() => run((draft) => sellResource(draft, id, qty))}
        >
          ПРОДАТЬ {num(Math.min(qty, held))}
        </Btn>
        <Btn
          size="tiny"
          kind="good"
          disabled={held <= 0}
          title="Продать этот товар из трюма целиком"
          onClick={() => run((draft) => sellResource(draft, id, held))}
        >
          ПРОДАТЬ ВСЁ ({num(held)})
        </Btn>
        <Btn
          size="tiny"
          disabled={!stationHere || stored <= 0}
          title={stationHere ? 'Взять со склада в трюм' : 'Только на своей станции'}
          onClick={() => run((draft) => loadFromStation(draft, id, qty))}
        >
          СО СКЛАДА {num(Math.min(qty, stored))}
        </Btn>
      </div>
    </div>
  );
}

