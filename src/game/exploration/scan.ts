import type { GameState, Ship, SurveyKind } from '../types.ts';
import { playerShip } from '../state/create.ts';
import { addToast } from '../sim/toast.ts';
import { addNews } from '../news/news.ts';
import { shipStats } from '../ships/ship.ts';
import { beltReserve, MIN_BELT_RESERVE } from '../data/belts.ts';
import { siteLogisticsBonus } from '../site/site.ts';
import { revealAround } from '../sim/travel.ts';

/**
 * Разведка. Одна задача сканирования на весь флот: панель «Разведка» запускает,
 * показывает прогресс и прерывает её. Скан открывает то, без чего нельзя играть
 * дальше: пояса (добыча) и планеты (участок под собственную станцию).
 */

export interface SurveyKindInfo {
  label: string;
  short: string;
  seconds: number;
  /** Топливо, которое сканер тратит на задачу. */
  fuel: number;
  hint: string;
}

export const SURVEY_INFO: Record<SurveyKind, SurveyKindInfo> = {
  belt: {
    label: 'Разведка пояса',
    short: 'ПОЯС',
    seconds: 35,
    fuel: 2,
    hint: 'Наносит пояс на карты и замеряет запас руды.',
  },
  system: {
    label: 'Полный скан системы',
    short: 'СКАН',
    seconds: 80,
    fuel: 4,
    hint: 'Картографирует планеты и пояса. Без него участок под станцию не выбрать.',
  },
  deep: {
    label: 'Дальний скан',
    short: 'ДАЛЬН',
    seconds: 110,
    fuel: 8,
    hint: 'Смотрит сквозь соседнюю систему и открывает её соседей.',
  },
};

/** Лучший сканер на корабле ускоряет работу: factor 1 → 0.4. */
export function surveyScannerFactor(ship: Ship): number {
  return Math.max(0.4, 1 - shipStats(ship).scanner * 0.02);
}

export function surveySeconds(state: GameState, ship: Ship, kind: SurveyKind): number {
  const factor = surveyScannerFactor(ship) * (1 - siteLogisticsBonus(state));
  return Math.max(8, Math.round(SURVEY_INFO[kind].seconds * factor));
}

export function surveyFuel(kind: SurveyKind): number {
  return SURVEY_INFO[kind].fuel;
}

/** Результат проверки: строка-причина отказа или null, если сканировать можно. */
export function surveyBlockedReason(
  state: GameState,
  ship: Ship,
  kind: SurveyKind,
  options: { beltId?: string | null; targetSystemId?: string | null } = {},
): string | null {
  if (ship.travel) return 'Сначала завершите перелёт.';
  if (ship.status === 'mining') return 'Сначала остановите добычу.';
  if (shipStats(ship).scanner <= 0) return 'На этом корабле нет сканера.';
  if (state.survey) return 'Сканер уже занят: дождитесь конца работы или прервите её.';
  const system = state.systems[ship.systemId];
  if (!system) return 'Рядом нет системы для сканирования.';
  if (kind === 'belt') {
    const belt = system.belts.find((b) => b.id === options.beltId);
    if (!belt) return 'Выберите пояс в текущей системе.';
    if (belt.discovered) return `Пояс ${belt.name} уже нанесён на карты.`;
    if (beltReserve(belt) <= MIN_BELT_RESERVE) return `В поясе ${belt.name} нечего искать: он выработан.`;
  }
  if (kind === 'system' && system.scanned === true) {
    return `Система ${system.name} уже отсканирована.`;
  }
  if (kind === 'deep') {
    const target = options.targetSystemId ? state.systems[options.targetSystemId] : null;
    if (!target) return 'Выберите систему, через которую вести дальний скан.';
    if (target.id === system.id) return 'Дальний скан ведут через соседнюю систему.';
    if (!target.discovered) return `Система ${target.name} ещё не на карте.`;
    if (!deepScanTargets(state, target.id).some((id) => !state.systems[id]?.discovered)) {
      return `За системой ${target.name} больше нечего открывать.`;
    }
  }
  if (ship.fuel < surveyFuel(kind)) {
    return `Нужно ${surveyFuel(kind)} топлива на работу сканера (в баке ${Math.floor(ship.fuel)}).`;
  }
  return null;
}

/** Соседи системы, которые дальний скан может открыть. */
export function deepScanTargets(state: GameState, systemId: string): string[] {
  const system = state.systems[systemId];
  if (!system) return [];
  return system.connections.filter((id) => !!state.systems[id]);
}

export interface StartSurveyOptions {
  beltId?: string | null;
  targetSystemId?: string | null;
}

/** Запускает сканирование. Топливо списывается сразу, работа идёт по таймеру. */
export function startSurvey(state: GameState, kind: SurveyKind, options: StartSurveyOptions = {}): boolean {
  const ship = playerShip(state);
  if (!ship) return false;
  const blocked = surveyBlockedReason(state, ship, kind, options);
  if (blocked) {
    addToast(state, blocked, 'bad');
    return false;
  }
  const system = state.systems[ship.systemId];
  const seconds = surveySeconds(state, ship, kind);
  const fuel = surveyFuel(kind);
  ship.fuel = Math.max(0, ship.fuel - fuel);
  ship.travel = null;
  const finishAt = state.gameTime + seconds;
  const job = {
    id: `SV-${Math.floor(state.gameTime)}-${kind}`,
    kind,
    systemId: system.id,
    beltId: options.beltId ?? null,
    targetSystemId: options.targetSystemId ?? null,
    startedAt: state.gameTime,
    finishAt,
  };
  state.survey = job;
  ship.status = 'survey';
  addToast(
    state,
    `${SURVEY_INFO[kind].label}: работа займёт ${seconds} с и ${fuel} топлива.`,
    'info',
  );
  return true;
}

/** Прерывает сканирование: топливо не возвращается, результат не выдаётся. */
export function cancelSurvey(state: GameState): void {
  const job = state.survey;
  if (!job) return;
  state.survey = null;
  const ship = playerShip(state);
  if (ship && ship.status === 'survey') ship.status = 'docked';
  addToast(state, `${SURVEY_INFO[job.kind].label} прервано. Израсходованное топливо списано.`, 'info');
}

/** Прогресс задачи, 0..1. */
export function surveyProgress(state: GameState): number {
  const job = state.survey;
  if (!job) return 0;
  const span = Math.max(0.001, job.finishAt - job.startedAt);
  return Math.min(1, Math.max(0, (state.gameTime - job.startedAt) / span));
}

function completeSurvey(state: GameState): void {
  const job = state.survey;
  if (!job) return;
  state.survey = null;
  const ship = playerShip(state);
  if (ship && ship.status === 'survey') ship.status = 'docked';
  const system = state.systems[job.systemId];
  const factionId = system?.factionId ?? null;

  if (job.kind === 'belt') {
    const belt = system?.belts.find((b) => b.id === job.beltId);
    if (!belt || !system) return;
    belt.discovered = true;
    const left = beltReserve(belt);
    addToast(state, `Пояс ${belt.name}: запас оценён в ${left} ед.`, 'good');
    addNews(
      state,
      `Сканер ${ship?.name ?? 'корабля'} нанёс на карты пояс ${belt.name} в системе ${system.name}: запас ~${left} ед.`,
      'exploration',
      system.id,
      factionId,
    );
    return;
  }

  if (job.kind === 'system') {
    if (!system) return;
    system.scanned = true;
    for (const belt of system.belts) belt.discovered = true;
    const buildable = system.planets.filter((p) => p.type !== 'газовый гигант').length;
    addToast(
      state,
      `Система ${system.name} отсканирована: планет ${system.planets.length}, поясов ${system.belts.length}.`,
      'good',
    );
    addNews(
      state,
      `Полный скан системы ${system.name} завершён: ${system.planets.length} планет, ${system.belts.length} поясов, пригодных миров — ${buildable}.`,
      'exploration',
      system.id,
      factionId,
    );
    return;
  }

  const targetId = job.targetSystemId;
  const target = targetId ? state.systems[targetId] : null;
  if (!target || !targetId) return;
  const revealed = revealAround(state, targetId, 1);
  addToast(
    state,
    revealed.length > 0
      ? `Дальний скан через ${target.name}: открыто систем — ${revealed.length}.`
      : `Дальний скан через ${target.name} не нашёл новых систем.`,
    revealed.length > 0 ? 'good' : 'info',
  );
  addNews(
    state,
    revealed.length > 0
      ? `Дальний скан из системы ${target.name}: на карту нанесено ${revealed.length} новых систем.`
      : `Дальний скан из системы ${target.name}: новых систем не обнаружено.`,
    'exploration',
    targetId,
    target.factionId,
  );
}

/** Тикает активное сканирование. Вызывается из главного цикла симуляции. */
export function processSurvey(state: GameState): void {
  const job = state.survey;
  if (!job) return;
  if (state.gameTime < job.finishAt) return;
  completeSurvey(state);
}

export interface SurveyStatus {
  job: NonNullable<GameState['survey']>;
  info: SurveyKindInfo;
  label: string;
  hint: string;
  progress: number;
  secondsLeft: number;
  systemName: string;
  beltName: string | null;
  targetName: string | null;
}

/** Состояние разведки для панели «Разведка». */
export function surveyStatus(state: GameState): SurveyStatus | null {
  const job = state.survey;
  if (!job) return null;
  const system = state.systems[job.systemId];
  const belt = job.beltId ? system?.belts.find((b) => b.id === job.beltId) : undefined;
  const target = job.targetSystemId ? state.systems[job.targetSystemId] : undefined;
  const info = SURVEY_INFO[job.kind];
  return {
    job,
    info,
    label: info.label,
    hint: info.hint,
    progress: surveyProgress(state),
    secondsLeft: Math.max(0, Math.ceil(job.finishAt - state.gameTime)),
    systemName: system?.name ?? job.systemId,
    beltName: belt?.name ?? null,
    targetName: target?.name ?? null,
  };
}
