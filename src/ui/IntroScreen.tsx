import { useState } from 'react';
import { START_CREDITS } from '../game/state/create.ts';
import { cr } from './format.ts';
import { Btn, Hint } from './kit.tsx';

/** Boot screen: pick a seed or resume the autosave. */

export function IntroScreen({
  hasSave,
  offlineReport,
  onNewGame,
  onContinue,
}: {
  hasSave: boolean;
  offlineReport: string | null;
  onNewGame: (seed: string, playerName: string) => void;
  onContinue: () => void;
}) {
  const [seed, setSeed] = useState('');
  const [name, setName] = useState('КОМАНДОР');
  const generated = seed.trim() || Math.random().toString(36).slice(2, 10).toUpperCase();

  return (
    <div className="intro">
      <div className="intro-card">
        <h1>FRONTIER</h1>
        <div className="dim">
          Процедурная космическая песочница: торговые трассы, пояса астероидов, своя станция и политика четырёх
          фракций. Никаких сюжетных миссий и финала — только космос.
        </div>
        {offlineReport ? <div className="warn">{offlineReport}</div> : null}
        <ul>
          <li>Летайте по трассам: покупайте дёшево, продавайте дорого, бурите пояса.</li>
          <li>Развивайте станцию: переработка, верфь, склад, лаборатория.</li>
          <li>Покупайте корабли во флот — они работают, пока вы летаете сами.</li>
          <li>Берите контракты на доставку, держите репутацию, уходите от пиратов.</li>
          <li>Прогресс сохраняется каждые 15 секунд — вкладку можно закрывать.</li>
        </ul>
        <label className="dim">
          имя капитана
          <input
            style={{ display: 'block', width: '100%', marginTop: 4 }}
            value={name}
            maxLength={16}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="dim">
          ключ галактики (seed)
          <input
            style={{ display: 'block', width: '100%', marginTop: 4 }}
            value={seed}
            placeholder={generated}
            maxLength={24}
            onChange={(event) => setSeed(event.target.value)}
          />
        </label>
        <div className="intro-actions">
          <Btn kind="primary" onClick={() => onNewGame(generated, name.trim() || 'КОМАНДОР')}>
            НОВАЯ ГАЛАКТИКА
          </Btn>
          <Btn
            disabled={!hasSave}
            onClick={onContinue}
            title={hasSave ? 'Продолжить сохранение' : 'Сохранение не найдено'}
          >
            ПРОДОЛЖИТЬ
          </Btn>
          <span className="dim">стартовый капитал: {cr(START_CREDITS)}</span>
        </div>
        <Hint>
          Один и тот же ключ — одна и та же галактика. Запишите его, если хотите поделиться картой или вернуться
          к ней позже.
        </Hint>
      </div>
    </div>
  );
}
