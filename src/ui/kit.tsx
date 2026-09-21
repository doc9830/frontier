import type { ReactNode } from 'react';
import { num } from './format.ts';

/** Tiny UI kit: panels, meters and buttons — the whole retro chrome lives here. */

export function Panel({
  title,
  actions,
  tight,
  children,
}: {
  title: string;
  actions?: ReactNode;
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className={tight ? 'panel-body tight' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  kind,
  title,
  size,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'good' | 'bad';
  title?: string;
  size?: 'small' | 'tiny';
}) {
  const classes = ['btn'];
  if (kind) classes.push(kind);
  if (size) classes.push(size);
  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/**
 * Крупная кнопка-раздел внутри вкладки: «Исследование», «Рынок», «Верфь».
 * На телефоне она должна нажиматься пальцем, поэтому у неё своя высота и подпись.
 */
export function Tile({
  label,
  hint,
  onClick,
  disabled,
  title,
  tone,
  note,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: 'primary' | 'good' | 'bad';
  note?: string;
}) {
  const classes = ['tile'];
  if (tone) classes.push(tone);
  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={disabled} title={title}>
      <b>{label}</b>
      {hint ? <span>{hint}</span> : null}
      {note ? <span className="tile-note">{note}</span> : null}
    </button>
  );
}

/** Сетка крупных кнопок: держит одинаковые отступы на всех экранах. */
export function Hub({ children }: { children: ReactNode }) {
  return <div className="hub">{children}</div>;
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="statbox" title={hint}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function Meter({
  label,
  value,
  max,
  color,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
}) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = color ?? '#41f0c1';
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {suffix ?? `/${Math.round(max)}`}
        </span>
      </div>
      <div className="meter-bar">
        <div className="meter-fill" style={{ width: `${fraction * 100}%`, background: fill }} />
      </div>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="dim">{children}</div>;
}

/** Переключатель «вкл/выкл» для панели настроек. */
export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="row">
      <span>
        {label}
        {hint ? <span className="dim"> · {hint}</span> : null}
      </span>
      <button
        type="button"
        className={value ? 'chip active' : 'chip'}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        {value ? 'ВКЛ' : 'ВЫКЛ'}
      </button>
    </div>
  );
}

/** Ряд взаимоисключающих вариантов (скорость времени, режимы). */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'chip active' : 'chip'}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="tag" style={color ? { color, borderColor: color } : undefined}>
      {children}
    </span>
  );
}

/** Тонкая полоска прогресса: работа, вахта, стройка. */
export function Progress({
  label,
  fraction,
  color,
  right,
}: {
  label: string;
  /** 0..1 */
  fraction: number;
  color?: string;
  right?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div className="progress">
      <div className="progress-top">
        <span>{label}</span>
        {right ? <span className="dim">{right}</span> : null}
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${clamped * 100}%`, background: color ?? '#41f0c1' }} />
      </div>
    </div>
  );
}

/** Счётчик количества: − значение + быстрые варианты и «МАКС». */
export function Stepper({
  value,
  onChange,
  max,
  presets = [5, 10, 25],
  disabled,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  /** Верхняя граница (трюм, запас рынка, план вахты). */
  max: number;
  presets?: number[];
  disabled?: boolean;
  suffix?: string;
}) {
  const limit = Math.max(1, Math.floor(max));
  const clamp = (next: number): number => Math.max(0, Math.min(limit, Math.floor(next)));
  return (
    <div className="stepper">
      <button
        type="button"
        className="chip"
        disabled={disabled || value <= 0}
        onClick={() => onChange(clamp(value - 1))}
        aria-label="Меньше"
      >
        −
      </button>
      <span className="stepper-value">
        {num(value)}
        {suffix ? <span className="dim"> {suffix}</span> : null}
      </span>
      <button
        type="button"
        className="chip"
        disabled={disabled || value >= limit}
        onClick={() => onChange(clamp(value + 1))}
        aria-label="Больше"
      >
        +
      </button>
      {presets
        .filter((preset) => preset > 0 && preset <= limit && preset !== value)
        .map((preset) => (
          <button
            key={preset}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => onChange(clamp(preset))}
          >
            {num(preset)}
          </button>
        ))}
      <button
        type="button"
        className="chip"
        disabled={disabled || value >= limit}
        title="Взять всё доступное количество"
        onClick={() => onChange(clamp(limit))}
      >
        МАКС
      </button>
    </div>
  );
}

export interface StepItem {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  active: boolean;
}

/** Пошаговый список задач: закладка станции, воронка развития. */
export function Steps({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="steps">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={step.done ? 'step done' : step.active ? 'step active' : 'step'}
        >
          <span className="step-mark">{step.done ? '✓' : index + 1}</span>
          <div className="step-body">
            <b>{step.label}</b>
            <span className="dim">{step.hint}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
