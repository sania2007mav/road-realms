import { BUILDINGS, KEEP_UPGRADE_COST, TRAIN_COST, TICKS_PER_GAME_MINUTE } from '../sim/balance';
import { bloomCommand } from '../sim/measure';
import { canPlace, idleCount, playerKeep, suggestedTile } from '../sim/update';
import type { BuildingType, Command, GameState, Resource, Weapon } from '../sim/types';
import { civilians } from './goals';
import type { BotPlan } from './types';

function countOf(state: GameState, type: BuildingType): number {
  let count = 0;
  for (const building of state.buildings) {
    if (building.playerId === 0 && building.type === type && building.hp > 0) count += 1;
  }
  return count;
}

function openSites(state: GameState): number {
  let count = 0;
  for (const building of state.buildings) {
    if (building.playerId !== 0 || building.hp <= 0) continue;
    if (!building.complete || building.upgrading) count += 1;
  }
  return count;
}

function affordable(stocks: GameState['players'][number]['stocks'], cost: Partial<Record<Resource, number>> | undefined): boolean {
  if (!cost) return true;
  for (const key of Object.keys(cost) as Resource[]) {
    if ((cost[key] ?? 0) > (stocks[key] ?? 0)) return false;
  }
  return true;
}

function place(state: GameState, type: BuildingType): Command | null {
  const player = state.players[0];
  if (!player) return null;
  const keep = playerKeep(state, 0);
  if ((BUILDINGS[type].keepLevel ?? 1) > (keep?.level ?? 1)) return null;
  if (!affordable(player.stocks, BUILDINGS[type].cost)) return null;
  const tile = suggestedTile(state, 0, type);
  if (!tile || !canPlace(state, 0, type, tile.x, tile.y).ok) return null;
  return { kind: 'place', playerId: 0, building: type, x: tile.x, y: tile.y };
}

function gateSpot(state: GameState, radius: number): { x: number; y: number } | null {
  const keep = playerKeep(state, 0);
  if (!keep) return null;
  const toward = Math.sign(state.roadY - (keep.y + 1)) || 1;
  return { x: keep.x + 1, y: keep.y + 1 + toward * radius };
}

function ringPlace(state: GameState, radius: number, type: BuildingType, skip: { x: number; y: number } | null): Command | null {
  const player = state.players[0];
  const keep = playerKeep(state, 0);
  if (!player || !keep) return null;
  if (!affordable(player.stocks, BUILDINGS[type].cost)) return null;
  const cx = keep.x + 1;
  const cy = keep.y + 1;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
      if (skip && x === skip.x && y === skip.y) continue;
      if (canPlace(state, 0, type, x, y).ok) return { kind: 'place', playerId: 0, building: type, x, y };
    }
  }
  return null;
}

function staff(state: GameState): Command | null {
  if (idleCount(state, 0) <= openSites(state)) return null;
  const site = state.buildings.find((building) => {
    if (building.playerId !== 0 || !building.complete || building.hp <= 0) return false;
    return building.workerIds.length < BUILDINGS[building.type].workers;
  });
  if (!site) return null;
  return { kind: 'assign', playerId: 0, buildingId: site.id, delta: 1 };
}

function nearestFoeKeep(state: GameState) {
  const home = playerKeep(state, 0);
  let best: GameState['buildings'][number] | null = null;
  let bestD = Infinity;
  for (const building of state.buildings) {
    if (building.type !== 'keep' || building.playerId === 0 || building.hp <= 0) continue;
    const d = Math.hypot(building.x - (home?.x ?? 0), building.y - (home?.y ?? 0));
    if (d < bestD) {
      best = building;
      bestD = d;
    }
  }
  return best;
}

function hallOf(weapon: Weapon): BuildingType {
  if (weapon === 'healer') return 'chapel';
  if (weapon === 'siegetower') return 'workshop';
  if (weapon === 'ram' || weapon === 'catapult' || weapon === 'engineer' || weapon === 'ladder') return 'guild';
  return 'barracks';
}

export function botCommand(plan: BotPlan, state: GameState): Command | null {
  if (plan.bloom) return bloomCommand(state);
  const player = state.players[0];
  if (!player?.alive) return null;
  if (plan.tax && player.tax !== plan.tax) return { kind: 'tax', playerId: 0, tax: plan.tax };
  if (plan.ration && player.ration !== plan.ration) return { kind: 'ration', playerId: 0, ration: plan.ration };
  const worker = staff(state);
  if (worker) return worker;

  if (plan.sell) {
    const market = state.buildings.find((b) => b.playerId === 0 && b.type === 'market' && b.complete && b.hp > 0 && b.workerIds.length > 0);
    const have = player.stocks[plan.sell.resource] ?? 0;
    if (market && have > plan.sell.above) {
      return { kind: 'market', playerId: 0, resource: plan.sell.resource, mode: 'sell', qty: Math.min(10, have - plan.sell.above) };
    }
  }

  const waiting = plan.buildings.some((step) => step.beforeUpgrade && countOf(state, step.type) < step.max);
  if (!waiting && plan.upgradeTo) {
    const keep = playerKeep(state, 0);
    if (keep && keep.level < plan.upgradeTo && !keep.upgrading) {
      const cost = KEEP_UPGRADE_COST[keep.level];
      if (cost && affordable(player.stocks, cost)) return { kind: 'upgrade', playerId: 0, buildingId: keep.id };
    }
  }

  for (const step of plan.buildings) {
    if (countOf(state, step.type) >= step.max) continue;
    const command = place(state, step.type);
    if (command) return command;
  }

  const gate = plan.gate ? gateSpot(state, plan.ring ?? 5) : null;
  if (plan.ring && countOf(state, 'palisade') < 8) {
    for (const radius of [plan.ring, plan.ring - 1, plan.ring + 1]) {
      if (radius < 3) continue;
      const command = ringPlace(state, radius, 'palisade', gate);
      if (command) return command;
    }
  }
  if (plan.gate && gate && countOf(state, 'gate') < 1 && countOf(state, 'palisade') >= 4) {
    if (affordable(player.stocks, BUILDINGS.gate.cost) && canPlace(state, 0, 'gate', gate.x, gate.y).ok) {
      return { kind: 'place', playerId: 0, building: 'gate', x: gate.x, y: gate.y };
    }
  }
  if (plan.tower && countOf(state, 'woodtower') < 1 && countOf(state, 'palisade') >= 4) {
    const command = place(state, 'woodtower');
    if (command) return command;
  }
  for (const step of plan.later ?? []) {
    if (countOf(state, step.type) >= step.max) continue;
    const command = place(state, step.type);
    if (command) return command;
  }

  for (const step of plan.train ?? []) {
    const have = state.soldiers.filter((s) => s.playerId === 0 && s.hp > 0 && s.weapon === step.weapon).length;
    if (have >= step.count) continue;
    const hall = hallOf(step.weapon);
    const yard = state.buildings.some((b) => b.playerId === 0 && b.type === hall && b.complete && b.hp > 0);
    const ready =
      yard && affordable(player.stocks, TRAIN_COST[step.weapon]) && idleCount(state, 0) > 0 && civilians(state) > step.keepPeople;
    if (!ready) {
      if (step.weapon === 'ram' || step.weapon === 'catapult') return null;
      continue;
    }
    return { kind: 'train', playerId: 0, weapon: step.weapon };
  }

  if (plan.attack === 'raid') {
    const soldiers = state.soldiers.filter((s) => s.playerId === 0 && s.hp > 0);
    if (plan.attackWeapon && !soldiers.some((s) => s.weapon === plan.attackWeapon)) return null;
    if (soldiers.length < (plan.attackSoldiers ?? 1)) return null;
    if (state.tick < (plan.attackMinute ?? 0) * TICKS_PER_GAME_MINUTE) return null;
    const waiting = soldiers.filter((s) => s.order !== 'raid' && s.order !== 'attack');
    if (!waiting.length) return null;
    if (soldiers.some((s) => s.order === 'raid' || s.order === 'attack')) {
      const foe = nearestFoeKeep(state);
      if (!foe) return null;
      return {
        kind: 'army',
        playerId: 0,
        ids: waiting.map((s) => s.id),
        mode: 'attack',
        x: foe.x + 1,
        y: foe.y + 1,
        target: 'building',
        targetId: foe.id,
      };
    }
    return { kind: 'order', playerId: 0, order: 'raid' };
  }
  return null;
}
