import type { ReactNode } from 'react';

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

export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="tag" style={color ? { color, borderColor: color } : undefined}>
      {children}
    </span>
  );
}
