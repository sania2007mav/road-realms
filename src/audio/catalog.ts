import { tileToIso, type Camera } from '../render/camera';

export type SoundId =
  | 'ui-click'
  | 'ui-hover'
  | 'ui-error'
  | 'place'
  | 'hammer'
  | 'complete'
  | 'chop'
  | 'pick'
  | 'mill'
  | 'bakery'
  | 'birds'
  | 'cows'
  | 'sheep'
  | 'coins'
  | 'tax'
  | 'mood-up'
  | 'mood-down'
  | 'arrive'
  | 'leave'
  | 'trained'
  | 'select'
  | 'order'
  | 'sword'
  | 'bow'
  | 'arrow'
  | 'ram'
  | 'catapult'
  | 'impact'
  | 'crumble'
  | 'fire'
  | 'cough'
  | 'horn'
  | 'victory'
  | 'defeat';

export type AudioBusName = 'ui' | 'sfx' | 'ambience';

export interface SoundDef {
  id: SoundId;
  bus: AudioBusName;
  /** Same id cannot retrigger until this many milliseconds have passed. */
  gapMs: number;
  /** Drop the sound when its tile is outside the view. */
  world: boolean;
  label: string;
}

export const SOUNDS: readonly SoundDef[] = [
  { id: 'ui-click', bus: 'ui', gapMs: 40, world: false, label: 'Щелчок' },
  { id: 'ui-hover', bus: 'ui', gapMs: 90, world: false, label: 'Наведение' },
  { id: 'ui-error', bus: 'ui', gapMs: 180, world: false, label: 'Ошибка' },
  { id: 'place', bus: 'sfx', gapMs: 120, world: false, label: 'Постройка поставлена' },
  { id: 'hammer', bus: 'sfx', gapMs: 260, world: true, label: 'Молоток на стройке' },
  { id: 'complete', bus: 'sfx', gapMs: 420, world: false, label: 'Постройка готова' },
  { id: 'chop', bus: 'sfx', gapMs: 420, world: true, label: 'Рубка дерева' },
  { id: 'pick', bus: 'sfx', gapMs: 420, world: true, label: 'Кирка по камню' },
  { id: 'mill', bus: 'ambience', gapMs: 800, world: true, label: 'Скрип мельницы' },
  { id: 'bakery', bus: 'ambience', gapMs: 700, world: true, label: 'Треск печи' },
  { id: 'birds', bus: 'ambience', gapMs: 1400, world: true, label: 'Птицы на оазисе' },
  { id: 'cows', bus: 'ambience', gapMs: 1800, world: true, label: 'Коровы' },
  { id: 'sheep', bus: 'ambience', gapMs: 2200, world: true, label: 'Овцы' },
  { id: 'coins', bus: 'sfx', gapMs: 160, world: false, label: 'Монеты рынка' },
  { id: 'tax', bus: 'sfx', gapMs: 700, world: false, label: 'Сбор налога' },
  { id: 'mood-up', bus: 'sfx', gapMs: 500, world: false, label: 'Настроение вверх' },
  { id: 'mood-down', bus: 'sfx', gapMs: 500, world: false, label: 'Настроение вниз' },
  { id: 'arrive', bus: 'sfx', gapMs: 280, world: false, label: 'Человек пришёл' },
  { id: 'leave', bus: 'sfx', gapMs: 280, world: false, label: 'Человек ушёл' },
  { id: 'trained', bus: 'sfx', gapMs: 220, world: false, label: 'Солдат обучен' },
  { id: 'select', bus: 'sfx', gapMs: 140, world: false, label: 'Выбор' },
  { id: 'order', bus: 'sfx', gapMs: 180, world: false, label: 'Приказ' },
  { id: 'sword', bus: 'sfx', gapMs: 90, world: true, label: 'Удар меча' },
  { id: 'bow', bus: 'sfx', gapMs: 120, world: true, label: 'Тетива' },
  { id: 'arrow', bus: 'sfx', gapMs: 90, world: true, label: 'Попадание стрелы' },
  { id: 'ram', bus: 'sfx', gapMs: 240, world: true, label: 'Удар тарана' },
  { id: 'catapult', bus: 'sfx', gapMs: 420, world: true, label: 'Выстрел катапульты' },
  { id: 'impact', bus: 'sfx', gapMs: 240, world: true, label: 'Удар ядра' },
  { id: 'crumble', bus: 'sfx', gapMs: 360, world: true, label: 'Стена рушится' },
  { id: 'fire', bus: 'sfx', gapMs: 280, world: true, label: 'Огонь и смола' },
  { id: 'cough', bus: 'sfx', gapMs: 600, world: false, label: 'Кашель чумы' },
  { id: 'horn', bus: 'sfx', gapMs: 5000, world: false, label: 'Рог «на нас напали»' },
  { id: 'victory', bus: 'ui', gapMs: 4000, world: false, label: 'Победа' },
  { id: 'defeat', bus: 'ui', gapMs: 4000, world: false, label: 'Поражение' },
];

const BY_ID = new Map<SoundId, SoundDef>(SOUNDS.map((sound) => [sound.id, sound]));

export function soundDef(id: SoundId): SoundDef {
  return BY_ID.get(id)!;
}

export interface ThrottleBook {
  last: Partial<Record<SoundId, number>>;
  voices: number;
}

export function emptyBook(): ThrottleBook {
  return { last: {}, voices: 0 };
}

/** True when this id may sound now. UI never takes a world voice. */
export function admit(book: ThrottleBook, id: SoundId, now: number, maxVoices = 8): boolean {
  const def = soundDef(id);
  const prev = book.last[id] ?? Number.NEGATIVE_INFINITY;
  if (now - prev < def.gapMs) return false;
  if (def.bus === 'sfx' && book.voices >= maxVoices) return false;
  book.last[id] = now;
  if (def.bus === 'sfx') book.voices += 1;
  return true;
}

export function releaseVoice(book: ThrottleBook): void {
  if (book.voices > 0) book.voices -= 1;
}

export function soundForLog(line: string): SoundId | null {
  if (line.startsWith('Готово:') || line.includes('главное здание улучшено')) return 'complete';
  if (line === 'В поселение пришёл новый человек') return 'arrive';
  if (line === 'Человек покинул поселение') return 'leave';
  if (line.startsWith('Чума')) return 'cough';
  if (line.includes('угрожает')) return 'horn';
  if (line.startsWith('Волна ')) return 'horn';
  if (line === 'Ров засыпан') return 'crumble';
  return null;
}

export function strikeSound(weapon: string): SoundId {
  if (weapon === 'bow') return 'bow';
  if (weapon === 'ram') return 'ram';
  if (weapon === 'catapult') return 'catapult';
  return 'sword';
}

export interface Heard {
  pan: number;
  gain: number;
}

/** Pan and loudness from the camera. Null when the tile is outside the audible view. */
export function stereoAt(camera: Camera, viewW: number, viewH: number, tileX: number, tileY: number): Heard | null {
  if (viewW < 2 || viewH < 2) return null;
  const iso = tileToIso(tileX, tileY);
  const dx = (iso.x - camera.x) * camera.zoom;
  const dy = (iso.y - camera.y) * camera.zoom;
  const nx = dx / (viewW / 2);
  const ny = dy / (viewH / 2);
  const dist = Math.hypot(nx, ny);
  if (dist > 1.35) return null;
  return {
    pan: Math.max(-1, Math.min(1, nx * 0.85)),
    gain: Math.max(0.08, 1 - dist / 1.35),
  };
}
