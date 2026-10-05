import { mapSize } from './match';
import { Terrain, type EventPace, type MapSizeId, type MobKind, type SeasonId, type SeasonPace } from './types';

export const MAP_SHARE_LIMIT = 12_000;
export const MAPS_KEY = 'dorozhnye-kraya-maps';

export type RoadLayout = 'straight' | 'bend' | 'cross';
export type SeasonStart = 'off' | SeasonId;
export type PropKind = 'wolf' | 'bear' | 'deer' | 'bandit' | 'camp';

export interface CustomStart {
  x: number;
  y: number;
  team: 0 | 1 | 2 | 3;
}

export interface CustomProp {
  kind: PropKind;
  x: number;
  y: number;
}

export interface CustomMap {
  name: string;
  size: MapSizeId;
  road: RoadLayout;
  seasonStart: SeasonStart;
  events: EventPace;
  paint: Uint8Array;
  starts: CustomStart[];
  props: CustomProp[];
}

export interface SavedMap {
  id: string;
  name: string;
  code: string;
}

export interface CompiledMap {
  mapW: number;
  mapH: number;
  roadY: number;
  terrain: Uint8Array;
  spawns: { x: number; y: number; side: 'north' | 'south'; team: number }[];
  mobs: { kind: MobKind; x: number; y: number }[];
  seasonShift: number;
  seasons: SeasonPace;
  events: EventPace;
  mapHash: string;
}

const LETTERS = 'abcdefghijk';
const RESOURCE_R = 16;
const REACH = 48;

export function mapDims(size: MapSizeId): { w: number; h: number } {
  return mapSize(size);
}

export function roadLayoutName(layout: RoadLayout): string {
  if (layout === 'bend') return 'Изгиб';
  if (layout === 'cross') return 'Перекрёсток';
  return 'Прямой';
}

export function sizeName(size: MapSizeId): string {
  if (size === 'small') return 'Малая';
  if (size === 'large') return 'Большая';
  return 'Средняя';
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function clampTile(value: number): number {
  if (!Number.isFinite(value)) return Terrain.Land;
  const n = Math.floor(value);
  if (n < 0 || n > Terrain.Clay || n === Terrain.Road || n === Terrain.Oasis) return Terrain.Land;
  return n;
}

export function roadMask(w: number, h: number, layout: RoadLayout): Uint8Array {
  const mask = new Uint8Array(w * h);
  const midY = Math.floor(h / 2);
  const midX = Math.floor(w / 2);
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    mask[y * w + x] = 1;
  };
  const band = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) paint(x, y + dy);
  };
  if (layout === 'bend') {
    for (let x = 0; x < w; x++) {
      const wave = Math.sin((x / Math.max(1, w - 1)) * Math.PI * 2);
      const y = midY + Math.round(wave * Math.max(3, Math.floor(h * 0.18)));
      band(x, y);
    }
  } else {
    for (let x = 0; x < w; x++) band(x, midY);
  }
  if (layout === 'cross') {
    for (let y = 0; y < h; y++) {
      for (let dx = -1; dx <= 1; dx++) paint(midX + dx, y);
    }
  }
  return mask;
}

function disc(paint: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, value: number) {
  const rr = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr) continue;
      paint[y * w + x] = value;
    }
  }
}

function rect(paint: Uint8Array, w: number, h: number, x0: number, y0: number, rw: number, rh: number, value: number) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      paint[y * w + x] = value;
    }
  }
}

export function blankMap(size: MapSizeId = 'small', road: RoadLayout = 'straight'): CustomMap {
  const { w, h } = mapDims(size);
  const paint = new Uint8Array(w * h);
  const sx = (n: number) => Math.max(4, Math.min(w - 5, Math.round((n * w) / 120)));
  const sy = (n: number) => Math.max(4, Math.min(h - 5, Math.round((n * h) / 80)));
  disc(paint, w, h, sx(40), sy(16), 3, Terrain.Forest);
  disc(paint, w, h, sx(96), sy(66), 3, Terrain.Forest);
  rect(paint, w, h, sx(20), sy(18), 4, 3, Terrain.Limestone);
  rect(paint, w, h, sx(74), sy(60), 4, 3, Terrain.Limestone);
  rect(paint, w, h, sx(36), sy(30), 3, 3, Terrain.Iron);
  rect(paint, w, h, sx(92), sy(48), 3, 3, Terrain.Swamp);
  rect(paint, w, h, sx(24), sy(30), 3, 2, Terrain.Clay);
  rect(paint, w, h, sx(80), sy(48), 3, 2, Terrain.Iron);
  disc(paint, w, h, sx(60), sy(12), 3, Terrain.Water);
  disc(paint, w, h, sx(14), sy(66), 3, Terrain.Desert);
  return {
    name: 'Новый край',
    size,
    road,
    seasonStart: 'spring',
    events: 'off',
    paint,
    starts: [
      { x: sx(30), y: sy(24), team: 0 },
      { x: sx(86), y: sy(56), team: 1 },
    ],
    props: [
      { kind: 'deer', x: sx(42), y: sy(18) },
      { kind: 'deer', x: sx(98), y: sy(66) },
      { kind: 'wolf', x: sx(58), y: sy(30) },
      { kind: 'camp', x: sx(60), y: sy(48) },
    ],
  };
}

export function cloneMap(map: CustomMap): CustomMap {
  return {
    ...map,
    paint: map.paint.slice(),
    starts: map.starts.map((start) => ({ ...start })),
    props: map.props.map((prop) => ({ ...prop })),
  };
}

function rle(tiles: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < tiles.length) {
    const value = tiles[i];
    let count = 1;
    while (i + count < tiles.length && tiles[i + count] === value && count < 9999) count += 1;
    out += `${count}${LETTERS[value] ?? 'a'}`;
    i += count;
  }
  return out;
}

function unrle(text: string, length: number): Uint8Array | null {
  const paint = new Uint8Array(length);
  let at = 0;
  const parts = text.match(/\d+[a-k]/g);
  if (!parts) return null;
  for (const part of parts) {
    const count = Number(part.slice(0, -1));
    const value = LETTERS.indexOf(part.slice(-1));
    if (!count || value < 0) return null;
    for (let i = 0; i < count; i++) {
      if (at >= length) return null;
      paint[at++] = value === Terrain.Road || value === Terrain.Oasis ? Terrain.Land : value;
    }
  }
  if (at !== length) return null;
  return paint;
}

interface MapFile {
  v: 1;
  name: string;
  size: MapSizeId;
  road: RoadLayout;
  season: SeasonStart;
  events: EventPace;
  starts: CustomStart[];
  props: CustomProp[];
  rle: string;
}

function cleanName(name: string): string {
  const text = name.replace(/[\u0000-\u001f]/g, '').trim();
  return (text || 'Новый край').slice(0, 24);
}

function asSize(value: unknown): MapSizeId {
  return value === 'small' || value === 'large' || value === 'normal' ? value : 'small';
}

function asRoad(value: unknown): RoadLayout {
  return value === 'bend' || value === 'cross' || value === 'straight' ? value : 'straight';
}

function asSeason(value: unknown): SeasonStart {
  return value === 'spring' || value === 'summer' || value === 'autumn' || value === 'winter' || value === 'off' ? value : 'spring';
}

function asEvents(value: unknown): EventPace {
  return value === 'rare' || value === 'normal' || value === 'often' || value === 'off' ? value : 'off';
}

function asTeam(value: unknown): 0 | 1 | 2 | 3 {
  const n = Math.floor(Number(value));
  if (n === 1 || n === 2 || n === 3) return n;
  return 0;
}

function asProp(value: unknown): PropKind | null {
  if (value === 'wolf' || value === 'bear' || value === 'deer' || value === 'bandit' || value === 'camp') return value;
  return null;
}

function fileOf(map: CustomMap): MapFile {
  return {
    v: 1,
    name: cleanName(map.name),
    size: map.size,
    road: map.road,
    season: map.seasonStart,
    events: map.events,
    starts: map.starts.slice(0, 4).map((start) => ({ x: Math.floor(start.x), y: Math.floor(start.y), team: asTeam(start.team) })),
    props: map.props.slice(0, 80).map((prop) => ({ kind: prop.kind, x: Math.floor(prop.x), y: Math.floor(prop.y) })),
    rle: rle(map.paint),
  };
}

function mapOf(file: MapFile): CustomMap | null {
  const size = asSize(file.size);
  const { w, h } = mapDims(size);
  const paint = unrle(String(file.rle || ''), w * h);
  if (!paint) return null;
  const starts = Array.isArray(file.starts)
    ? file.starts.slice(0, 4).map((start) => ({
        x: Math.floor(Number(start?.x) || 0),
        y: Math.floor(Number(start?.y) || 0),
        team: asTeam(start?.team),
      }))
    : [];
  const props = Array.isArray(file.props)
    ? file.props
        .slice(0, 80)
        .map((prop) => {
          const kind = asProp(prop?.kind);
          if (!kind) return null;
          return { kind, x: Math.floor(Number(prop?.x) || 0), y: Math.floor(Number(prop?.y) || 0) };
        })
        .filter((prop): prop is CustomProp => !!prop)
    : [];
  return { name: cleanName(String(file.name || '')), size, road: asRoad(file.road), seasonStart: asSeason(file.season), events: asEvents(file.events), paint, starts, props };
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64ToBytes(code: string): Uint8Array | null {
  const clean = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+$/.test(clean)) return null;
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function exportJson(map: CustomMap): string {
  return JSON.stringify(fileOf(map));
}

export function encodeShare(map: CustomMap): string {
  const bytes = new TextEncoder().encode(exportJson(map));
  return bytesToB64(bytes);
}

export function decodeShare(code: string): CustomMap {
  const bytes = b64ToBytes(code);
  if (!bytes) throw new Error('Код карты не читается');
  let text = '';
  try {
    text = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('Код карты не читается');
  }
  return importMap(text);
}

export function importMap(text: string): CustomMap {
  const raw = text.trim();
  if (!raw.startsWith('{')) return decodeShare(raw);
  let file: MapFile;
  try {
    file = JSON.parse(raw) as MapFile;
  } catch {
    throw new Error('Файл карты не читается');
  }
  const map = mapOf(file);
  if (!map) throw new Error('Файл карты не читается');
  return map;
}

function bake(map: CustomMap): { tiles: Uint8Array; w: number; h: number; roadY: number; mask: Uint8Array } {
  const { w, h } = mapDims(map.size);
  const tiles = map.paint.length === w * h ? map.paint.slice() : new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = clampTile(tiles[i]);
  const mask = roadMask(w, h, map.road);
  const roadY = Math.floor(h / 2);
  for (const start of map.starts) {
    const spot = oasisSpot(tiles, mask, w, h, start.x, start.y);
    if (!spot) continue;
    for (let y = spot.y; y < spot.y + 3; y++) {
      for (let x = spot.x; x < spot.x + 4; x++) {
        const index = y * w + x;
        if (tiles[index] === Terrain.Land || tiles[index] === Terrain.Desert) tiles[index] = Terrain.Oasis;
      }
    }
  }
  for (let i = 0; i < mask.length; i++) if (mask[i]) tiles[i] = Terrain.Road;
  return { tiles, w, h, roadY, mask };
}

function oasisSpot(tiles: Uint8Array, mask: Uint8Array, w: number, h: number, sx: number, sy: number): { x: number; y: number } | null {
  for (let y = sy - 10; y <= sy + 6; y++) {
    for (let x = sx - 6; x <= sx + 8; x++) {
      if (x < 1 || y < 1 || x + 4 >= w || y + 3 >= h) continue;
      let ok = true;
      for (let dy = 0; dy < 3 && ok; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const index = (y + dy) * w + (x + dx);
          if (mask[index]) {
            ok = false;
            break;
          }
          const tile = tiles[index];
          if (tile !== Terrain.Land && tile !== Terrain.Desert) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

function countNear(tiles: Uint8Array, w: number, h: number, sx: number, sy: number, want: (tile: number) => boolean): number {
  let count = 0;
  for (let y = sy - RESOURCE_R; y <= sy + RESOURCE_R; y++) {
    for (let x = sx - RESOURCE_R; x <= sx + RESOURCE_R; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (want(tiles[y * w + x])) count += 1;
    }
  }
  return count;
}

function reachesRoad(tiles: Uint8Array, w: number, h: number, sx: number, sy: number): boolean {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;
  const start = sy * w + sx;
  if (tiles[start] === Terrain.Road) return true;
  const seen = new Uint8Array(w * h);
  const queue = [start];
  seen[start] = 1;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    const x = index % w;
    const y = Math.floor(index / w);
    const next = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of next) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      const tile = tiles[ni];
      if (tile === Terrain.Water || tile === Terrain.Rock) continue;
      if (tile === Terrain.Road) return true;
      if (Math.abs(nx - sx) + Math.abs(ny - sy) > REACH) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return false;
}

export function validateMap(map: CustomMap): string[] {
  const errors: string[] = [];
  const { tiles, w, h, mask } = bake(map);
  if (map.starts.length < 2 || map.starts.length > 4) errors.push('Нужно от 2 до 4 стартов');
  map.starts.forEach((start, index) => {
    const label = index + 1;
    if (start.x < 2 || start.y < 2 || start.x >= w - 2 || start.y >= h - 2) {
      errors.push(`Старт ${label} стоит у края карты`);
      return;
    }
    const tile = tiles[start.y * w + start.x];
    if (tile === Terrain.Water || tile === Terrain.Rock || tile === Terrain.Road || mask[start.y * w + start.x]) {
      errors.push(`Старт ${label} стоит на воде, скале или тракте`);
    }
    if (!reachesRoad(tiles, w, h, start.x, start.y)) errors.push(`Старт ${label} не достаёт до тракта`);
    if (countNear(tiles, w, h, start.x, start.y, (value) => value === Terrain.Forest) < 8) errors.push(`У старта ${label} мало леса рядом`);
    if (countNear(tiles, w, h, start.x, start.y, (value) => value === Terrain.Limestone || value === Terrain.Clay) < 4) {
      errors.push(`У старта ${label} мало камня или глины рядом`);
    }
    if (countNear(tiles, w, h, start.x, start.y, (value) => value === Terrain.Iron || value === Terrain.Swamp) < 4) {
      errors.push(`У старта ${label} мало железа или смолы рядом`);
    }
    if (!oasisSpot(map.paint.length === w * h ? map.paint : tiles, mask, w, h, start.x, start.y)) {
      errors.push(`У старта ${label} нет ровной земли под сад`);
    }
  });
  for (let i = 0; i < map.starts.length; i++) {
    for (let j = i + 1; j < map.starts.length; j++) {
      const a = map.starts[i];
      const b = map.starts[j];
      if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < 8) errors.push(`Старты ${i + 1} и ${j + 1} стоят слишком близко`);
    }
  }
  return errors;
}

const SHIFT: Record<SeasonId, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

export function compileCustom(map: CustomMap): CompiledMap {
  const { tiles, w, h, roadY } = bake(map);
  const spawns = map.starts.slice(0, 4).map((start) => ({
    x: start.x,
    y: start.y,
    side: start.y < roadY ? ('north' as const) : ('south' as const),
    team: start.team,
  }));
  const mobs: CompiledMap['mobs'] = [];
  for (const prop of map.props) {
    if (prop.kind === 'camp') {
      mobs.push({ kind: 'bandit', x: prop.x, y: prop.y });
      mobs.push({ kind: 'bandit', x: prop.x + 1, y: prop.y + 0.6 });
      mobs.push({ kind: 'bandit', x: prop.x - 0.8, y: prop.y + 0.8 });
    } else {
      mobs.push({ kind: prop.kind, x: prop.x + 0.5, y: prop.y + 0.5 });
    }
  }
  const file = fileOf(map);
  const stamp = `${file.size}|${file.road}|${file.season}|${file.events}|${file.rle}|${file.starts.map((start) => `${start.x},${start.y},${start.team}`).join(';')}|${file.props.map((prop) => `${prop.kind},${prop.x},${prop.y}`).join(';')}`;
  return {
    mapW: w,
    mapH: h,
    roadY,
    terrain: tiles,
    spawns,
    mobs,
    seasonShift: map.seasonStart === 'off' ? 0 : SHIFT[map.seasonStart],
    seasons: map.seasonStart === 'off' ? 'off' : 'normal',
    events: map.events,
    mapHash: fnv(stamp),
  };
}

export function listMaps(): SavedMap[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const rows = JSON.parse(localStorage.getItem(MAPS_KEY) || '[]') as SavedMap[];
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string' && typeof row.code === 'string') : [];
  } catch {
    return [];
  }
}

function writeMaps(rows: SavedMap[]) {
  localStorage.setItem(MAPS_KEY, JSON.stringify(rows.slice(0, 40)));
}

export function saveMap(map: CustomMap, id?: string): SavedMap {
  const rows = listMaps();
  const code = encodeShare(map);
  const name = cleanName(map.name);
  const existing = id ? rows.find((row) => row.id === id) : undefined;
  const record: SavedMap = { id: existing?.id || `m${Date.now().toString(36)}`, name, code };
  const next = existing ? rows.map((row) => (row.id === record.id ? record : row)) : [record, ...rows];
  writeMaps(next);
  return record;
}

export function renameMap(id: string, name: string) {
  writeMaps(listMaps().map((row) => (row.id === id ? { ...row, name: cleanName(name) } : row)));
}

export function deleteMap(id: string) {
  writeMaps(listMaps().filter((row) => row.id !== id));
}

export function loadMap(id: string): CustomMap | null {
  const row = listMaps().find((item) => item.id === id);
  if (!row) return null;
  try {
    const map = decodeShare(row.code);
    map.name = row.name;
    return map;
  } catch {
    return null;
  }
}
