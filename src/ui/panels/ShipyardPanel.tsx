import type { GameState, ModuleType } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { moduleDef, requiredShipyardLevel } from '../../game/data/modules.ts';
import { makerDef } from '../../game/data/makers.ts';
import {
  hullsForSale,
  installModule,
  moduleOfferGroups,
  purchaseShip,
  shipyardHere,
} from '../../game/actions/outfitting.ts';
import { cr, num } from '../format.ts';
import { Btn, Hint, Panel, Row, Tag } from '../kit.tsx';

/**
 * Подэкран верфи: модули и корпуса. Отдельный экран, потому что сюда приходят
 * из двух мест — из раздела «Корабль» и из меню станции с верфью.
 */

export function ShipyardPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;

  const yard = shipyardHere(state, ship);
  const groups = moduleOfferGroups(state, ship);
  const hulls = hullsForSale(state, ship);
  const liveShip = (draft: GameState) => draft.ships.find((s) => s.id === ship.id)!;

  if (yard.tier <= 0) {
    return (
      <Panel title="Верфь" actions={<Tag color="#ffb347">НЕДОСТУПНА</Tag>}>
        <Hint>{yard.blockedReason ?? 'В этой системе верфи нет.'}</Hint>
        <Hint>
          Верфи фракций стоят в узловых системах: ищите их в услугах станций. Свою верфь можно построить на базе —
          тогда клеймо будет «Фронтир».
        </Hint>
        <Row label="Своя верфь в системе" value={yard.ownLevel > 0 ? `Mk ${yard.ownLevel}` : 'не построена'} />
      </Panel>
    );
  }

  return (
    <>
      <Panel title="Верфь" actions={<Tag color="#41f0c1">{yard.source === 'own' ? 'СВОЯ' : 'ФРАКЦИЯ'}</Tag>}>
        <Row label="Кто ставит" value={`${yard.label} · модули до Mk ${Math.min(3, yard.tier + 1)}`} />
        <Row label="Клеймо сборки" value={makerDef(yard.maker).name} />
        <Hint>
          {yard.hint} Модули разных верфей сочетаются на одном корпусе: клеймо видно в названии. Материалы верфь
          берёт из трюма, а со склада рядом — если он есть.
        </Hint>
      </Panel>

      {groups.map((group) => (
        <Panel
          key={group.id}
          title={group.label}
          actions={
            <Tag color={group.maxInstalled > 0 ? '#41f0c1' : undefined}>
              {group.maxInstalled > 0 ? `Mk ${group.maxInstalled}` : 'НЕ СТАВИЛОСЬ'}
            </Tag>
          }
          tight
        >
          <Hint>
            {group.installed
              .map((entry) => {
                const short = moduleDef(entry.type).short;
                if (entry.level <= 0) return `${short}: пусто`;
                const mark = entry.maker === 'standard' ? '' : ` ·${makerDef(entry.maker).short}`;
                return `${short}: Mk ${entry.level}${mark}`;
              })
              .join(' · ')}
          </Hint>
          {group.hint ? <Hint>{group.hint}</Hint> : null}
          {group.offers.map((offer) => {
            const canInstall =
              !offer.owned && !offer.locked && offer.affordable && offer.powered && offer.hasMaterials;
            const missing = offer.needs.filter((need) => !need.ok);
            const reason = offer.owned
              ? 'Уже установлено'
              : offer.locked
                ? `Нужна верфь уровня ${requiredShipyardLevel(offer.level)}: ${yard.label}`
                : !offer.powered
                  ? 'Перегрузка реактора — поставьте реактор мощнее'
                  : missing.length > 0
                    ? `Не хватает: ${missing.map((need) => `${need.name} ${need.have}/${need.need}`).join(', ')}`
                    : !offer.affordable
                      ? 'Не хватает кредитов'
                      : 'Можно установить';
            return (
              <div className="list-row" key={`${offer.type}-${offer.level}`}>
                <div className="list-main">
                  <b>{offer.name}</b>
                  <span className="dim">
                    {offer.cost > 0 ? `${cr(offer.cost)} · ` : 'есть · '}
                    {offer.power > 0 ? `${num(offer.power)} эн · ` : ''}
                    {offer.note}
                  </span>
                  {offer.needs.length > 0 ? (
                    <span className="dim">
                      материалы:{' '}
                      {offer.needs
                        .map((need) => `${need.name} ${num(need.have)}/${num(need.need)}${need.ok ? '' : ' ✗'}`)
                        .join(' · ')}
                    </span>
                  ) : null}
                </div>
                <Btn
                  size="small"
                  kind="primary"
                  disabled={!canInstall}
                  title={reason}
                  onClick={() =>
                    run((draft) => installModule(draft, liveShip(draft), offer.type as ModuleType, offer.level))
                  }
                >
                  {offer.owned ? 'УСТАНОВЛЕНО' : 'УСТАНОВИТЬ'}
                </Btn>
              </div>
            );
          })}
        </Panel>
      ))}

      {hulls.length > 0 ? (
        <Panel title="Корпуса на продажу" actions={<span className="dim">лимит задаёт офис флота</span>} tight>
          {hulls.map((hull) => (
            <div className="list-row" key={hull.typeId}>
              <div className="list-main">
                <b>{hull.name}</b>
                <span className="dim">
                  {hull.role} · {cr(hull.price)}
                  {hull.slotFree ? '' : ' · флот заполнен'}
                </span>
              </div>
              <Btn
                size="small"
                kind="primary"
                disabled={!hull.affordable || !hull.slotFree}
                title={
                  !hull.slotFree
                    ? 'Достигнут лимит флота'
                    : !hull.affordable
                      ? 'Не хватает кредитов'
                      : 'Купить и оставить здесь'
                }
                onClick={() => run((draft) => purchaseShip(draft, hull.typeId))}
              >
                КУПИТЬ
              </Btn>
            </div>
          ))}
          <Hint>
            Новые корпуса приходят без модулей: поставьте буровое оборудование, прежде чем отправлять корабль в
            пояс.
          </Hint>
        </Panel>
      ) : null}

    </>
  );
}