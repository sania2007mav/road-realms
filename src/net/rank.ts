import { get, limitToLast, orderByChild, query, ref, set, serverTimestamp } from 'firebase/database';
import { db, net, type RankPacket } from './session';
import {
  EMBLEMS,
  FORFEIT_MS,
  RATING_START,
  claimKey,
  bumpTag,
  displayTag,
  isEmblem,
  ratePair,
  readStoredProfile,
  tagFromUid,
  writeStoredProfile,
  type BoardEntry,
  type EmblemId,
  type HistoryEntry,
  type LocalProfile,
  type PublicProfile,
} from '../meta/rating';

const SOON = 'Рейтинг скоро';

export function ratingDenied(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /permission[-_ ]denied/i.test(`${code} ${message}`);
}

function emptyPublic(profile: LocalProfile): PublicProfile {
  return { ...profile, rating: RATING_START, games: 0, wins: 0, last: '' };
}

function parsePublic(value: unknown, fallback: LocalProfile | null): PublicProfile | null {
  if (!value || typeof value !== 'object') return fallback ? emptyPublic(fallback) : null;
  const row = value as Partial<PublicProfile>;
  const nick = String(row.nick || fallback?.nick || '');
  const tag = String(row.tag || fallback?.tag || '');
  const emblem = String(row.emblem || fallback?.emblem || 'road');
  if (!isEmblem(emblem)) return null;
  return {
    nick,
    tag,
    emblem,
    rating: Number(row.rating) || RATING_START,
    games: Number(row.games) || 0,
    wins: Number(row.wins) || 0,
    last: String(row.last || ''),
  };
}

export async function publishProfile(profile: LocalProfile): Promise<{ ok: boolean; soon: boolean; profile: LocalProfile }> {
  writeStoredProfile(profile);
  let next = profile;
  try {
    await net.signIn();
    const uid = net.uid;
    if (!next.tag) next = { ...next, tag: tagFromUid(uid) };
    for (let attempt = 0; attempt < 6; attempt++) {
      const key = claimKey(next.nick, next.tag);
      try {
        await set(ref(db, `claims/${key}`), uid);
        break;
      } catch (err) {
        if (ratingDenied(err)) return { ok: false, soon: true, profile: next };
        const owner = await get(ref(db, `claims/${key}`));
        if (owner.val() === uid) break;
        next = { ...next, tag: bumpTag(next.tag) };
      }
    }
    writeStoredProfile(next);
    const existing = await get(ref(db, `players/${uid}`));
    const prev = parsePublic(existing.val(), next);
    const body: PublicProfile = prev
      ? { ...prev, nick: next.nick, tag: next.tag, emblem: next.emblem }
      : emptyPublic(next);
    if (!existing.exists()) {
      await set(ref(db, `players/${uid}`), body);
    } else {
      await set(ref(db, `players/${uid}`), { ...prev, nick: next.nick, emblem: next.emblem, tag: prev?.tag || next.tag });
    }
    return { ok: true, soon: false, profile: { nick: next.nick, tag: body.tag, emblem: next.emblem } };
  } catch (err) {
    return { ok: false, soon: ratingDenied(err), profile: next };
  }
}

export async function loadBoard(selfUid: string): Promise<{ rows: BoardEntry[]; me: PublicProfile | null; place: string; soon: boolean }> {
  try {
    await net.signIn();
    const listed = await get(query(ref(db, 'players'), orderByChild('rating'), limitToLast(100)));
    const rows: BoardEntry[] = [];
    listed.forEach((child) => {
      const parsed = parsePublic(child.val(), null);
      if (!parsed || !child.key) return;
      rows.push({
        uid: child.key,
        nick: parsed.nick,
        tag: parsed.tag,
        emblem: parsed.emblem,
        rating: parsed.rating,
        place: 0,
        self: child.key === selfUid,
      });
    });
    rows.sort((a, b) => b.rating - a.rating || (a.nick < b.nick ? -1 : 1));
    rows.forEach((row, index) => {
      row.place = index + 1;
    });
    const mineSnap = selfUid ? await get(ref(db, `players/${selfUid}`)) : null;
    const me = mineSnap ? parsePublic(mineSnap.val(), readStoredProfile()) : null;
    const found = rows.find((row) => row.self);
    const place = found ? String(found.place) : me ? 'ниже 100' : '—';
    return { rows, me, place, soon: false };
  } catch (err) {
    return { rows: [], me: null, place: '—', soon: ratingDenied(err) };
  }
}

export async function loadHistory(uid: string): Promise<HistoryEntry[]> {
  try {
    const snap = await get(ref(db, `history/${uid}`));
    const rows: HistoryEntry[] = [];
    snap.forEach((child) => {
      const value = child.val() as Partial<HistoryEntry> | null;
      if (!value) return;
      rows.push({
        opp: String(value.opp || ''),
        delta: Number(value.delta) || 0,
        rating: Number(value.rating) || RATING_START,
        winner: String(value.winner || ''),
        at: Number(value.at) || 0,
      });
    });
    rows.sort((a, b) => b.at - a.at);
    return rows.slice(0, 20);
  } catch {
    return [];
  }
}

async function readRating(uid: string): Promise<PublicProfile | null> {
  const snap = await get(ref(db, `players/${uid}`));
  return parsePublic(snap.val(), null);
}

export async function settleRanked(packet: RankPacket): Promise<{ text: string; soon: boolean }> {
  try {
    await net.signIn();
    let mine = await readRating(packet.myUid);
    if (!mine) {
      const stored = readStoredProfile() ?? { nick: 'Путник', tag: tagFromUid(packet.myUid), emblem: 'road' as const };
      const published = await publishProfile(stored);
      if (!published.ok) return { text: published.soon ? SOON : 'Сначала сохраните имя в «Рейтинг».', soon: published.soon };
      mine = (await readRating(packet.myUid)) ?? emptyPublic(published.profile);
    }
    const other = await readRating(packet.oppUid);
    const oldMine = mine.rating || RATING_START;
    const oldOpp = other?.rating || RATING_START;
    const iAmA = packet.myUid < packet.oppUid;
    const ratingA = iAmA ? oldMine : oldOpp;
    const ratingB = iAmA ? oldOpp : oldMine;
    const winnerSide = packet.winnerUid === (iAmA ? packet.myUid : packet.oppUid) ? 'a' : 'b';
    const rated = ratePair(ratingA, ratingB, winnerSide);
    const deltaMine = iAmA ? rated.deltaA : rated.deltaB;
    await set(ref(db, `matches/${packet.matchId}/reports/${packet.myUid}`), {
      winner: packet.winnerUid,
      hash: packet.hash,
      delta: deltaMine,
      forfeit: packet.forfeit,
      at: serverTimestamp(),
    });
    const reportA = await get(ref(db, `matches/${packet.matchId}/reports/${iAmA ? packet.myUid : packet.oppUid}`));
    const reportB = await get(ref(db, `matches/${packet.matchId}/reports/${iAmA ? packet.oppUid : packet.myUid}`));
    const left = reportA.val() as { winner?: string; hash?: string; delta?: number; forfeit?: boolean } | null;
    const right = reportB.val() as { winner?: string; hash?: string; delta?: number; forfeit?: boolean } | null;
    const agreed =
      !!left &&
      !!right &&
      left.winner === right.winner &&
      left.hash === right.hash &&
      left.winner === packet.winnerUid &&
      left.hash === packet.hash;
    const presence = await get(ref(db, `matches/${packet.matchId}/presence/${packet.oppUid}`));
    const seen = presence.val() as { at?: number } | null;
    const seenAt = Number(seen?.at) || 0;
    const stale = seenAt > 0 && Date.now() - seenAt >= FORFEIT_MS;
    const mineReport = iAmA ? left : right;
    const forfeited = packet.forfeit && stale && mineReport?.forfeit === true && packet.winnerUid === packet.myUid;
    if (!agreed && !forfeited) {
      return { text: `Отчёт отправлен. Рейтинг ${oldMine}, ждём второй отчёт.`, soon: false };
    }
    const mode = agreed ? 'agree' : 'forfeit';
    const a = iAmA ? packet.myUid : packet.oppUid;
    const b = iAmA ? packet.oppUid : packet.myUid;
    try {
      await set(ref(db, `matches/${packet.matchId}/settled`), {
        winner: packet.winnerUid,
        hash: packet.hash,
        a,
        b,
        oldA: ratingA,
        oldB: ratingB,
        nextA: rated.nextA,
        nextB: rated.nextB,
        deltaA: rated.deltaA,
        deltaB: rated.deltaB,
        mode,
      });
    } catch (err) {
      const existing = await get(ref(db, `matches/${packet.matchId}/settled`));
      if (!existing.exists()) {
        if (ratingDenied(err)) return { text: `Отчёт отправлен. Рейтинг ${oldMine}, ждём второй отчёт.`, soon: false };
        throw err;
      }
    }
    const settledSnap = await get(ref(db, `matches/${packet.matchId}/settled`));
    const settled = settledSnap.val() as { nextA?: number; nextB?: number; deltaA?: number; deltaB?: number; winner?: string; a?: string } | null;
    if (!settled) return { text: 'Отчёт записан.', soon: false };
    const next = settled.a === packet.myUid ? Number(settled.nextA) : Number(settled.nextB);
    const delta = settled.a === packet.myUid ? Number(settled.deltaA) : Number(settled.deltaB);
    const won = settled.winner === packet.myUid;
    const current = (await readRating(packet.myUid)) ?? mine;
    if (current.last !== packet.matchId && (await get(ref(db, `players/${packet.myUid}`))).exists()) {
      await set(ref(db, `players/${packet.myUid}`), {
        ...current,
        rating: next,
        games: current.games + 1,
        wins: current.wins + (won ? 1 : 0),
        last: packet.matchId,
      });
    }
    const oppNow = (await readRating(packet.oppUid)) ?? other;
    if (oppNow && oppNow.last !== packet.matchId) {
      const oppNext = settled.a === packet.oppUid ? Number(settled.nextA) : Number(settled.nextB);
      await set(ref(db, `players/${packet.oppUid}`), {
        ...oppNow,
        rating: oppNext,
        games: oppNow.games + 1,
        wins: oppNow.wins + (settled.winner === packet.oppUid ? 1 : 0),
        last: packet.matchId,
      });
    }
    try {
      await set(ref(db, `history/${packet.myUid}/${packet.matchId}`), {
        opp: packet.oppUid,
        delta,
        rating: next,
        winner: packet.winnerUid,
        at: serverTimestamp(),
      });
    } catch {
      /* history is optional once the rating moved */
    }
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return { text: `Рейтинг ${oldMine} → ${next} (${sign})`, soon: false };
  } catch (err) {
    if (ratingDenied(err)) return { text: SOON, soon: true };
    return { text: 'Рейтинг не записан.', soon: false };
  }
}

export function defaultEmblem(): EmblemId {
  return EMBLEMS[0].id;
}

export { displayTag, SOON };
