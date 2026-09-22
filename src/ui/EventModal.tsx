import type { Encounter, GameState, Ship } from '../game/types.ts';
import { eventDef } from '../game/events/events.ts';
import { battleForecast } from '../game/combat/minigame.ts';
import { RISK_SHORT, amountsText, pct, threatColor } from './format.ts';
import { Tag } from './kit.tsx';

/**
 * Travel event modal. The simulation pauses on a pending event, so this is the
 * only way the trip can continue — every choice goes through the store.
 */

/**
 * Честный прогноз боя из мини-игры: сколько раз бой заканчивался победой при
 * базовой меткости. Генератор сеяный, поэтому цифры не дрожат при перерисовке.
 */
function ForecastRow({ ship, enemy }: { ship: Ship; enemy: Encounter }) {
  const forecast = battleForecast(ship, enemy);
  const color = forecast.win >= 0.66 ? '#7ef7b0' : forecast.win >= 0.4 ? '#ffd166' : '#ff6b6b';
  return (
    <div className="list-row">
      <div className="list-main">
        <b>Прогноз боя</b>
        <span className="dim">
          победа {pct(forecast.win)} · ничья {pct(forecast.draw)} · гибель {pct(forecast.loss)} · нужно попаданий{' '}
          {forecast.balance.hitsToWin} · корпус терпит {forecast.balance.lossesAllowed}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <Tag color={color}>{forecast.verdict}</Tag>
      </div>
    </div>
  );
}

export function EventModal({
  state,
  onChoose,
}: {
  state: GameState;
  onChoose: (choiceId: string) => void;
}) {
  const pending = state.pendingEvent;
  if (!pending) return null;

  const def = eventDef(pending.eventId);
  const ship = state.ships.find((entry) => entry.id === pending.shipId);
  const payload = pending.payload;
  const enemy = payload.enemy;
  const systemHere = state.systems[ship?.systemId ?? ''] ?? null;

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h2>
          {def?.title ?? pending.eventId}
          {ship ? <span className="dim"> · {ship.name}</span> : null}
        </h2>
        <div className="modal-body">
          <div className="dim">
            перелёт прерван в системе {systemHere?.name ?? 'глубокий космос'}
          </div>
          {payload.text ? <div>{payload.text}</div> : null}

          {enemy ? (
            <div className="list-row">
              <div className="list-main">
                <b>{enemy.name}</b>
                <span className="dim">
                  бой {enemy.combat} · корпус {Math.round(enemy.hull)}/{enemy.hullMax} · щиты{' '}
                  {Math.round(enemy.shield)}/{enemy.shieldMax} · скорость {Math.round(enemy.speed)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <Tag color={threatColor(enemy.threat)}>{RISK_SHORT[enemy.threat]}</Tag>
                <Tag color="#ffb347">награда {enemy.bounty} кр</Tag>
              </div>
            </div>
          ) : null}

          {enemy && ship ? <ForecastRow ship={ship} enemy={enemy} /> : null}

          {payload.cargo && Object.keys(payload.cargo).length > 0 ? (
            <div className="dim">на кону груз: {amountsText(payload.cargo)}</div>
          ) : null}
          {payload.credits ? <div className="dim">возможная добыча: {payload.credits} кр</div> : null}
          {payload.systemId ? (
            <div className="dim">пункт назначения: {state.systems[payload.systemId]?.name ?? payload.systemId}</div>
          ) : null}

          {(def?.choices ?? []).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="btn choice"
              onClick={() => onChoose(choice.id)}
            >
              <b>{choice.label}</b>
              {choice.hint ? <span className="dim">{choice.hint}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
