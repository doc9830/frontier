import type { GameState } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { SERVICE_INFO, dockedStations, stationServiceList, stationTypeLabel } from '../../game/data/stations.ts';
import type { StationService } from '../../game/data/stations.ts';
import { stationPhaseLabel } from '../../game/site/site.ts';
import { refuelCost, refuelShip, repairCost, repairShip } from '../../game/actions/trade.ts';
import { cr } from '../format.ts';
import { Btn, Hint, Hub, Panel, Row, Tag, Tile } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Меню станции: услуги идут ОТДЕЛЬНЫМИ кнопками, а не панелями в общем списке.
 * Верфь, рынок, контракты и склад открываются отсюда как подэкраны со своей
 * кнопкой «назад».
 */

const SERVICE_SCREEN: Partial<Record<StationService, Screen['id']>> = {
  market: 'market',
  shipyard: 'shipyard',
  contracts: 'contracts',
  storage: 'storage',
};

const SERVICE_HUB: [StationService, string, string][] = [
  ['market', 'РЫНОК', 'купить и продать'],
  ['contracts', 'КОНТРАКТЫ', 'доставка грузов'],
  ['shipyard', 'ВЕРФЬ', 'модули и корпуса'],
  ['storage', 'СКЛАД', 'оставить груз'],
];

export function StationServices({
  state,
  run,
  stationId,
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  stationId?: string;
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;
  const entries = dockedStations(state, ship.systemId);
  const entry = entries.find((item) => item.station.id === stationId) ?? entries[0] ?? null;

  if (!entry) {
    return (
      <Panel title="Станции системы">
        <Hint>В этой системе станций нет: прыгайте к соседям или заложите свою базу.</Hint>
        <div className="row-actions">
          <Btn size="small" kind="primary" onClick={() => onOpen({ id: 'site' })}>
            СТРОИТЕЛЬСТВО СТАНЦИИ
          </Btn>
        </div>
      </Panel>
    );
  }

  const station = entry.station;
  const own = entry.own;
  const refuelPrice = entry.allowed.refuel ? refuelCost(state, ship) : 0;
  const repairPrice = entry.allowed.repair ? repairCost(state, ship) : 0;
  const liveShip = (draft: GameState) => draft.ships.find((s) => s.id === ship.id)!;

  return (
    <>
      <Panel
        title={station.name}
        actions={
          <Tag color={own ? '#41f0c1' : undefined}>{own ? 'ВАША БАЗА' : stationTypeLabel(station.type)}</Tag>
        }
      >
        <div className="grid2">
          <Row
            label="Владелец"
            value={
              own
                ? 'частное владение'
                : station.factionId
                  ? state.factions[station.factionId]?.name ?? station.factionId
                  : 'безвластие'
            }
          />
          <Row
            label="Репутация"
            value={station.factionId ? state.player.reputation[station.factionId] ?? 0 : 'не требуется'}
          />
          {own ? <Row label="Стадия" value={stationPhaseLabel(state.station.phase)} /> : null}
          {own ? <Row label="Командный центр" value={`Mk ${state.station.level}`} /> : null}
          <Row
            label="Услуги"
            value={
              stationServiceList(station)
                .map((service) => SERVICE_INFO[service].short)
                .join(' ') || 'нет'
            }
          />
        </div>
        {entry.reason ? <Hint>{entry.reason}</Hint> : null}
        <Hint>Выберите услугу: каждая открывается своим экраном с кнопкой «назад».</Hint>
        <Hub>
          {own ? (
            <Tile
              label="УПРАВЛЕНИЕ БАЗОЙ"
              hint="стройка, переработка, исследования"
              tone="primary"
              onClick={() => onOpen({ id: 'base' })}
            />
          ) : null}
          {SERVICE_HUB.map(([service, label, hint]) =>
            entry.services[service] ? (
              <Tile
                key={service}
                label={label}
                hint={hint}
                disabled={!entry.allowed[service]}
                title={
                  entry.allowed[service]
                    ? SERVICE_INFO[service].hint
                    : `Недоступно: ${SERVICE_INFO[service].label.toLowerCase()} закрыт (репутация)`
                }
                onClick={() => {
                  const target = SERVICE_SCREEN[service];
                  if (target) onOpen({ id: target, stationId: station.id });
                }}
              />
            ) : null,
          )}
        </Hub>
      </Panel>
      {entry.services.refuel || entry.services.repair ? (
        <Panel title="Доковые службы" tight>
          <Row label="Заправка до полного" value={refuelPrice > 0 ? cr(refuelPrice) : 'баки полны'} />
          <Row label="Ремонт корпуса и щитов" value={repairPrice > 0 ? cr(repairPrice) : 'повреждений нет'} />
          <div className="row-actions">
            <Btn
              size="small"
              disabled={!entry.allowed.refuel || refuelPrice <= 0 || state.player.credits < refuelPrice}
              title={entry.allowed.refuel ? 'Залить 40 единиц топлива' : 'Здесь не заправляют'}
              onClick={() => run((draft) => refuelShip(draft, liveShip(draft), 40))}
            >
              ЗАПРАВИТЬ 40
            </Btn>
            <Btn
              size="small"
              disabled={!entry.allowed.refuel || refuelPrice <= 0 || state.player.credits < refuelPrice}
              title={entry.allowed.refuel ? 'Заправиться до полного бака' : 'Здесь не заправляют'}
              onClick={() => run((draft) => refuelShip(draft, liveShip(draft), 9999))}
            >
              ПОЛНЫЙ БАК
            </Btn>
            <Btn
              size="small"
              kind="good"
              disabled={!entry.allowed.repair || repairPrice <= 0 || state.player.credits < repairPrice}
              title={entry.allowed.repair ? 'Починить корпус и щиты' : 'Здесь не ремонтируют'}
              onClick={() => run((draft) => repairShip(draft, liveShip(draft)))}
            >
              РЕМОНТ
            </Btn>
          </div>
          <Hint>
            Своя верфь и док снижают стоимость заправки, ремонта и установки модулей: держите их в порядке.
          </Hint>
        </Panel>
      ) : null}
    </>
  );
}
