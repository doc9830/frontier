import type { GameState } from '../game/types.ts';

/** Single stacked toast slot: the sim keeps the newest message in state.toast. */

export function Toaster({ state }: { state: GameState }) {
  const toast = state.toast;
  return (
    <div className="toasts">
      {toast ? (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
