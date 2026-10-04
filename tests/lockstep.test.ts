import { describe, expect, it } from 'vitest';
import { createGame, step } from '../src/sim';
import { hashState } from '../src/sim/hash';
import type { Command } from '../src/sim/types';
import {
  LOCK_DELAY,
  TICKS_PER_TURN,
  commandsFor,
  createLockstep,
  hashClash,
  ingest,
  isDropped,
  ready,
  type Lockstep,
} from '../src/net/lockstep';

interface Client {
  uid: string;
  playerId: number;
  state: ReturnType<typeof createGame>;
  ls: Lockstep;
  sent: number;
  bucket: Command[];
}

function makeClients(count: number, seed: number): Client[] {
  const seats = Array.from({ length: count }, (_, playerId) => ({ uid: `u${playerId}`, playerId }));
  return seats.map((seat) => {
    const state = createGame(seed, { humans: count });
    state.players.forEach((player, index) => {
      player.name = `Игрок ${index + 1}`;
    });
    return { uid: seat.uid, playerId: seat.playerId, state, ls: createLockstep(seats), sent: -1, bucket: [] };
  });
}

function runTurn(client: Client, turn: number) {
  const commands = commandsFor(client.ls, turn);
  step(client.state, commands);
  for (let i = 1; i < TICKS_PER_TURN; i++) step(client.state, []);
  client.ls.executed = turn + 1;
}

function broadcast(clients: Client[], turn: number, uid: string, cmds: Command[], hash?: string) {
  const raw = JSON.stringify(cmds);
  for (const client of clients) ingest(client.ls, turn, uid, { cmds: raw, h: hash });
}

/** Same delivery order a lockstep host would use: lookahead goes out when the turn is about to run. */
function play(clients: Client[], turns: number, plan: (client: Client, turn: number) => Command[], skip?: (client: Client, turn: number) => boolean) {
  const send = (client: Client, turn: number) => {
    if (client.sent >= turn) return;
    for (let t = client.sent + 1; t <= turn; t++) {
      if (skip?.(client, t)) return;
      const cmds = plan(client, t);
      broadcast(clients, t, client.uid, cmds, t % 10 === 0 ? hashState(client.state) : undefined);
    }
    client.sent = turn;
  };
  for (const client of clients) send(client, LOCK_DELAY - 1);
  for (let guard = 0; guard < turns; guard++) {
    for (const client of clients) {
      if (skip?.(client, client.ls.executed + LOCK_DELAY)) continue;
      send(client, client.ls.executed + LOCK_DELAY);
    }
    for (const client of clients) {
      const turn = client.ls.executed;
      if (skip?.(client, turn) && client.uid !== 'host') continue;
      if (!ready(client.ls, turn)) continue;
      const clash = hashClash(client.ls, turn);
      expect(clash).toBeNull();
      runTurn(client, turn);
    }
  }
}

describe('сетевой такт', () => {
  it('два и три клиента получают один и тот же хеш', () => {
    for (const count of [2, 3]) {
      const clients = makeClients(count, 20261003 + count);
      const taxes = ['low', 'normal', 'high', 'none'] as const;
      play(clients, 24, (client, turn) => {
        if (turn % 4 !== client.playerId) return [];
        return [{ kind: 'tax', playerId: client.playerId, tax: taxes[(turn + client.playerId) % taxes.length] }];
      });
      const hashes = clients.map((client) => hashState(client.state));
      expect(new Set(hashes).size).toBe(1);
      expect(clients[0].ls.executed).toBeGreaterThan(10);
      expect(clients.every((client) => client.ls.executed === clients[0].ls.executed)).toBe(true);
    }
  });

  it('исключение игрока дописывает пустые ходы и не расходится', () => {
    const clients = makeClients(3, 77);
    const [host, other, dropped] = clients;
    const send = (client: Client, turn: number, cmds: Command[]) => {
      if (client.sent >= turn) return;
      for (let current = client.sent + 1; current <= turn; current++) {
        const body = current === turn ? cmds : [];
        broadcast(clients, current, client.uid, body, current % 10 === 0 ? hashState(client.state) : undefined);
      }
      client.sent = turn;
    };
    const stepGroup = (group: Client[]) => {
      const turn = group[0].ls.executed;
      const ahead = turn + LOCK_DELAY;
      for (const client of group) send(client, ahead, []);
      for (const client of group) {
        expect(ready(client.ls, client.ls.executed), client.uid).toBe(true);
        expect(hashClash(client.ls, client.ls.executed)).toBeNull();
        runTurn(client, client.ls.executed);
      }
    };

    for (const client of clients) send(client, LOCK_DELAY - 1, []);
    while (host.ls.executed < 9) stepGroup(clients);

    const online = [host, other];
    while (host.ls.executed < 12) stepGroup(online);
    expect(host.ls.executed).toBe(12);
    expect(ready(host.ls, 12)).toBe(false);

    const drop = { kind: 'drop', playerId: host.playerId, uid: dropped.uid, fromTurn: 12 } as unknown as Command;
    send(host, 12 + LOCK_DELAY, [drop]);
    broadcast(clients, 12, dropped.uid, [{ kind: 'tax', playerId: dropped.playerId, tax: 'high' }]);
    expect(isDropped(host.ls, dropped.uid, 12)).toBe(true);
    expect(isDropped(other.ls, dropped.uid, 12)).toBe(true);

    for (let i = 0; i < 6; i++) stepGroup(online);
    expect(hashState(host.state)).toBe(hashState(other.state));
    expect(host.state.players[dropped.playerId].tax).toBe('low');
    expect(host.ls.executed).toBeGreaterThan(12);
  });
});
