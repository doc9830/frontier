import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, StarSystem } from '../game/types.ts';
import { FIELD } from '../game/universe/generate.ts';
import { archetypeLabel } from '../game/universe/generate.ts';
import { findPath } from '../game/exploration/travel.ts';
import { jumpPlan } from '../game/actions/nav.ts';
import { travelProgress } from '../game/sim/travel.ts';
import { playerShip } from '../game/state/create.ts';
import { factionView } from '../game/factions/reputation.ts';
import { cr, duration, riskText, threatColor } from './format.ts';
import { hops } from '../game/plural.ts';
import { Btn, Tag } from './kit.tsx';

/**
 * The galaxy map. Pure SVG so it scales on mobile and needs no canvas loop:
 * only the hop network, the faction colours and the current position matter.
 */

interface View {
  k: number;
  x: number;
  y: number;
}

/**
 * Поле галактики выросло вместе с числом систем (128), поэтому зум считается от
 * размера поля: SPAN — во сколько раз поле больше базового. Так видимый участок
 * карты и плотность звёзд на экране остаются прежними, а не 128 точек разом.
 */
const SPAN = FIELD.width / 1240;
const MIN_K = 0.7;
const MAX_K = 4 * SPAN;
const PAD = 90;

/** Стартовый масштаб: телефон показывает окрестности корабля ближе, десктоп — шире. */
function defaultK(): number {
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  return (phone ? 1.7 : 1) * SPAN;
}

/** Вид, в котором корабль (или центр поля) стоит посреди карты. */
function frameView(target: { x: number; y: number } | undefined | null, k: number): View {
  const x = target?.x ?? FIELD.width / 2;
  const y = target?.y ?? FIELD.height / 2;
  return { k, x: FIELD.width / 2 - x * k, y: FIELD.height / 2 - y * k };
}

function nodeRadius(system: StarSystem): number {
  const population = Math.max(0, system.population) / 1_000_000;
  return 5 + Math.min(7, Math.sqrt(population) * 1.6) + (system.stations.length > 0 ? 1.5 : 0);
}

export function GalaxyMap({
  state,
  selectedId,
  onSelect,
  onJump,
  animations = true,
}: {
  state: GameState;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJump: (id: string) => void;
  /** Настройка «анимация прыжка»: без неё корабль всё равно виден, но не едет плавно. */
  animations?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  /** Live pointers: two of them turn a pan into a pinch-zoom. */
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const ship = playerShip(state);
  const currentId = ship?.systemId ?? '';
  const current = state.systems[currentId];

  /**
   * The phone shell is map-first, so the whole field would leave a tiny cluster in
   * the middle: both shells start framed on the ship instead of the whole field.
   */
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !current) return;
    focused.current = true;
    setView(frameView(current.position, defaultK()));
  }, [current]);

  const lanes = useMemo(() => {
    const seen = new Set<string>();
    const list: { a: StarSystem; b: StarSystem }[] = [];
    for (const id of state.systemIds) {
      const a = state.systems[id];
      if (!a) continue;
      for (const link of a.connections) {
        const key = id < link ? `${id}|${link}` : `${link}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = state.systems[link];
        if (b) list.push({ a, b });
      }
    }
    return list;
  }, [state]);

  /** Systems the player may still be surprised by: hidden but adjacent to charts. */
  const chartedNeighbours = useMemo(() => {
    const hidden = new Set<string>();
    for (const id of state.systemIds) {
      const system = state.systems[id];
      if (system?.discovered) continue;
      for (const link of system?.connections ?? []) {
        if (state.systems[link]?.discovered) {
          hidden.add(id);
          break;
        }
      }
    }
    return hidden;
  }, [state]);

  const selected = selectedId ? state.systems[selectedId] : null;
  const plan = selected && selected.discovered && selected.id !== currentId ? jumpPlan(state, selected.id) : null;
  const path = useMemo(() => {
    if (!selected || !selected.discovered || !currentId) return [] as string[];
    return findPath(state, currentId, selected.id);
  }, [state, selected, currentId]);

  /**
   * Перелёт виден прямо на карте: маршрут подсвечен, а корабль ползёт по линии
   * от системы к системе. Прогресс берётся из симуляции, так что анимация не
   * врёт: когда полоса дошла до конца, корабль действительно прибыл.
   */
  const travel = ship?.travel ?? null;
  const route = useMemo(() => {
    if (!travel) return [] as { x: number; y: number }[];
    return travel.path
      .map((id) => state.systems[id]?.position)
      .filter((point): point is { x: number; y: number } => Boolean(point));
  }, [travel, state.systems]);

  const warp = useMemo(() => {
    if (!travel || !ship || route.length < 2) return null;
    const span = route.length - 1;
    const travelled = Math.min(span, Math.max(0, travelProgress(state, ship) * span));
    const index = Math.min(span - 1, Math.floor(travelled));
    const from = route[index];
    const to = route[index + 1];
    const local = travelled - index;
    const point = { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
    const trail = route
      .slice(0, index + 1)
      .map((step) => `${step.x},${step.y}`)
      .join(' ');
    return { point, trail: `${trail} ${point.x},${point.y}` };
  }, [travel, route, ship, state]);

  const toViewBox = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / FIELD.width, rect.height / FIELD.height);
    const offsetX = (rect.width - FIELD.width * scale) / 2;
    const offsetY = (rect.height - FIELD.height * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale,
    };
  };

  /** Screen pixels → viewBox units, so a gesture tracks the finger at any zoom. */
  const pixelScale = (): number => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    return Math.min(rect.width / FIELD.width, rect.height / FIELD.height) || 1;
  };

  const pinchState = (): { dist: number; midX: number; midY: number } | null => {
    if (pointers.current.size < 2) return null;
    const [a, b] = [...pointers.current.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      // second finger down: panning stops, pinch-zoom takes over
      drag.current.active = false;
      setDragging(false);
      pinch.current = pinchState();
      return;
    }
    const point = toViewBox(event.clientX, event.clientY);
    drag.current = { active: true, lastX: point.x, lastY: point.y };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const two = pinchState();
    if (two) {
      const before = pinch.current;
      if (before && before.dist > 0 && two.dist > 0) {
        // zoom about the midpoint and drag the map along with the fingers
        zoomAt(two.dist / before.dist, two.midX, two.midY);
        const scale = pixelScale();
        setView((prev) => ({
          ...prev,
          x: prev.x + (two.midX - before.midX) / scale,
          y: prev.y + (two.midY - before.midY) / scale,
        }));
      }
      pinch.current = two;
      return;
    }

    if (!drag.current.active) return;
    const point = toViewBox(event.clientX, event.clientY);
    const dx = point.x - drag.current.lastX;
    const dy = point.y - drag.current.lastY;
    drag.current.lastX = point.x;
    drag.current.lastY = point.y;
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };

  /** A finger went away: forget it, and keep panning with whatever is left. */
  const releasePointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current.active = false;
      setDragging(false);
      return;
    }
    const [rest] = [...pointers.current.values()];
    const point = toViewBox(rest.x, rest.y);
    drag.current = { active: true, lastX: point.x, lastY: point.y };
    setDragging(true);
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number): void => {
    setView((prev) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, prev.k * factor));
      if (k === prev.k) return prev;
      const svg = svgRef.current;
      if (!svg || clientX === undefined || clientY === undefined) {
        const cx = FIELD.width / 2;
        const cy = FIELD.height / 2;
        return { k, x: cx - (cx - prev.x) * (k / prev.k), y: cy - (cy - prev.y) * (k / prev.k) };
      }
      const point = toViewBox(clientX, clientY);
      const worldX = (point.x - prev.x) / prev.k;
      const worldY = (point.y - prev.y) / prev.k;
      return { k, x: point.x - worldX * k, y: point.y - worldY * k };
    });
  };

  return (
    <div className="mapwrap">
      <svg
        ref={svgRef}
        className={dragging ? 'dragging' : undefined}
        viewBox={`${-PAD} ${-PAD} ${FIELD.width + PAD * 2} ${FIELD.height + PAD * 2}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onPointerLeave={releasePointer}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? 1.14 : 1 / 1.14, event.clientX, event.clientY);
        }}
      >
        <defs>
          <radialGradient id="starGlow">
            <stop offset="0%" stopColor="#41f0c1" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#41f0c1" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {state.systemIds.map((id) => {
            const system = state.systems[id];
            if (!system?.discovered) return null;
            return (
              <circle
                key={`halo-${id}`}
                cx={system.position.x}
                cy={system.position.y}
                r={nodeRadius(system) * 3.2}
                fill="url(#starGlow)"
                opacity={id === currentId ? 0.9 : 0.25}
              />
            );
          })}

          {lanes.map(({ a, b }, index) => {
            if (!a.discovered || !b.discovered) return null;
            const onRoute = path.includes(a.id) && path.includes(b.id);
            const step = Math.abs(path.indexOf(a.id) - path.indexOf(b.id)) === 1;
            return (
              <line
                key={`lane-${index}`}
                x1={a.position.x}
                y1={a.position.y}
                x2={b.position.x}
                y2={b.position.y}
                stroke={onRoute && step ? '#41f0c1' : '#14323d'}
                strokeWidth={onRoute && step ? 2 : 1}
                strokeDasharray={onRoute && step ? '6 5' : undefined}
              />
            );
          })}

          {state.systemIds.map((id) => {
            const system = state.systems[id];
            if (!system) return null;
            const hidden = !system.discovered;
            if (hidden && !chartedNeighbours.has(id)) return null;
            const faction = factionView(state, system.factionId);
            const isCurrent = id === currentId;
            const isSelected = id === selectedId;
            const radius = hidden ? 4 : nodeRadius(system);
            return (
              <g
                key={id}
                className="galaxy-node"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(isSelected ? null : id);
                }}
              >
                {(isCurrent || isSelected) && (
                  <circle
                    cx={system.position.x}
                    cy={system.position.y}
                    r={radius + 8}
                    fill="none"
                    stroke={isSelected ? '#ffb347' : '#41f0c1'}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                )}
                <circle
                  cx={system.position.x}
                  cy={system.position.y}
                  r={radius}
                  fill={hidden ? '#0a1620' : faction.color}
                  fillOpacity={hidden ? 0.8 : 0.85}
                  stroke={hidden ? '#2a4a56' : '#dff5ee'}
                  strokeWidth={hidden ? 1 : 1.2}
                  strokeDasharray={hidden ? '3 3' : undefined}
                />
                <text
                  className="galaxy-label"
                  x={system.position.x + radius + 6}
                  y={system.position.y + 4}
                  opacity={hidden ? 0.55 : 1}
                >
                  {hidden ? `${system.name} ?` : system.name}
                </text>
                {!hidden && (
                  <text
                    className="galaxy-label small"
                    x={system.position.x + radius + 6}
                    y={system.position.y + 16}
                  >
                    {`${faction.short} · ${archetypeLabel(system.archetype)}`}
                  </text>
                )}
              </g>
            );
          })}

          {warp ? (
            <g className={animations ? 'warp' : 'warp still'} pointerEvents="none">
              <polyline
                className="warp-route"
                points={route.map((step) => `${step.x},${step.y}`).join(' ')}
                fill="none"
                stroke="#41f0c1"
                strokeWidth={2.4}
                strokeDasharray="8 7"
                opacity={0.65}
              />
              <polyline points={warp.trail} fill="none" stroke="#ffb347" strokeWidth={2.6} opacity={0.9} />
              <g className="warp-marker" style={{ transform: `translate(${warp.point.x}px, ${warp.point.y}px)` }}>
                <circle className="warp-pulse" r={12} fill="none" stroke="#41f0c1" strokeWidth={1.4} />
                <circle r={5.5} fill="#41f0c1" stroke="#04090d" strokeWidth={1.6} />
              </g>
            </g>
          ) : null}
        </g>
      </svg>

      <div className="map-overlay">
        <div className="map-box">
          {selected ? (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <b>{selected.name}</b>
                <Tag color={factionView(state, selected.factionId).color}>
                  {factionView(state, selected.factionId).short}
                </Tag>
                {selected.id === currentId ? <Tag color="#41f0c1">ВЫ ЗДЕСЬ</Tag> : null}
              </div>
              <div className="dim">
                {selected.discovered
                  ? `${selected.starClass} · ${archetypeLabel(selected.archetype)} · безопасность ${Math.round(
                      selected.security * 100,
                    )}% · население ${(selected.population / 1_000_000).toFixed(1)} млн`
                  : 'Не нанесена на карты. Откроется, когда вы пролетите трассу в эту сторону.'}
              </div>
              {plan ? (
                <>
                  <div className="dim">
                    {hops(plan.hops)} · {duration(plan.seconds)} · топливо {plan.fuel} ·{' '}
                    <span style={{ color: threatColor(plan.risk) }}>{riskText(plan.risk)}</span>
                  </div>
                  <div className="dim">
                    пояса {selected.belts.length} · станции {selected.stations.length} · контракты{' '}
                    {selected.contracts.length}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn
                      kind="primary"
                      size="small"
                      disabled={!ship || ship.fuel < plan.fuel || !!ship.travel}
                      title={
                        ship && ship.fuel < plan.fuel
                          ? 'Не хватает топлива — переработайте газ или купите топливо.'
                          : 'Потратить топливо и прыгнуть'
                      }
                      onClick={() => onJump(selected.id)}
                    >
                      ПРЫЖОК · {plan.fuel} ТОПЛ.
                    </Btn>
                    <Btn size="small" onClick={() => onSelect(null)}>
                      ЗАКРЫТЬ
                    </Btn>
                  </div>
                </>
              ) : (
                <div className="dim">
                  {selected.discovered ? 'Вы находитесь в этой системе.' : 'Проложенного маршрута нет.'}
                </div>
              )}
            </>
          ) : (
            <div className="dim">
              <span className="hint-desktop">
                Перетаскивайте карту · колесо мыши — масштаб · нажмите на звезду, чтобы увидеть план прыжка.
              </span>
              <span className="hint-touch">
                Тяните карту пальцем · щипок двумя пальцами или кнопки + / − — масштаб · тапните по звезде.
              </span>
              <br />
              <span className="scroll-hint">
                {current?.name ?? '?'} · {cr(state.player.credits)}
              </span>
            </div>
          )}
        </div>

        <div className="map-tools">
          <Btn size="small" onClick={() => zoomAt(1.25)}>
            +
          </Btn>
          <Btn size="small" onClick={() => zoomAt(1 / 1.25)}>
            −
          </Btn>
          <Btn size="small" onClick={() => setView(frameView(current?.position, defaultK()))}>
            СБРОС
          </Btn>
          <div className="legend">
            <span>
              <i style={{ background: '#41f0c1' }} />
              вы
            </span>
            <span>
              <i style={{ background: '#ffb347' }} />
              выбрано
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
