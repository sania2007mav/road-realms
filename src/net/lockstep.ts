import type { Command } from '../sim/types';

/** Commands collected now are sent for this many turns ahead and applied when that turn runs. */
export const LOCK_DELAY = 3;
/** Four ticks at 20 Hz is 200 ms of simulation. */
export const TICKS_PER_TURN = 4;
export const TURN_MS = 200;
export const HASH_EVERY = 10;

const SIM_KINDS = new Set(['place', 'assign', 'ration', 'tax', 'upgrade', 'market', 'train', 'order', 'army', 'demolish']);

export interface Seat {
  uid: string;
  playerId: number;
}

export interface DropCommand {
  kind: 'drop';
  playerId: number;
  uid: string;
  fromTurn: number;
}

interface Stored {
  cmds: unknown[];
  h?: string;
}

export interface Lockstep {
  seats: Seat[];
  executed: number;
  inbox: Map<number, Map<string, Stored>>;
  /** uid -> first turn treated as an empty submission. */
  dropped: Map<string, number>;
}

export function createLockstep(seats: Seat[]): Lockstep {
  return { seats: [...seats].sort((a, b) => a.playerId - b.playerId), executed: 0, inbox: new Map(), dropped: new Map() };
}

export function playerIdOf(ls: Lockstep, uid: string): number {
  return ls.seats.find((seat) => seat.uid === uid)?.playerId ?? -1;
}

export function isDropped(ls: Lockstep, uid: string, turn: number): boolean {
  const from = ls.dropped.get(uid);
  return from != null && turn >= from;
}

function noteDrop(ls: Lockstep, uid: string, fromTurn: number) {
  const prev = ls.dropped.get(uid);
  if (prev == null || fromTurn < prev) ls.dropped.set(uid, fromTurn);
}

function asDrop(senderId: number, raw: unknown): DropCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const cmd = raw as DropCommand;
  if (cmd.kind !== 'drop') return null;
  if (cmd.playerId !== senderId) return null;
  if (typeof cmd.uid !== 'string' || !cmd.uid || cmd.uid.length > 128) return null;
  if (!Number.isInteger(cmd.fromTurn) || cmd.fromTurn < 0 || cmd.fromTurn > 9999999) return null;
  return cmd;
}

/** Store one player's turn entry. A drop inside it applies even if that turn has not executed yet. */
export function ingest(ls: Lockstep, turn: number, uid: string, raw: { cmds?: string; h?: string }) {
  if (!Number.isInteger(turn) || turn < 0 || turn > 9999999) return;
  if (!ls.seats.some((seat) => seat.uid === uid)) return;
  let bag = ls.inbox.get(turn);
  if (!bag) {
    bag = new Map();
    ls.inbox.set(turn, bag);
  }
  if (bag.has(uid)) return;
  let parsed: unknown[] = [];
  try {
    const value = JSON.parse(raw.cmds ?? '[]');
    if (Array.isArray(value)) parsed = value;
  } catch {
    parsed = [];
  }
  const h = typeof raw.h === 'string' && raw.h.length <= 64 ? raw.h : undefined;
  bag.set(uid, { cmds: parsed, h });
  const senderId = playerIdOf(ls, uid);
  for (const item of parsed) {
    const drop = asDrop(senderId, item);
    if (drop && drop.uid !== uid) noteDrop(ls, drop.uid, drop.fromTurn);
  }
}

export function ready(ls: Lockstep, turn: number): boolean {
  return missingUids(ls, turn).length === 0;
}

export function missingUids(ls: Lockstep, turn: number): string[] {
  const bag = ls.inbox.get(turn);
  const missing: string[] = [];
  for (const seat of ls.seats) {
    if (isDropped(ls, seat.uid, turn)) continue;
    if (!bag?.has(seat.uid)) missing.push(seat.uid);
  }
  return missing;
}

/** Commands for one turn: turn order, then seat order, then array order. Dropped players contribute nothing. */
export function commandsFor(ls: Lockstep, turn: number): Command[] {
  const bag = ls.inbox.get(turn);
  const out: Command[] = [];
  for (const seat of ls.seats) {
    if (isDropped(ls, seat.uid, turn)) continue;
    const stored = bag?.get(seat.uid);
    if (!stored) continue;
    for (const item of stored.cmds) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as { kind?: string; playerId?: number };
      if (raw.kind === 'drop') continue;
      if (!raw.kind || !SIM_KINDS.has(raw.kind)) continue;
      if (raw.playerId !== seat.playerId) continue;
      out.push(item as Command);
    }
  }
  return out;
}

/** When turn % 10 === 0, every seated submission should carry the same state hash from send time. */
export function hashClash(ls: Lockstep, turn: number): string | null {
  if (turn % HASH_EVERY !== 0) return null;
  const bag = ls.inbox.get(turn);
  if (!bag) return null;
  const rows: string[] = [];
  const values = new Set<string>();
  for (const seat of ls.seats) {
    if (isDropped(ls, seat.uid, turn)) continue;
    const entry = bag.get(seat.uid);
    if (!entry?.h) {
      rows.push(`${seat.uid}:нет`);
      values.add('нет');
      continue;
    }
    rows.push(`${seat.uid}:${entry.h}`);
    values.add(entry.h);
  }
  if (values.size <= 1) return null;
  return `ход ${turn}: ${rows.join(', ')}`;
}
