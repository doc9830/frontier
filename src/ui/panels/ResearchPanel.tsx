import type { GameState, ResourceId, SurveyKind } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { shipStats } from '../../game/ships/ship.ts';
import { resource } from '../../game/data/resources.ts';
import { beltReserve, beltWear, MIN_BELT_RESERVE } from '../../game/data/belts.ts';
import {
  SURVEY_INFO,
  cancelSurvey,
  deepScanTargets,
  startSurvey,
  surveyBlockedReason,
  surveyFuel,
  surveyScannerFactor,
  surveySeconds,
  surveyStatus,
} from '../../game/exploration/scan.ts';
import { stationPhase } from '../../game/site/site.ts';
import { duration, num } from '../format.ts';
import { Btn, Hint, Panel, Progress, Row, Tag } from '../kit.tsx';
import type { Screen } from '../nav.ts';

/**
 * Подэкран «Исследование»: полный скан системы, разведка поясов и дальний скан.
 *
 * Скан — вход во всю остальную игру: без изученных поясов нет добычи, без
 * полного скана системы нет планет и участка под собственную станцию. Поэтому
 * подэкран живёт в разделе «Система» первой кнопкой.
 */

export function ResearchPanel({
  state,
  run,
  onOpen,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
  /** Переход к добыче после скана пояса. */
  onOpen: (screen: Screen) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;
  const system = state.systems[ship.systemId];
  if (!system) return null;
  const stats = shipStats(ship);
  const status = surveyStatus(state);
  const scannerFactor = surveyScannerFactor(ship);
  const siteNote =
    stationPhase(state) === 'operational'
      ? 'бонус площадки работает'
      : 'бонус площадки включится после КЦ Mk1';
  const seconds = (kind: SurveyKind): number => surveySeconds(state, ship, kind);
  const scanned = system.belts.filter((belt) => belt.discovered).length;


  return (
    <>
      <Panel
        title={`Исследование · ${system.name}`}
        actions={
          <Tag color={system.scanned ? '#41f0c1' : '#ffd166'}>{system.scanned ? 'СКАН ЕСТЬ' : 'НЕ ИЗУЧЕНА'}</Tag>
        }
      >
        <div className="grid3">
          <div className="statbox">
            <span>СКАНЕР</span>
            <b>{stats.scanner}</b>
          </div>
          <div className="statbox">
            <span>МНОЖИТЕЛЬ ВРЕМЕНИ</span>
            <b>×{scannerFactor.toFixed(2)}</b>
          </div>
          <div className="statbox">
            <span>ТОПЛИВО</span>
            <b>
              {Math.floor(ship.fuel)}/{stats.fuelMax}
            </b>
          </div>
        </div>
        <Hint>
          Сканер тратит топливо на каждую задачу и работает только над одной за раз. Модуль сканера ускоряет
          работу; {siteNote}. Изучено поясов: {num(scanned)} из {num(system.belts.length)}.
        </Hint>
        {status ? (
          <>
            <Progress
              label={status.label}
              fraction={status.progress}
              color="#5ec8ff"
              right={`осталось ${duration(status.secondsLeft)}`}
            />
            <Row
              label="Цель"
              value={
                status.beltName
                  ? `пояс ${status.beltName}`
                  : status.targetName
                    ? `через систему ${status.targetName}`
                    : `система ${status.systemName}`
              }
            />
            <div className="row-actions">
              <Btn size="small" kind="bad" onClick={() => run((draft) => cancelSurvey(draft))}>
                ПРЕРВАТЬ СКАН
              </Btn>
            </div>
          </>
        ) : (
          <Hint>{ship.status === 'survey' ? 'Сканер работает.' : 'Сканер свободен.'}</Hint>
        )}
      </Panel>

      <Panel
        title="Полный скан системы"
        actions={
          <span className="dim">
            {duration(seconds('system'))} · {surveyFuel('system')} топл.
          </span>
        }
        tight
      >
        {system.scanned ? (
          <Hint>Система изучена: планеты и пояса на карте, участок под станцию выбирать можно.</Hint>
        ) : (
          <>
            <Hint>{SURVEY_INFO.system.hint}</Hint>
            <div className="row-actions">
              <Btn
                size="small"
                kind="primary"
                disabled={!!surveyBlockedReason(state, ship, 'system')}
                title={surveyBlockedReason(state, ship, 'system') ?? 'Начать полный скан системы'}
                onClick={() => run((draft) => startSurvey(draft, 'system'))}
              >
                НАЧАТЬ СКАН
              </Btn>
            </div>
          </>
        )}
        <Row label="Планет в системе" value={system.scanned ? num(system.planets.length) : '—'} />
        <Row label="Поясов в системе" value={num(system.belts.length)} />
      </Panel>


      <Panel title="Пояса астероидов" tight>
        {system.belts.length === 0 ? (
          <Hint>Здесь нет поясов: руду придётся возить из соседних систем.</Hint>
        ) : null}
        {system.belts.map((belt) => {
          const blocked = surveyBlockedReason(state, ship, 'belt', { beltId: belt.id });
          const grades = Object.keys(belt.grades) as ResourceId[];
          const reserve = beltReserve(belt);
          return (
            <div className="list-row col" key={belt.id}>
              <div className="list-main">
                <b>
                  {belt.name} <span className="dim">{belt.discovered ? 'на карте' : 'не изучен'}</span>
                </b>
                <span className="dim">
                  {belt.discovered
                    ? `${grades.map((id) => resource(id).symbol).join(' ')} · богатство ${belt.richness.toFixed(2)}× · запас ${num(reserve)} ед.`
                    : 'состав пояса неизвестен'}
                </span>
                {belt.discovered ? (
                  <Progress
                    label="Выработано"
                    fraction={beltWear(belt)}
                    color="#ffb347"
                    right={reserve <= MIN_BELT_RESERVE ? 'выработан' : `осталось ${num(reserve)} ед.`}
                  />
                ) : null}
              </div>
              {belt.discovered ? (
                <div className="row-actions">
                  <Btn size="small" kind="primary" title="К добыче в этой системе" onClick={() => onOpen({ id: 'resources' })}>
                    К ДОБЫЧЕ
                  </Btn>
                </div>
              ) : (
                <Btn
                  size="small"
                  disabled={!!blocked}
                  title={blocked ?? 'Оценить пояс сканером'}
                  onClick={() => run((draft) => startSurvey(draft, 'belt', { beltId: belt.id }))}
                >
                  РАЗВЕДКА ({duration(seconds('belt'))})
                </Btn>
              )}
            </div>
          );
        })}
      </Panel>

      <Panel
        title="Дальний скан"
        actions={
          <span className="dim">
            {duration(seconds('deep'))} · {surveyFuel('deep')} топл.
          </span>
        }
        tight
      >
        <Hint>{SURVEY_INFO.deep.hint}</Hint>
        {system.connections
          .map((id) => state.systems[id])
          .filter((target) => !!target?.discovered)
          .map((target) => {
            const hidden = deepScanTargets(state, target.id).filter((id) => !state.systems[id]?.discovered);
            const blocked = surveyBlockedReason(state, ship, 'deep', { targetSystemId: target.id });
            return (
              <div className="list-row" key={target.id}>
                <div className="list-main">
                  <b>{target.name}</b>
                  <span className="dim">
                    {hidden.length > 0 ? `за ней неизученных систем: ${hidden.length}` : 'за ней всё изучено'}
                  </span>
                </div>
                <Btn
                  size="small"
                  disabled={!!blocked}
                  title={blocked ?? 'Пробить туман за этой системой'}
                  onClick={() => run((draft) => startSurvey(draft, 'deep', { targetSystemId: target.id }))}
                >
                  ДАЛЬНИЙ СКАН
                </Btn>
              </div>
            );
          })}
        {system.connections.filter((id) => state.systems[id]?.discovered).length === 0 ? (
          <Hint>Соседей на карте нет: прыгните к соседу или просканируйте текущую систему.</Hint>
        ) : null}
      </Panel>
    </>
  );
}

