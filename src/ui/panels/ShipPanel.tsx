import { useState } from 'react';
import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { shipType } from '../../game/data/ships.ts';
import { resource } from '../../game/data/resources.ts';
import { moduleDef } from '../../game/data/modules.ts';
import { makerDef } from '../../game/data/makers.ts';
import { MODULE_GROUPS } from '../../game/data/modules.ts';
import { cargoUsed, makerOf, sealedTotal, shipStats } from '../../game/ships/ship.ts';
import { renameShip, shipyardHere } from '../../game/actions/outfitting.ts';
import { refuelCost, refuelShip, repairCost, repairShip, serviceHere } from '../../game/actions/trade.ts';
import { depotHere, depotRefusal } from '../../game/sim/depots.ts';
import { barColor, cr, num } from '../format.ts';
import { Btn, Hint, Hub, Meter, Panel, Row, Tag, Tile } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Раздел «Корабль»: состояние флагмана и входы в сервисы. Установка модулей
 * переехала на подэкран верфи — здесь остались сводка сборки, док и ремонт.
 */

export function ShipPanel({
  state,
  run,
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  const [draftName, setDraftName] = useState('');
  if (!ship) return null;

  const stats = shipStats(ship);
  const type = shipType(ship.typeId);
  const yard = shipyardHere(state, ship);
  const depot = depotHere(state);
  const refuelService = serviceHere(state, 'refuel');
  const repairService = serviceHere(state, 'repair');
  const docked = refuelService?.ok === true;
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
          <Row label="Опечатанный груз" value={`${num(sealed)} ед. · контракт, продаже не подлежит`} />
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
        <div className="name-row">
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

      <Panel title="Куда дальше" tight>
        <Hub>
          <Tile
            label="ВЕРФЬ"
            hint={yard.tier > 0 ? `${yard.label} · до Mk ${Math.min(3, yard.tier + 1)}` : 'нет доступной верфи'}
            tone={yard.tier > 0 ? 'primary' : undefined}
            disabled={yard.tier <= 0}
            title={yard.tier > 0 ? 'Модули и корпуса' : yard.blockedReason ?? 'В этой системе верфи нет'}
            onClick={() => onOpen({ id: 'shipyard' })}
          />
          <Tile
            label="СКЛАД"
            hint={depot ? `${depot.name} · свободно ${num(depot.free)} ед.` : 'нет доступного склада'}
            disabled={!depot}
            title={depot ? 'Переложить груз между трюмом и складом' : depotRefusal(state) ?? 'Склад недоступен'}
            onClick={() => onOpen({ id: 'storage' })}
          />
          <Tile label="СТАНЦИЯ" hint="услуги, рынок, контракты" onClick={() => onOpen({ id: 'stations' })} />
          <Tile label="РЫНОК" hint="цены и продажа" onClick={() => onOpen({ id: 'market' })} />
        </Hub>
        <Hint>Кнопки открывают подэкраны: из них возвращает «назад» или аппаратная кнопка телефона.</Hint>
      </Panel>


      <Panel title="Сборка корабля" tight>
        {MODULE_GROUPS.map((group) => {
          const installed = group.types.map((entry) => ({
            type: entry,
            level: ship.modules[entry] ?? 0,
            maker: makerOf(ship, entry),
          }));
          const maxInstalled = installed.reduce((max, item) => Math.max(max, item.level), 0);
          return (
            <div className="list-row" key={group.id}>
              <div className="list-main">
                <b>{group.label}</b>
                <span className="dim">
                  {installed
                    .map((item) => {
                      const short = moduleDef(item.type).short;
                      if (item.level <= 0) return `${short}: пусто`;
                      const mark = item.maker === 'standard' ? '' : ` ·${makerDef(item.maker).short}`;
                      return `${short}: Mk ${item.level}${mark}`;
                    })
                    .join(' · ')}
                </span>
              </div>
              <Tag color={maxInstalled > 0 ? '#41f0c1' : undefined}>
                {maxInstalled > 0 ? `Mk ${maxInstalled}` : 'ПУСТО'}
              </Tag>
            </div>
          );
        })}
        <Hint>
          {yard.tier > 0
            ? `Модули ставит ${yard.label}. Откройте «Верфь», чтобы посмотреть предложения.`
            : 'Модули продают верфи фракций; свою верфь можно построить на базе.'}
        </Hint>
      </Panel>

      <Panel
        title="Службы дока"
        actions={
          <Tag color={docked ? '#41f0c1' : undefined}>
            {docked ? 'ДОСТУПНО' : repairService?.ok ? 'ТОЛЬКО РЕМОНТ' : 'НУЖНА СТАНЦИЯ'}
          </Tag>
        }
        tight
      >
        <Row label="Заправка" value={refuelService?.station.name ?? 'станции с заправкой рядом нет'} />
        <Row label="Ремонт" value={repairService?.station.name ?? 'в этой системе не ремонтируют'} />
        <Row label="Заправка до полного" value={refuelPrice > 0 ? cr(refuelPrice) : 'баки полны'} />
        <Row label="Ремонт корпуса и щитов" value={repairPrice > 0 ? cr(repairPrice) : 'повреждений нет'} />
        <div className="row-actions">
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
          Своя станция ремонтирует и заправляет дешевле: «Док» и «Верфь» на базе снижают цену услуг и установки
          модулей.
        </Hint>
      </Panel>
    </>
  );
}
