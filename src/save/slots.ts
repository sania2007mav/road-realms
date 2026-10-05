import type { CampaignSession } from '../campaign/director';
import { deserialize, serialize } from '../sim/update';
import type { GameState } from '../sim/types';

export type SlotId = 1 | 2 | 3 | 'auto';

export const SLOT_IDS: SlotId[] = [1, 2, 3, 'auto'];

export const LEGACY_SAVE_KEY = 'dorozhnye-kraya-v1';

export interface SaveSession {
  fired: boolean[];
  drought: boolean;
  keepHp: number[];
}

export interface SaveMeta {
  savedAt: number;
  slot: SlotId;
  campaignId: string | null;
  session: SaveSession | null;
}

interface Envelope {
  v: 2;
  savedAt: number;
  slot: SlotId;
  campaignId: string | null;
  session: SaveSession | null;
  payload: string;
}

export function slotKey(id: SlotId): string {
  return `dorozhnye-kraya-save-${id}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function toB64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function fromB64(text: string): Uint8Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const done = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  return new Uint8Array(await done);
}

async function inflateRaw(bytes: Uint8Array): Promise<string> {
  const stream = new DecompressionStream('deflate-raw');
  const done = new Response(stream.readable).text();
  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await writer.write(copy);
  await writer.close();
  return done;
}

export async function packSnapshot(state: GameState, meta: SaveMeta): Promise<string> {
  const json = serialize(state);
  const payload = toB64(await deflateRaw(json));
  const envelope: Envelope = {
    v: 2,
    savedAt: meta.savedAt,
    slot: meta.slot,
    campaignId: meta.campaignId,
    session: meta.session,
    payload,
  };
  return JSON.stringify(envelope);
}

function metaOf(data: Envelope): SaveMeta {
  return {
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
    slot: data.slot === 1 || data.slot === 2 || data.slot === 3 || data.slot === 'auto' ? data.slot : 'auto',
    campaignId: typeof data.campaignId === 'string' ? data.campaignId : null,
    session: data.session ?? null,
  };
}

/** Versioned snapshot, a raw saveVersion-1 string, or null when the bytes are corrupt. */
export async function unpackSnapshot(raw: string): Promise<{ state: GameState; meta: SaveMeta } | null> {
  try {
    const data = JSON.parse(raw) as Envelope & { saveVersion?: number };
    if (data && data.v === 2 && typeof data.payload === 'string') {
      const json = await inflateRaw(fromB64(data.payload));
      return { state: deserialize(json), meta: metaOf(data) };
    }
    if (data && (data.saveVersion === 1 || data.saveVersion === 2 || data.saveVersion === 3)) {
      return {
        state: deserialize(raw),
        meta: { savedAt: 0, slot: 'auto', campaignId: null, session: null },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function readHeader(id: SlotId): SaveMeta | null {
  const store = storage();
  const raw = store?.getItem(slotKey(id));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Envelope;
    if (data?.v !== 2) return null;
    return metaOf(data);
  } catch {
    return null;
  }
}

export function newestSlot(): SlotId | null {
  let best: SlotId | null = null;
  let at = -1;
  for (const id of SLOT_IDS) {
    const header = readHeader(id);
    if (!header) continue;
    if (header.savedAt >= at) {
      at = header.savedAt;
      best = id;
    }
  }
  return best;
}

export async function writeSlot(id: SlotId, state: GameState, meta: SaveMeta): Promise<void> {
  const store = storage();
  if (!store) throw new Error('Сохранение недоступно');
  const raw = await packSnapshot(state, { ...meta, slot: id });
  store.setItem(slotKey(id), raw);
}

export async function readSlot(id: SlotId): Promise<{ state: GameState; meta: SaveMeta } | null> {
  const store = storage();
  const raw = store?.getItem(slotKey(id));
  if (!raw) return null;
  return unpackSnapshot(raw);
}

export function clearSlots(): void {
  const store = storage();
  if (!store) return;
  for (const id of SLOT_IDS) store.removeItem(slotKey(id));
  store.removeItem(LEGACY_SAVE_KEY);
}

export function sessionMeta(session: CampaignSession | null, slot: SlotId): SaveMeta {
  return {
    savedAt: Date.now(),
    slot,
    campaignId: session?.id ?? null,
    session: session
      ? { fired: session.fired.slice(), drought: session.drought, keepHp: session.keepHp.slice() }
      : null,
  };
}

/** Move the old single autosave into the auto slot once. */
export async function migrateLegacy(): Promise<void> {
  const store = storage();
  if (!store) return;
  const raw = store.getItem(LEGACY_SAVE_KEY);
  if (!raw || readHeader('auto')) return;
  const loaded = await unpackSnapshot(raw);
  if (!loaded) return;
  await writeSlot('auto', loaded.state, { ...loaded.meta, slot: 'auto', savedAt: Date.now() });
  store.removeItem(LEGACY_SAVE_KEY);
}
