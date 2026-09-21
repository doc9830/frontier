import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types.ts';
import { advance, catchUp, resolvePendingEvent } from '../sim/engine.ts';
import { clearToast } from '../sim/toast.ts';
import { hasSave, loadGame, offlineSeconds, saveGame, startNewGame } from '../save.ts';

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
  /** Runs a mutation and refreshes the UI. */
  act: (mutator: (state: GameState) => void) => void;
  resolveEvent: (choiceId: string) => void;
  save: () => void;
  newGame: (seed: string, playerName?: string) => void;
  continueGame: () => void;
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
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;

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

  const load = useCallback((withCatchUp: boolean) => {
    const loaded = loadGame();
    if (!loaded) return;
    if (withCatchUp) {
      const seconds = offlineSeconds(loaded);
      const simulated = catchUp(loaded, seconds);
      if (simulated > 45) setOfflineReport(describeOffline(simulated));
    }
    setState({ ...loaded });
  }, []);

  const save = useCallback(() => {
    const current = stateRef.current;
    if (current) saveGame(current);
  }, []);

  const newGame = useCallback((seed: string, playerName?: string) => {
    const created = startNewGame(seed, playerName);
    setOfflineReport(null);
    setState({ ...created });
  }, []);

  const continueGame = useCallback(() => load(true), [load]);

  const resolveEvent = useCallback(
    (choiceId: string) => {
      act((draft) => resolvePendingEvent(draft, choiceId));
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
      if (seconds > 0.02) act((draft) => advance(draft, seconds));
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
    if (!active) return;
    const id = window.setInterval(() => save(), AUTOSAVE_MS);
    const onLeave = (): void => save();
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', onLeave);
      save();
    };
  }, [active, save]);

  const hasExistingSave = hasSave();

  return { state, offlineReport, act, resolveEvent, save, newGame, continueGame, hasExistingSave };
}
