import type { GameState } from '../../game/types.ts';
import { playerShip } from '../../game/state/create.ts';
import { resource } from '../../game/data/resources.ts';
import { factionView } from '../../game/factions/reputation.ts';
import { gameDay } from '../../game/news/news.ts';
import {
  abandonContract,
  acceptContract,
  activeContracts,
  canDeliverContract,
  contractBlockedReason,
  contractBoard,
  contractRoute,
  contractTargetName,
  contractUnitsInHold,
  contractsHere,
  deliverContract,
} from '../../game/actions/contracts.ts';
import { cr, num } from '../format.ts';
import { Btn, Hint, Panel, Row, Tag } from '../kit.tsx';

/** Courier board: what is on offer here and what you already signed. */

export function ContractsPanel({
  state,
  run,
}: {
  state: GameState;
  run: (mutator: (draft: GameState) => void) => void;
}) {
  const ship = playerShip(state);
  if (!ship) return null;
  const board = contractBoard(state);
  const here = contractsHere(state);
  const active = activeContracts(state);
  const day = gameDay(state);

  return (
    <>
      <Panel
        title="Доска контрактов"
        actions={
          <div className="row-actions">
            <span className="dim">день {day.toFixed(2)}</span>
            <Tag color={board.available ? '#41f0c1' : undefined}>{board.stationName ?? 'нет доски'}</Tag>
          </div>
        }
      >
        {!board.available ? (
          <Hint>
            {board.reason ??
              'В этой системе контрактов не предлагают.'} Доски бывают на торговых, военных, промышленных и
            научных станциях: смотрите список услуг во вкладке СИСТЕМА.
          </Hint>
        ) : here.length === 0 ? (
          <Hint>На доске пока пусто: заказы появляются со временем.</Hint>
        ) : (
          here.map((contract) => {
            const blocked = contractBlockedReason(state, contract);
            const inHold = contractUnitsInHold(state, contract);
            const deliverable = canDeliverContract(state, contract);
            return (
              <div className="list-row col" key={contract.id}>
                <div className="list-main">
                  <b>
                    {contract.kind === 'courier' ? 'КУРЬЕР · ' : 'ПОСТАВКА · '}
                    {num(contract.amount)} {resource(contract.resource).symbol} →{' '}
                    {contractTargetName(state, contract)}
                  </b>
                  <span className="dim">
                    {cr(contract.reward)} · репутация +{contract.repReward} · нужна репутация {contract.minRep} ·
                    срок до дня {contract.expiresDay.toFixed(1)}
                  </span>
                  <span className="dim">
                    {contractRoute(state, contract)} · {factionView(state, contract.factionId).name}
                    {contract.kind === 'courier'
                      ? ' · груз выдаётся опечатанным'
                      : ` · в трюме ${num(inHold)}/${num(contract.amount)}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {contract.accepted ? (
                    <Btn
                      size="small"
                      kind="good"
                      disabled={!deliverable}
                      title={
                        deliverable
                          ? 'Передать груз'
                          : contract.kind === 'courier'
                            ? `Летите в систему ${contractTargetName(state, contract)} с опечатанным грузом`
                            : `Летите в систему ${contractTargetName(state, contract)} с грузом ${contract.amount} ед. в трюме`
                      }
                      onClick={() => run((draft) => deliverContract(draft, contract.id))}
                    >
                      СДАТЬ
                    </Btn>
                  ) : (
                    <Btn
                      size="small"
                      kind="primary"
                      disabled={!!blocked}
                      title={blocked ?? 'Подписать этот контракт'}
                      onClick={() => run((draft) => acceptContract(draft, contract.id))}
                    >
                      ПРИНЯТЬ
                    </Btn>
                  )}
                  {contract.accepted ? (
                    <Btn size="small" kind="bad" onClick={() => run((draft) => abandonContract(draft, contract.id))}>
                      ОТКАЗАТЬСЯ
                    </Btn>
                  ) : null}
                  {blocked ? <Tag color="#ffb347">{blocked}</Tag> : null}
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel title="Активные контракты" tight>
        {active.length === 0 ? (
          <Hint>
            Ничего не подписано. Контракты платят больше рыночной цены и повышают репутацию фракции.
          </Hint>
        ) : (
          active.map(({ contract }) => (
            <div className="list-row" key={contract.id}>
              <div className="list-main">
                <b>
                  {contract.kind === 'courier' ? 'КУРЬЕР · ' : 'ПОСТАВКА · '}
                  {num(contract.amount)} {resource(contract.resource).symbol}
                </b>
                <span className="dim">
                  сдать в системе {contractTargetName(state, contract)} ·{' '}
                  {contract.kind === 'courier'
                    ? `опечатано ${num(contract.amount)} ед.`
                    : `в трюме ${num(contractUnitsInHold(state, contract))}/${num(contract.amount)}`}{' '}
                  · {cr(contract.reward)}
                </span>
              </div>
              <Btn
                size="small"
                kind="good"
                disabled={!canDeliverContract(state, contract)}
                onClick={() => run((draft) => deliverContract(draft, contract.id))}
              >
                СДАТЬ
              </Btn>
            </div>
          ))
        )}
        <Row label="Выполнено контрактов" value={num(state.player.stats.contracts)} />
      </Panel>
    </>
  );
}
