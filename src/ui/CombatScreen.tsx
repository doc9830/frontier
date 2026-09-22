import { useEffect, useRef, useState } from 'react';
import type { Encounter, Ship } from '../game/types.ts';
import {
  GLOW_SECONDS,
  VOLLEY_SECONDS,
  autoBattle,
  battleResult,
  createBattle,
  fireAt,
  radarPoint,
  tickBattle,
} from '../game/combat/minigame.ts';
import type { BattleState, TapKind } from '../game/combat/minigame.ts';
import type { FightResult } from '../game/combat/combat.ts';
import { plural } from '../game/plural.ts';
import { Btn, Meter, Progress, Tag } from './kit.tsx';
import { RISK_SHORT, threatColor } from './format.ts';

/**
 * Боевой экран: радар, луч, метки и залпы. Здесь игрок ведёт бой сам, поэтому у
 * экрана свой цикл кадров; мир в это время стоит — решение по событию ещё не
 * принято, и `advance` не двигает время, пока событие открыто.
 *
 * Экран не знает про мир: он получает корабль и противника, а в конце отдаёт
 * готовый `FightResult` — тот же, что считала бы статистическая модель.
 */

interface Flash {
  kind: TapKind;
  x: number;
  y: number;
  at: number;
}

/** Квадратный канвас под размер элемента: рисуем в CSS-пикселях, не в блобе DPR. */
function fitCanvas(canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(220, Math.round(rect.width || 320));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.dataset.dpr = String(dpr);
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  size: number,
  battle: BattleState,
  flash: Flash | null,
): void {
  const center = size / 2;
  const maxRadius = center - 4;
  const accent = threatColor(battle.enemy.threat);
  const now = performance.now();

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, 0, size, size);

  // Сетка дальности и перекрестие: по ним видно, сколько лететь залпу.
  ctx.strokeStyle = 'rgba(65, 240, 193, 0.16)';
  ctx.lineWidth = 1;
  for (const ring of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(center, center, maxRadius * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(center - maxRadius, center);
  ctx.lineTo(center + maxRadius, center);
  ctx.moveTo(center, center - maxRadius);
  ctx.lineTo(center, center + maxRadius);
  ctx.stroke();

  // Луч радара: узкий сектор, который и «зажигает» метки.
  const halo = ctx.createRadialGradient(center, center, 0, center, center, maxRadius);
  halo.addColorStop(0, 'rgba(65, 240, 193, 0.34)');
  halo.addColorStop(1, 'rgba(65, 240, 193, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.moveTo(center, center);
  ctx.arc(center, center, maxRadius, battle.sweep - 0.55, battle.sweep);
  ctx.closePath();
  ctx.fill();

  // Залпы видно всегда: это уже выпущенный по вам огонь, его надо перехватить.
  for (const volley of battle.volleys) {
    const head = radarPoint(volley.angle, volley.radius);
    const tail = radarPoint(volley.angle, Math.min(1, volley.radius + 0.16));
    const fuse = Math.max(0, Math.min(1, volley.fuse / VOLLEY_SECONDS));
    const x = head.x * size;
    const y = head.y * size;
    ctx.strokeStyle = 'rgba(255, 107, 107, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(tail.x * size, tail.y * size);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Кольцо сжимается по мере подлёта: это и есть предохранитель залпа.
    ctx.strokeStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x, y, 5 + (1 - fuse) * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Метки пиратов: засветка живёт GLOW_SECONDS после прохода луча.
  for (const raider of battle.raiders) {
    const lit = Math.max(0, Math.min(1, raider.glow / GLOW_SECONDS));
    if (lit <= 0) continue;
    const point = radarPoint(raider.angle, raider.radius);
    const x = point.x * size;
    const y = point.y * size;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16 + 0.3 * lit;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 + 0.65 * lit;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ваш корабль в центре и вспышка последнего выстрела.
  ctx.fillStyle = '#e8fff8';
  ctx.beginPath();
  ctx.arc(center, center, 4, 0, Math.PI * 2);
  ctx.fill();

  if (flash && now - flash.at < 320) {
    const fade = 1 - (now - flash.at) / 320;
    ctx.strokeStyle =
      flash.kind === 'hit' ? '#41f0c1' : flash.kind === 'intercept' ? '#ffd166' : 'rgba(255, 255, 255, 0.6)';
    ctx.globalAlpha = fade;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(flash.x * size, flash.y * size, 8 + (1 - fade) * 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const OUTCOME_TITLE: Record<FightResult['outcome'], string> = {
  victory: 'ПРОТИВНИК УНИЧТОЖЕН',
  defeat: 'КОРАБЛЬ ПОТЕРЯН',
  stalemate: 'БОЙ ПРЕРВАН',
};

export function CombatScreen({
  ship,
  enemy,
  onFinish,
}: {
  ship: Ship;
  enemy: Encounter;
  onFinish: (result: FightResult) => void;
}) {
  const battleRef = useRef<BattleState | null>(null);
  if (battleRef.current === null) battleRef.current = createBattle(ship, enemy);
  const battle = battleRef.current;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flashRef = useRef<Flash | null>(null);
  const overSeenRef = useRef(false);
  const [passed, setPassed] = useState(false);
  const [, bump] = useState(0);
  const [note, setNote] = useState('Тап по радару — выстрел по этому сектору.');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    fitCanvas(canvas);
    const onResize = (): void => fitCanvas(canvas);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const current = battleRef.current;
      if (!current) return;
      const step = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      if (!current.over) tickBattle(current, step);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = Number(canvas.dataset.dpr ?? '1');
        drawRadar(ctx, canvas.width / dpr, current, flashRef.current);
      }

      // Пока бой идёт, цифры обновляются десять раз в секунду: чаще не нужно.
      if (current.over) {
        if (!overSeenRef.current) {
          overSeenRef.current = true;
          bump((value) => value + 1);
        }
      } else if (now - hudAt > 100) {
        hudAt = now;
        bump((value) => value + 1);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const enemyHealth = battle.enemyHull + battle.enemyShield;
  const myHealth = battle.playerHull + battle.playerShield;

  /** Тап по радару: переводим точку канваса в полярные координаты и стреляем. */
  const tap = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas || battle.over || passed) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) / Math.max(1, rect.height);
    const dx = x - 0.5;
    const dy = y - 0.5;
    const radius = Math.min(1, Math.hypot(dx, dy) * 2);
    const result = fireAt(battle, Math.atan2(dy, dx), radius);
    flashRef.current = { kind: result.kind, x, y, at: performance.now() };
    setNote(result.text);
    bump((value) => value + 1);
  };

  const leave = (result: FightResult): void => {
    if (passed) return;
    setPassed(true);
    onFinish(result);
  };

  return (
    <div className="modal-backdrop combat-backdrop">
      <div className="modal combat" role="dialog" aria-modal="true">
        <div className="combat-head">
          <b>БОЕВОЙ КОНТАКТ</b>
          <span className="dim">{enemy.name}</span>
          <Tag color={threatColor(enemy.threat)}>{RISK_SHORT[enemy.threat]}</Tag>
          <span className="dim">осталось {Math.ceil(battle.timeLeft)} с</span>
        </div>

        <div className="combat-bars">
          <Meter
            label="ПРОТИВНИК"
            value={enemyHealth}
            max={battle.balance.enemyHp}
            color={threatColor(battle.enemy.threat)}
            suffix={`/${battle.balance.enemyHp} · попаданий ${battle.enemyHits}/${battle.balance.hitsToWin}`}
          />
          <Meter
            label="ВАШ КОРАБЛЬ"
            value={myHealth}
            max={battle.balance.playerHp}
            color={myHealth / battle.balance.playerHp > 0.5 ? '#41f0c1' : '#ff6b6b'}
            suffix={`/${battle.balance.playerHp} · пропущено ${battle.breached}/${battle.balance.lossesAllowed}`}
          />
          <Progress
            label="ОРУДИЕ"
            fraction={battle.charge}
            color={battle.charge >= 1 ? '#41f0c1' : '#ffb347'}
            right={battle.charge >= 1 ? 'ГОТОВ' : 'перезарядка'}
          />
        </div>

        <canvas ref={canvasRef} className="combat-radar" onPointerDown={tap} />

        <div className="combat-hint">{note}</div>
        <div className="dim combat-count">
          выстрелов {battle.shots} · попаданий {battle.enemyHits} · промахов {battle.misses} · перехвачено{' '}
          {battle.intercepted} · пропущено залпов {battle.breached}
        </div>

        {battle.over ? (
          <div className="combat-result">
            <b>{OUTCOME_TITLE[battle.outcome ?? 'stalemate']}</b>
            <div className="combat-log">
              {battle.log.slice(-5).map((line, index) => (
                <span key={`${index}-${line}`} className="dim">
                  {line}
                </span>
              ))}
            </div>
            <Btn kind="primary" onClick={() => leave(battleResult(battle))}>
              ПРОДОЛЖИТЬ
            </Btn>
          </div>
        ) : (
          <div className="combat-actions">
            <Btn size="small" onClick={() => leave(autoBattle(ship, enemy))} title="Отдать бой автопилоту">
              АВТОБОЙ
            </Btn>
            <span className="dim">
              нужно попаданий {battle.balance.hitsToWin} из {battle.balance.shots} выстрелов, корпус терпит{' '}
              {battle.balance.lossesAllowed}{' '}
              {plural(battle.balance.lossesAllowed, 'пробитие', 'пробития', 'пробитий')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


