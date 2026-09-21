import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { resource } from '../../game/data/resources.ts';
import { RECIPES } from '../../game/data/recipes.ts';
import { cargoFree, cargoUsed, shipStats } from '../../game/ships/ship.ts';
import { storageCapacity, storageFree, storageUsed } from '../../game/sim/station.ts';
import {
  MINING_CYCLE_SECONDS,
  beltById,
  miningBonus,
  miningStatus,
  miningYieldPerCycle,
} from '../../game/sim/mining.ts';
import {
  atMarket,
  atOwnStation,
  buyPriceAt,
  loadFromStation,
  sellPriceAt,
  sellResource,
  sellStoredResource,
  unloadToStation,
} from '../../game/actions/trade.ts';
import { stationPhase } from '../../game/site/site.ts';
import { barColor, cr, duration, num, pct, unitsText } from '../format.ts';
import { Btn, Hint, Meter, Panel, Progress, Row, Tag } from '../kit.tsx';

/**
 * Cargo screen — the answer to "what did I mine and where did it go?".
 * One row per resource in the hold and in station storage, each row says what it
 * is worth here and which button moves it where.
 */

/** Recipes that consume / produce a resource, so the row can explain its use. */
function refinePaths(id: ResourceId): { uses: string[]; makes: string[] } {
  return {
    uses: RECIPES.filter((recipe) => (recipe.input[id] ?? 0) > 0).map((recipe) => recipe.name),
    makes: RECIPES.filter((recipe) => (recipe.output[id] ?? 0) > 0).map((recipe) => recipe.name),
  };
}

function rowList(counts: Partial<Record<ResourceId, number>>): [ResourceId, number][] {
  return (Object.entries(counts) as [ResourceId, number][])
    .filter(([, qty]) => (qty ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
}

export function CargoPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;

  const stats = shipStats(ship);
  const system = state.systems[ship.systemId];
  const holdUsed = cargoUsed(ship);
  const holdFree = cargoFree(ship);
  const founded = stationPhase(state) !== 'planned';
  const storeUsed = storageUsed(state.station);
  const storeCap = storageCapacity(state.station);
  const storeFree = storageFree(state.station);
  const ownStationHere = atOwnStation(state);
  const market = atMarket(state);
  const holdRows = rowList(ship.cargo);
  const storeRows = rowList(state.station.storage);

  const mining = miningStatus(state, ship);
  const mission = ship.mission?.kind === 'mine' ? ship.mission : null;
  const found = mission ? beltById(state, mission.beltId) : null;
  const belt = found?.belt ?? null;
  const perCycle = belt ? miningYieldPerCycle(ship, belt, miningBonus(state)) : null;
  const cycleTotal = perCycle ? Object.values(perCycle).reduce((sum, qty) => sum + qty, 0) : 0;

  return (
    <>
      <Panel
        title="Груз и склад"
        actions={<Tag color={market ? '#41f0c1' : undefined}>{market ? 'РЫНОК РЯДОМ' : 'БЕЗ РЫНКА'}</Tag>}
      >
        <div className="grid2 summary-grid">
          <Row label="Трюм" value={`${num(holdUsed)} / ${num(stats.cargo)} (свободно ${num(holdFree)})`} />
          <Row
            label="Склад станции"
            value={`${num(storeUsed)} / ${num(storeCap)} (свободно ${num(storeFree)})`}
          />
          <Row label="Где склад" value={founded ? `${state.station.name} · ${state.systems[state.station.systemId]?.name ?? '?'}` : 'участок не заложен — вкладка СТАНЦИЯ'} />
          <Row label="Свободный трюм" value={`${num(holdFree)} ед.`} />
          <Row label="Свободный склад" value={founded ? `${num(storeFree)} ед.` : '—'} />
          <Row label="Кредиты" value={cr(state.player.credits)} />
        </div>
        <Meter
          label="ТРЮМ"
          value={holdUsed}
          max={Math.max(1, stats.cargo)}
          color={barColor(1 - holdUsed / Math.max(1, stats.cargo))}
        />
        <Meter
          label="СКЛАД"
          value={storeUsed}
          max={Math.max(1, storeCap)}
          color={barColor(1 - storeUsed / Math.max(1, storeCap))}
        />
        <Hint>
          Добытое и купленное сначала попадает в трюм корабля. Со склада работают переработка и постройки, а
          продавать можно и из трюма, и со склада — если рядом есть рынок.
        </Hint>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn
            size="small"
            disabled={!ownStationHere || holdUsed <= 0}
            title={ownStationHere ? 'Выгрузить весь трюм на склад' : 'Только на своей станции'}
            onClick={() => run((draft) => unloadToStation(draft, null))}
          >
            ВСЁ НА СКЛАД
          </Btn>
          <Btn
            size="small"
            disabled={!ownStationHere || storeUsed <= 0}
            title={ownStationHere ? 'Взять со склада столько, сколько влезет в трюм' : 'Только на своей станции'}
            onClick={() =>
              run((draft) => {
                for (const [id, qty] of storeRows) loadFromStation(draft, id, qty);
              })
            }
          >
            СКЛАД → В ТРЮМ
          </Btn>
        </div>
      </Panel>

      {mission && belt ? (
        <Panel title="Идёт добыча" actions={<Tag color="#41f0c1">БУРЕНИЕ</Tag>} tight>
          <Row label="Пояс" value={`${belt.name} · ${system?.name ?? '?'}`} />
          <Row label="Богатство пояса" value={`${belt.richness.toFixed(2)}×`} />
          {mining ? (
            <>
              <Progress
                label={mining.phase === 'approach' ? 'Подход к поясу' : `Заход ${num(mining.piece)}`}
                fraction={mining.phase === 'approach' ? mining.approachProgress : mining.pieceProgress}
                color="#ffd166"
                right={
                  mining.plannedTotal > 0
                    ? `${num(mining.hauledTotal)}/${num(mining.plannedTotal)} ед. (${pct(mining.progress)})`
                    : 'до полного трюма'
                }
              />
              <Row label="Свободно в трюме" value={`${num(mining.cargoFree)} ед.`} />
              <Row
                label="Запас пояса"
                value={mining.exhausted ? 'выработан' : `осталось ${num(mining.reserveLeft)} ед.`}
              />
            </>
          ) : null}
          <Row
            label="Темп добычи"
            value={
              cycleTotal > 0
                ? `≈ ${num(cycleTotal)} ед. за ${duration(MINING_CYCLE_SECONDS)}`
                : 'нет подходящего оборудования'
            }
          />
          <Row label="В трюме ожидается" value={Object.entries(perCycle ?? {})
            .filter(([, qty]) => (qty ?? 0) > 0)
            .map(([id, qty]) => `${num(qty ?? 0)} ${resource(id as ResourceId).symbol}`)
            .join(' ') || '—'} />
          <Hint>
            Добыча идёт автоматически, пока в трюме есть место. План вахты, прогресс и кнопка «ОСТАНОВИТЬ ДОБЫЧУ» —
            во вкладке СИСТЕМА.
          </Hint>
        </Panel>
      ) : null}

      <Panel
        title={`Трюм корабля · ${num(holdUsed)}/${num(stats.cargo)}`}
        actions={<span className="dim">свободно {unitsText(holdFree)}</span>}
        tight
      >
        {holdRows.length === 0 ? (
          <Hint>
            Трюм пуст. Бурите пояс во вкладке СИСТЕМА или покупайте товар на РЫНКЕ — всё добытое и купленное
            появится здесь.
          </Hint>
        ) : (
          holdRows.map(([id, qty]) => {
            const def = resource(id);
            const share = qty / Math.max(1, stats.cargo);
            const sell = market ? sellPriceAt(state, id) : 0;
            const buy = market ? buyPriceAt(state, id) : 0;
            const paths = refinePaths(id);
            return (
              <div className="list-row col" key={id}>
                <div className="list-main">
                  <b style={{ color: def.color }}>
                    {def.symbol} <span className="dim">{def.name}</span>
                  </b>
                  <span className="dim">
                    в трюме {num(qty)} ед. · это {pct(share)} трюма · место {num(qty)} из {num(stats.cargo)}
                  </span>
                  {market ? (
                    <span className="dim">
                      здесь: купить {cr(buy)}/ед. · продать {cr(sell)}/ед. · вся партия {cr(sell * qty)}
                    </span>
                  ) : (
                    <span className="dim">рынка рядом нет — продать можно только на торговой станции</span>
                  )}
                  {paths.uses.length > 0 || paths.makes.length > 0 ? (
                    <span className="dim">
                      {paths.uses.length > 0 ? `переработка: ${paths.uses.join('; ')}` : ''}
                      {paths.makes.length > 0
                        ? `${paths.uses.length > 0 ? ' · ' : ''}получается: ${paths.makes.join('; ')}`
                        : ''}
                    </span>
                  ) : null}
                  <div className="row-actions">
                    <Btn
                      size="tiny"
                      kind="good"
                      disabled={!market}
                      title={market ? 'Продать всё это' : 'Нужен рынок рядом'}
                      onClick={() => run((draft) => sellResource(draft, id, qty))}
                    >
                      ПРОДАТЬ ВСЁ
                    </Btn>
                    <Btn
                      size="tiny"
                      disabled={!market || qty < 5}
                      title="Продать 5 единиц"
                      onClick={() => run((draft) => sellResource(draft, id, 5))}
                    >
                      ПРОДАТЬ 5
                    </Btn>
                    <Btn
                      size="tiny"
                      disabled={!ownStationHere}
                      title={ownStationHere ? 'Убрать на склад станции' : 'Только на своей станции'}
                      onClick={() => run((draft) => unloadToStation(draft, id))}
                    >
                      НА СКЛАД
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel
        title={`Склад станции · ${num(storeUsed)}/${num(storeCap)}`}
        actions={
          <Tag color={ownStationHere ? '#41f0c1' : undefined}>{ownStationHere ? 'ВЫ ЗДЕСЬ' : 'ДАЛЕКО'}</Tag>
        }
        tight
      >
        {storeRows.length === 0 ? (
          <Hint>
            Склад пуст. Сюда попадают грузы, выгруженные с корабля, и продукция переработки. Разгружайте руду
            перед переработкой.
          </Hint>
        ) : (
          storeRows.map(([id, qty]) => {
            const def = resource(id);
            const paths = refinePaths(id);
            const canLoad = ownStationHere && holdFree > 0;
            const loadable = Math.min(qty, Math.max(0, holdFree));
            return (
              <div className="list-row col" key={id}>
                <div className="list-main">
                  <b style={{ color: def.color }}>
                    {def.symbol} <span className="dim">{def.name}</span>
                  </b>
                  <span className="dim">
                    на складе {num(qty)} ед. · занимает {pct(qty / Math.max(1, storeUsed))} хранения
                  </span>
                  <span className="dim">
                    {paths.uses.length > 0
                      ? `идёт в переработку: ${paths.uses.join('; ')}`
                      : paths.makes.length > 0
                        ? `производится по рецепту: ${paths.makes.join('; ')}`
                        : 'используется только для продажи'}
                  </span>
                  <div className="row-actions">
                    <Btn
                      size="tiny"
                      disabled={!canLoad}
                      title={
                        canLoad
                          ? 'Загрузить в трюм корабля'
                          : 'Нужно быть на своей станции и иметь свободный трюм'
                      }
                      onClick={() => run((draft) => loadFromStation(draft, id, qty))}
                    >
                      В ТРЮМ ({num(loadable)})
                    </Btn>
                    <Btn
                      size="tiny"
                      kind="good"
                      disabled={!market || !ownStationHere}
                      title={
                        market && ownStationHere
                          ? 'Продать со склада по местной цене'
                          : 'Нужен рынок рядом и своя станция'
                      }
                      onClick={() => run((draft) => sellStoredResource(draft, id, qty))}
                    >
                      ПРОДАТЬ
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel title="Как это устроено" tight>
        <ul className="cargo-help">
          <li>
            <b>Добыча.</b> Бурите пояс во вкладке СИСТЕМА — руда, газ или редкая руда падают в трюм корабля.
          </li>
          <li>
            <b>Покупка.</b> Купленные товары тоже лежат в трюме, пока вы их не продадите или не выгрузите.
          </li>
          <li>
            <b>Продажа.</b> Кнопки «ПРОДАТЬ» работают там, где есть рынок; цена зависит от системы и вашей
            репутации.
          </li>
          <li>
            <b>Свой склад.</b> «НА СКЛАД» переносит груз на вашу станцию — это можно делать только там, где она
            стоит.
          </li>
          <li>
            <b>Переработка.</b> Перерабатывающий комплекс берёт сырьё <b>со склада</b> (вкладка СТАНЦИЯ) и
            возвращает готовый товар туда же.
          </li>
        </ul>
      </Panel>
    </>
  );
}
