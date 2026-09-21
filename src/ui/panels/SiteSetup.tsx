import type { GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { resource } from '../../game/data/resources.ts';
import {
  baseStationHaul,
  baseStationMissing,
  chooseSite,
  clearSite,
  foundationState,
  foundStation,
  haulFreeCargo,
  materialsText,
} from '../../game/actions/site.ts';
import { FOUNDATION_SECONDS, chosenSite, localSiteCandidate, phaseSteps, stationPhase } from '../../game/site/site.ts';
import { cr, duration, num } from '../format.ts';
import { Btn, Hint, Panel, Row, Steps, Tag } from '../kit.tsx';

/**
 * Воронка закладки станции: подэкран «Строительство станции» в разделе
 * «Система». Пока склад не поставлен, это инструкция из пяти шагов:
 * ничья система под кораблём → скан → участок → перевозка → база.
 * Выбрать участок можно только там, где стоит корабль: удалённых закладок нет.
 */

export function SiteSetup({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  const phase = stationPhase(state);
  const site = chosenSite(state);
  const info = foundationState(state);
  const haul = baseStationHaul(state);
  const missing = baseStationMissing(state);
  /** Участок ищут только в системе, где стоит корабль. */
  const local = localSiteCandidate(state);
  const hereSystem = ship ? state.systems[ship.systemId] : null;

  return (
    <>
      <Panel
        title="Закладка станции"
        actions={
          <Tag color="#ffd166">
            {phase === 'foundation' ? 'СТРОЙПЛОЩАДКА' : site ? 'УЧАСТОК ВЫБРАН' : 'УЧАСТОК НЕ ЗАКРЕПЛЁН'}
          </Tag>
        }
      >
        <Steps steps={phaseSteps(state)} />
        <Row
          label="Система"
          value={site ? `${site.system.name} · вы здесь` : hereSystem ? `${hereSystem.name} · вы здесь` : '—'}
        />
        <Row label="Планета" value={site ? `${site.planet.name} (${site.kind.label})` : '—'} />
        <Row label="Бонус площадки" value={site ? site.planetInfo.bonusText : '—'} />
        <Row label="Свободный трюм" value={`${num(haulFreeCargo(state))} ед.`} />
      </Panel>

      {phase === 'planned' ? (
        <Panel title="Требования закладки склада" tight>
          <Row label="Кредиты" value={`${cr(info.credits)} ${info.creditsOk ? '· хватает' : '· не хватает'}`} />
          <Row label="Материалы в трюме" value={materialsText(info.materials)} />
          <Row
            label="Сейчас в трюме"
            value={(Object.entries(info.materials) as [ResourceId, number][])
              .map(([id, qty]) => `${num(Math.min(info.haveMaterials[id] ?? 0, qty))}/${num(qty)} ${resource(id).symbol}`)
              .join(' · ')}
          />
          <Row label="Корабль в системе участка" value={info.atSite ? 'да' : 'нет'} />
          <Row label="Стройка займёт" value={duration(FOUNDATION_SECONDS)} />
          {!info.ok ? (
            <ul className="cargo-help">
              {info.reasons.map((reason) => (
                <li key={reason} className="dim">
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <Hint>Всё готово: закладка спишет кредиты и металл прямо из трюма.</Hint>
          )}
          <div className="row-actions">
            <Btn
              size="small"
              kind="primary"
              disabled={!info.ok}
              title={info.ok ? 'Начать закладку склада' : info.reasons[0]}
              onClick={() => run((draft) => foundStation(draft))}
            >
              ЗАЛОЖИТЬ СКЛАД
            </Btn>
            <Btn size="small" disabled={!site} title="Выбрать другой участок" onClick={() => run((draft) => clearSite(draft))}>
              СМЕНИТЬ УЧАСТОК
            </Btn>
          </div>
        </Panel>
      ) : null}

      {phase === 'foundation' ? (
        <Panel title="Дальше: материалы для базовой станции" tight>
          <Row label="Нужно кредитов" value={cr(haul.credits)} />
          <Row label="Нужно на складе" value={materialsText(haul.materials)} />
          <Row
            label="Лежит на складе"
            value={(Object.entries(haul.materials) as [ResourceId, number][])
              .map(([id, qty]) => `${num(haul.storage[id] ?? 0)}/${num(qty)} ${resource(id).symbol}`)
              .join(' · ')}
          />
          {missing.length > 0 ? (
            <ul className="cargo-help">
              {missing.map((reason) => (
                <li key={reason} className="dim">
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <Hint>Материалы на месте: запускайте стройку командного центра на экране «Управление базой».</Hint>
          )}
          <Hint>
            Руду и электронику возят в трюме: купите на рынке, выгрузите на склад своей станции и повторите рейс.
            Склад открывается сразу после того, как закладка достроена.
          </Hint>
        </Panel>
      ) : null}

      {phase === 'planned' ? (
        <Panel title="Куда поставить станцию" tight>
          <Hint>
            Частную станцию ставят только в системе, где стоит корабль, и только на ничьей земле: фракции свои системы
            под закладку не отдают. Сначала полный скан системы («Система» → «Исследование»), потом планета с твёрдой
            корой — металл для закладки везут в трюме.
          </Hint>
          {local ? (
            <>
              <Row
                label="Система под кораблём"
                value={`${local.system.name} · ${local.free ? 'ничья система' : 'под контролем фракции'} · ${
                  local.scanned ? `планет ${num(local.planets.length)}` : 'нужен полный скан'
                }`}
              />
              {local.reasons.length > 0 ? (
                <ul className="cargo-help">
                  {local.reasons.map((reason) => (
                    <li key={reason} className="dim">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {local.planets.map((planet) => (
                <div className="list-row" key={planet.planet.id}>
                  <div className="list-main">
                    <b>
                      {planet.planet.name}{' '}
                      {site?.planet.id === planet.planet.id ? <span className="dim">· участок закреплён</span> : null}
                    </b>
                    <span className="dim">
                      {planet.kind.label} · {planet.buildable ? planet.bonusText : 'закладка невозможна'}
                    </span>
                  </div>
                  {planet.buildable ? (
                    <div className="row-actions">
                      <Btn
                        size="tiny"
                        kind={site?.planet.id === planet.planet.id ? 'primary' : undefined}
                        title={`Закрепить участок на ${planet.planet.name}`}
                        onClick={() => run((draft) => chooseSite(draft, local.system.id, planet.planet.id))}
                      >
                        {site?.planet.id === planet.planet.id ? 'ВЫБРАНО' : 'ВЫБРАТЬ'}
                      </Btn>
                    </div>
                  ) : null}
                </div>
              ))}
              {local.scanned && local.planets.length === 0 ? (
                <Hint>В системе нет планет: закладку ставить не на что.</Hint>
              ) : null}
            </>
          ) : (
            <Hint>Система под кораблём не найдена: обновите страницу или начните новую галактику.</Hint>
          )}
        </Panel>
      ) : null}
    </>
  );
}

