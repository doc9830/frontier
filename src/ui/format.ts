import type { Amounts, ResourceId, RiskLevel, ShipStatus } from '../game/types.ts';
import { resource } from '../game/data/resources.ts';

/** Small presentation helpers shared by every panel. */

export function num(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function cr(value: number): string {
  return `${num(value)} кр`;
}

export function amountsText(amounts: Amounts | undefined | null): string {
  if (!amounts) return '—';
  const parts = Object.entries(amounts)
    .filter(([, qty]) => (qty ?? 0) > 0)
    .map(([id, qty]) => `${num(qty ?? 0)} ${resource(id as ResourceId).symbol}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} с`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} мин ${String(total % 60).padStart(2, '0')} с`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${String(minutes % 60).padStart(2, '0')} мин`;
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function barColor(fraction: number): string {
  if (fraction > 0.66) return '#41f0c1';
  if (fraction > 0.33) return '#ffb347';
  return '#ff6b6b';
}

export function threatColor(risk: RiskLevel): string {
  if (risk === 'LOW') return '#7ef7b0';
  if (risk === 'MEDIUM') return '#ffd166';
  if (risk === 'HIGH') return '#ffb347';
  return '#ff6b6b';
}

export const STATUS_LABEL: Record<ShipStatus, string> = {
  docked: 'В ДОКЕ',
  transit: 'В ПЕРЕЛЁТЕ',
  mining: 'ДОБЫЧА',
  trading: 'ТОРГОВЫЙ РЕЙС',
  escort: 'ЭСКОРТ',
  survey: 'СКАНИРОВАНИЕ',
};

/** Risk is stored as an enum key; the UI never shows raw English. */
export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: 'низкий',
  MEDIUM: 'средний',
  HIGH: 'высокий',
  EXTREME: 'экстремальный',
};

export const RISK_SHORT: Record<RiskLevel, string> = {
  LOW: 'НИЗК.',
  MEDIUM: 'СРЕДН.',
  HIGH: 'ВЫСОК.',
  EXTREME: 'ЭКСТР.',
};

export function riskText(risk: RiskLevel): string {
  return `риск ${RISK_LABEL[risk]}`;
}

/** Mission phase keys → human Russian. */
export const PHASE_LABEL: Record<string, string> = {
  outbound: 'идёт к поясу',
  working: 'бурит',
  inbound: 'везёт на станцию',
  toBuy: 'закупается',
  toSell: 'везёт на продажу',
};

/** News tags are stored as keys; the feed shows Russian words. */
export const NEWS_TAG_LABEL: Record<string, string> = {
  market: 'рынок',
  piracy: 'пиратство',
  faction: 'фракции',
  exploration: 'исследование',
  salvage: 'находки',
  rescue: 'спасение',
  travel: 'перелёты',
  station: 'станция',
  mining: 'добыча',
  trade: 'торговля',
  personal: 'личное',
  system: 'система',
  world: 'мир',
  lawless: 'безвластие',
  survey: 'съёмка',
};

export function newsTag(tag: string): string {
  return NEWS_TAG_LABEL[tag] ?? tag;
}

