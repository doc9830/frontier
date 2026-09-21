import type { GameState } from '../types.ts';

let toastId = 1;

/** Short-lived message for the HUD. The UI shows the newest toast and fades it. */
export function addToast(state: GameState, text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  state.toast = { id: toastId, text, kind };
  toastId += 1;
}

export function clearToast(state: GameState): void {
  state.toast = null;
}
