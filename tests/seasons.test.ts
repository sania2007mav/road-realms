import { describe, expect, it } from 'vitest';
import { TICKS_PER_GAME_MINUTE } from '../src/sim/balance';
import { createBuilding } from '../src/sim/entities';
import { hashState } from '../src/sim/hash';
import { packLobbyName, tailFromLobbyName } from '../src/sim/match';
import { ROAD_MULT, onRoad, roadPace } from '../src/sim/roads';
import {
  climateMinute,
  farmWorkRate,
  forecastLine,
  seasonAt,
  stormMiss,
  syncClimate,
  weatherAt,
} from '../src/sim/seasons';
import { planOneAi } from '../src/sim/ai';
import { deserialize, playerKeep, serialize, step } from '../src/sim/update';
import { createGame } from '../src/sim/world';
import type { AiProfile } from '../src/sim/types';

const profiles: AiProfile[] = [
  { difficulty: 'cruel', personality: 'merchant' },
  { difficulty: 'easy', personality: 'warlord' },
  { difficulty: 'hard', personality: 'builder' },
];

describe('сезоны', () => {
  it('крутит год фиксированными минутами', () => {
    const minute = TICKS_PER_GAME_MINUTE;
    expect(seasonAt(0, 'off')).toBe('off');
    expect(seasonAt(0, 'normal')).toBe('spring');
    expect(seasonAt(6 * minute, 'normal')).toBe('summer');
    expect(seasonAt(12 * minute, 'normal')).toBe('autumn');
    expect(seasonAt(18 * minute, 'normal')).toBe('winter');
    expect(seasonAt(24 * minute, 'normal')).toBe('spring');
    expect(seasonAt(12 * minute, 'long')).toBe('summer');
    expect(seasonAt(48 * minute, 'long')).toBe('spring');
  });

  it('меняет рост полей и не трогает дорожный множитель', () => {
    const state = createGame(1, { ai: 0, setup: { seasons: 'normal', map: 'small' } });
    state.season = 'spring';
    state.weather = 'clear';
    expect(farmWorkRate(state)).toBe(1);
    state.season = 'autumn';
    expect(farmWorkRate(state)).toBe(2);
    state.season = 'winter';
    expect(farmWorkRate(state)).toBe(0);
    state.season = 'summer';
    state.weather = 'drought';
    expect(farmWorkRate(state)).toBeCloseTo(0.45);

    let roadX = 0;
    const roadY = state.roadY;
    for (let x = 0; x < state.mapW; x++) {
      if (onRoad(state, x, roadY)) {
        roadX = x;
        break;
      }
    }
    let offX = 0;
    let offY = 0;
    for (let y = 0; y < state.mapH && onRoad(state, offX, offY); y++) {
      for (let x = 0; x < state.mapW; x++) {
        if (!onRoad(state, x, y)) {
          offX = x;
          offY = y;
          break;
        }
      }
    }
    state.weather = 'rain';
    state.season = 'spring';
    expect(roadPace(state, roadX, roadY, 1)).toBeCloseTo(ROAD_MULT);
    expect(ROAD_MULT).toBe(1.45);
    expect(onRoad(state, offX, offY)).toBe(false);
    expect(roadPace(state, offX, offY, 1)).toBeCloseTo(0.82);
    state.weather = 'snow';
    expect(roadPace(state, roadX, roadY, 1)).toBeCloseTo(ROAD_MULT);
    expect(roadPace(state, offX, offY, 1)).toBeCloseTo(0.74);
    state.weather = 'clear';
    state.season = 'summer';
    expect(roadPace(state, offX, offY, 1)).toBeCloseTo(1);
  });

  it('зимой жжёт дрова, в зной — пиво, в засуху сушит запас', () => {
    const state = createGame(2, { ai: 0, setup: { seasons: 'normal', map: 'small' } });
    const keep = playerKeep(state, 0)!;
    createBuilding(state, 0, 'house', keep.x + 5, keep.y + 1, true);
    state.tick = 18 * TICKS_PER_GAME_MINUTE;
    syncClimate(state);
    expect(state.season).toBe('winter');
    state.players[0].stocks.wood = 8;
    climateMinute(state);
    expect(state.players[0].stocks.wood).toBe(7);
    state.players[0].stocks.wood = 0;
    const mood = state.players[0].popularity;
    climateMinute(state);
    expect(state.players[0].popularity).toBe(mood - 1);

    state.tick = 7 * TICKS_PER_GAME_MINUTE;
    state.season = 'summer';
    state.weather = 'heat';
    state.players[0].stocks.beer = 2;
    climateMinute(state);
    expect(state.players[0].stocks.beer).toBe(1);
    state.players[0].stocks.beer = 0;
    const warm = state.players[0].popularity;
    climateMinute(state);
    expect(state.players[0].popularity).toBe(warm - 1);

    state.weather = 'drought';
    state.players[0].stocks.apples = 5;
    state.players[0].stocks.wheat = 4;
    state.players[0].stocks.cheese = 3;
    climateMinute(state);
    expect(state.players[0].stocks.apples).toBe(4);
    expect(state.players[0].stocks.wheat).toBe(3);
    expect(state.players[0].stocks.cheese).toBe(2);
  });

  it('гроза сбивает выстрел одинаково на обоих клиентах', () => {
    const state = createGame(8, { ai: 0 });
    state.weather = 'storm';
    state.tick = 40;
    const first = stormMiss(state, 7);
    expect(stormMiss(state, 7)).toBe(first);
    const twin = createGame(8, { ai: 0 });
    twin.weather = 'storm';
    twin.tick = 40;
    expect(stormMiss(twin, 7)).toBe(first);
    let misses = 0;
    for (let id = 0; id < 25; id++) if (stormMiss(state, id)) misses += 1;
    expect(misses).toBeGreaterThan(0);
    expect(misses).toBeLessThan(25);
    state.weather = 'clear';
    expect(stormMiss(state, 7)).toBe(false);
  });

  it('два прогона с сезонами дают один хеш', () => {
    const run = (seed: number, seasons: 'off' | 'normal') => {
      const state = createGame(seed, { ai: 1, setup: { map: 'small', seasons } });
      for (let i = 0; i < 420; i++) step(state, []);
      return { hash: hashState(state), season: state.season, weather: state.weather };
    };
    const left = run(9, 'normal');
    const right = run(9, 'normal');
    expect(left).toEqual(right);
    expect(left.season).toBe('summer');
    expect(weatherAt(9, 420, 'normal')).toBe(left.weather);
    expect(run(9, 'off').hash).not.toBe(left.hash);
    expect(run(9, 'off').season).toBe('off');
  });

  it('кладёт сезон в имя лобби и не выходит за 32 знака', () => {
    const packed = packLobbyName('Посад у большого тракта', profiles, {
      speed: 3,
      teams: 'pairs',
      seasons: 'long',
      lock: 'ab12cd34',
    });
    expect(packed.length).toBeLessThanOrEqual(32);
    expect(tailFromLobbyName(packed)).toEqual({ speed: 3, teams: 'pairs', lock: 'ab12cd34', seasons: 'long', events: 'off', ranked: false });
    const quiet = packLobbyName('Посад', profiles, { speed: 1, teams: 'ffa', seasons: 'off' });
    expect(quiet.length).toBeLessThanOrEqual(32);
    expect(tailFromLobbyName(quiet).seasons).toBe('off');
  });

  it('старое сохранение остаётся без года, новое хранит погоду', () => {
    const state = createGame(4, { ai: 0, setup: { seasons: 'normal', map: 'small' } });
    for (let i = 0; i < 400; i++) step(state, []);
    expect(state.season).toBe('summer');
    expect(state.saveVersion).toBe(6);
    expect(forecastLine(state)).toContain('Лето');
    expect(forecastLine(state)).toContain('дальше');
    const back = deserialize(serialize(state));
    expect(hashState(back)).toBe(hashState(state));
    expect(back.season).toBe('summer');

    const raw = JSON.parse(serialize(state)) as { saveVersion: number; match: { seasons?: string }; season?: string; weather?: string };
    raw.saveVersion = 4;
    delete raw.match.seasons;
    delete raw.season;
    delete raw.weather;
    const old = deserialize(JSON.stringify(raw));
    expect(old.saveVersion).toBe(6);
    expect(old.match?.seasons).toBe('off');
    expect(old.season).toBe('off');
  });

  it('перед зимой ужимает паёк, когда еды мало', () => {
    const state = createGame(3, {
      ai: 1,
      setup: { map: 'small', seasons: 'normal', victory: 'wealth', profiles: [{ difficulty: 'easy', personality: 'merchant' }] },
    });
    const ai = state.players.find((player) => player.isAi)!;
    const keep = playerKeep(state, ai.id)!;
    createBuilding(state, ai.id, 'granary', keep.x + 4, keep.y, true);
    createBuilding(state, ai.id, 'stockpile', keep.x + 4, keep.y + 3, true);
    createBuilding(state, ai.id, 'woodcutter', keep.x - 4, keep.y, true);
    createBuilding(state, ai.id, 'orchard', keep.x + 8, keep.y, true);
    createBuilding(state, ai.id, 'orchard', keep.x + 8, keep.y + 3, true);
    state.people = state.people.filter((person) => person.playerId !== ai.id);
    ai.stocks.wood = 80;
    ai.stocks.apples = 8;
    ai.ration = 'normal';
    state.season = 'autumn';
    state.weather = 'clear';
    expect(planOneAi(state, ai)).toEqual({ kind: 'ration', playerId: ai.id, ration: 'half' });
  });
});
