import type { GameState } from '../game/types.ts';
import { dockedStations, ownStationRecord } from '../game/data/stations.ts';
import { playerShip } from '../game/state/create.ts';

/**
 * Навигация интерфейса: шесть вкладок нижнего дока и подэкраны внутри них.
 *
 * Раньше рынок, верфь, станция, контракты и разведка были отдельными вкладками.
 * Теперь вкладок ровно шесть (под мобильный экран), а всё остальное — экраны
 * внутри вкладки: в стек можно войти и вернуться кнопкой «назад» (в том числе
 * аппаратной на Android).
 */

export type TabId = 'system' | 'cargo' | 'ship' | 'fleet' | 'news' | 'settings';

export interface TabDef {
  id: TabId;
  label: string;
  title: string;
}

export const TABS: TabDef[] = [
  { id: 'system', label: 'СИСТЕМА', title: 'Система: описание, планеты, станции, исследование, ресурсы и прыжки' },
  { id: 'cargo', label: 'ГРУЗ', title: 'Трюм корабля, рынок и склады станций' },
  { id: 'ship', label: 'КОРАБЛЬ', title: 'Флагман: состояние, службы и верфь' },
  { id: 'fleet', label: 'ФЛОТ', title: 'Задания для остальных кораблей' },
  { id: 'news', label: 'ЛЕНТА', title: 'Сводка, статистика и подсказки' },
  { id: 'settings', label: 'НАСТРОЙКИ', title: 'Пауза, темп времени, интерфейс и обновления' },
];

export function tabDef(id: TabId): TabDef {
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

export type ScreenId =
  | 'research'
  | 'resources'
  | 'stations'
  | 'station'
  | 'base'
  | 'site'
  | 'market'
  | 'storage'
  | 'shipyard'
  | 'contracts';

export interface Screen {
  id: ScreenId;
  /** Для экрана станции: id конкретной станции системы. */
  stationId?: string;
}

export interface Destination {
  tab: TabId;
  screen?: Screen;
}

export function destination(tab: TabId, screen?: ScreenId, stationId?: string): Destination {
  return screen ? { tab, screen: { id: screen, stationId } } : { tab };
}

/** Заголовок подэкрана: он же в шапке листа и в хлебной крошке. */
export function screenTitle(state: GameState, screen: Screen): string {
  switch (screen.id) {
    case 'research':
      return 'Исследование';
    case 'resources':
      return 'Ресурсы';
    case 'stations':
      return 'Станции системы';
    case 'station': {
      const own = ownStationRecord(state);
      const ship = playerShip(state);
      if (own && own.id === screen.stationId) return `Станция · ${own.name}`;
      if (ship) {
        const found = dockedStations(state, ship.systemId).find(
          (entry) => entry.station.id === screen.stationId,
        );
        if (found) return `Станция · ${found.station.name}`;
      }
      return 'Станция';
    }
    case 'base':
      return `База · ${state.station.name}`;
    case 'site':
      return 'Закладка станции';
    case 'market':
      return 'Рынок';
    case 'storage':
      return 'Склады';
    case 'shipyard':
      return 'Верфь';
    case 'contracts':
      return 'Контракты';
    default:
      return 'Раздел';
  }
}

/** Название пункта для подсказок в ленте. */
export function destinationLabel(dest: Destination): string {
  if (dest.screen) return screenLabelOnly(dest.screen.id);
  return tabDef(dest.tab).label;
}

function screenLabelOnly(id: ScreenId): string {
  const map: Record<ScreenId, string> = {
    research: 'ИССЛЕДОВАНИЕ',
    resources: 'РЕСУРСЫ',
    stations: 'СТАНЦИИ',
    station: 'СТАНЦИЯ',
    base: 'БАЗА',
    site: 'ЗАКЛАДКА',
    market: 'РЫНОК',
    storage: 'СКЛАД',
    shipyard: 'ВЕРФЬ',
    contracts: 'КОНТРАКТЫ',
  };
  return map[id];
}
