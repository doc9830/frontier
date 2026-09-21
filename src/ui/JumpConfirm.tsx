import type { GameState } from '../game/types.ts';
import { jumpPlan } from '../game/actions/nav.ts';
import { playerShip } from '../game/state/create.ts';
import { hops } from '../game/plural.ts';
import { duration, riskText, threatColor } from './format.ts';
import { Row, Tag } from './kit.tsx';

/**
 * Необязательная проверка перед прыжком (настройка «подтверждать прыжок»).
 * Своя разметка вместо window.confirm: системный диалог WebView может быть
 * выключен оболочкой, а решение должно оставаться внутри игры.
 */

export function JumpConfirm({
  state,
  targetId,
  onConfirm,
  onCancel,
}: {
  state: GameState;
  targetId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const target = state.systems[targetId];
  if (!target) return null;

  const ship = playerShip(state);
  const plan = jumpPlan(state, targetId);
  const from = ship ? state.systems[ship.systemId]?.name ?? '?' : '?';

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h2>
          Прыжок · {target.name}
          <span className="dim"> · из {from}</span>
        </h2>
        <div className="modal-body">
          {plan ? (
            <>
              <Row label="Маршрут" value={hops(plan.hops)} />
              <Row label="Время" value={duration(plan.seconds)} />
              <Row label="Топливо" value={`${plan.fuel} ед.`} />
              <Row
                label="Риск"
                value={<span style={{ color: threatColor(plan.risk) }}>{riskText(plan.risk)}</span>}
              />
              <Row label="Топлива в баке" value={`${Math.round(ship?.fuel ?? 0)} ед.`} />
              <Tag color="#ffb347">трасса займёт топливо сразу</Tag>
              <button type="button" className="btn choice primary" onClick={onConfirm}>
                <b>ПРЫЖОК</b>
                <span className="dim">списать {plan.fuel} топлива и стартовать</span>
              </button>
            </>
          ) : (
            <div className="dim">Маршрут из текущей системы не проложен.</div>
          )}
          <button type="button" className="btn choice" onClick={onCancel}>
            <b>ОТМЕНА</b>
            <span className="dim">остаться в системе {from}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
