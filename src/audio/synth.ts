import type { SoundId } from './catalog';

interface Param {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
  setTargetAtTime(value: number, time: number, constant: number): void;
}

interface NodeLike {
  connect(dest: AudioNode): NodeLike;
}

interface OscLike extends NodeLike {
  type: OscillatorType;
  frequency: Param;
  start(when: number): void;
  stop(when: number): void;
}

interface GainLike extends NodeLike {
  gain: Param;
}

interface FilterLike extends NodeLike {
  type: BiquadFilterType;
  frequency: Param;
  Q: Param;
}

interface SourceLike extends NodeLike {
  buffer: AudioBuffer | null;
  loop: boolean;
  start(when: number): void;
  stop(when: number): void;
}

/** The slice of AudioContext the synth actually touches. */
export interface SynthContext {
  currentTime: number;
  sampleRate: number;
  destination: AudioNode;
  createOscillator(): OscLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): SourceLike;
  createStereoPanner?(): StereoPannerNode;
}

function envGain(ctx: SynthContext, dest: AudioNode, when: number, vol: number, dur: number): GainLike {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, vol), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  gain.connect(dest);
  return gain;
}

function tone(ctx: SynthContext, dest: AudioNode, when: number, freq: number, dur: number, type: OscillatorType, vol: number, slide = 1): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), when + dur);
  const gain = envGain(ctx, dest, when, vol, dur);
  osc.connect(gain as unknown as AudioNode);
  osc.start(when);
  osc.stop(when + dur + 0.03);
}

function burst(ctx: SynthContext, dest: AudioNode, noise: AudioBuffer, when: number, dur: number, vol: number, freq: number, q: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, when);
  filter.Q.setValueAtTime(q, when);
  const gain = envGain(ctx, dest, when, vol, dur);
  src.connect(filter as unknown as AudioNode);
  filter.connect(gain as unknown as AudioNode);
  src.start(when);
  src.stop(when + dur + 0.03);
}

function grunt(ctx: SynthContext, dest: AudioNode, noise: AudioBuffer, when: number, base: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base, when);
  osc.frequency.exponentialRampToValueAtTime(base * 0.72, when + 0.12);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(980, when);
  filter.frequency.exponentialRampToValueAtTime(420, when + 0.12);
  filter.Q.setValueAtTime(5, when);
  const gain = envGain(ctx, dest, when, 0.07, 0.14);
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(0.015, when);
  osc.connect(filter as unknown as AudioNode);
  breath.connect(breathGain as unknown as AudioNode);
  breathGain.connect(filter as unknown as AudioNode);
  filter.connect(gain as unknown as AudioNode);
  osc.start(when);
  osc.stop(when + 0.16);
  breath.start(when);
  breath.stop(when + 0.16);
}

let noiseCache: AudioBuffer | null = null;
let noiseCtx: SynthContext | null = null;

export function sharedNoise(ctx: SynthContext): AudioBuffer {
  if (noiseCache && noiseCtx === ctx) return noiseCache;
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = 1;
  for (let i = 0; i < len; i++) {
    state = (state * 16807) % 2147483647;
    data[i] = state / 2147483647 * 2 - 1;
  }
  noiseCache = buffer;
  noiseCtx = ctx;
  return buffer;
}

export function resetNoiseCache(): void {
  noiseCache = null;
  noiseCtx = null;
}

/** Schedule one original voice. Nodes are stopped, so nothing is built per frame. */
export function speak(ctx: SynthContext, dest: AudioNode, id: SoundId, when: number, vol = 1): void {
  const noise = sharedNoise(ctx);
  const v = Math.max(0.0001, vol);
  switch (id) {
    case 'ui-click':
      tone(ctx, dest, when, 880, 0.045, 'sine', 0.06 * v);
      break;
    case 'ui-hover':
      tone(ctx, dest, when, 640, 0.03, 'sine', 0.025 * v);
      break;
    case 'ui-error':
      tone(ctx, dest, when, 140, 0.16, 'square', 0.05 * v, 0.7);
      break;
    case 'place':
      tone(ctx, dest, when, 330, 0.1, 'triangle', 0.07 * v, 1.35);
      break;
    case 'hammer':
      burst(ctx, dest, noise, when, 0.07, 0.08 * v, 220, 1.2);
      tone(ctx, dest, when, 180, 0.05, 'sine', 0.04 * v, 0.5);
      break;
    case 'complete':
      tone(ctx, dest, when, 523, 0.16, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.08, 659, 0.18, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.16, 784, 0.28, 'triangle', 0.07 * v);
      break;
    case 'chop':
      burst(ctx, dest, noise, when, 0.06, 0.07 * v, 480, 2);
      tone(ctx, dest, when, 120, 0.05, 'sine', 0.04 * v);
      break;
    case 'pick':
      burst(ctx, dest, noise, when, 0.04, 0.06 * v, 1400, 3);
      tone(ctx, dest, when, 220, 0.07, 'triangle', 0.04 * v, 0.6);
      break;
    case 'mill':
      tone(ctx, dest, when, 96, 0.35, 'sine', 0.03 * v, 1.08);
      tone(ctx, dest, when, 102, 0.35, 'triangle', 0.02 * v);
      break;
    case 'bakery':
      burst(ctx, dest, noise, when, 0.22, 0.04 * v, 700, 0.6);
      break;
    case 'birds':
      tone(ctx, dest, when, 1480, 0.09, 'sine', 0.03 * v, 1.4);
      tone(ctx, dest, when + 0.11, 1760, 0.07, 'sine', 0.02 * v, 0.8);
      break;
    case 'cows':
      tone(ctx, dest, when, 146, 0.42, 'sawtooth', 0.04 * v, 0.62);
      break;
    case 'sheep':
      tone(ctx, dest, when, 520, 0.18, 'triangle', 0.035 * v, 0.75);
      tone(ctx, dest, when + 0.16, 430, 0.16, 'triangle', 0.03 * v, 1.15);
      break;
    case 'coins':
      tone(ctx, dest, when, 1310, 0.06, 'sine', 0.05 * v);
      tone(ctx, dest, when + 0.05, 1760, 0.08, 'sine', 0.04 * v);
      break;
    case 'tax':
      tone(ctx, dest, when, 880, 0.08, 'triangle', 0.05 * v);
      tone(ctx, dest, when + 0.07, 1175, 0.12, 'sine', 0.04 * v);
      break;
    case 'mood-up':
      tone(ctx, dest, when, 523, 0.14, 'sine', 0.05 * v, 1.5);
      break;
    case 'mood-down':
      tone(ctx, dest, when, 440, 0.18, 'sine', 0.05 * v, 0.6);
      break;
    case 'arrive':
      tone(ctx, dest, when, 494, 0.12, 'triangle', 0.05 * v, 1.25);
      break;
    case 'leave':
      tone(ctx, dest, when, 392, 0.16, 'triangle', 0.045 * v, 0.7);
      break;
    case 'trained':
      burst(ctx, dest, noise, when, 0.08, 0.04 * v, 300, 2);
      tone(ctx, dest, when, 310, 0.12, 'square', 0.03 * v);
      break;
    case 'select':
      grunt(ctx, dest, noise, when, 150);
      break;
    case 'order':
      grunt(ctx, dest, noise, when, 190);
      break;
    case 'sword':
      burst(ctx, dest, noise, when, 0.08, 0.07 * v, 1800, 2);
      tone(ctx, dest, when, 210, 0.09, 'triangle', 0.05 * v, 0.5);
      break;
    case 'spear':
      burst(ctx, dest, noise, when, 0.05, 0.06 * v, 2400, 3);
      tone(ctx, dest, when, 180, 0.07, 'triangle', 0.04 * v, 0.4);
      break;
    case 'hoof':
      burst(ctx, dest, noise, when, 0.06, 0.05 * v, 220, 1);
      burst(ctx, dest, noise, when + 0.08, 0.05, 0.04 * v, 180, 1);
      break;
    case 'charge':
      tone(ctx, dest, when, 140, 0.16, 'sawtooth', 0.05 * v, 1.4);
      burst(ctx, dest, noise, when, 0.1, 0.06 * v, 200, 1);
      burst(ctx, dest, noise, when + 0.09, 0.08, 0.05 * v, 160, 1);
      break;
    case 'bow':
      tone(ctx, dest, when, 620, 0.1, 'triangle', 0.05 * v, 0.35);
      burst(ctx, dest, noise, when, 0.05, 0.04 * v, 2400, 4);
      break;
    case 'crossbow':
      burst(ctx, dest, noise, when, 0.04, 0.08 * v, 2800, 5);
      tone(ctx, dest, when, 180, 0.06, 'square', 0.04 * v, 0.3);
      tone(ctx, dest, when + 0.03, 90, 0.08, 'sine', 0.05 * v, 0.4);
      break;
    case 'shield':
      burst(ctx, dest, noise, when, 0.09, 0.08 * v, 180, 0.7);
      tone(ctx, dest, when, 95, 0.1, 'sine', 0.05 * v, 0.5);
      break;
    case 'volley':
      tone(ctx, dest, when, 740, 0.06, 'triangle', 0.04 * v, 0.4);
      tone(ctx, dest, when + 0.07, 680, 0.06, 'triangle', 0.035 * v, 0.4);
      burst(ctx, dest, noise, when, 0.05, 0.04 * v, 200, 1);
      burst(ctx, dest, noise, when + 0.08, 0.05, 0.035 * v, 160, 1);
      break;
    case 'arrow':
      burst(ctx, dest, noise, when, 0.04, 0.06 * v, 3200, 6);
      break;
    case 'ram':
      tone(ctx, dest, when, 58, 0.22, 'sine', 0.08 * v, 0.7);
      burst(ctx, dest, noise, when, 0.12, 0.05 * v, 140, 1);
      break;
    case 'catapult':
      tone(ctx, dest, when, 90, 0.18, 'sawtooth', 0.04 * v, 2.2);
      burst(ctx, dest, noise, when + 0.05, 0.12, 0.04 * v, 500, 1);
      break;
    case 'impact':
      tone(ctx, dest, when, 48, 0.28, 'sine', 0.08 * v, 0.55);
      burst(ctx, dest, noise, when, 0.18, 0.06 * v, 180, 0.7);
      break;
    case 'crumble':
      burst(ctx, dest, noise, when, 0.4, 0.07 * v, 240, 0.5);
      tone(ctx, dest, when, 70, 0.3, 'sine', 0.04 * v, 0.5);
      break;
    case 'fire':
      burst(ctx, dest, noise, when, 0.32, 0.05 * v, 420, 0.4);
      break;
    case 'cough':
      burst(ctx, dest, noise, when, 0.08, 0.05 * v, 900, 2);
      burst(ctx, dest, noise, when + 0.12, 0.1, 0.04 * v, 700, 1.5);
      break;
    case 'horn':
      tone(ctx, dest, when, 220, 0.45, 'sawtooth', 0.05 * v, 1.5);
      tone(ctx, dest, when + 0.28, 330, 0.4, 'triangle', 0.04 * v);
      break;
    case 'victory':
      tone(ctx, dest, when, 523, 0.16, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.12, 659, 0.16, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.24, 784, 0.16, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.36, 1046, 0.36, 'sine', 0.07 * v);
      break;
    case 'defeat':
      tone(ctx, dest, when, 392, 0.2, 'triangle', 0.06 * v);
      tone(ctx, dest, when + 0.16, 349, 0.2, 'triangle', 0.05 * v);
      tone(ctx, dest, when + 0.32, 311, 0.22, 'sine', 0.05 * v);
      tone(ctx, dest, when + 0.48, 262, 0.4, 'sine', 0.05 * v);
      break;
    default:
      break;
  }
}
