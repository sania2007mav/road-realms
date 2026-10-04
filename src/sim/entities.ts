import { BUILDINGS } from './balance';
import type { Building, BuildingType, GameState, Mob, MobKind, Ox, Person, Soldier, Weapon } from './types';

export function createBuilding(
  state: GameState,
  playerId: number,
  type: BuildingType,
  x: number,
  y: number,
  complete: boolean,
): Building {
  const def = BUILDINGS[type];
  const hp = def.hp;
  const building: Building = {
    id: state.nextId++,
    playerId,
    type,
    x,
    y,
    complete,
    buildProgress: 0,
    workerIds: [],
    level: 1,
    hp,
    maxHp: hp,
    buffer: 0,
    bufferRes: null,
    input: 0,
    inputRes: null,
    work: 0,
    plague: 0,
    upgrading: false,
    seal: 0,
    ruin: 0,
  };
  state.buildings.push(building);
  return building;
}

export function createPerson(state: GameState, playerId: number, x: number, y: number, anim: number): Person {
  const person: Person = {
    id: state.nextId++,
    playerId,
    x,
    y,
    hp: 22,
    maxHp: 22,
    task: { type: 'idle' },
    cargo: null,
    cargoQty: 0,
    destX: x,
    destY: y,
    destBuildingId: 0,
    flee: false,
    anim,
    idlePhase: anim * 3,
  };
  state.people.push(person);
  return person;
}

const SOLDIER_STATS: Record<Weapon, { hp: number; dmg: number }> = {
  club: { hp: 30, dmg: 5 },
  sword: { hp: 48, dmg: 8 },
  bow: { hp: 22, dmg: 4 },
  engineer: { hp: 24, dmg: 2 },
  ladder: { hp: 26, dmg: 3 },
  ram: { hp: 80, dmg: 6 },
  catapult: { hp: 50, dmg: 4 },
};

export function createSoldier(state: GameState, playerId: number, x: number, y: number, weapon: Weapon): Soldier {
  const stats = SOLDIER_STATS[weapon];
  const soldier: Soldier = {
    id: state.nextId++,
    playerId,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    dmg: stats.dmg,
    weapon,
    order: 'defend',
    raidTargetId: 0,
    anim: state.nextId,
    destX: x,
    destY: y,
    anchorX: x,
    anchorY: y,
    targetKind: 'none',
    targetId: 0,
    waypoints: [],
    waypointI: 0,
  };
  state.soldiers.push(soldier);
  return soldier;
}

export function createOx(state: GameState, playerId: number, buildingId: number, x: number, y: number): Ox {
  const ox: Ox = {
    id: state.nextId++,
    playerId,
    buildingId,
    x,
    y,
    cargo: null,
    cargoQty: 0,
    mode: 'load',
    destX: x,
    destY: y,
    destBuildingId: 0,
  };
  state.oxen.push(ox);
  return ox;
}

const MOB_STATS: Record<MobKind, { hp: number; dmg: number }> = {
  wolf: { hp: 18, dmg: 4 },
  bear: { hp: 42, dmg: 7 },
  bandit: { hp: 28, dmg: 5 },
  deer: { hp: 12, dmg: 0 },
};

export function createMob(state: GameState, kind: MobKind, x: number, y: number): Mob {
  const stats = MOB_STATS[kind];
  const mob: Mob = {
    id: state.nextId++,
    kind,
    x,
    y,
    homeX: x,
    homeY: y,
    hp: stats.hp,
    maxHp: stats.hp,
    dmg: stats.dmg,
    alive: true,
    respawn: 0,
    wander: 10,
    destX: x,
    destY: y,
  };
  state.mobs.push(mob);
  return mob;
}
