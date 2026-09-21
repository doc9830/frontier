import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { resource } from '../../game/data/resources.ts';
import { RECIPES } from '../../game/data/recipes.ts';
import { cargoFree, cargoUsed, sealedTotal, sellableUnits, shipStats } from '../../game/ships/ship.ts';
import { depotHere, depotRefusal } from '../../game/sim/depots.ts';
import {
  atMarket,
  marketRefusal,
  sellEverything,
  sellPriceAt,
  sellResource,
  unloadToStation,
} from '../../game/actions/trade.ts';
import { cr, num } from '../format.ts';
import { Btn, Hint, Hub, Panel, Row, Tag, Tile } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Раздел «Груз»: что лежит в трюме, сколько это стоит здесь и две кнопки —
 * «Рынок» и «Склад». Оба открываются отдельными экранами: у каждого свои
 * действия и свой объём.
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
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;

  const stats = shipStats(ship);
  const holdUsed = cargoUsed(ship);
  const holdFree = cargoFree(ship);
  const hold = rowList(ship.cargo);
  const sealed = sealedTotal(ship);
  const market = atMarket(state);
  const depot = depotHere(state);
  const refusal = marketRefusal(state);
  const depotNote = depotRefusal(state);

  return (
    <>
      <Panel
        title="Груз"
        actions={<Tag color={market ? '#41f0c1' : undefined}>{market ? 'РЫНОК РЯДОМ' : 'БЕЗ РЫНКА'}</Tag>}
      >
        <div className="grid2 summary-grid">
          <Row label="Трюм" value={`${num(holdUsed)} / ${num(stats.cargo)} (свободно ${num(holdFree)})`} />
          <Row label="Кредиты" value={cr(state.player.credits)} />
          <Row label="Склад здесь" value={depot ? `${depot.name} · свободно ${num(depot.free)} ед.` : 'нет'} />
          {sealed > 0 ? <Row label="Опечатано" value={`${num(sealed)} ед. контракт`} /> : null}
        </div>
        <Hub>
          <Tile
            label="РЫНОК"
            hint={market ? 'купить и продать' : 'в этой системе закрыт'}
            tone={market ? 'primary' : undefined}
            disabled={!market}
            title={market ? 'Цены, покупка и продажа' : refusal ?? 'Рынка рядом нет'}
            onClick={() => onOpen({ id: 'market' })}
          />
          <Tile
            label="СКЛАД"
            hint={depot ? `${num(depot.used)} / ${num(depot.capacity)} ед.` : 'недоступен'}
            disabled={!depot}
            title={
              depot
                ? `${depot.name}: ${depot.own ? 'свой склад' : 'арендованная ячейка'}`
                : depotNote ?? 'Склад недоступен'
            }
            onClick={() => onOpen({ id: 'storage' })}
          />
        </Hub>
        <div className="row-actions">
          <Btn
            size="small"
            kind="primary"
            disabled={!market || holdUsed - sealed <= 0}
            title={market ? 'Продать всё, что не под пломбой' : refusal ?? 'Рынка рядом нет'}
            onClick={() => run((draft) => sellEverything(draft))}
          >
            ПРОДАТЬ ВСЁ
          </Btn>
          <Btn
            size="small"
            disabled={!depot || holdUsed - sealed <= 0}
            title={depot ? `Разгрузить трюм на «${depot.name}»` : depotNote ?? 'Склад недоступен'}
            onClick={() => run((draft) => unloadToStation(draft, null))}
          >
            НА СКЛАД
          </Btn>
        </div>
      </Panel>

      <Panel title="В трюме" actions={<span className="dim">{hold.length} вид(ов) груза</span>} tight>
        {hold.length === 0 ? (
          <Hint>Трюм пуст. Руду берут в поясах («Система» → «Ресурсы»), товары — на рынке.</Hint>
        ) : (
          hold.map(([id, qty]) => {
            const def = resource(id);
            const paths = refinePaths(id);
            const sellable = sellableUnits(ship, id);
            const price = market ? sellPriceAt(state, id) : 0;
            const toDepot = depot ? Math.min(qty, depot.free) : 0;
            return (
              <div className="list-row col" key={id}>
                <div className="list-main">
                  <b style={{ color: def.color }}>
                    {def.symbol} <span className="dim">{def.name}</span>
                  </b>
                  <span className="dim">
                    {num(qty)} ед.
                    {market
                      ? ` · цена продажи ${cr(price)} за ед. · партия ${cr(price * sellable)}`
                      : ' · здесь не продать'}
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
                      kind="good"
                      disabled={!market || sellable <= 0}
                      title={market ? 'Продать всё, что не под пломбой' : 'Рынка рядом нет'}
                      onClick={() => run((draft) => sellResource(draft, id, sellable))}
                    >
                      ПРОДАТЬ ({num(sellable)})
                    </Btn>
                    <Btn
                      size="tiny"
                      disabled={toDepot <= 0}
                      title={depot ? 'Перенести на склад' : 'Склада рядом нет'}
                      onClick={() => run((draft) => unloadToStation(draft, id))}
                    >
                      НА СКЛАД ({num(toDepot)})
                    </Btn>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {sealed > 0 ? (
          <Hint>
            {num(sealed)} ед. лежат под пломбой контракта: их нельзя продать или сдать на склад — только доставить
            заказчику.
          </Hint>
        ) : null}
      </Panel>

      <Panel title="Как это устроено" tight>
        <ul className="cargo-help">
          <li>
            <b>Добыча.</b> Бурите пояс в разделе «Система» → «Ресурсы»: руда, газ или редкая руда падают в трюм.
          </li>
          <li>
            <b>Покупка.</b> Купленные товары тоже лежат в трюме, пока вы их не продадите или не выгрузите.
          </li>
          <li>
            <b>Продажа.</b> «РЫНОК» работает там, где станция держит рынок; цена зависит от системы, репутации и
            исследований.
          </li>
          <li>
            <b>Склады.</b> Свой склад стоит на вашей станции, а на станциях фракций ячейку можно арендовать. Груз
            лежит именно на той станции, где вы его оставили.
          </li>
          <li>
            <b>Переработка.</b> Перерабатывающий комплекс берёт сырьё со склада базы и возвращает товар туда же.
          </li>
        </ul>
      </Panel>


    </>
  );
}