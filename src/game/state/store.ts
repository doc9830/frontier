import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types.ts';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings, tickSeconds } from '../settings.ts';
import type { AppSettings } from '../settings.ts';
import { advance, catchUp, resolvePendingEvent } from '../sim/engine.ts';
import type { FightResult } from '../combat/combat.ts';
import { clearToast } from '../sim/toast.ts';
import {
  activeSlotId,
  deleteSlot as deleteSlotFile,
  loadGame,
  offlineSeconds,
  saveGame,
  slotInfoOf,
  slotList,
  startNewGame,
} from '../save.ts';
import type { SlotId, SlotInfo } from '../save.ts';

/**
 * The single bridge between the simulation and React. The world object is kept
 * in React state and every action mutates a shallow clone, which gives us cheap
 * re-renders without a state management library.
 */

export const TICK_MS = 250;
const AUTOSAVE_MS = 15000;
/** A frame longer than this is clamped so a backgrounded tab cannot teleport. */
const MAX_TICK_SECONDS = 2.5;
const TOAST_MS = 4200;

export interface GameStore {
  state: GameState | null;
  offlineReport: string | null;
  /** Настройки приложения: темп времени, анимация, подтверждения, автосохранение. */
  settings: AppSettings;
  /** Мир на паузе: время, перелёты и стройка стоят. */
  paused: boolean;
  /** Три слота сохранений: меню рисует их карточками. */
  slots: SlotInfo[];
  /** Runs a mutation and refreshes the UI. */
  act: (mutator: (state: GameState) => void) => void;
  resolveEvent: (choiceId: string, prefilledFight?: FightResult | null) => void;
  save: () => void;
  newGame: (seed: string, playerName?: string, slotId?: SlotId) => void;
  continueGame: (slotId?: SlotId) => void;
  /** Удаляет мир из слота: меню показывает это на карточке слота. */
  deleteSlot: (slotId: SlotId) => void;
  /** Перечитывает шапки слотов (например, после возврата в меню). */
  refreshSlots: () => void;
  /** Возврат в главное меню: мир сохраняется и выгружается из памяти. */
  backToMenu: () => void;
  /** Закрыть офлайн-отчёт (он висит поверх игры, пока игрок его не уберёт). */
  dismissOfflineReport: () => void;
  togglePause: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
  hasExistingSave: boolean;
}

function describeOffline(seconds: number): string {
  if (seconds < 60) return 'Пока вас не было, трассы были тихими.';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `Офлайн-прогон: смоделировано ${minutes} мин работы флота.`;
  const hours = (seconds / 3600).toFixed(1);
  return `Офлайн-прогон: смоделировано ${hours} ч (лимит — 8 ч). Ваши корабли продолжали работать.`;
}

export function useGame(): GameStore {
  const [state, setState] = useState<GameState | null>(null);
  const [offlineReport, setOfflineReport] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [paused, setPaused] = useState(false);
  const [slots, setSlots] = useState<SlotInfo[]>(() => slotList());
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;
  // The tick timer is created once, so the loop reads the live values from refs.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const act = useCallback((mutator: (target: GameState) => void) => {
    setState((prev) => {
      if (!prev) return prev;
      const draft: GameState = { ...prev };
      mutator(draft);
      const next: GameState = { ...draft };
      stateRef.current = next;
      return next;
    });
  }, []);

  const refreshSlots = useCallback(() => setSlots(slotList()), []);

  /** Обновляет шапку активного слота без разбора всего блоба. */
  const touchActiveSlot = useCallback((current: GameState) => {
    const id = activeSlotId();
    if (!id) return;
    setSlots((prev) =>
      prev.map((slot) => (slot.id === id ? slotInfoOf(current, id, true) : { ...slot, active: false })),
    );
  }, []);

  const load = useCallback((withCatchUp: boolean, slotId?: SlotId) => {
    const loaded = loadGame(slotId);
    if (!loaded) return;
    if (withCatchUp) {
      const seconds = offlineSeconds(loaded);
      const simulated = catchUp(loaded, seconds);
      if (simulated > 45) setOfflineReport(describeOffline(simulated));
    }
    setState({ ...loaded });
    refreshSlots();
  }, [refreshSlots]);

  const save = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    if (saveGame(current)) touchActiveSlot(current);
  }, [touchActiveSlot]);

  const newGame = useCallback(
    (seed: string, playerName?: string, slotId?: SlotId) => {
      const created = startNewGame(seed, playerName, slotId);
      setOfflineReport(null);
      setPaused(false);
      setState({ ...created });
      refreshSlots();
    },
    [refreshSlots],
  );

  const continueGame = useCallback((slotId?: SlotId) => load(true, slotId), [load]);

  const deleteSlot = useCallback(
    (slotId: SlotId) => {
      deleteSlotFile(slotId);
      refreshSlots();
    },
    [refreshSlots],
  );

  /** «Главное меню»: мир уходит на диск, игра выгружается из памяти. */
  const backToMenu = useCallback(() => {
    save();
    setOfflineReport(null);
    setPaused(false);
    setState(null);
    refreshSlots();
  }, [refreshSlots, save]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...prev, ...patch });
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings({ ...DEFAULT_SETTINGS });
  }, []);

  const togglePause = useCallback(() => setPaused((prev) => !prev), []);

  const resolveEvent = useCallback(
    (choiceId: string, prefilledFight?: FightResult | null) => {
      act((draft) => resolvePendingEvent(draft, choiceId, prefilledFight));
      const current = stateRef.current;
      if (current) saveGame(current);
    },
    [act],
  );

  // --- main loop -----------------------------------------------------------
  const active = state !== null;
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const seconds = Math.min(MAX_TICK_SECONDS, (now - last) / 1000);
      last = now;
      // Пауза не двигает мир вовсе: ни лишних перерисовок, ни расхода батареи.
      const step = tickSeconds(seconds, settingsRef.current, pausedRef.current);
      if (step > 0.02) act((draft) => advance(draft, step));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, act]);

  // --- toasts fade out on their own ---------------------------------------
  const toastId = state?.toast?.id ?? null;
  useEffect(() => {
    if (toastId === null) return;
    const id = window.setTimeout(() => act((draft) => clearToast(draft)), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toastId, act]);

  // --- autosave ------------------------------------------------------------
  useEffect(() => {
    if (!active || !settings.autosave) return;
    const id = window.setInterval(() => save(), AUTOSAVE_MS);
    const onLeave = (): void => save();
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', onLeave);
      save();
    };
  }, [active, save, settings.autosave]);

  const hasExistingSave = slots.some((slot) => slot.filled);

  return {
    state,
    offlineReport,
    settings,
    paused,
    slots,
    act,
    resolveEvent,
    save,
    newGame,
    continueGame,
    deleteSlot,
    refreshSlots,
    backToMenu,
    togglePause,
    updateSettings,
    resetSettings,
    dismissOfflineReport: () => setOfflineReport(null),
    hasExistingSave,
  };
}
