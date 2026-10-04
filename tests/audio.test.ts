import { afterEach, describe, expect, it } from 'vitest';
import { admit, emptyBook, soundForLog, stereoAt, strikeSound, SOUNDS } from '../src/audio/catalog';
import { createBus } from '../src/audio/bus';
import { parseSettings, serializeSettings } from '../src/audio/settings';
import { resetNoiseCache } from '../src/audio/synth';

function param() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  };
}

function mockContext() {
  const started: string[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running' as AudioContextState,
    destination: {},
    createGain() {
      return { gain: param(), connect() { return this; } };
    },
    createOscillator() {
      started.push('osc');
      return {
        type: 'sine',
        frequency: param(),
        connect() { return this; },
        start() {},
        stop() {},
      };
    },
    createBiquadFilter() {
      return { type: 'lowpass', frequency: param(), Q: param(), connect() { return this; } };
    },
    createBuffer(_channels: number, length: number, sampleRate: number) {
      const data = new Float32Array(length);
      return { duration: length / sampleRate, length, numberOfChannels: 1, sampleRate, getChannelData: () => data };
    },
    createBufferSource() {
      return {
        buffer: null as AudioBuffer | null,
        loop: false,
        connect() { return this; },
        start() { started.push('noise'); },
        stop() {},
      };
    },
    createStereoPanner() {
      return { pan: param(), connect() { return this; } };
    },
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

describe('звук', () => {
  afterEach(() => resetNoiseCache());

  it('переводит строки журнала в звуки', () => {
    expect(soundForLog('Готово: Амбар')).toBe('complete');
    expect(soundForLog('Ваш посад: главное здание улучшено')).toBe('complete');
    expect(soundForLog('В поселение пришёл новый человек')).toBe('arrive');
    expect(soundForLog('Человек покинул поселение')).toBe('leave');
    expect(soundForLog('Чума на молочной ферме')).toBe('cough');
    expect(soundForLog('Воевода угрожает вам')).toBe('horn');
    expect(soundForLog('Посад «Ольха» угрожает: соседу')).toBe('horn');
    expect(soundForLog('Волна 2: бандиты подступают')).toBe('horn');
    expect(soundForLog('Ров засыпан')).toBe('crumble');
    expect(soundForLog('нет свободных людей')).toBeNull();
    expect(strikeSound('bow')).toBe('bow');
    expect(strikeSound('ram')).toBe('ram');
    expect(strikeSound('catapult')).toBe('catapult');
    expect(strikeSound('sword')).toBe('sword');
    expect(strikeSound('club')).toBe('sword');
  });

  it('не повторяет один звук, пока не вышло окно, и держит потолок голосов', () => {
    const book = emptyBook();
    expect(admit(book, 'sword', 0, 2)).toBe(true);
    expect(admit(book, 'sword', 40, 2)).toBe(false);
    expect(admit(book, 'bow', 40, 2)).toBe(true);
    expect(admit(book, 'arrow', 40, 2)).toBe(false);
    expect(book.voices).toBe(2);
    expect(admit(book, 'ui-click', 40, 2)).toBe(true);
    expect(SOUNDS.length).toBeGreaterThan(20);
  });

  it('глушит то, что далеко от камеры', () => {
    const near = stereoAt({ x: 0, y: 0, zoom: 1 }, 800, 600, 0, 0);
    expect(near).not.toBeNull();
    expect(Math.abs(near!.pan)).toBeLessThan(0.2);
    expect(near!.gain).toBeGreaterThan(0.8);
    expect(stereoAt({ x: 0, y: 0, zoom: 1 }, 800, 600, 80, 80)).toBeNull();
  });

  it('помнит ползунки', () => {
    const raw = serializeSettings({ master: 2, music: -1, sfx: 0.3, ambience: 0.5, muted: true });
    expect(parseSettings(raw)).toEqual({ master: 1, music: 0, sfx: 0.3, ambience: 0.5, muted: true });
    expect(parseSettings('не json').muted).toBe(false);
  });

  it('играет журнал через подменённый AudioContext и режет повтор', () => {
    const mock = mockContext();
    const bus = createBus(() => mock.ctx);
    const heard: string[] = [];
    bus.onPlayed = (id) => heard.push(id);
    bus.unlock();
    bus.play('arrive');
    bus.play('arrive');
    expect(heard).toEqual(['arrive']);
    for (const id of ['place', 'complete', 'coins', 'tax', 'mood-up', 'mood-down', 'leave', 'trained', 'select'] as const) {
      bus.play(id);
    }
    expect(heard).toHaveLength(8);
    expect(mock.started.length).toBeGreaterThan(0);
  });
});
