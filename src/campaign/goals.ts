import { TICKS_PER_GAME_MINUTE } from '../sim/balance';
import { playerKeep } from '../sim/update';
import type { GameState } from '../sim/types';
import type { GoalKind, Scenario } from './types';

export function civilians(state: GameState, playerId = 0): number {
  let count = 0;
  for (const person of state.people) if (person.playerId === playerId && person.hp > 0) count += 1;
  return count;
}

export function minutesOf(state: GameState): number {
  return state.tick / TICKS_PER_GAME_MINUTE;
}

export function goalMet(goal: GoalKind, state: GameState): boolean {
  const player = state.players[0];
  if (!player?.alive) return false;
  if (goal.kind === 'population') return civilians(state) >= goal.count;
  if (goal.kind === 'keep-stone') {
    const keep = playerKeep(state, 0);
    return (keep?.level ?? 0) >= goal.level && (player.stocks.stone ?? 0) >= goal.stone;
  }
  if (goal.kind === 'hold') return state.tick >= goal.minutes * TICKS_PER_GAME_MINUTE;
  if (goal.kind === 'gold-mood') return player.gold >= goal.gold && player.popularity >= goal.mood;
  if (goal.kind === 'bread') return (player.stats?.food.bread ?? 0) >= goal.count;
  if (goal.kind === 'conquest') return state.outcome === 'victory' && state.winnerId === 0;
  if (goal.kind === 'bloom') return state.outcome === 'victory' && state.winnerId === 0;
  return false;
}

export function goalLine(goal: GoalKind, state: GameState): string {
  const player = state.players[0];
  if (!player) return '';
  if (goal.kind === 'population') return `люди ${civilians(state)}/${goal.count}`;
  if (goal.kind === 'keep-stone') {
    const keep = playerKeep(state, 0);
    return `уровень ${keep?.level ?? 0}/${goal.level} · камень ${player.stocks.stone ?? 0}/${goal.stone}`;
  }
  if (goal.kind === 'hold') {
    const left = Math.max(0, goal.minutes - Math.floor(minutesOf(state)));
    return `осталось ${left} мин`;
  }
  if (goal.kind === 'gold-mood') {
    const sign = player.popularity > 0 ? `+${player.popularity}` : String(player.popularity);
    return `золото ${player.gold}/${goal.gold} · настроение ${sign}`;
  }
  if (goal.kind === 'bread') return `хлеб ${player.stats?.food.bread ?? 0}/${goal.count}`;
  if (goal.kind === 'conquest') {
    const standing = state.players.filter((other) => other.alive && other.id !== 0).length;
    return standing === 0 ? 'соседи пали' : `соседей стоит ${standing}`;
  }
  if (goal.kind === 'bloom') {
    const keep = playerKeep(state, 0);
    return `ур. ${keep?.level ?? 0}/4 · люди ${civilians(state)}/12`;
  }
  return '';
}

export function bonusMet(scenario: Scenario, state: GameState): boolean {
  const player = state.players[0];
  if (!player) return false;
  const kind = scenario.bonusKind;
  if (kind === 'orchards') {
    return state.buildings.filter((b) => b.playerId === 0 && b.type === 'orchard' && b.hp > 0).length >= 2;
  }
  if (kind === 'quarry') {
    const quarry = state.buildings.some((b) => b.playerId === 0 && b.type === 'quarry' && b.complete && b.hp > 0 && b.workerIds.length > 0);
    const stock = state.buildings.some((b) => b.playerId === 0 && b.type === 'stockpile' && b.complete && b.hp > 0);
    return quarry && stock;
  }
  if (kind === 'soldiers') return state.soldiers.filter((s) => s.playerId === 0 && s.hp > 0).length >= 2;
  if (kind === 'market') {
    return state.buildings.some((b) => b.playerId === 0 && b.type === 'market' && b.complete && b.hp > 0 && b.workerIds.length > 0);
  }
  if (kind === 'chain') {
    const staffed = (type: 'mill' | 'bakery') =>
      state.buildings.some((b) => b.playerId === 0 && b.type === type && b.complete && b.hp > 0 && b.workerIds.length > 0);
    return staffed('mill') && staffed('bakery');
  }
  if (kind === 'walls') {
    const palisade = state.buildings.filter((b) => b.playerId === 0 && b.type === 'palisade' && b.complete && b.hp > 0).length;
    const tower = state.buildings.some((b) => b.playerId === 0 && b.type === 'woodtower' && b.hp > 0);
    return palisade >= 4 && tower;
  }
  if (kind === 'keep-hp') {
    const keep = playerKeep(state, 0);
    return !!keep && keep.hp >= keep.maxHp * 0.5;
  }
  if (kind === 'mood') return player.popularity >= 0;
  if (kind === 'stores') return civilians(state) >= 4 && (player.stocks.apples ?? 0) >= 8;
  if (kind === 'people') return civilians(state) >= 5;
  return false;
}

export function playerLost(scenario: Scenario, state: GameState): boolean {
  const player = state.players[0];
  if (!player?.alive) return true;
  const keep = playerKeep(state, 0);
  if (!keep || keep.hp <= 0) return true;
  if (state.tick > 0 && civilians(state) <= 0) return true;
  if (scenario.failMinutes > 0 && state.tick >= scenario.failMinutes * TICKS_PER_GAME_MINUTE && !goalMet(scenario.goal, state)) return true;
  return false;
}
