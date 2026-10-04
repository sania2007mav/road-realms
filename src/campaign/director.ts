import { TICKS_PER_GAME_MINUTE, CLOUD_TICKS, CLOUD_RADIUS } from '../sim/balance';
import { createMob, createSoldier } from '../sim/entities';
import { playerKeep } from '../sim/update';
import type { GameState } from '../sim/types';
import { bonusMet, goalMet, playerLost } from './goals';
import { scenarioById } from './scenarios';
import type { CampaignEvent, Scenario } from './types';

export interface CampaignSession {
  id: string;
  fired: boolean[];
  drought: boolean;
}

export function openSession(scenario: Scenario): CampaignSession {
  return { id: scenario.id, fired: scenario.events.map(() => false), drought: false };
}

function log(state: GameState, text: string) {
  if (state.log.includes(text)) return;
  state.log.push(text);
  if (state.log.length > 8) state.log.shift();
}

export function applyEvent(state: GameState, event: CampaignEvent) {
  const keep = playerKeep(state, 0);
  const center = keep ? { x: keep.x + 1, y: keep.y + 1 } : { x: 20, y: 20 };
  if (event.kind === 'log') log(state, event.text);
  if (event.kind === 'caravan') {
    const player = state.players[0];
    if (player) {
      player.gold += event.gold;
      if (player.stats) player.stats.goldEarned += event.gold;
    }
    log(state, event.text);
  }
  if (event.kind === 'wave') {
    const spots = [
      [11, 4],
      [-10, 6],
      [8, -9],
      [-7, -8],
      [12, -2],
      [-12, 2],
    ];
    for (let i = 0; i < event.count; i++) {
      const spot = spots[i % spots.length];
      createMob(state, 'bandit', center.x + spot[0], center.y + spot[1]);
    }
    log(state, event.text);
  }
  if (event.kind === 'raiders') {
    const foe = state.players.find((player) => player.isAi && player.alive);
    const owner = foe?.id ?? 1;
    const toward = Math.sign(state.roadY - center.y) || 1;
    for (let i = 0; i < event.count; i++) {
      const soldier = createSoldier(state, owner, center.x - 4 + i * 1.4, center.y + toward * 12, 'club');
      soldier.order = 'raid';
      soldier.raidTargetId = keep?.id ?? 0;
    }
    log(state, event.text);
  }
  if (event.kind === 'drought') log(state, event.text);
  if (event.kind === 'blight') {
    const player = state.players[0];
    if (player) player.stocks.apples = Math.max(0, (player.stocks.apples ?? 0) - event.apples);
    if (!state.clouds) state.clouds = [];
    state.clouds.push({
      id: state.nextId++,
      playerId: -1,
      x: center.x,
      y: state.roadY,
      ticks: CLOUD_TICKS,
      radius: CLOUD_RADIUS,
    });
    log(state, event.text);
  }
}

function dryFarms(state: GameState) {
  const player = state.players[0];
  if (!player) return;
  for (const resource of ['apples', 'wheat', 'cheese'] as const) {
    player.stocks[resource] = Math.max(0, (player.stocks[resource] ?? 0) - 2);
  }
  for (const building of state.buildings) {
    if (building.playerId !== 0 || building.hp <= 0) continue;
    if (building.type !== 'orchard' && building.type !== 'wheat' && building.type !== 'dairy') continue;
    if (building.buffer > 0) building.buffer = Math.max(0, building.buffer - 2);
    building.work = Math.floor(building.work / 2);
  }
}

/** Client-side campaign rules. Called after step, never from the sim itself. */
export function enact(session: CampaignSession, state: GameState) {
  const scenario = scenarioById(session.id);
  if (!scenario || state.outcome !== 'playing') return;
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  scenario.events.forEach((event, index) => {
    if (session.fired[index] || minute < event.minute) return;
    session.fired[index] = true;
    if (event.kind === 'drought') session.drought = event.on;
    applyEvent(state, event);
  });
  if (session.drought && state.tick > 0 && state.tick % TICKS_PER_GAME_MINUTE === 0) dryFarms(state);
  if (state.outcome !== 'playing') return;
  if (playerLost(scenario, state)) {
    state.outcome = 'defeat';
    state.winnerId = -1;
    return;
  }
  if (scenario.goal.kind !== 'conquest' && scenario.goal.kind !== 'bloom' && goalMet(scenario.goal, state)) {
    state.outcome = 'victory';
    state.winnerId = 0;
  }
}

export function scenarioBonus(session: CampaignSession, state: GameState): boolean {
  const scenario = scenarioById(session.id);
  if (!scenario) return false;
  return bonusMet(scenario, state);
}
