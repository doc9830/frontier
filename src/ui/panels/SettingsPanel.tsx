import type { GameState } from '../../game/types.ts';
import { SPEED_CHOICES, type AppSettings } from '../../game/settings.ts';
import { playerShip } from '../../game/state/create.ts';
import { gameDay } from '../../game/news/news.ts';
import { isAndroidShell } from '../../platform/android.ts';
import { cr, num, pct } from '../format.ts';
import { Btn, Chips, Hint, Panel, Row, Tag, Toggle } from '../kit.tsx';
import { UpdateCard } from '../UpdateCard.tsx';

/**
 * Раздел настроек: пауза, темп игрового времени, поведение интерфейса,
 * обновления и сводка по приложению. Настройки лежат отдельно от сохранения —
 * их можно менять прямо в перелёте.
 */

export function SettingsPanel({
  state,
  settings,
  paused,
  onTogglePause,
  onChange,
  onReset,
  onSave,
  onMenu,
}: {
  state: GameState;
  settings: AppSettings;
  paused: boolean;
  onTogglePause: () => void;
  onChange: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
  onSave: () => void;
  /** Сохраняет мир и возвращает в главное меню со слотами. */
  onMenu: () => void;
}) {
  const ship = playerShip(state);
  const discovered = state.systemIds.filter((id) => state.systems[id]?.discovered).length;
  const speed = SPEED_CHOICES.find((choice) => choice.value === settings.speed);
  const savedAt = state.savedAt
    ? new Date(state.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <>
      <Panel
        title="Игра"
        tight
        actions={<Tag color={paused ? '#ffb347' : '#41f0c1'}>{paused ? 'ПАУЗА' : 'ИДЁТ'}</Tag>}
      >
        <Row label="Игровое время" value={paused ? 'остановлено' : `день ${gameDay(state).toFixed(2)}`} />
        <Btn kind={paused ? 'good' : 'primary'} onClick={onTogglePause}>
          {paused ? 'ПРОДОЛЖИТЬ' : 'ПАУЗА'}
        </Btn>
        <Hint>Пауза останавливает время: перелёты, добыча, стройка и флот ждут. Тот же переключатель — в верхней панели.</Hint>
        <Row label="Темп времени" value={speed?.hint ?? `×${settings.speed}`} />
        <Chips
          options={SPEED_CHOICES.map((choice) => ({ value: choice.value, label: choice.label, hint: choice.hint }))}
          value={settings.speed}
          onChange={(value) => onChange({ speed: value })}
        />
        <Toggle
          label="Автосохранение"
          hint="каждые 15 секунд"
          value={settings.autosave}
          onChange={(value) => onChange({ autosave: value })}
        />
        <div className="list-row">
          <div className="list-main">
            <span>Сохранение</span>
            <span className="dim">последнее в {savedAt} · ключ {state.seed}</span>
          </div>
          <Btn size="small" onClick={onSave}>
            СОХРАНИТЬ
          </Btn>
        </div>
        <div className="list-row">
          <div className="list-main">
            <span>Главное меню</span>
            <span className="dim">мир запишется в свой слот, игра выгрузится из памяти</span>
          </div>
          <Btn size="small" onClick={onMenu}>
            ГЛАВНОЕ МЕНЮ
          </Btn>
        </div>
      </Panel>

      <Panel title="Интерфейс" tight>
        <Toggle
          label="Анимация прыжка"
          hint="корабль идёт по линии"
          value={settings.animations}
          onChange={(value) => onChange({ animations: value })}
        />
        <Toggle
          label="Всплывающие сообщения"
          value={settings.toasts}
          onChange={(value) => onChange({ toasts: value })}
        />
        <Toggle
          label="Подтверждать прыжок"
          hint="спрашивать перед тратой топлива"
          value={settings.confirmJump}
          onChange={(value) => onChange({ confirmJump: value })}
        />
      </Panel>

      {isAndroidShell() ? (
        <UpdateCard />
      ) : (
        <Panel title="Обновления" tight>
          <Hint>
            В браузере обновлений нет: новая сборка приходит вместе со страницей. В Android-приложении здесь
            появится проверка обновлений вручную.
          </Hint>
        </Panel>
      )}

      <Panel title="Приложение" tight>
        <Row label="Ключ галактики" value={state.seed} />
        <Row label="Открыто систем" value={`${discovered} / ${state.systemIds.length} · ${pct(discovered / Math.max(1, state.systemIds.length))}`} />
        <Row label="Флот" value={`${num(state.ships.length)} · топливо ${Math.round(ship?.fuel ?? 0)}`} />
        <Row label="Прыжков / сделок" value={`${num(state.player.stats.jumps)} / ${num(state.player.stats.trades)}`} />
        <Row label="Кредиты" value={cr(state.player.credits)} />
        <Hint>Настройки хранятся на устройстве отдельно от сохранения и не сбрасываются новой галактикой.</Hint>
        <Btn size="small" onClick={onReset}>
          СБРОСИТЬ НАСТРОЙКИ
        </Btn>
      </Panel>
    </>
  );
}
