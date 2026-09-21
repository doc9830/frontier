import { useEffect, useState } from 'react';
import {
  checkForUpdate,
  currentUpdateState,
  installAppUpdate,
  installWebUpdate,
  isAndroidShell,
  onUpdateState,
  openInstallSettings,
  reloadShell,
  shellInfo,
  shellToast,
} from '../platform/android.ts';
import { Btn, Hint, Meter, Panel, Row, Tag } from './kit.tsx';

/**
 * Update card, shown only inside the Android shell: the game checks the GitHub
 * repository itself, swaps its own files for a newer bundle and, when the shell
 * changed too, hands a new APK to the system installer — no browser involved.
 */

const BUSY_PHASES = new Set(['checking', 'downloading', 'unpacking', 'installing']);

export function UpdateCard() {
  const [state, setState] = useState(currentUpdateState);
  const [info, setInfo] = useState(shellInfo);

  useEffect(() => onUpdateState(setState), []);
  // The reported versions change right after an install, so refresh them with the phase.
  useEffect(() => {
    setInfo(shellInfo());
  }, [state.phase]);

  if (!isAndroidShell()) return null;

  const busy = BUSY_PHASES.has(state.phase);
  const percent = typeof state.percent === 'number' && state.percent >= 0 ? state.percent : null;
  const ready = state.phase === 'ready' || state.reload === true;

  return (
    <Panel
      title="Обновление"
      tight
      actions={<Tag color="#41f0c1">{`v${info?.web ?? '—'}`}</Tag>}
    >
      <Row label="Версия игры" value={`v${info?.web ?? '—'}`} />
      <Row label="Версия приложения" value={`v${info?.app ?? '—'}`} />
      {state.version ? <Row label="Доступно в репозитории" value={`v${state.version}`} /> : null}
      <Hint>
        {state.message ||
          'Обновления приходят из GitHub прямо в приложение: сборка игры меняется на месте, APK — через системный установщик.'}
      </Hint>
      {percent !== null && busy ? <Meter label="Загрузка" value={percent} max={100} suffix="%" /> : null}

      <div className="list-row">
        <div className="list-main">
          <span className="dim">{info?.repo ? `Источник: ${info.repo}` : 'Источник не указан'}</span>
        </div>
        <Btn size="small" onClick={checkForUpdate} disabled={busy}>
          ПРОВЕРИТЬ
        </Btn>
      </div>

      {state.web ? (
        <div className="list-row">
          <div className="list-main">
            <span>Игра: доступна версия {state.version}.</span>
            <span className="dim">Файлы игры заменяются на месте, сохранение остаётся.</span>
          </div>
          <Btn kind="good" size="small" onClick={installWebUpdate} disabled={busy}>
            ОБНОВИТЬ ИГРУ
          </Btn>
        </div>
      ) : null}

      {state.apk ? (
        <div className="list-row">
          <div className="list-main">
            <span>Приложение: доступна версия {state.version}.</span>
            <span className="dim">Android спросит подтверждение один раз и перезапустит FRONTIER.</span>
          </div>
          <Btn kind="primary" size="small" onClick={installAppUpdate} disabled={busy}>
            ОБНОВИТЬ APK
          </Btn>
        </div>
      ) : null}

      {state.needsPermission ? (
        <div className="list-row">
          <div className="list-main">
            <span>Нужно разрешение на установку приложений для FRONTIER.</span>
          </div>
          <Btn size="small" onClick={openInstallSettings}>
            РАЗРЕШИТЬ
          </Btn>
        </div>
      ) : null}

      {ready ? (
        <div className="list-row">
          <div className="list-main">
            <span>Новая версия уже на диске.</span>
          </div>
          <Btn kind="good" size="small" onClick={reloadShell}>
            ПЕРЕЗАПУСТИТЬ
          </Btn>
        </div>
      ) : null}

      {state.notes ? <Hint>{state.notes.split('\n')[0]}</Hint> : null}

      {!busy && state.phase === 'idle' ? (
        <div className="list-row">
          <div className="list-main">
            <span className="dim">Проверить прямо сейчас.</span>
          </div>
          <Btn
            size="tiny"
            onClick={() => {
              shellToast('Проверяю обновления…');
              checkForUpdate();
            }}
          >
            ОБНОВЛЕНИЯ
          </Btn>
        </div>
      ) : null}
    </Panel>
  );
}
