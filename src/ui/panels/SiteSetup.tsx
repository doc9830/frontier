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
import { FOUNDATION_SECONDS, chosenSite, phaseSteps, siteCandidates, stationPhase } from '../../game/site/site.ts';
import { cr, duration, num } from '../format.ts';
import { Btn, Hint, Panel, Row, Steps, Tag } from '../kit.tsx';

/**
 * Воронка закладки станции. Пока склад не поставлен, вкладка «Станция» — это
 * инструкция из пяти шагов: ничья система → скан → участок → перевозка → база.
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
  const candidates = siteCandidates(state).slice(0, 10);
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
          value={site ? `${site.system.name} · прыжков ${candidates.find((c) => c.system.id === site.system.id)?.hops ?? '?'}` : 'не выбрана'}
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
            <Hint>Материалы на месте: запускайте стройку командного центра во вкладке ниже.</Hint>
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
            Частную станцию ставят только в ничей системе и только на планету с твёрдой корой. Сначала систему нужно
            просканировать (вкладка РАЗВЕДКА), затем выбрать планету здесь и привезти металл в трюме.
          </Hint>
          {candidates.length === 0 ? (
            <Hint>Подходящих систем пока не видно: разведайте соседей и проведите полный скан.</Hint>
          ) : null}
          {candidates.map((candidate) => (
            <div className="list-row col" key={candidate.system.id}>
              <div className="list-main">
                <b>
                  {candidate.system.name}{' '}
                  <span className="dim">
                    {hereSystem?.id === candidate.system.id
                      ? 'вы здесь'
                      : candidate.hops >= 0
                        ? `${num(candidate.hops)} прыжк.`
                        : 'маршрут неизвестен'}
                  </span>
                </b>
                <span className="dim">
                  {candidate.free ? 'ничья система' : 'под контролем фракции'} ·{' '}
                  {candidate.scanned ? `планет ${num(candidate.planets.length)}` : 'нужен полный скан'}
                </span>
                {candidate.reasons.map((reason) => (
                  <span className="dim" key={reason}>
                    {reason}
                  </span>
                ))}
              </div>
              {candidate.buildable.length > 0 ? (
                <div className="row-actions">
                  {candidate.buildable.slice(0, 3).map((planet) => (
                    <Btn
                      key={planet.planet.id}
                      size="tiny"
                      kind={site?.planet.id === planet.planet.id ? 'primary' : undefined}
                      title={`${planet.planet.name}: ${planet.bonusText}`}
                      onClick={() => run((draft) => chooseSite(draft, candidate.system.id, planet.planet.id))}
                    >
                      {planet.planet.name}
                    </Btn>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </Panel>
      ) : null}
    </>
  );
}

