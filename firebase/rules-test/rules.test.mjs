import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, update, get, remove, push, query, orderByChild, equalTo, limitToLast, limitToFirst, serverTimestamp } from 'firebase/database';

const NS = 'road-realms-test-default-rtdb';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-road-realms',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();
const TS = serverTimestamp();

function newLobby(host, extra = {}) {
  return {
    hostUid: host, name: 'Комната', maxPlayers: 2, status: 'open', seed: 12345, createdAt: TS,
    players: { [host]: { name: 'Хост', seat: 0, joinedAt: TS } },
    seats: { 0: host },
    ...extra,
  };
}
async function seed(path, val) { await env.withSecurityRulesDisabled(async (c) => { await set(ref(c.database(), path), val); }); }
const join = (uid, id, seat, name = 'Игрок') => update(ref(db(uid), `lobbies/${id}`), {
  [`players/${uid}`]: { name, seat, joinedAt: TS }, [`seats/${seat}`]: uid,
});

test('unauthenticated cannot read or create', async () => {
  await assertFails(get(ref(db(null), 'lobbies/L1')));
  await assertFails(set(ref(db(null), 'lobbies/L1'), newLobby('x')));
  await assertFails(get(query(ref(db(null), 'lobbies'), orderByChild('status'), equalTo('open'), limitToLast(50))));
});

test('host creates lobby; validations', async () => {
  await assertSucceeds(set(ref(db('alice'), 'lobbies/L1'), newLobby('alice')));
  await assertFails(set(ref(db('alice'), 'lobbies/L2'), newLobby('bob')));                    // hostUid != auth
  await assertFails(set(ref(db('alice'), 'lobbies/L3'), newLobby('alice', { maxPlayers: 5 })));
  await assertFails(set(ref(db('alice'), 'lobbies/L4'), newLobby('alice', { maxPlayers: 1 })));
  await assertFails(set(ref(db('alice'), 'lobbies/L5'), newLobby('alice', { status: 'started' })));
  await assertFails(set(ref(db('alice'), 'lobbies/L6'), newLobby('alice', { createdAt: 1 })));
  await assertFails(set(ref(db('alice'), 'lobbies/L7'), newLobby('alice', { seed: 1.5 })));
  await assertFails(set(ref(db('alice'), 'lobbies/L8'), newLobby('alice', { name: '' })));
  await assertFails(set(ref(db('alice'), 'lobbies/L9'), newLobby('alice', { name: 'x'.repeat(33) })));
  await assertFails(set(ref(db('alice'), 'lobbies/L10'), newLobby('alice', { evil: true })));
  // can't pre-seat a fake second player
  await assertFails(set(ref(db('alice'), 'lobbies/L11'), newLobby('alice', {
    players: { alice: { name: 'a', seat: 0, joinedAt: TS }, bob: { name: 'b', seat: 1, joinedAt: TS } }, seats: { 0: 'alice', 1: 'bob' } })));
  // can't overwrite an existing lobby
  await assertFails(set(ref(db('bob'), 'lobbies/L1'), newLobby('bob')));
  await assertFails(set(ref(db('alice'), 'lobbies/L1'), newLobby('alice')));
  await assertFails(set(ref(db('alice'), 'lobbies/bad id'), newLobby('alice')));
  await assertFails(set(ref(db('alice'), 'lobbies/' + 'x'.repeat(33)), newLobby('alice')));
  await assertFails(set(ref(db('alice'), 'lobbies/L12'), newLobby('alice', { startedAt: TS })));
  await assertFails(set(ref(db('alice'), 'lobbies/L13'), newLobby('alice', { players: { alice: { name: 'a', seat: 0, joinedAt: TS } }, seats: { 0: 'alice', 1: 'alice' } })));
});

test('listing: only open-lobby query with limit', async () => {
  await set(ref(db('alice'), 'lobbies/L1'), newLobby('alice'));
  await assertSucceeds(get(query(ref(db('bob'), 'lobbies'), orderByChild('status'), equalTo('open'), limitToLast(50))));
  await assertFails(get(ref(db('bob'), 'lobbies')));
  await assertFails(get(query(ref(db('bob'), 'lobbies'), orderByChild('status'), equalTo('started'), limitToLast(50))));
  await assertFails(get(query(ref(db('bob'), 'lobbies'), orderByChild('status'), equalTo('open'), limitToLast(51))));
  await assertFails(get(query(ref(db('bob'), 'lobbies'), orderByChild('status'), equalTo('open'))));
  await assertSucceeds(get(ref(db('bob'), 'lobbies/L1')));
});

test('join: own uid only, open only, capacity enforced, seat unique', async () => {
  await set(ref(db('alice'), 'lobbies/L1'), newLobby('alice', { maxPlayers: 3 }));
  await assertFails(join('bob', 'L1', 0));                       // seat taken
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/carol': { name: 'c', seat: 1, joinedAt: TS }, 'seats/1': 'carol' })); // other uid
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob': { name: 'b', seat: 1, joinedAt: TS } })); // no seat
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'seats/1': 'bob' })); // seat without player
  await assertFails(join('bob', 'L1', 3));                       // seat >= maxPlayers
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob': { name: 'b', seat: 1, joinedAt: 5 }, 'seats/1': 'bob' })); // joinedAt != now
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob': { name: 'b', seat: 1, joinedAt: TS, x: 1 }, 'seats/1': 'bob' }));
  await assertFails(join('bob', 'L1', 1, 'n'.repeat(21)));      // name too long
  await assertSucceeds(join('bob', 'L1', 1));
  await assertFails(join('bob', 'L1', 2));                       // double join
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob/seat': 2, 'seats/2': 'bob' })); // can't grab second seat
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'seats/2': 'bob' }));
  await assertFails(join('carol', 'L1', 1));                     // race loser
  await assertSucceeds(join('carol', 'L1', 2));
  await assertFails(join('dave', 'L1', 3));                      // full (max 3)
  const s = await get(ref(db('alice'), 'lobbies/L1/seats'));
  assert.deepEqual(s.val(), ['alice', 'bob', 'carol']);
});

test('ready flag, leave, host cannot leave, members cannot edit others', async () => {
  await set(ref(db('alice'), 'lobbies/L1'), newLobby('alice', { maxPlayers: 4 }));
  await join('bob', 'L1', 1); await join('carol', 'L1', 2);
  await assertSucceeds(set(ref(db('bob'), 'lobbies/L1/players/bob/ready'), true));
  await assertFails(set(ref(db('bob'), 'lobbies/L1/players/carol/ready'), true));
  await assertFails(set(ref(db('bob'), 'lobbies/L1/players/bob/name'), 'renamed'));
  await assertFails(set(ref(db('bob'), 'lobbies/L1/name'), 'hijack'));
  await assertFails(set(ref(db('alice'), 'lobbies/L1/maxPlayers'), 4));
  await assertFails(set(ref(db('alice'), 'lobbies/L1/seed'), 1));
  await assertFails(remove(ref(db('bob'), 'lobbies/L1/players/carol')));
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/carol': null, 'seats/2': null }));
  await assertFails(remove(ref(db('bob'), 'lobbies/L1/players/bob')));   // must free seat together
  await assertSucceeds(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob': null, 'seats/1': null }));
  await assertFails(update(ref(db('alice'), 'lobbies/L1'), { 'players/alice': null, 'seats/0': null })); // host leaves -> delete lobby instead
  await assertFails(remove(ref(db('carol'), 'lobbies/L1')));
  await assertSucceeds(join('dave', 'L1', 1));                   // freed seat reusable
});

test('start / finish transitions', async () => {
  await set(ref(db('alice'), 'lobbies/L1'), newLobby('alice'));
  await assertFails(update(ref(db('alice'), 'lobbies/L1'), { status: 'started', startedAt: TS })); // alone
  await join('bob', 'L1', 1);
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { status: 'started', startedAt: TS }));  // not host
  await assertFails(update(ref(db('alice'), 'lobbies/L1'), { status: 'started' }));             // needs startedAt
  await assertFails(update(ref(db('alice'), 'lobbies/L1'), { status: 'bogus' }));
  await assertSucceeds(update(ref(db('alice'), 'lobbies/L1'), { status: 'started', startedAt: TS }));
  await assertFails(join('carol', 'L1', 1));
  await assertFails(update(ref(db('bob'), 'lobbies/L1'), { 'players/bob': null, 'seats/1': null })); // roster frozen
  await assertFails(set(ref(db('alice'), 'lobbies/L1/status'), 'open'));
  await assertFails(set(ref(db('alice'), 'lobbies/L1/startedAt'), TS));
  // not listed / not readable by outsiders once started
  await assertFails(get(ref(db('carol'), 'lobbies/L1')));
  await assertSucceeds(get(ref(db('bob'), 'lobbies/L1')));
  await assertFails(set(ref(db('carol'), 'lobbies/L1/status'), 'finished'));
  await assertSucceeds(set(ref(db('bob'), 'lobbies/L1/status'), 'finished'));             // any member may finish
  await assertFails(set(ref(db('alice'), 'lobbies/L1/status'), 'started'));
});

test('turn commands: own uid, append-only, started only, size limits', async () => {
  await set(ref(db('alice'), 'lobbies/M1'), newLobby('alice'));
  await join('bob', 'M1', 1);
  const cmd = (extra = {}) => ({ cmds: '[]', at: TS, ...extra });
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/0/alice'), cmd()));          // not started yet
  await update(ref(db('alice'), 'lobbies/M1'), { status: 'started', startedAt: TS });
  await assertSucceeds(set(ref(db('alice'), 'matches/M1/turns/0/alice'), cmd({ h: 'abc123' })));
  await assertSucceeds(set(ref(db('bob'), 'matches/M1/turns/0/bob'), cmd({ cmds: JSON.stringify([{ kind: 'tax', playerId: 1, tax: 'low' }]) })));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/0/alice'), cmd()));         // overwrite own
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/0/alice/cmds'), '[1]'));
  await assertFails(remove(ref(db('alice'), 'matches/M1/turns/0/alice')));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/1/bob'), cmd()));           // impersonate
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/1'), { alice: cmd(), bob: cmd() }));
  await assertFails(set(ref(db('carol'), 'matches/M1/turns/1/carol'), cmd()));         // non-member
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/2/alice'), cmd({ cmds: 'x'.repeat(8193) })));
  await assertSucceeds(set(ref(db('alice'), 'matches/M1/turns/2/alice'), cmd({ cmds: 'x'.repeat(8192) })));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/3/alice'), { cmds: '[]', at: 5 }));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/3/alice'), cmd({ junk: 1 })));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/3/alice'), cmd({ cmds: 7 })));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/03/alice'), cmd()));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/abc/alice'), cmd()));
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/12345678/alice'), cmd()));
  await assertSucceeds(set(ref(db('alice'), 'matches/M1/turns/9999999/alice'), cmd()));
  await assertFails(set(ref(db('alice'), 'matches/M1/other'), 1));
  // reads
  await assertSucceeds(get(ref(db('bob'), 'matches/M1')));
  await assertFails(get(ref(db('carol'), 'matches/M1')));
  // finished: no more writes
  await set(ref(db('alice'), 'lobbies/M1/status'), 'finished');
  await assertFails(set(ref(db('alice'), 'matches/M1/turns/4/alice'), cmd()));
});

test('presence', async () => {
  await set(ref(db('alice'), 'lobbies/M1'), newLobby('alice'));
  await join('bob', 'M1', 1);
  await assertSucceeds(set(ref(db('bob'), 'matches/M1/presence/bob'), { online: true, at: TS }));
  await assertSucceeds(set(ref(db('bob'), 'matches/M1/presence/bob'), { online: false, at: TS }));
  await assertFails(set(ref(db('bob'), 'matches/M1/presence/alice'), { online: false, at: TS }));
  await assertFails(set(ref(db('carol'), 'matches/M1/presence/carol'), { online: true, at: TS }));
  await assertFails(set(ref(db('bob'), 'matches/M1/presence/bob'), { online: 'yes', at: TS }));
});

test('cleanup: host deletes; stale lobbies/matches deletable by anyone authed', async () => {
  await set(ref(db('alice'), 'lobbies/L1'), newLobby('alice'));
  await assertFails(remove(ref(db('bob'), 'lobbies/L1')));
  await assertSucceeds(remove(ref(db('alice'), 'lobbies/L1')));
  const old = Date.now() - 3 * 3600 * 1000;
  const veryOld = Date.now() - 25 * 3600 * 1000;
  await seed('lobbies/OPEN_OLD', { ...newLobby('alice'), createdAt: old, players: { alice: { name: 'a', seat: 0, joinedAt: old } } });
  await seed('lobbies/START_OLD', { ...newLobby('alice'), status: 'started', startedAt: old, createdAt: old, players: { alice: { name: 'a', seat: 0, joinedAt: old } } });
  await seed('lobbies/START_VOLD', { ...newLobby('alice'), status: 'started', startedAt: veryOld, createdAt: veryOld, players: { alice: { name: 'a', seat: 0, joinedAt: veryOld } } });
  await seed('matches/START_OLD', { turns: { 0: { alice: { cmds: '[]', at: old } } } });
  await seed('matches/START_VOLD', { turns: { 0: { alice: { cmds: '[]', at: veryOld } } } });
  await seed('matches/ORPHAN', { turns: { 0: { alice: { cmds: '[]', at: old } } } });
  await assertSucceeds(remove(ref(db('bob'), 'lobbies/OPEN_OLD')));     // abandoned open lobby > 2h
  await assertFails(remove(ref(db('bob'), 'lobbies/START_OLD')));       // running match < 24h
  await assertFails(remove(ref(db('bob'), 'matches/START_OLD')));
  await assertSucceeds(remove(ref(db('bob'), 'matches/START_VOLD')));   // > 24h
  await assertSucceeds(remove(ref(db('bob'), 'lobbies/START_VOLD')));
  await assertSucceeds(remove(ref(db('bob'), 'matches/ORPHAN')));       // lobby gone
  await assertSucceeds(remove(ref(db('alice'), 'matches/START_OLD')));  // host
  await assertFails(remove(ref(db(null), 'lobbies/START_OLD')));
});
