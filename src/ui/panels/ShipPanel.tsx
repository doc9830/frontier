import { useState } from 'react';
import type { GameState, ModuleType, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { shipType } from '../../game/data/ships.ts';
import { resource } from '../../game/data/resources.ts';
import { moduleDef, requiredShipyardLevel } from '../../game/data/modules.ts';
import { makerDef } from '../../game/data/makers.ts';
import { cargoUsed, sealedTotal, shipStats } from '../../game/ships/ship.ts';
import {
  hullsForSale,
  installModule,
  moduleOfferGroups,
  purchaseShip,
  renameShip,
  shipyardHere,
} from '../../game/actions/outfitting.ts';
import {
  refuelCost,
  refuelShip,
  repairCost,
  repairShip,
  serviceHere,
} from '../../game/actions/trade.ts';
import { barColor, cr, num } from '../format.ts';
import { Btn, Hint, Meter, Panel, Row, Tag } from '../kit.tsx';


/** Flagship screen: stats, module fitting, dock services and hull sales. */

export function ShipPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  const [draftName, setDraftName] = useState('');
  if (!ship) return null;

  const stats = shipStats(ship);
  const type = shipType(ship.typeId);
  const groups = moduleOfferGroups(state, ship);
  const hulls = hullsForSale(state, ship);
  // Доковые услуги теперь отдельный сервис: он может быть закрыт по репутации.
  const refuelService = serviceHere(state, 'refuel');
  const repairService = serviceHere(state, 'repair');
  const docked = refuelService?.ok === true;
  const yard = shipyardHere(state, ship);
  const sealed = sealedTotal(ship);
  const refuelPrice = refuelCost(state, ship);
  const repairPrice = repairCost(state, ship);
  const cargoEntries = (Object.entries(ship.cargo) as [string, number][]).filter(([, qty]) => qty > 0);
  const liveShip = (draft: GameState) => draft.ships.find((s) => s.id === ship.id)!;
  const rename = (): void => {
    const name = draftName.trim();
    if (!name) return;
    run((draft) => renameShip(draft, ship.id, name));
    setDraftName('');
  };


  return (
    <>
      <Panel
        title={`Корабль · ${ship.name}`}
        actions={
          <>
            <Tag>{type.name}</Tag>
            <Tag color="#41f0c1">{type.role}</Tag>
          </>
        }
      >
        <div className="grid3">
          <div className="statbox">
            <span>СКОРОСТЬ</span>
            <b>{num(stats.speed)}</b>
          </div>
          <div className="statbox">
            <span>ПРЫЖОК</span>
            <b>{num(stats.jumpRange)}</b>
          </div>
          <div className="statbox">
            <span>БОЙ</span>
            <b>{num(stats.combat)}</b>
          </div>
          <div className="statbox">
            <span>ДОБЫЧА</span>
            <b>{num(stats.mining)}</b>
          </div>
          <div className="statbox">
            <span>СКАНЕР</span>
            <b>{num(stats.scanner)}</b>
          </div>
          <div className="statbox">
            <span>ЭНЕРГИЯ</span>
            <b style={{ color: stats.powerDraw > stats.powerCapacity ? '#ff6b6b' : undefined }}>
              {num(stats.powerDraw)}/{num(stats.powerCapacity)}
            </b>
          </div>
        </div>

        <Meter label="КОРПУС" value={ship.hull} max={stats.hullMax} color={barColor(ship.hull / stats.hullMax)} />
        <Meter
          label="ЩИТ"
          value={ship.shield}
          max={stats.shieldMax}
          color={barColor(ship.shield / Math.max(1, stats.shieldMax))}
        />
        <Meter label="ТОПЛИВО" value={ship.fuel} max={stats.fuelMax} color="#ffb347" />

        <Row label="Трюм" value={`${num(cargoUsed(ship))} / ${num(stats.cargo)} ед.`} />
        {sealed > 0 ? (
          <Row
            label="Опечатанный груз"
            value={`${num(sealed)} ед. · контракт, продаже не подлежит`}
          />
        ) : null}
        <Row label="Побед в бою" value={num(ship.kills)} />
        <Row label="Добыто" value={`${num(ship.minedUnits)} ед.`} />
        <Row label="Оборот торговли" value={cr(ship.tradedCredits)} />
        {cargoEntries.length > 0 ? (
          <Hint>
            В трюме: {cargoEntries.map(([id, qty]) => `${num(qty)} ${resource(id as ResourceId).name}`).join(' · ')}
          </Hint>
        ) : (
          <Hint>Трюм пуст.</Hint>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="text"
            placeholder="новое имя корабля"
            value={draftName}
            maxLength={18}
            onChange={(event) => setDraftName(event.target.value)}
          />
          <Btn size="small" disabled={!draftName.trim()} onClick={rename}>
            ПЕРЕИМЕНОВАТЬ
          </Btn>
        </div>
      </Panel>

      <Panel
        title="Модули"
        actions={
          <Tag color={yard.tier > 0 ? '#41f0c1' : undefined}>
            {yard.tier > 0 ? 'ВЕРФЬ РЯДОМ' : 'НЕТ ВЕРФИ'}
          </Tag>
        }
        tight
      >
        <Row
          label="Верфь"
          value={
            yard.tier > 0
              ? `${yard.label} · модули до Mk ${Math.min(3, yard.tier + 1)}`
              : yard.blockedReason ?? 'в этой системе верфи нет'
          }
        />
        <Hint>
          {yard.hint} Модули разных верфей сочетаются на одном корпусе: клеймо видно в названии. Материалы верфь
          берёт из трюма, а на своей базе — ещё и со склада; недостающее продают на рынке.
        </Hint>
        {groups.map((group) => (
          <div key={group.id}>
            <div className="list-row">
              <div className="list-main">
                <b>{group.label}</b>
                <span className="dim">
                  {group.installed
                    .map((entry) => {
                      const short = moduleDef(entry.type).short;
                      if (entry.level <= 0) return `${short}: пусто`;
                      const mark = entry.maker === 'standard' ? '' : `·${makerDef(entry.maker).short}`;
                      return `${short}: Mk ${entry.level}${mark}`;
                    })
                    .join(' · ')}
                </span>
              </div>
              <Tag color={group.maxInstalled > 0 ? '#41f0c1' : undefined}>
                {group.maxInstalled > 0 ? `Mk ${group.maxInstalled}` : 'НЕ СТАВИЛОСЬ'}
              </Tag>
            </div>
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
                          .map(
                            (need) =>
                              `${need.name} ${num(need.have)}/${num(need.need)}${need.ok ? '' : ' ✗'}`,
                          )
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
          </div>
        ))}
      </Panel>

      <Panel
        title="Службы дока"
        actions={
          <Tag color={docked ? '#41f0c1' : undefined}>
            {docked ? 'ДОСТУПНО' : repairService ? 'РЕМОНТ ЗАКРЫТ' : 'НУЖНА СТАНЦИЯ'}
          </Tag>
        }
        tight
      >
        <Row
          label="Заправка"
          value={refuelService ? refuelService.station.name : 'станции с заправкой рядом нет'}
        />
        <Row
          label="Ремонт"
          value={
            repairService
              ? repairService.ok
                ? repairService.station.name
                : repairService.reason ?? 'закрыт'
              : 'в этой системе не ремонтируют'
          }
        />
        <Row
          label="Верфь"
          value={yard.tier > 0 ? `${yard.label} · модули до Mk ${Math.min(3, yard.tier + 1)}` : yard.blockedReason ?? 'в этой системе верфи нет'}
        />
        <Row label="Заправка до полного" value={refuelPrice > 0 ? cr(refuelPrice) : 'баки полны'} />
        <Row label="Ремонт корпуса и щитов" value={repairPrice > 0 ? cr(repairPrice) : 'повреждений нет'} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn
            size="small"
            disabled={!docked || refuelPrice <= 0 || state.player.credits < refuelPrice}
            title={docked ? 'Залить 40 единиц топлива' : refuelService?.reason ?? 'Нужна станция с заправкой'}
            onClick={() => run((draft) => refuelShip(draft, liveShip(draft), 40))}
          >
            ЗАПРАВИТЬ 40
          </Btn>
          <Btn
            size="small"
            disabled={!docked || refuelPrice <= 0 || state.player.credits < refuelPrice}
            title={docked ? 'Заправиться до полного бака' : refuelService?.reason ?? 'Нужна станция с заправкой'}
            onClick={() => run((draft) => refuelShip(draft, liveShip(draft), 9999))}
          >
            ПОЛНЫЙ БАК
          </Btn>
          <Btn
            size="small"
            kind="good"
            disabled={!repairService?.ok || repairPrice <= 0 || state.player.credits < repairPrice}
            title={repairService?.ok ? 'Починить корпус и щиты' : repairService?.reason ?? 'Нужна ремонтная станция'}
            onClick={() => run((draft) => repairShip(draft, liveShip(draft)))}
          >
            РЕМОНТ
          </Btn>
        </div>
        <Hint>
          Модули и корпуса продают только на станциях с верфью, и только если фракция вас обслуживает. Свои «Док» и
          «Верфь» снижают стоимость ремонта, заправки и установки модулей на вашей станции.
        </Hint>
      </Panel>

      {hulls.length > 0 ? (
        <Panel title="Корпуса на продажу" actions={<span className="dim">лимит задаёт офис флота</span>} tight>
          {hulls.map((hull) => (
            <div className="list-row" key={hull.typeId}>
              <div className="list-main">
                <b>{hull.name}</b>
                <span className="dim">
                  {hull.role} · {cr(hull.price)}
                  {!hull.slotFree ? ' · флот заполнен' : ''}
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
