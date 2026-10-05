/** Local rating math. The lockstep sim does not import this module. */

export const RATING_START = 1000;
export const RATING_K = 32;
export const RATING_CAP = 32;
export const FORFEIT_MS = 60_000;
export const PROFILE_KEY = 'dorozhnye-kraya-profile';

export const EMBLEMS = [
  { id: 'road', mark: '🛤', name: 'Тракт' },
  { id: 'keep', mark: '🏰', name: 'Замок' },
  { id: 'eagle', mark: '🦅', name: 'Орёл' },
  { id: 'sun', mark: '☀', name: 'Солнце' },
  { id: 'wolf', mark: '🐺', name: 'Волк' },
  { id: 'oak', mark: '🌳', name: 'Дуб' },
  { id: 'banner', mark: '🚩', name: 'Стяг' },
  { id: 'star', mark: '⭐', name: 'Звезда' },
] as const;

export type EmblemId = (typeof EMBLEMS)[number]['id'];

export interface LocalProfile {
  nick: string;
  tag: string;
  emblem: EmblemId;
}

export interface PublicProfile extends LocalProfile {
  rating: number;
  games: number;
  wins: number;
  last: string;
}

export interface PairRating {
  deltaA: number;
  deltaB: number;
  nextA: number;
  nextB: number;
}

export function isEmblem(value: string): value is EmblemId {
  return EMBLEMS.some((item) => item.id === value);
}

export function emblemOf(id: string): (typeof EMBLEMS)[number] {
  return EMBLEMS.find((item) => item.id === id) ?? EMBLEMS[0];
}

/** 3–16 visible characters, without the characters Realtime Database rejects in text we also show beside a tag. */
export function cleanNick(raw: string): string {
  return raw.replace(/[.#$/[\]~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export function nickOk(nick: string): boolean {
  return nick.length >= 3 && nick.length <= 16;
}

export function tagFromUid(uid: string): string {
  let n = 0;
  for (let i = 0; i < uid.length; i++) n = (n * 33 + uid.charCodeAt(i)) >>> 0;
  return String(1000 + (n % 9000));
}

export function bumpTag(tag: string): string {
  const n = (Number(tag) + 1) % 10000;
  return String(n).padStart(4, '0');
}

export function claimKey(nick: string, tag: string): string {
  let n = 2166136261;
  const text = nick.toLowerCase();
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return `${(n >>> 0).toString(16)}_${tag}`;
}

export function displayTag(nick: string, tag: string): string {
  return `${nick}#${tag}`;
}

/** Lobby seats accept at most 20 characters, so a 16-letter nick keeps the tag on the board and the seat shows the nick. */
export function seatLabel(nick: string, tag: string): string {
  const full = displayTag(nick, tag);
  return full.length <= 20 ? full : nick.slice(0, 20);
}

export function readStoredProfile(): LocalProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || '') as Partial<LocalProfile>;
    const nick = cleanNick(String(data.nick || ''));
    const tag = String(data.tag || '');
    if (!nickOk(nick) || !/^[0-9]{4}$/.test(tag) || !isEmblem(String(data.emblem || ''))) return null;
    return { nick, tag, emblem: data.emblem as EmblemId };
  } catch {
    return null;
  }
}

export function writeStoredProfile(profile: LocalProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function expectedScore(mine: number, opp: number): number {
  return 1 / (1 + 10 ** ((opp - mine) / 400));
}

/** Integer Elo. The two deltas sum to 0 and each stays inside ±K, which is the range the database rules allow. */
export function ratePair(ratingA: number, ratingB: number, winner: 'a' | 'b'): PairRating {
  const scoreA = winner === 'a' ? 1 : 0;
  let deltaA = Math.round(RATING_K * (scoreA - expectedScore(ratingA, ratingB)));
  let deltaB = Math.round(RATING_K * (1 - scoreA - expectedScore(ratingB, ratingA)));
  deltaA = Math.max(-RATING_CAP, Math.min(RATING_CAP, deltaA));
  deltaB = Math.max(-RATING_CAP, Math.min(RATING_CAP, deltaB));
  const sum = deltaA + deltaB;
  if (sum !== 0) {
    if (winner === 'a') deltaB -= sum;
    else deltaA -= sum;
  }
  return { deltaA, deltaB, nextA: ratingA + deltaA, nextB: ratingB + deltaB };
}

export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

export function profileHtml(profile: LocalProfile | null, note: string): string {
  const nick = profile?.nick ?? '';
  const tag = profile?.tag ?? '0000';
  const emblem = profile?.emblem ?? 'road';
  const marks = EMBLEMS.map(
    (item) =>
      `<button type="button" data-emblem="${item.id}" data-testid="emblem-${item.id}" class="${item.id === emblem ? 'on' : ''}" title="${item.name}">${item.mark}</button>`,
  ).join('');
  return `<div class="card help-card">
    <header class="help-head"><h2>Профиль</h2></header>
    <div class="help-body">
      ${note ? `<p class="rating-soon" data-testid="rating-soon">${escapeHtml(note)}</p>` : ''}
      <label>Имя, 3–16 знаков
        <input id="rating-nick" data-testid="rating-nick" maxlength="16" value="${escapeHtml(nick)}" />
      </label>
      <p data-testid="rating-tag">На таблице: ${escapeHtml(nickOk(nick) ? displayTag(nick, tag) : `имя#${tag}`)}</p>
      <p>Знак</p>
      <div class="emblem-row" data-testid="emblem-row">${marks}</div>
    </div>
    <div class="actions">
      <button type="button" id="rating-save" data-testid="rating-save">Сохранить</button>
      <button type="button" id="rating-board" data-testid="rating-board">Таблица</button>
      <button type="button" id="rating-close" data-testid="rating-close">Закрыть</button>
    </div>
  </div>`;
}

export interface BoardEntry {
  uid: string;
  nick: string;
  tag: string;
  emblem: string;
  rating: number;
  place: number;
  self: boolean;
}

export interface HistoryEntry {
  opp: string;
  delta: number;
  rating: number;
  winner: string;
  at: number;
}

export function boardHtml(rows: BoardEntry[], me: PublicProfile | null, place: string, soon: string): string {
  const list = rows
    .map((row) => {
      const mark = emblemOf(row.emblem).mark;
      return `<div class="board-row${row.self ? ' rating-me' : ''}" data-testid="board-row">
        <span>${mark}</span>
        <span>${row.place}. ${escapeHtml(displayTag(row.nick, row.tag))}</span>
        <b>${row.rating}</b>
      </div>`;
    })
    .join('');
  const mine = me ? `${escapeHtml(displayTag(me.nick, me.tag))} · ${me.rating}` : 'профиль не задан';
  return `<div class="card help-card">
    <header class="help-head"><h2>Рейтинг</h2></header>
    <div class="help-body">
      ${soon ? `<p class="rating-soon" data-testid="rating-soon">${escapeHtml(soon)}</p>` : ''}
      <p data-testid="board-place">Ваше место: ${escapeHtml(place)}. ${mine}</p>
      <div data-testid="board-list">${list || '<p>Пока пусто.</p>'}</div>
    </div>
    <div class="actions">
      <button type="button" id="season-reset" data-testid="season-reset" disabled>Сброс сезона</button>
      <button type="button" id="board-back" data-testid="board-back">Профиль</button>
      <button type="button" id="rating-close" data-testid="rating-close">Закрыть</button>
    </div>
  </div>`;
}

export function historyHtml(rows: HistoryEntry[]): string {
  if (!rows.length) return '<p>Партий пока нет.</p>';
  return rows
    .map((row) => {
      const won = row.winner && row.delta > 0 ? 'победа' : row.delta < 0 ? 'поражение' : 'ничья';
      return `<div class="history-row"><span>${won}</span><span>${escapeHtml(row.opp)}</span><b>${formatDelta(row.delta)} · ${row.rating}</b></div>`;
    })
    .join('');
}
