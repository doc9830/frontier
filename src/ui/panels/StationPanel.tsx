import type { BuildingType, GameState, ResourceId } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { buildingDef, totalSlots } from '../../game/data/buildings.ts';
import { resource } from '../../game/data/resources.ts';
import { slotsUsed, storageCapacity, storageUsed } from '../../game/sim/station.ts';
import type { ResearchKey } from '../../game/actions/build.ts';
import {
  buildingOffers,
  buyResearch,
  cancelConstruction,
  cancelProduction,
  productionSlots,
  productionSlotsUsed,
  recipeOffers,
  researchOffers,
  startConstruction,
  startProduction,
} from '../../game/actions/build.ts';
import { amountsText, barColor, cr, duration, num } from '../format.ts';
import { Btn, Hint, Meter, Panel, Row, Tag } from '../kit.tsx';

/** Home base: construction, refinery queues, research and storage. */

export function StationPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const station = state.station;
  const ship = playerShip(state);
  const here = ship?.systemId === station.systemId;
  const buildings = buildingOffers(state);
  const recipes = recipeOffers(state);
  const research = researchOffers(state);
  const capacity = storageCapacity(station);
  const used = storageUsed(station);
  const slotCap = totalSlots(station.level);
  const construction = station.construction;

  return (
    <>
      <Panel
        title={`Ваша станция · ${station.name}`}
        actions={<Tag color={here ? '#41f0c1' : undefined}>{here ? 'ВЫ ЗДЕСЬ' : 'УДАЛЁННО'}</Tag>}
      >
        <div className="grid3">
          <div className="statbox">
            <span>УРОВЕНЬ</span>
            <b>Mk {station.level}</b>
          </div>
          <div className="statbox">
            <span>СЛОТЫ</span>
            <b>
              {slotsUsed(station)}/{slotCap}
            </b>
          </div>
          <div className="statbox">
            <span>ФЛОТ</span>
            <b>{state.ships.length}</b>
          </div>
        </div>
        <Meter label="СКЛАД" value={used} max={capacity} color={barColor(used / Math.max(1, capacity))} />
        <Row label="Содержимое" value={amountsText(station.storage)} />
        {construction ? (
          <>
            <Meter
              label={`Строится ${buildingDef(construction.building).name} Mk ${construction.targetLevel}`}
              value={state.gameTime - construction.startedAt}
              max={Math.max(1, construction.finishAt - construction.startedAt)}
              suffix={` осталось ${duration(Math.max(0, construction.finishAt - state.gameTime))}`}
            />
            <div>
              <Btn size="small" kind="bad" onClick={() => run((draft) => cancelConstruction(draft))}>
                ОТМЕНИТЬ СТРОЙКУ
              </Btn>
            </div>
          </>
        ) : (
          <Hint>Строительная бригада свободна. Выберите проект ниже.</Hint>
        )}
      </Panel>

      <Panel title="Строительство" tight>
        {buildings.map((offer) => {
          const canBuild =
            !offer.maxed && !offer.busy && offer.requirementsMet && offer.slotsFree && offer.affordable;
          const reason = offer.busy
            ? 'Бригада уже занята'
            : offer.maxed
              ? 'Максимальный уровень'
              : !offer.requirementsMet
                ? `Сначала нужно: ${offer.requirements.join(', ')}`
                : !offer.slotsFree
                  ? 'Нет свободного слота — улучшите командный центр'
                  : !offer.affordable
                    ? 'Не хватает кредитов или материалов'
                    : 'Начать строительство';
          return (
            <div className="list-row" key={offer.type}>
              <div className="list-main">
                <b>
                  {offer.name} <span className="dim">Mk {offer.level}</span>
                </b>
                <span className="dim">
                  {cr(offer.cost.credits)} ·{' '}
                  {Object.entries(offer.cost.materials)
                    .map(([id, qty]) => `${qty} ${resource(id as ResourceId).symbol}`)
                    .join(' ') || 'без материалов'}{' '}
                  · {duration(offer.seconds)}
                </span>
              </div>
              <Btn
                size="small"
                kind="primary"
                disabled={!canBuild}
                title={reason}
                onClick={() => run((draft) => startConstruction(draft, offer.type as BuildingType))}
              >
                СТРОИТЬ
              </Btn>
            </div>
          );
        })}
        <Hint>
          Уровни командного центра открывают слоты, склад и лимит флота. Первый перерабатывающий комплекс требует
          склад, а горный комплекс и верфь — док.
        </Hint>
      </Panel>

      <Panel
        title="Переработка"
        actions={
          <span className="dim">
            слоты {productionSlotsUsed(state)}/{productionSlots(state)}
          </span>
        }
        tight
      >
        {station.production.map((job) => {
          const recipe = recipes.find((entry) => entry.id === job.recipeId);
          return (
            <div className="list-row col" key={job.id}>
              <div className="list-main">
                <b>
                  {recipe?.name ?? job.recipeId}{' '}
                  {job.repeat ? <span className="dim">· цикл повторяется</span> : null}
                </b>
                <span className="dim">
                  {amountsText(recipe?.input)} → {amountsText(recipe?.output)}
                </span>
              </div>
              <Meter
                label="прогресс"
                value={state.gameTime - job.startedAt}
                max={Math.max(1, job.finishAt - job.startedAt)}
                suffix={` осталось ${duration(Math.max(0, job.finishAt - state.gameTime))}`}
              />
              <div>
                <Btn size="tiny" kind="bad" onClick={() => run((draft) => cancelProduction(draft, job.id))}>
                  ОТМЕНИТЬ
                </Btn>
              </div>
            </div>
          );
        })}
        {station.production.length === 0 ? <Hint>Ничего не перерабатывается.</Hint> : null}
        {recipes.map((recipe) => (
          <div className="list-row" key={recipe.id}>
            <div className="list-main">
              <b>{recipe.name}</b>
              <span className="dim">
                {amountsText(recipe.input)} → {amountsText(recipe.output)} · {duration(recipe.seconds)} ·{' '}
                доступно партий: {num(recipe.runs)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Btn
                size="small"
                disabled={!recipe.canRun}
                title={
                  recipe.locked
                    ? `Нужен перерабатывающий комплекс Mk ${recipe.neededRefinery}`
                    : recipe.canRun
                      ? 'Запустить одну партию со склада'
                      : 'На складе не хватает сырья'
                }
                onClick={() => run((draft) => startProduction(draft, recipe.id, false))}
              >
                ЗАПУСК
              </Btn>
              <Btn
                size="small"
                disabled={!recipe.canRun}
                title="Повторять, пока хватает сырья"
                onClick={() => run((draft) => startProduction(draft, recipe.id, true))}
              >
                ЦИКЛ
              </Btn>
            </div>
          </div>
        ))}
        <Hint>
          Переработчик берёт сырьё со склада станции, а не из трюма. Сначала выгрузите руду на склад, потом
          запускайте цикл — он будет работать, пока вы летаете по торговым маршрутам.
        </Hint>
      </Panel>

      <Panel title="Исследования" tight>
        {research.map((entry) => (
          <div className="list-row" key={entry.key}>
            <div className="list-main">
              <b>
                {entry.name} <span className="dim">Mk {entry.level}</span>
              </b>
              <span className="dim">
                {entry.effect} · {cr(entry.cost)}
                {entry.electronics > 0 ? ` + ${entry.electronics} ЭЛЕК` : ''}
              </span>
            </div>
            <Btn
              size="small"
              kind="primary"
              disabled={entry.maxed || !entry.affordable}
              title={
                !entry.hasLab
                  ? 'Сначала постройте исследовательскую лабораторию'
                  : entry.maxed
                    ? 'Достигнут предел'
                    : !entry.affordable
                      ? 'Не хватает кредитов или электроники'
                      : 'Изучить это направление'
              }
              onClick={() => run((draft) => buyResearch(draft, entry.key as ResearchKey))}
            >
              {entry.maxed ? 'МАКС' : 'ИЗУЧИТЬ'}
            </Btn>
          </div>
        ))}
        {research.every((entry) => !entry.hasLab) ? (
          <Hint>
            Исследования требуют исследовательской лаборатории на станции. Она же расширяет возможности сканера.
          </Hint>
        ) : null}
      </Panel>
    </>
  );
}
