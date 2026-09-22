import type { GameState, SystemStation } from '../types.ts';
import { LAWLESS_NAME } from './factions.ts';
import { stationHasStorage, stationPhaseOf } from '../sim/station.ts';

/**
 * Услуги станций. Набор услуг выводится из типа станции и флагов, которые
 * пишет генератор, поэтому сейвы старых версий читаются без миграции.
 */

export type StationService = 'market' | 'shipyard' | 'refuel' | 'repair' | 'contracts' | 'storage';

export const SERVICE_INFO: Record<StationService, { label: string; short: string; hint: string }> = {
  market: { label: 'Рынок', short: 'РЫНОК', hint: 'Купить и продать товары по текущим ценам.' },
  shipyard: { label: 'Верфь', short: 'ВЕРФЬ', hint: 'Модули кораблей и продажа корпусов.' },
  refuel: { label: 'Заправка', short: 'ТОПЛ', hint: 'Долить топливо в бак флагмана.' },
  repair: { label: 'Ремонт', short: 'РЕМОНТ', hint: 'Починить корпус и щиты за кредиты.' },
  contracts: {
    label: 'Контракты',
    short: 'КОНТР',
    hint: 'Доставка грузов за кредиты и репутацию.',
  },
  storage: {
    label: 'Склад',
    short: 'СКЛАД',
    hint: 'Арендованная ячейка: оставьте груз здесь и заберите в другой рейс.',
  },
};

export const STATION_TYPE_INFO: Record<SystemStation['type'], { label: string; color: string }> = {
  trade: { label: 'Торговая', color: '#5ec8ff' },
  industrial: { label: 'Промышленная', color: '#ffd166' },
  mining: { label: 'Добывающая', color: '#c9a0ff' },
  military: { label: 'Военная', color: '#ff8fa3' },
  research: { label: 'Научная', color: '#6ff0e0' },
  pirate: { label: 'Пиратская', color: '#8a8f98' },
};

/** Минимальная репутация, при которой фракционная станция вас обслуживает. */
export const SERVICE_MIN_REP = 0;

/**
 * Объём арендованного склада на станции фракции. Свой склад расширяется
 * постройками, а чужой всегда ограничен — иначе база была бы не нужна.
 */
export const RENTED_STORAGE: Record<SystemStation['type'], number> = {
  trade: 900,
  industrial: 700,
  mining: 500,
  military: 400,
  research: 600,
  pirate: 250,
};

export function rentedStorageCapacity(station: SystemStation): number {
  return RENTED_STORAGE[station.type] ?? 400;
}

export function stationServices(station: SystemStation): Record<StationService, boolean> {
  return {
    market: station.hasMarket,
    shipyard: station.hasShipyard,
    contracts: station.hasContracts,
    // Явные флаги появились позже: для старых сейвов выводим из типа и рынка.
    refuel: station.hasRefuel ?? true,
    repair:
      station.hasRepair ??
      (station.hasShipyard || station.type === 'trade' || station.type === 'industrial' || station.type === 'pirate'),
    storage: station.hasStorage ?? true,
  };
}

export function stationServiceList(station: SystemStation): StationService[] {
  const flags = stationServices(station);
  return (Object.keys(SERVICE_INFO) as StationService[]).filter((s) => flags[s]);
}

/** «Торговая станция», «Пиратская станция» — подпись типа для карточек. */
export function stationTypeLabel(type: SystemStation['type']): string {
  return `${(STATION_TYPE_INFO[type]?.label ?? type).toLowerCase()} станция`;
}

export function stationOwnerName(state: GameState, station: SystemStation): string {
  if (!station.factionId) return LAWLESS_NAME;
  return state.factions[station.factionId]?.name ?? station.factionId;
}

export interface ServiceAccess {
  ok: boolean;
  /** Причина отказа, готовая к показу в интерфейсе. */
  reason: string | null;
}

/**
 * Репутационный гейт: станция фракции отказывает в обслуживании тем, кого
 * фракция считает врагом. Вольные станции (пираты, Безвластие) обслуживают всех.
 */
export function serviceAccess(
  state: GameState,
  station: SystemStation,
  service: StationService,
): ServiceAccess {
  const flags = stationServices(station);
  if (!flags[service]) {
    return { ok: false, reason: `Станция «${station.name}» не оказывает услугу «${SERVICE_INFO[service].label}».` };
  }
  if (!station.factionId) return { ok: true, reason: null };
  const rep = state.player.reputation[station.factionId] ?? 0;
  if (rep < SERVICE_MIN_REP) {
    const name = stationOwnerName(state, station);
    return {
      ok: false,
      reason: `«${name}» не обслуживает вас: репутация ${rep}. Нужна нейтральная или положительная.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Своя станция как обычная станция системы: эти же флаги услуг читает UI, а
 * набор услуг выводится из построек базы. Пока базы нет (стадия «участок»),
 * вернётся null — иначе она попала бы в списки станций системы.
 */
export function ownStationRecord(state: GameState): SystemStation | null {
  const station = state.station;
  if (!station.systemId || stationPhaseOf(station) === 'planned') return null;
  const dock = (station.buildings.dock ?? 0) > 0;
  return {
    id: station.id,
    name: station.name,
    type: 'industrial',
    factionId: null,
    hasMarket: false,
    hasShipyard: (station.buildings.shipyard ?? 0) > 0,
    hasContracts: false,
    hasRefuel: dock,
    hasRepair: dock,
    hasStorage: stationHasStorage(station),
  };
}

/** Станции текущей системы корабля вместе с их услугами и допуском. */
export interface DockedStation {
  station: SystemStation;
  services: Record<StationService, boolean>;
  /** Услуги, реально доступные игроку с учётом репутации. */
  allowed: Record<StationService, boolean>;
  reason: string | null;
  own: boolean;
}

export function dockedStations(state: GameState, shipSystemId: string): DockedStation[] {
  const system = state.systems[shipSystemId];
  if (!system) return [];
  const own = ownStationRecord(state);
  const list: SystemStation[] =
    own && state.station.systemId === shipSystemId ? [own, ...system.stations] : system.stations;
  return list.map((station) => {
    const services = stationServices(station);
    const allowed: Record<StationService, boolean> = { ...services };
    let reason: string | null = null;
    for (const service of Object.keys(services) as StationService[]) {
      const access = serviceAccess(state, station, service);
      allowed[service] = access.ok;
      if (!access.ok && services[service] && !reason) reason = access.reason;
    }
    return {
      station,
      services,
      allowed,
      reason,
      own: station.id === state.station.id,
    };
  });
}
