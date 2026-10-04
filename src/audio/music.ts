import type { SynthContext } from './synth';
import { sharedNoise, speak } from './synth';

export type MusicMode = 'menu' | 'calm' | 'tense';

const CALM = [220, 261.63, 293.66, 329.63, 392];
const TENSE = [110, 130.81, 146.83, 164.81, 174.61];
const MENU = [329.63, 392, 440, 493.88, 523.25];
const DEGREE = [0, 2, 4, 2, 3, 1, 4, 0, 3, 2, 4, 1];

interface GainLike {
  gain: {
    value: number;
    setTargetAtTime(value: number, time: number, constant: number): void;
  };
  connect(dest: AudioNode): unknown;
}

/**
 * Generative steppe bed: a drone fifth, a plucked pentatonic line and a soft pulse.
 * Notes are scheduled on the audio clock, so the line does not restart from a loop point.
 */
export class Score {
  private next = 0;
  private step = 0;
  private mode: MusicMode = 'menu';
  private drones = false;
  readonly menu: GainLike;
  readonly calm: GainLike;
  readonly tense: GainLike;

  constructor(
    private ctx: SynthContext,
    dest: AudioNode,
  ) {
    this.menu = ctx.createGain();
    this.calm = ctx.createGain();
    this.tense = ctx.createGain();
    this.menu.gain.value = 1;
    this.calm.gain.value = 0;
    this.tense.gain.value = 0;
    this.menu.connect(dest);
    this.calm.connect(dest);
    this.tense.connect(dest);
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const now = this.ctx.currentTime;
    const aim = (node: GainLike, value: number) => node.gain.setTargetAtTime(value, now, 0.7);
    aim(this.menu, mode === 'menu' ? 1 : 0);
    aim(this.calm, mode === 'calm' ? 1 : 0);
    aim(this.tense, mode === 'tense' ? 1 : 0);
  }

  catchUp(): void {
    if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime + 0.05;
  }

  pump(): void {
    this.ensureDrones();
    const horizon = this.ctx.currentTime + 0.28;
    let guard = 0;
    while (this.next < horizon && guard < 6) {
      this.note(this.next);
      const swing = ((this.step * 17) % 5) * 0.018;
      const gap = (this.mode === 'tense' ? 0.34 : this.mode === 'menu' ? 0.64 : 0.5) + swing;
      this.next += gap;
      this.step += 1;
      guard += 1;
    }
  }

  private bus(): AudioNode {
    if (this.mode === 'tense') return this.tense as unknown as AudioNode;
    if (this.mode === 'calm') return this.calm as unknown as AudioNode;
    return this.menu as unknown as AudioNode;
  }

  private scale(): number[] {
    if (this.mode === 'tense') return TENSE;
    if (this.mode === 'calm') return CALM;
    return MENU;
  }

  private note(when: number): void {
    if (this.step % 7 === 3) return;
    const scale = this.scale();
    const degree = (DEGREE[this.step % DEGREE.length] + Math.floor(this.step / DEGREE.length)) % scale.length;
    const oct = this.step % 11 === 10 ? 2 : 1;
    const freq = scale[degree] * oct;
    const dest = this.bus();
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, when);
    const harm = this.ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(freq * 2, when);
    const gain = this.ctx.createGain();
    const peak = this.mode === 'menu' ? 0.045 : 0.06;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
    const harmGain = this.ctx.createGain();
    harmGain.gain.setValueAtTime(0.22, when);
    osc.connect(gain as unknown as AudioNode);
    harm.connect(harmGain as unknown as AudioNode);
    harmGain.connect(gain as unknown as AudioNode);
    gain.connect(dest);
    osc.start(when);
    harm.start(when);
    osc.stop(when + 0.46);
    harm.stop(when + 0.46);
    const pulseEvery = this.mode === 'tense' ? 2 : this.mode === 'menu' ? 8 : 4;
    if (this.step % pulseEvery === 0) {
      speak(this.ctx, dest, 'hammer', when, this.mode === 'tense' ? 0.35 : 0.18);
    }
  }

  private ensureDrones(): void {
    if (this.drones) return;
    this.drones = true;
    this.drone(110, 164.81, this.calm as unknown as AudioNode, 0.018);
    this.drone(98, 146.83, this.tense as unknown as AudioNode, 0.022);
    this.drone(220, 329.63, this.menu as unknown as AudioNode, 0.014);
    sharedNoise(this.ctx);
  }

  private drone(a: number, b: number, dest: AudioNode, vol: number): void {
    for (const freq of [a, b]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      osc.connect(gain as unknown as AudioNode);
      gain.connect(dest);
      osc.start(this.ctx.currentTime);
    }
  }
}
