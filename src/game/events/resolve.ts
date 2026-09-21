import type { Amounts, Encounter, EventPayload, GameState, ResourceId, Ship } from '../types.ts';
import { runtimeRng } from '../rng.ts';
import { createEncounter, resolveFight, tryEscape } from '../combat/combat.ts';
import { shipStats } from '../ships/ship.ts';
import { resourceSymbol } from '../data/resources.ts';
import { addNews } from '../news/news.ts';
import { eventDef, eventReputation, grantCargo } from './events.ts';

/**
 * Resolves a travel event choice. Everything that is not about travel itself
 * (credits, cargo, hull, reputation, news) is applied here, so the engine only
 * has to deal with the trip bookkeeping.
 */

export interface ResolutionOutcome {
  summary: string;
  kind: 'info' | 'good' | 'bad';
  log: string[];
  /** the player made an emergency jump: retarget the trip to a neighbour */
  emergencyJump: boolean;
  /** the player's flagship was destroyed */
  shipDestroyed: boolean;
  /** the trap sprung: the engine immediately opens a pirate encounter modal */
  triggerCombat: Encounter | null;
}

function outcome(partial: Partial<ResolutionOutcome>): ResolutionOutcome {
  return {
    summary: '',
    kind: 'info',
    log: [],
    emergencyJump: false,
    shipDestroyed: false,
    triggerCombat: null,
    ...partial,
  };
}

function cargoLine(added: number, lost: number, cargo: Amounts): string {
  const text = Object.entries(cargo)
    .filter(([, qty]) => (qty ?? 0) > 0)
    .map(([id, qty]) => `${qty} ${resourceSymbol(id as ResourceId)}`)
    .join(', ');
  if (lost > 0) {
    return `Погружено ${added} из ${added + lost} единиц (${text}); остальное не влезло.`;
  }
  return `В трюм погружено ${added} единиц (${text}).`;
}

export function resolveTravelEvent(
  state: GameState,
  ship: Ship,
  eventId: string,
  choiceId: string,
  payload: EventPayload,
): ResolutionOutcome {
  void eventDef(eventId);
  const system = state.systems[payload.systemId ?? ship.systemId] ?? state.systems[ship.systemId];
  const systemName = system?.name ?? 'глубоком космосе';
  const factionId = system?.factionId ?? null;

  switch (eventId) {
    case 'nothing':
      return outcome({ summary: 'Перелёт спокойный. Только звёзды и шум эфира.', kind: 'info' });

    case 'abandoned_cargo': {
      if (choiceId === 'leave') {
        return outcome({ summary: 'Вы оставляете контейнер дрейфовать.', kind: 'info' });
      }
      if (runtimeRng.chance(0.12)) {
        return outcome({
          summary: 'Контейнер оказался приманкой. Пираты снимают маскировку!',
          kind: 'bad',
          log: ['Абордажная команда нашла в корпусе работающий транспондер.'],
          triggerCombat: createEncounter(state, ship.systemId, 0.9),
        });
      }
      const cargo = payload.cargo ?? { metal: 10 };
      const { added, lost } = grantCargo(ship, cargo);
      if (added === 0) {
        return outcome({ summary: 'Трюм полон. Груз приходится оставить.', kind: 'info' });
      }
      addNews(state, `Спасатель нашёл бесхозный груз в системе ${systemName}.`, 'salvage', system?.id);
      return outcome({ summary: cargoLine(added, lost, cargo), kind: 'good' });
    }

    case 'distress_signal': {
      if (choiceId === 'ignore') {
        return outcome({
          summary: 'Вы игнорируете сигнал бедствия и продолжаете путь.',
          kind: 'info',
        });
      }
      const fuelCost = Math.min(ship.fuel, 8);
      ship.fuel = Math.max(0, ship.fuel - 8);
      const reward = payload.credits ?? 1200;
      state.player.credits += reward;
      const rep = eventReputation(state, factionId, 3);
      addNews(
        state,
        `Гражданский грузовик в системе ${systemName} благодарит безымянного пилота за спасение.`,
        'rescue',
        system?.id,
        factionId,
      );
      return outcome({
        summary: `Вы стыкуетесь, латаете реактор и принимаете ${Math.round(fuelCost)} т топлива в счёт оплаты. Награда: ${reward} кр.${rep}`,
        kind: 'good',
        log: ['Спасательная операция завершена.'],
      });
    }

    case 'rare_signal': {
      if (choiceId === 'skip') {
        return outcome({ summary: 'Вы фиксируете сигнал в журнале и летите дальше.', kind: 'info' });
      }
      const stats = shipStats(ship);
      const scanPower = 0.35 + Math.min(0.6, stats.scanner / 60);
      if (!runtimeRng.chance(scanPower)) {
        return outcome({ summary: 'Сигнал тонет в фоновом шуме.', kind: 'info' });
      }
      if (payload.beltId && system) {
        const belt = system.belts.find((b) => b.id === payload.beltId);
        if (belt) belt.discovered = true;
        addNews(
          state,
          `Глубокое сканирование открыло новое месторождение в системе ${systemName}.`,
          'exploration',
          system.id,
          factionId,
        );
        return outcome({
          summary: `Сканирование выявило новое поле астероидов: ${belt?.name ?? 'безымянный пояс'}.`,
          kind: 'good',
        });
      }
      const cargo = payload.cargo ?? { rareOre: 5 };
      const { added, lost } = grantCargo(ship, cargo);
      if (added === 0) return outcome({ summary: 'В этой системе нет ничего нового.', kind: 'info' });
      return outcome({ summary: cargoLine(added, lost, cargo), kind: 'good' });
    }
    case 'derelict_ship': {
      if (choiceId === 'leave') {
        return outcome({ summary: 'Вы оставляете брошенный корабль космосу.', kind: 'info' });
      }
      if (runtimeRng.chance(0.18)) {
        return outcome({
          summary: 'На брошенном корабле всё ещё есть экипаж — и это пираты!',
          kind: 'bad',
          log: ['Абордажная команда вскрыла переборку и попала в засаду.'],
          triggerCombat: createEncounter(state, ship.systemId, 0.95),
        });
      }
      const credits = payload.credits ?? 1500;
      state.player.credits += credits;
      const cargo = payload.cargo ?? { metal: 15 };
      const { added, lost } = grantCargo(ship, cargo);
      addNews(
        state,
        `Команда скупщиков разобрала брошенный корпус в системе ${systemName}.`,
        'salvage',
        system?.id,
      );
      return outcome({
        summary: `Из корпуса извлечено ${credits} кр. ${cargoLine(added, lost, cargo)}`,
        kind: 'good',
      });
    }

    case 'trade_opportunity': {
      if (choiceId === 'decline') {
        return outcome({ summary: 'Вы отказываетесь от услуг посредника и сохраняете кредиты.', kind: 'info' });
      }
      const tipCost = 250;
      const value = payload.credits ?? 600;
      state.player.credits += value - tipCost;
      addNews(
        state,
        `Торговые сводки: в системе ${systemName} растёт спред между ценами.`,
        'market',
        system?.id,
        factionId,
      );
      return outcome({
        summary: `Информация куплена за ${tipCost} кр и перепродана за ${value} кр.`,
        kind: value > tipCost ? 'good' : 'bad',
      });
    }

    case 'unknown_anomaly': {
      if (choiceId === 'avoid') {
        return outcome({ summary: 'Вы прокладываете курс по широкой дуге вокруг аномалии.', kind: 'info' });
      }
      if (runtimeRng.chance(0.4)) {
        const stats = shipStats(ship);
        const damage = Math.round(Math.max(10, stats.hullMax * runtimeRng.range(0.06, 0.16)));
        ship.hull = Math.max(1, ship.hull - damage);
        return outcome({
          summary: `Аномалия ударила по корпусу: −${damage} прочности. Вы уходите на аварийной тяге.`,
          kind: 'bad',
          log: ['Гармоники щита вышли за допустимые пределы.'],
        });
      }
      const credits = payload.credits ?? 0;
      state.player.credits += credits;
      const cargo = payload.cargo ?? { rareOre: 8 };
      const { added, lost } = grantCargo(ship, cargo);
      addNews(
        state,
        `В системе ${systemName} зафиксированы аномальные показания. Научные корабли уже в пути.`,
        'exploration',
        system?.id,
        factionId,
      );
      return outcome({
        summary: `Аномалия изучена: ${credits} кр за научные данные. ${cargoLine(added, lost, cargo)}`,
        kind: 'good',
      });
    }

    case 'pirate_encounter': {
      const enemy = payload.enemy ?? createEncounter(state, ship.systemId, 1);
      if (choiceId === 'cargo') {
        const before = Object.values(ship.cargo).reduce((a, b) => a + (b ?? 0), 0);
        for (const [id, qty] of Object.entries(ship.cargo) as [ResourceId, number][]) {
          const half = Math.floor((qty ?? 0) / 2);
          ship.cargo[id] = (qty ?? 0) - half;
        }
        const after = Object.values(ship.cargo).reduce((a, b) => a + (b ?? 0), 0);
        const dropped = before - after;
        if (dropped === 0) state.player.credits = Math.max(0, state.player.credits - 800);
        addNews(state, `Пираты обобрали торговца рядом с системой ${systemName}.`, 'piracy', system?.id);
        return outcome({
          summary:
            dropped === 0
              ? 'Трюм был пуст, поэтому пираты берут 800 кр «пошлины».'
              : `Вы выбрасываете ${dropped} единиц груза. Пираты пропускают вас.`,
          kind: 'bad',
        });
      }
      if (choiceId === 'fight') {
        const result = resolveFight(state, ship, enemy);
        ship.hull = result.playerHull;
        ship.shield = result.playerShield;
        if (result.outcome === 'victory') {
          state.player.credits += result.bounty;
          ship.kills += 1;
          if (result.repFactionId) eventReputation(state, result.repFactionId, result.repChange);
          addNews(
            state,
            `Независимый пилот уничтожил пиратский рейдер в системе ${systemName}.`,
            'piracy',
            system?.id,
            factionId,
          );
          return outcome({
            summary: `${enemy.name} уничтожен. Трофеи: ${result.bounty} кр.`,
            kind: 'good',
            log: result.log,
          });
        }
        if (result.outcome === 'defeat') {
          return outcome({
            summary: 'Ваш корабль уничтожен, спасательная капсула дрейфует в темноте.',
            kind: 'bad',
            log: result.log,
            shipDestroyed: true,
          });
        }
        return outcome({
          summary: 'Жёсткая перестрелка, после которой обе стороны расходятся.',
          kind: 'bad',
          log: result.log,
        });
      }
      const emergency = choiceId === 'emergency';
      const attempt = tryEscape(ship, enemy, emergency);
      ship.hull = attempt.hull;
      ship.shield = attempt.shield;
      if (ship.hull <= 0) {
        return outcome({
          summary: 'Огонь противника настигает вас на развороте. Корабль потерян.',
          kind: 'bad',
          log: attempt.log,
          shipDestroyed: true,
        });
      }
      if (!attempt.success) {
        return outcome({
          summary: `Уйти не удалось: −прочность корпуса. ${enemy.name} всё ещё на хвосте.`,
          kind: 'bad',
          log: attempt.log,
        });
      }
      return outcome({
        summary: emergency
          ? 'Экстренный прыжок сработал. Вы приходите в соседнюю систему с ободранным корпусом.'
          : 'Вы отрываетесь от перехвата и возвращаетесь на курс.',
        kind: 'good',
        log: attempt.log,
        emergencyJump: emergency,
      });
    }

    default:
      break;
  }
  return outcome({ summary: 'Ничего не произошло.', kind: 'info' });
}


