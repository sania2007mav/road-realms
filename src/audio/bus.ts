import { isoToTile, type Camera } from '../render/camera';
import { TAX_EVERY } from '../sim/balance';
import { Terrain, type GameState } from '../sim/types';
import { terrainAt } from '../sim/world';
import {
  admit,
  emptyBook,
  releaseVoice,
  soundDef,
  soundForLog,
  stereoAt,
  strikeSound,
  type SoundId,
  type ThrottleBook,
} from './catalog';
import { Score, type MusicMode } from './music';
import { loadSettings, saveSettings, type AudioSettings } from './settings';
import { speak, type SynthContext } from './synth';

const WALL = new Set(['palisade', 'wall', 'gate', 'woodtower', 'stonetower', 'keep']);
const SAMPLE_X = [0, 12, -12, 0, 0];
const SAMPLE_Y = [0, 0, 0, 8, -8];

export interface AudioBus {
  unlock(): void;
  setHidden(hidden: boolean): void;
  settings(): AudioSettings;
  update(partial: Partial<AudioSettings>): void;
  toggleMuted(): boolean;
  play(id: SoundId, x?: number, y?: number): void;
  follow(state: GameState, playerId: number, camera: Camera, viewW: number, viewH: number, playing: boolean, won: boolean | null): void;
  onPlayed: ((id: SoundId) => void) | null;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  ambience: GainNode;
  score: Score;
}

function contextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const extra = window as Window & { webkitAudioContext?: new () => AudioContext };
  return window.AudioContext ?? extra.webkitAudioContext ?? null;
}

export function createBus(factory?: () => AudioContext): AudioBus {
  const settings = loadSettings();
  const book: ThrottleBook = emptyBook();
  const playedLines = ['', '', '', '', '', '', '', ''];
  const soldierHp = new Map<number, number>();
  const buildingHp = new Map<number, number>();
  const dropIds: number[] = [];
  let graph: Graph | null = null;
  let failed = false;
  let unlocked = false;
  let hidden = false;
  let primed = false;
  let playedN = 0;
  let gold = 0;
  let popularity = 0;
  let soldiers = 0;
  let outcome = 'playing';
  let tenseUntil = 0;
  let scanAt = 0;
  let sweep = 0;
  let inMatch = false;
  let muffled = false;
  let climateRain = false;
  let climateWind = false;
  let seenSeed = -1;
  let seenTick = -1;
  let battle = false;
  let cameraX = 0;
  let cameraY = 0;
  let cameraZoom = 1;
  let viewW = 1;
  let viewH = 1;
  let hammer = 0;
  let chop = 0;
  let pick = 0;
  let mill = 0;
  let bakery = 0;
  let birds = 0;
  let cows = 0;
  let sheep = 0;
  let fire = 0;
  let hoof = 0;
  let hammerX = 0;
  let hammerY = 0;
  let chopX = 0;
  let chopY = 0;
  let pickX = 0;
  let pickY = 0;
  let millX = 0;
  let millY = 0;
  let bakeryX = 0;
  let bakeryY = 0;
  let birdX = 0;
  let birdY = 0;
  let cowX = 0;
  let cowY = 0;
  let sheepX = 0;
  let sheepY = 0;
  let fireX = 0;
  let fireY = 0;
  let hoofX = 0;
  let hoofY = 0;
  const hoofAt = new Map<number, { x: number; y: number }>();
  const nextAt: Partial<Record<SoundId, number>> = {};
  let onPlayed: ((id: SoundId) => void) | null = null;

  const cam = (): Camera => ({ x: cameraX, y: cameraY, zoom: cameraZoom });

  function heard(x: number, y: number) {
    return stereoAt(cam(), viewW, viewH, x, y);
  }

  function ensure(): Graph | null {
    if (graph || failed) return graph;
    try {
      const Ctor = factory ? null : contextCtor();
      const ctx = factory ? factory() : Ctor ? new Ctor() : null;
      if (!ctx) {
        failed = true;
        return null;
      }
      const master = ctx.createGain();
      const music = ctx.createGain();
      const sfx = ctx.createGain();
      const ambience = ctx.createGain();
      music.connect(master);
      sfx.connect(master);
      ambience.connect(master);
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 8;
        comp.ratio.value = 4;
        comp.attack.value = 0.01;
        comp.release.value = 0.25;
        master.connect(comp);
        comp.connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
      const score = new Score(ctx as unknown as SynthContext, music);
      graph = { ctx, master, music, sfx, ambience, score };
      applyGains();
      return graph;
    } catch {
      failed = true;
      return null;
    }
  }

  function applyGains() {
    if (!graph) return;
    const now = graph.ctx.currentTime;
    const master = settings.muted ? 0 : settings.master;
    graph.master.gain.setTargetAtTime(master, now, 0.04);
    graph.music.gain.setTargetAtTime(settings.music, now, 0.04);
    graph.sfx.gain.setTargetAtTime(settings.sfx * (muffled ? 0.4 : 1), now, 0.08);
    graph.ambience.gain.setTargetAtTime(settings.ambience, now, 0.04);
  }

  function running(): Graph | null {
    if (!unlocked || hidden || settings.muted) return null;
    const live = ensure();
    if (!live || live.ctx.state === 'closed') return null;
    return live;
  }

  function playAt(id: SoundId, when: number, x?: number, y?: number): void {
    const live = running();
    if (!live) return;
    const def = soundDef(id);
    let dest: AudioNode = def.bus === 'ambience' ? live.ambience : live.sfx;
    let vol = 1;
    if (def.world) {
      if (x === undefined || y === undefined) return;
      const place = heard(x, y);
      if (!place) return;
      vol = place.gain;
      if (typeof live.ctx.createStereoPanner === 'function') {
        const panner = live.ctx.createStereoPanner();
        panner.pan.setValueAtTime(place.pan, when);
        panner.connect(dest);
        dest = panner;
      }
    }
    const now = typeof performance !== 'undefined' ? performance.now() : when * 1000;
    if (!admit(book, id, now)) return;
    speak(live.ctx as unknown as SynthContext, dest, id, when, vol);
    if (id === 'horn') tenseUntil = now + 8000;
    onPlayed?.(id);
    if (def.bus === 'sfx') {
      const wait = def.gapMs;
      setTimeout(() => releaseVoice(book), wait);
    }
  }

  function play(id: SoundId, x?: number, y?: number): void {
    if (!unlocked) return;
    const live = graph ?? ensure();
    playAt(id, live ? live.ctx.currentTime : 0, x, y);
  }

  function markLog(line: string) {
    playedLines[playedN % 8] = line;
    playedN += 1;
  }

  function logFresh(line: string): boolean {
    for (let i = 0; i < 8; i++) if (playedLines[i] === line) return false;
    markLog(line);
    return true;
  }

  function takeLog(log: readonly string[]) {
    for (let i = 0; i < log.length; i++) {
      const line = log[i];
      if (!line || !logFresh(line)) continue;
      const id = soundForLog(line);
      if (id) play(id);
    }
  }

  function rememberHp(state: GameState) {
    for (let i = 0; i < state.soldiers.length; i++) {
      const soldier = state.soldiers[i];
      soldierHp.set(soldier.id, soldier.hp);
    }
    for (let i = 0; i < state.buildings.length; i++) {
      const building = state.buildings[i];
      buildingHp.set(building.id, building.hp);
    }
  }

  function nearestWeapon(state: GameState, x: number, y: number, owner: number): string {
    let weapon = '';
    let best = 9;
    for (let i = 0; i < state.soldiers.length; i++) {
      const soldier = state.soldiers[i];
      if (soldier.hp <= 0 || soldier.playerId === owner) continue;
      const dist = Math.hypot(soldier.x - x, soldier.y - y);
      const reach =
        soldier.weapon === 'catapult' ? 8 : soldier.weapon === 'bow' || soldier.weapon === 'crossbow' || soldier.weapon === 'horsebow' ? 6 : soldier.weapon === 'ram' ? 2.4 : 2.2;
      if (dist > reach || dist >= best) continue;
      best = dist;
      weapon = soldier.weapon;
    }
    return weapon;
  }

  function hitSoldier(state: GameState, x: number, y: number, owner: number) {
    const weapon = nearestWeapon(state, x, y, owner);
    if (!weapon) {
      play('sword', x, y);
      return;
    }
    const id = strikeSound(weapon);
    play(id, x, y);
    if (weapon === 'bow' || weapon === 'horsebow') play('arrow', x, y);
    if (weapon === 'catapult') play('impact', x, y);
  }

  function hitBuilding(state: GameState, type: string, x: number, y: number, owner: number, hp: number) {
    if (type === 'pitchditch' || type === 'oil') {
      play('fire', x, y);
      return;
    }
    if (!WALL.has(type)) return;
    const weapon = nearestWeapon(state, x + 1, y + 1, owner);
    if (weapon === 'catapult') {
      play('catapult', x, y);
      play('impact', x, y);
    } else if (weapon === 'ram') play('ram', x, y);
    if (hp <= 0) play('crumble', x, y);
  }

  function scan(state: GameState, playerId: number) {
    hammer = 0;
    chop = 0;
    pick = 0;
    mill = 0;
    bakery = 0;
    cows = 0;
    fire = 0;
    hoof = 0;
    birds = 0;
    sheep = 0;
    battle = false;
    for (let i = 0; i < state.buildings.length; i++) {
      const building = state.buildings[i];
      if (building.hp <= 0) {
        const prev = buildingHp.get(building.id);
        if (prev !== undefined && prev > 0) hitBuilding(state, building.type, building.x, building.y, building.playerId, 0);
        buildingHp.set(building.id, 0);
        continue;
      }
      const place = heard(building.x + 1, building.y + 1);
      const prev = buildingHp.get(building.id);
      if (prev !== undefined && building.hp < prev) hitBuilding(state, building.type, building.x, building.y, building.playerId, building.hp);
      buildingHp.set(building.id, building.hp);
      if (!place) continue;
      if (!building.complete) {
        hammer = 1;
        hammerX = building.x + 1;
        hammerY = building.y + 1;
        continue;
      }
      if (building.type === 'woodcutter' && building.workerIds.length > 0) {
        chop = 1;
        chopX = building.x + 1;
        chopY = building.y + 1;
      } else if (building.type === 'quarry' && building.workerIds.length > 0) {
        pick = 1;
        pickX = building.x + 1;
        pickY = building.y + 1;
      } else if (building.type === 'mill' && building.workerIds.length > 0) {
        mill = 1;
        millX = building.x + 1;
        millY = building.y + 1;
      } else if (building.type === 'bakery' && building.workerIds.length > 0) {
        bakery = 1;
        bakeryX = building.x + 1;
        bakeryY = building.y + 1;
      } else if (building.type === 'dairy' && building.workerIds.length > 0) {
        cows = 1;
        cowX = building.x + 1;
        cowY = building.y + 1;
      } else if (building.type === 'pitchditch' || building.type === 'oil') {
        fire = 1;
        fireX = building.x + 1;
        fireY = building.y + 1;
      } else if (building.type === 'orchard' || building.type === 'wheat' || building.type === 'hop') {
        birds = 1;
        birdX = building.x + 1;
        birdY = building.y + 1;
        sheep = 1;
        sheepX = building.x + 1;
        sheepY = building.y + 1;
      }
    }
    if (!birds) {
      for (let i = 0; i < SAMPLE_X.length; i++) {
        const tile = isoToTile(cameraX + SAMPLE_X[i], cameraY + SAMPLE_Y[i]);
        if (terrainAt(state, tile.x, tile.y) !== Terrain.Oasis) continue;
        birds = 1;
        sheep = 1;
        birdX = tile.x;
        birdY = tile.y;
        sheepX = tile.x;
        sheepY = tile.y;
        break;
      }
    }
    let own = 0;
    for (let i = 0; i < state.soldiers.length; i++) {
      const soldier = state.soldiers[i];
      if (soldier.playerId === playerId && soldier.hp > 0) own += 1;
      const prev = soldierHp.get(soldier.id);
      if (prev !== undefined && soldier.hp < prev && soldier.hp > 0) hitSoldier(state, soldier.x, soldier.y, soldier.playerId);
      if (prev !== undefined && soldier.hp > prev) {
        const healer = state.soldiers.some(
          (other) => other.hp > 0 && other.weapon === 'healer' && other.playerId === soldier.playerId && Math.hypot(other.x - soldier.x, other.y - soldier.y) <= 2.4,
        );
        if (healer) play('heal', soldier.x, soldier.y);
      }
      soldierHp.set(soldier.id, soldier.hp);
      if (soldier.hp > 0 && soldier.weapon === 'ladder' && (soldier.dock ?? 0) === 1 && heard(soldier.x, soldier.y)) {
        schedule('ladder', true, 1.6, soldier.x, soldier.y);
      }
      if (soldier.hp > 0 && soldier.weapon === 'siegetower' && (soldier.dock ?? 0) === 2 && heard(soldier.x, soldier.y)) {
        schedule('tower', true, 2.4, soldier.x, soldier.y);
      }
      if (soldier.hp > 0 && soldier.playerId !== playerId && heard(soldier.x, soldier.y)) battle = true;
      if (soldier.hp > 0 && (soldier.weapon === 'light' || soldier.weapon === 'heavy' || soldier.weapon === 'horsebow') && heard(soldier.x, soldier.y)) {
        const prev = hoofAt.get(soldier.id);
        if (!prev || Math.hypot(prev.x - soldier.x, prev.y - soldier.y) > 0.04) {
          hoof = 1;
          hoofX = soldier.x;
          hoofY = soldier.y;
        }
        hoofAt.set(soldier.id, { x: soldier.x, y: soldier.y });
      }
    }
    if (own > soldiers) play('trained');
    soldiers = own;
    sweep += 1;
    if (sweep % 60 !== 0) return;
    dropIds.length = 0;
    for (const id of soldierHp.keys()) {
      let live = false;
      for (let i = 0; i < state.soldiers.length; i++) if (state.soldiers[i].id === id) live = true;
      if (!live) dropIds.push(id);
    }
    for (let i = 0; i < dropIds.length; i++) soldierHp.delete(dropIds[i]);
    dropIds.length = 0;
    for (const id of buildingHp.keys()) {
      let live = false;
      for (let i = 0; i < state.buildings.length; i++) if (state.buildings[i].id === id) live = true;
      if (!live) dropIds.push(id);
    }
    for (let i = 0; i < dropIds.length; i++) buildingHp.delete(dropIds[i]);
  }

  function schedule(id: SoundId, on: boolean, every: number, x: number, y: number) {
    const live = graph;
    if (!live || live.ctx.state === 'closed') return;
    if (!on) {
      nextAt[id] = live.ctx.currentTime;
      return;
    }
    const due = nextAt[id] ?? live.ctx.currentTime;
    if (due > live.ctx.currentTime + 0.12) return;
    playAt(id, Math.max(due, live.ctx.currentTime), x, y);
    nextAt[id] = live.ctx.currentTime + every;
  }

  function pump() {
    const live = running();
    if (!live) return;
    live.score.pump();
    if (!inMatch) return;
    schedule('hammer', hammer > 0, 0.28, hammerX, hammerY);
    schedule('chop', chop > 0, 0.7, chopX, chopY);
    schedule('pick', pick > 0, 0.75, pickX, pickY);
    schedule('mill', mill > 0, 0.9, millX, millY);
    schedule('bakery', bakery > 0, 0.55, bakeryX, bakeryY);
    schedule('birds', birds > 0, 1.6, birdX, birdY);
    schedule('sheep', sheep > 0, 2.6, sheepX, sheepY);
    schedule('cows', cows > 0, 2.1, cowX, cowY);
    schedule('fire', fire > 0, 1.1, fireX, fireY);
    schedule('hoof', hoof > 0, 0.32, hoofX, hoofY);
    schedule('rain', climateRain, 0.42, 0, 0);
    schedule('wind', climateWind, 0.7, 0, 0);
  }

  function modeFor(playing: boolean): MusicMode {
    if (!playing) return 'menu';
    if (battle || (typeof performance !== 'undefined' && performance.now() < tenseUntil)) return 'tense';
    return 'calm';
  }

  const bus: AudioBus = {
    onPlayed: null,
    unlock() {
      if (unlocked && graph?.ctx.state === 'running') return;
      unlocked = true;
      const live = ensure();
      if (!live || hidden || settings.muted) return;
      void live.ctx.resume().then(() => live.score.catchUp());
    },
    setHidden(next: boolean) {
      hidden = next;
      if (!graph || !unlocked) return;
      if (next) void graph.ctx.suspend();
      else if (!settings.muted) void graph.ctx.resume().then(() => graph?.score.catchUp());
    },
    settings() {
      return settings;
    },
    update(partial: Partial<AudioSettings>) {
      if (partial.master !== undefined) settings.master = Math.max(0, Math.min(1, partial.master));
      if (partial.music !== undefined) settings.music = Math.max(0, Math.min(1, partial.music));
      if (partial.sfx !== undefined) settings.sfx = Math.max(0, Math.min(1, partial.sfx));
      if (partial.ambience !== undefined) settings.ambience = Math.max(0, Math.min(1, partial.ambience));
      if (partial.muted !== undefined) settings.muted = partial.muted;
      saveSettings(settings);
      applyGains();
      if (!graph || !unlocked) return;
      if (settings.muted || hidden) void graph.ctx.suspend();
      else void graph.ctx.resume().then(() => graph?.score.catchUp());
    },
    toggleMuted() {
      bus.update({ muted: !settings.muted });
      return settings.muted;
    },
    play,
    follow(state, playerId, camera, width, height, playing, won) {
      cameraX = camera.x;
      cameraY = camera.y;
      cameraZoom = camera.zoom;
      viewW = width;
      viewH = height;
      inMatch = playing;
      const snow = state.weather === 'snow';
      if (snow !== muffled) {
        muffled = snow;
        applyGains();
      }
      climateRain = state.weather === 'rain' || state.weather === 'storm';
      climateWind = state.season === 'winter' || state.weather === 'snow' || state.weather === 'storm';
      if (state.seed !== seenSeed || state.tick < seenTick) primed = false;
      seenSeed = state.seed;
      seenTick = state.tick;
      if (!primed) {
        primed = true;
        for (let i = 0; i < state.log.length; i++) if (state.log[i]) markLog(state.log[i]);
        const player = state.players[playerId];
        gold = player?.gold ?? 0;
        popularity = player?.popularity ?? 0;
        rememberHp(state);
        let own = 0;
        for (let i = 0; i < state.soldiers.length; i++) if (state.soldiers[i].playerId === playerId && state.soldiers[i].hp > 0) own += 1;
        soldiers = own;
        outcome = state.outcome;
      } else if (playing) {
        takeLog(state.log);
        const player = state.players[playerId];
        if (player) {
          if (player.gold > gold && state.tick > 0 && state.tick % TAX_EVERY === 0) play('tax');
          gold = player.gold;
          if (player.popularity > popularity) play('mood-up');
          else if (player.popularity < popularity) play('mood-down');
          popularity = player.popularity;
        }
        if (won !== null && state.outcome !== outcome) play(won ? 'victory' : 'defeat');
        outcome = state.outcome;
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        if (now - scanAt >= 200) {
          scanAt = now;
          scan(state, playerId);
        }
      }
      const live = running();
      live?.score.setMode(modeFor(playing));
      pump();
    },
  };

  Object.defineProperty(bus, 'onPlayed', {
    get: () => onPlayed,
    set: (fn: ((id: SoundId) => void) | null) => {
      onPlayed = fn;
    },
  });

  return bus;
}

export function createAudio(): AudioBus {
  const bus = createBus();
  if (typeof window === 'undefined' || typeof document === 'undefined') return bus;
  const arm = () => bus.unlock();
  window.addEventListener('pointerdown', arm, { passive: true });
  window.addEventListener('keydown', arm);
  window.addEventListener('touchstart', arm, { passive: true });
  document.addEventListener('visibilitychange', () => bus.setHidden(document.hidden));
  return bus;
}
