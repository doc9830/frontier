import { useState } from 'react';
import type { SlotId, SlotInfo } from '../game/save.ts';
import { START_CREDITS } from '../game/state/create.ts';
import { cr } from './format.ts';
import { Btn, Hint, Panel, Tag } from './kit.tsx';
import { UpdateCard } from './UpdateCard.tsx';
import { shellInfo } from '../platform/android.ts';

/**
 * Главное меню: единственный экран, который открывается до игры. Здесь видно
 * все миры сразу (три слота), здесь же обновляется приложение — заходить в игру
 * для этого не нужно. Новый мир заводится тут же: слот выбирается кнопкой.
 */

function savedAgo(savedAt: number): string {
  if (!savedAt) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 60) return 'только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

export function MainMenu({
  slots,
  offlineReport,
  onPlay,
  onCreate,
  onDelete,
}: {
  slots: SlotInfo[];
  offlineReport: string | null;
  /** Запускает выбранный мир. */
  onPlay: (slotId: SlotId) => void;
  /** Заводит новый мир в выбранном слоте. */
  onCreate: (seed: string, name: string, slotId: SlotId) => void;
  onDelete: (slotId: SlotId) => void;
}) {
  const [name, setName] = useState('КОМАНДОР');
  const [seed, setSeed] = useState('');
  const [target, setTarget] = useState<SlotId | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SlotId | null>(null);
  const info = shellInfo();
  const generated = seed.trim() || Math.random().toString(36).slice(2, 10).toUpperCase();
  const active = slots.find((slot) => slot.filled && slot.active) ?? null;
  const free = slots.filter((slot) => !slot.filled);
  const chosenId =
    (target && slots.some((slot) => slot.id === target) ? target : null) ??
    free[0]?.id ??
    active?.id ??
    slots[0]?.id ??
    null;
  const chosen = slots.find((slot) => slot.id === chosenId) ?? null;
  const overwrites = Boolean(chosen?.filled);

  return (
    <div className="menu">
      <div className="menu-card">
        <header className="menu-head">
          <h1>FRONTIER</h1>
          <div className="dim">
            Процедурный космос без сюжета: торговые трассы, пояса астероидов, своя станция и политика четырёх
            фракций. Один ключ галактики — один и тот же мир.
          </div>
          <div className="menu-meta">
            <Tag color="#41f0c1">{info ? `игра v${info.web} · оболочка v${info.app}` : 'веб-сборка'}</Tag>
            <Tag>{`миров: ${slots.filter((slot) => slot.filled).length} из ${slots.length}`}</Tag>
          </div>
        </header>

        {offlineReport ? <div className="warn">{offlineReport}</div> : null}

        <Panel title="Миры" tight>
          {slots.map((slot) => (
            <div
              className={slot.filled && slot.active ? 'list-row slot-row active' : 'list-row slot-row'}
              key={slot.id}
            >
              <div className="list-main">
                <b>
                  СЛОТ {slot.index}
                  {slot.filled ? ` · ${slot.playerName}` : ' · пусто'}
                  {slot.filled && slot.active ? <span className="dim"> · активный</span> : null}
                </b>
                {slot.filled ? (
                  <span className="dim">
                    корабль {slot.shipName} · день {slot.day} · {cr(slot.credits)}
                  </span>
                ) : (
                  <span className="dim">Свободен: сюда встанет новый мир со своим ключом галактики.</span>
                )}
                {slot.filled ? (
                  <span className="dim">
                    ключ {slot.seed} · сохранён {savedAgo(slot.savedAt)}
                  </span>
                ) : null}
              </div>
              <div className="row-actions">
                {slot.filled ? (
                  <Btn
                    kind={slot.active ? 'primary' : undefined}
                    size="small"
                    onClick={() => onPlay(slot.id)}
                  >
                    {slot.active ? 'ПРОДОЛЖИТЬ' : 'ИГРАТЬ'}
                  </Btn>
                ) : (
                  <Btn size="small" onClick={() => setTarget(slot.id)}>
                    НОВЫЙ МИР
                  </Btn>
                )}
                {slot.filled ? (
                  <Btn
                    kind={confirmDelete === slot.id ? 'bad' : undefined}
                    size="tiny"
                    title={`Удалить мир из слота ${slot.index}`}
                    onClick={() => (confirmDelete === slot.id ? onDelete(slot.id) : setConfirmDelete(slot.id))}
                  >
                    {confirmDelete === slot.id ? 'ТОЧНО УДАЛИТЬ?' : 'УДАЛИТЬ'}
                  </Btn>
                ) : null}
              </div>
            </div>
          ))}
        </Panel>
        <Panel title="Новый мир" tight>
          <div className="row">
            <span>Капитан</span>
            <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="row">
            <span>Ключ галактики</span>
            <input
              value={seed}
              placeholder={generated}
              maxLength={24}
              onChange={(event) => setSeed(event.target.value)}
            />
          </div>
          <div className="row">
            <span>Слот</span>
            <div className="chips">
              {slots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  className={slot.id === chosenId ? 'chip active' : 'chip'}
                  title={slot.filled ? `Слот ${slot.index} занят: мир будет заменён` : `Слот ${slot.index} свободен`}
                  onClick={() => setTarget(slot.id)}
                >
                  {slot.filled ? `${slot.index} ·` : slot.index}
                </button>
              ))}
            </div>
          </div>
          {overwrites ? (
            <Hint>
              Слот {chosen?.index} занят: мир «{chosen?.playerName}» будет заменён новым. Хотите оставить его —
              выберите свободный слот.
            </Hint>
          ) : (
            <Hint>Ключ можно не заполнять: он сгенерируется, а записанный всегда даёт ту же галактику.</Hint>
          )}
          <div className="menu-actions">
            <Btn
              kind="primary"
              disabled={!chosenId}
              onClick={() => {
                if (!chosenId) return;
                onCreate(generated, name.trim() || 'КОМАНДОР', chosenId);
              }}
            >
              НОВАЯ ГАЛАКТИКА
            </Btn>
            <span className="dim">стартовый капитал: {cr(START_CREDITS)}</span>
          </div>
        </Panel>

        <UpdateCard />

        <details className="menu-help">
          <summary>КАК ИГРАТЬ</summary>
          <ul>
            <li>Летайте по трассам: покупайте дёшево, продавайте дорого, бурите пояса.</li>
            <li>
              Разведайте ничью систему, заложите склад на планете с твёрдой корой и привезите материалы — так
              появляется своя станция.
            </li>
            <li>Развивайте базу: переработка, док, верфь, склад, лаборатория.</li>
            <li>Покупайте корабли во флот — они работают, пока вы летаете сами.</li>
            <li>Берите контракты на доставку, держите репутацию, уходите от пиратов или бейте их на радаре.</li>
            <li>Прогресс пишется в активный слот каждые 15 секунд: вкладку можно закрывать.</li>
          </ul>
        </details>


      </div>
    </div>
  );
}
