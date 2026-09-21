import type { GameState } from '../game/types.ts';
import { playerShip } from '../game/state/create.ts';
import { currentHop, travelProgress } from '../game/sim/travel.ts';
import { duration, pct } from './format.ts';
import { Btn, Tag } from './kit.tsx';

/**
 * Статус-бар прыжка: живёт вторым рядом верхней панели, пока корабль между
 * системами, — прогресс, текущий отрезок трассы и кнопка «прервать». Саму
 * анимацию (корабль, идущий по линии) рисует карта.
 */

export function JumpBar({
  state,
  paused,
  onCancel,
}: {
  state: GameState;
  paused: boolean;
  onCancel: () => void;
}) {
  const ship = playerShip(state);
  const travel = ship?.travel;
  if (!ship || !travel) return null;

  const destinationId = travel.path[travel.path.length - 1];
  const destination = state.systems[destinationId];
  const here = currentHop(state, ship) ?? state.systems[ship.systemId];
  const progress = travelProgress(state, ship);
  const left = Math.max(0, Math.round(travel.arriveAt - state.gameTime));
  const note = paused ? 'ПАУЗА' : travel.pausedAt !== null ? 'ЖДЁТ РЕШЕНИЯ' : null;

  return (
    <div className="jumpbar">
      <b>ПРЫЖОК</b>
      <span className="jumpbar-text">
        {here?.name ?? '?'} → {destination?.name ?? destinationId} · осталось {duration(left)}
      </span>
      <div className="jumpbar-track">
        <div className="jumpbar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <span className="dim">{pct(progress)}</span>
      {note ? <Tag color="#ffb347">{note}</Tag> : null}
      <Btn size="tiny" kind="bad" onClick={onCancel} title="Остановиться в текущей системе">
        ПРЕРВАТЬ
      </Btn>
    </div>
  );
}
