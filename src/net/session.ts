import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, type User } from 'firebase/auth';
import {
  getDatabase,
  limitToLast,
  get,
  onChildAdded,
  onChildChanged,
  onDisconnect,
  onValue,
  orderByChild,
  orderByKey,
  push,
  query,
  ref,
  remove,
  equalTo,
  serverTimestamp,
  set,
  startAt,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { firebaseConfig } from '../firebase';
import { createGame } from '../sim/world';
import { hashState } from '../sim/hash';
import { step, type Command, type GameState } from '../sim';
import {
  LOCK_DELAY,
  TURN_MS,
  TICKS_PER_TURN,
  commandsFor,
  createLockstep,
  hashClash,
  ingest,
  missingUids,
  ready,
  type Lockstep,
} from './lockstep';

const TWO_HOURS = 2 * 60 * 60 * 1000;

export interface LobbyPlayer {
  name: string;
  seat: number;
  joinedAt?: number;
  ready?: boolean;
}

export interface LobbyData {
  hostUid: string;
  name: string;
  maxPlayers: number;
  status: 'open' | 'started' | 'finished';
  seed: number;
  createdAt?: number;
  startedAt?: number;
  players?: Record<string, LobbyPlayer>;
  seats?: Record<string, string> | string[];
}

export interface RosterSeat {
  uid: string;
  name: string;
  seat: number;
  playerId: number;
}

export interface LobbyRow {
  id: string;
  name: string;
  host: string;
  count: number;
  max: number;
  age: string;
}

export interface RoomView {
  id: string;
  name: string;
  hostUid: string;
  maxPlayers: number;
  seed: number;
  me: string;
  invite: string;
  seats: { seat: number; uid: string; name: string; ready: boolean; host: boolean }[];
  canStart: boolean;
}

export interface WaitView {
  names: string[];
  exclude: { uid: string; name: string }[];
}

export interface NetHooks {
  onList: (rows: LobbyRow[]) => void;
  onRoom: (room: RoomView) => void;
  onStart: (state: GameState, localPlayer: number) => void;
  onWait: (wait: WaitView | null) => void;
  onDesync: (detail: string) => void;
  onClosed: (reason: string) => void;
  onError: (message: string) => void;
  onEnded: () => void;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app, firebaseConfig.databaseURL);

export function clampText(raw: string, max: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Firebase may hand seats back as an array (0..n-1) or as an object. */
export function normalizeSeats(seats: LobbyData['seats']): (string | null)[] {
  const out: (string | null)[] = [null, null, null, null];
  if (!seats) return out;
  if (Array.isArray(seats)) {
    for (let i = 0; i < Math.min(4, seats.length); i++) {
      if (typeof seats[i] === 'string' && seats[i]) out[i] = seats[i];
    }
    return out;
  }
  for (const key of Object.keys(seats)) {
    const seat = Number(key);
    const uid = seats[key];
    if (seat >= 0 && seat <= 3 && typeof uid === 'string' && uid) out[seat] = uid;
  }
  return out;
}

export function rosterOf(lobby: LobbyData): RosterSeat[] {
  const seats = normalizeSeats(lobby.seats);
  const rows: { uid: string; name: string; seat: number }[] = [];
  for (let seat = 0; seat < 4; seat++) {
    const uid = seats[seat];
    if (!uid) continue;
    const player = lobby.players?.[uid];
    if (!player) continue;
    rows.push({ uid, name: clampText(String(player.name || 'Путник'), 20) || 'Путник', seat });
  }
  rows.sort((a, b) => a.seat - b.seat || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return rows.map((row, playerId) => ({ ...row, playerId }));
}

function ageLabel(createdAt: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин`;
  return `${Math.floor(mins / 60)} ч`;
}

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

async function ensureUser(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export class NetSession {
  uid = '';
  lobbyId = '';
  hooks: NetHooks = {
    onList: () => {},
    onRoom: () => {},
    onStart: () => {},
    onWait: () => {},
    onDesync: () => {},
    onClosed: () => {},
    onError: () => {},
    onEnded: () => {},
  };

  private unsubs: Unsubscribe[] = [];
  private op = 0;
  private ls: Lockstep | null = null;
  private state: GameState | null = null;
  private roster: RosterSeat[] = [];
  private sent = new Set<number>();
  private bucket: Command[] = [];
  private drops: { kind: 'drop'; playerId: number; uid: string; fromTurn: number }[] = [];
  private nextAt = 0;
  private desynced = false;
  private playing = false;
  private finishedSent = false;
  private presence: Record<string, { online: boolean; at: number }> = {};
  private waitingSince = 0;
  private ended = false;

  async signIn(): Promise<void> {
    const user = await ensureUser();
    this.uid = user.uid;
  }

  async listenList() {
    const token = ++this.op;
    await this.signIn();
    if (token !== this.op) return;
    this.clearSubs();
    const q = query(ref(db, 'lobbies'), orderByChild('status'), equalTo('open'), limitToLast(50));
    const unsub = onValue(
      q,
      (snap) => {
        const rows: LobbyRow[] = [];
        const now = Date.now();
        snap.forEach((child) => {
          const lobby = child.val() as LobbyData | null;
          if (!lobby || lobby.status !== 'open') return;
          const created = Number(lobby.createdAt) || 0;
          if (!created || now - created > TWO_HOURS) {
            if (created && now - created > TWO_HOURS) void remove(ref(db, `lobbies/${child.key}`)).catch(() => {});
            return;
          }
          const seats = normalizeSeats(lobby.seats);
          const count = seats.filter(Boolean).length;
          const hostName = lobby.players?.[lobby.hostUid]?.name || 'Хост';
          rows.push({
            id: child.key || '',
            name: clampText(String(lobby.name || 'Лобби'), 32),
            host: clampText(String(hostName), 20),
            count,
            max: lobby.maxPlayers,
            age: ageLabel(created),
          });
        });
        rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
        this.hooks.onList(rows);
      },
      (err) => this.hooks.onError(err.message),
    );
    this.unsubs.push(unsub);
  }

  async create(name: string, maxPlayers: 2 | 3 | 4): Promise<void> {
    await this.signIn();
    const clean = clampText(name, 32);
    if (clean.length < 1) throw new Error('Введите название');
    const lobbyRef = push(ref(db, 'lobbies'));
    const id = lobbyRef.key;
    if (!id) throw new Error('Не удалось создать лобби');
    await set(lobbyRef, {
      hostUid: this.uid,
      name: clean,
      maxPlayers,
      status: 'open',
      seed: randomSeed(),
      createdAt: serverTimestamp(),
      players: { [this.uid]: { name: this.playerName(), seat: 0, joinedAt: serverTimestamp() } },
      seats: { 0: this.uid },
    });
    this.watchLobby(id);
  }

  async join(id: string): Promise<void> {
    await this.signIn();
    const clean = id.trim();
    let last: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const snap = await get(ref(db, `lobbies/${clean}`));
      const lobby = snap.val() as LobbyData | null;
      if (!lobby || lobby.status !== 'open') throw new Error('Лобби уже закрыто');
      if (lobby.players?.[this.uid]) {
        this.watchLobby(clean);
        return;
      }
      const seats = normalizeSeats(lobby.seats);
      let seat = -1;
      for (let i = 0; i < lobby.maxPlayers; i++) {
        if (!seats[i]) {
          seat = i;
          break;
        }
      }
      if (seat < 0) throw new Error('Нет свободных мест');
      try {
        await update(ref(db, `lobbies/${clean}`), {
          [`players/${this.uid}`]: { name: this.playerName(), seat, joinedAt: serverTimestamp() },
          [`seats/${seat}`]: this.uid,
        });
        this.watchLobby(clean);
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error('Место заняли, попробуйте ещё раз');
  }

  async leave(): Promise<void> {
    const id = this.lobbyId;
    const uid = this.uid;
    this.clear();
    this.lobbyId = '';
    if (!id || !uid) return;
    const snap = await get(ref(db, `lobbies/${id}`));
    const lobby = snap.val() as LobbyData | null;
    if (!lobby || lobby.status !== 'open') return;
    if (lobby.hostUid === uid) {
      await remove(ref(db, `lobbies/${id}`));
      return;
    }
    const seat = lobby.players?.[uid]?.seat;
    if (seat == null) return;
    await update(ref(db, `lobbies/${id}`), { [`players/${uid}`]: null, [`seats/${seat}`]: null });
  }

  async setReady(ready: boolean): Promise<void> {
    if (!this.lobbyId || !this.uid) return;
    await set(ref(db, `lobbies/${this.lobbyId}/players/${this.uid}/ready`), ready);
  }

  async start(): Promise<void> {
    if (!this.lobbyId) return;
    await update(ref(db, `lobbies/${this.lobbyId}`), { status: 'started', startedAt: serverTimestamp() });
  }

  submit(command: Command) {
    if (!this.playing || this.desynced) return;
    this.bucket.push(command);
  }

  exclude(uid: string) {
    if (!this.ls || !this.playing || uid === this.uid) return;
    const me = this.roster.find((seat) => seat.uid === this.uid);
    if (!me) return;
    this.drops.push({ kind: 'drop', playerId: me.playerId, uid, fromTurn: this.ls.executed });
    this.writeAhead(true);
  }

  pump(now: number) {
    if (!this.playing || !this.ls || !this.state || this.desynced) return;
    if (this.state.outcome !== 'playing') {
      this.finishMatch();
      return;
    }
    let guard = 0;
    while (guard < 4 && this.state.outcome === 'playing' && now >= this.nextAt) {
      const turn = this.ls.executed;
      if (!ready(this.ls, turn)) {
        if (!this.waitingSince) this.waitingSince = Date.now();
        this.hooks.onWait(this.waitView());
        return;
      }
      this.waitingSince = 0;
      this.hooks.onWait(null);
      const clash = hashClash(this.ls, turn);
      if (clash) {
        this.desynced = true;
        console.warn('Рассинхронизация', clash);
        this.hooks.onDesync(clash);
        return;
      }
      this.writeAhead(false);
      const commands = commandsFor(this.ls, turn);
      step(this.state, commands);
      for (let i = 1; i < TICKS_PER_TURN; i++) step(this.state, []);
      this.ls.executed += 1;
      this.nextAt += TURN_MS;
      guard += 1;
    }
    if (this.state.outcome !== 'playing') this.finishMatch();
  }

  hash(): string {
    return this.state ? hashState(this.state) : '';
  }

  turn(): number {
    return this.ls?.executed ?? 0;
  }

  presenceLines(): { name: string; online: boolean }[] {
    return this.roster.map((seat) => ({
      name: seat.name,
      online: this.presence[seat.uid]?.online === true,
    }));
  }

  async destroyMatch(): Promise<void> {
    const id = this.lobbyId;
    this.clear();
    this.playing = false;
    this.ls = null;
    this.state = null;
    if (!id) return;
    try {
      await remove(ref(db, `matches/${id}`));
    } catch {
      /* host or stale match */
    }
    try {
      await remove(ref(db, `lobbies/${id}`));
    } catch {
      /* non-host cannot delete a live lobby */
    }
    this.lobbyId = '';
  }

  private playerName(): string {
    const stored = clampText(localStorage.getItem('dorozhnye-kraya-name') || '', 20);
    return stored || 'Путник';
  }

  private watchLobby(id: string) {
    this.clear();
    this.lobbyId = id;
    const unsub = onValue(ref(db, `lobbies/${id}`), (snap) => {
      const lobby = snap.val() as LobbyData | null;
      if (!lobby) {
        if (!this.playing) this.hooks.onClosed('Лобби закрыто');
        return;
      }
      if (lobby.status === 'open') {
        this.hooks.onRoom(this.roomView(id, lobby));
        return;
      }
      if (lobby.status === 'started' && !this.playing) this.begin(id, lobby);
    });
    this.unsubs.push(unsub);
  }

  private roomView(id: string, lobby: LobbyData): RoomView {
    const seats = normalizeSeats(lobby.seats);
    const rows = [];
    for (let seat = 0; seat < lobby.maxPlayers; seat++) {
      const uid = seats[seat];
      if (!uid) continue;
      const player = lobby.players?.[uid];
      rows.push({
        seat,
        uid,
        name: clampText(String(player?.name || 'Путник'), 20) || 'Путник',
        ready: player?.ready === true,
        host: uid === lobby.hostUid,
      });
    }
    const url = new URL(location.href);
    url.searchParams.set('lobby', id);
    const canStart = this.uid === lobby.hostUid && rows.length >= 2 && rows.every((row) => row.ready);
    return { id, name: String(lobby.name || ''), hostUid: lobby.hostUid, maxPlayers: lobby.maxPlayers, seed: lobby.seed, me: this.uid, invite: url.toString(), seats: rows, canStart };
  }

  private begin(id: string, lobby: LobbyData) {
    this.roster = rosterOf(lobby);
    const me = this.roster.find((seat) => seat.uid === this.uid);
    if (!me) {
      this.hooks.onError('Вас нет среди игроков');
      return;
    }
    const state = createGame(lobby.seed >>> 0, { humans: this.roster.length });
    for (const seat of this.roster) {
      const player = state.players[seat.playerId];
      if (player) player.name = seat.name;
    }
    this.state = state;
    this.ls = createLockstep(this.roster.map((seat) => ({ uid: seat.uid, playerId: seat.playerId })));
    this.sent.clear();
    this.bucket = [];
    this.drops = [];
    this.desynced = false;
    this.playing = true;
    this.ended = false;
    this.finishedSent = false;
    this.waitingSince = 0;
    this.nextAt = performance.now();
    for (let turn = 0; turn < LOCK_DELAY; turn++) this.writeAheadTurn(turn, []);
    this.listenTurns(id);
    this.listenPresence(id);
    this.hooks.onStart(state, me.playerId);
  }

  private listenTurns(id: string) {
    // orderByKey is lexicographic, so startAt("2") would hide "10". Keep the cursor at "0".
    const q = query(ref(db, `matches/${id}/turns`), orderByKey(), startAt('0'));
    const take = (snap: { key: string | null; val: () => unknown }) => {
      const turn = Number(snap.key);
      if (!Number.isInteger(turn) || String(turn) !== snap.key) return;
      const body = snap.val() as Record<string, { cmds?: string; h?: string }> | null;
      if (!body || !this.ls) return;
      for (const uid of Object.keys(body)) {
        const entry = body[uid];
        if (!entry || typeof entry.cmds !== 'string') continue;
        ingest(this.ls, turn, uid, { cmds: entry.cmds, h: entry.h });
      }
    };
    this.unsubs.push(onChildAdded(q, take));
    this.unsubs.push(onChildChanged(q, take));
  }

  private listenPresence(id: string) {
    const mine = ref(db, `matches/${id}/presence/${this.uid}`);
    void onDisconnect(mine)
      .set({ online: false, at: serverTimestamp() })
      .then(() => set(mine, { online: true, at: serverTimestamp() }))
      .catch((err) => this.hooks.onError(err instanceof Error ? err.message : 'Не удалось отметить присутствие'));
    this.unsubs.push(
      onValue(ref(db, `matches/${id}/presence`), (snap) => {
        const value = (snap.val() || {}) as Record<string, { online?: boolean; at?: number }>;
        this.presence = {};
        for (const uid of Object.keys(value)) {
          this.presence[uid] = { online: value[uid]?.online === true, at: Number(value[uid]?.at) || 0 };
        }
      }),
    );
  }

  private waitView(): WaitView {
    if (!this.ls) return { names: [], exclude: [] };
    const missing = missingUids(this.ls, this.ls.executed);
    const names = missing.map((uid) => this.roster.find((seat) => seat.uid === uid)?.name || 'игрок');
    const now = Date.now();
    const exclude = this.roster
      .filter((seat) => seat.uid !== this.uid && missing.includes(seat.uid))
      .filter((seat) => {
        const presence = this.presence[seat.uid];
        if (presence && !presence.online && presence.at && now - presence.at > 30000) return true;
        if (!presence && this.waitingSince && now - this.waitingSince > 30000) return true;
        return false;
      })
      .map((seat) => ({ uid: seat.uid, name: seat.name }));
    return { names, exclude };
  }

  private takeCmds(): (Command | { kind: 'drop'; playerId: number; uid: string; fromTurn: number })[] {
    const cmds = [...this.bucket.splice(0), ...this.drops.splice(0)];
    while (JSON.stringify(cmds).length > 8192 && cmds.length) cmds.pop();
    return cmds;
  }

  /** Send the lookahead packet. `early` is the exclude path, before the stalled turn can run. */
  private writeAhead(early: boolean) {
    if (!this.ls || !ready(this.ls, this.ls.executed) && !early) return;
    const turn = this.ls.executed + LOCK_DELAY;
    if (this.sent.has(turn) && !early) return;
    if (this.sent.has(turn)) return;
    this.writeAheadTurn(turn, this.takeCmds());
  }

  private writeAheadTurn(turn: number, cmds: (Command | { kind: 'drop'; playerId: number; uid: string; fromTurn: number })[]) {
    if (!this.lobbyId || !this.uid || this.sent.has(turn) || !this.state) return;
    this.sent.add(turn);
    const payload: { cmds: string; at: object; h?: string } = {
      cmds: JSON.stringify(cmds),
      at: serverTimestamp(),
    };
    if (turn % 10 === 0) payload.h = hashState(this.state);
    void set(ref(db, `matches/${this.lobbyId}/turns/${turn}/${this.uid}`), payload).catch((err) => {
      this.sent.delete(turn);
      for (const cmd of cmds) {
        if (cmd.kind === 'drop') this.drops.push(cmd as { kind: 'drop'; playerId: number; uid: string; fromTurn: number });
        else this.bucket.push(cmd as Command);
      }
      this.hooks.onError(err instanceof Error ? err.message : 'Не удалось отправить ход');
    });
  }

  private finishMatch() {
    if (this.ended) return;
    this.ended = true;
    this.hooks.onEnded();
    if (this.finishedSent || !this.lobbyId) return;
    this.finishedSent = true;
    void set(ref(db, `lobbies/${this.lobbyId}/status`), 'finished').catch(() => {});
  }

  private clear() {
    this.op += 1;
    this.clearSubs();
  }

  private clearSubs() {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
  }
}

export const net = new NetSession();
