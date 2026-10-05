import { hashRoad } from './events';
import { RESOURCES, type GameState } from './types';

/** Stable text for a number. The sim never uses Math.random or Date.now; this only fingerprints the tick state. */
function num(value: number): string {
  if (Object.is(value, -0) || Object.is(value, 0)) return '0';
  if (!Number.isFinite(value)) return 'x';
  return String(value);
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Same string on every client that executed the same commands. Names are included so the lobby roster is part of the check. */
export function hashState(state: GameState): string {
  const parts: string[] = [];
  const match = state.match;
  parts.push(
    `t${state.tick}`,
    `r${state.rng >>> 0}`,
    `n${state.nextId}`,
    `o${state.outcome}`,
    `s${state.seed >>> 0}`,
    `w${state.winnerId ?? -1}`,
    match
      ? `K${match.victory}|${match.timeLimit}|${match.map}|${match.start}|${match.ai}|${match.goldTarget}|${match.popTarget}|${match.surviveMinutes}|${match.teams === 'pairs' ? 'pairs' : 'ffa'}|${match.seasons ?? 'off'}|${state.season ?? 'off'}|${state.weather ?? 'clear'}`
      : 'K',
  );
  const players = [...state.players].sort((a, b) => a.id - b.id);
  for (const player of players) {
    const stocks = RESOURCES.map((res) => num(player.stocks[res] ?? 0)).join(',');
    const stats = player.stats;
    const food = stats ? `${stats.food.apples},${stats.food.cheese},${stats.food.meat},${stats.food.bread}` : '0,0,0,0';
    const tally = stats ? `${stats.peakPop}|${stats.goldEarned}|${stats.buildings}|${stats.soldiers}|${stats.kills}|${stats.razed}|${food}` : '0';
    parts.push(
      `P${player.id}|${player.name}|${player.alive ? 1 : 0}|${player.gold}|${num(player.popularity)}|${player.ration}|${player.tax}|${player.hunger ? 1 : 0}|${player.beerMood}|${player.mail ?? 0}|${player.migrate}|${player.difficulty ?? 'normal'}|${player.personality ?? 'strategist'}|${stocks}|${tally}`,
    );
  }
  const buildings = [...state.buildings].sort((a, b) => a.id - b.id);
  for (const building of buildings) {
    parts.push(
      `B${building.id}|${building.playerId}|${building.type}|${building.x}|${building.y}|${building.complete ? 1 : 0}|${num(building.buildProgress)}|${building.hp}|${building.level}|${building.buffer}|${building.bufferRes ?? ''}|${building.input}|${building.inputRes ?? ''}|${num(building.work)}|${building.plague}|${building.upgrading ? 1 : 0}|${building.gear ?? 0}|${building.seal ?? 0}|${building.ruin ?? 0}|${building.workerIds.join('.')}`,
    );
  }
  const people = [...state.people].sort((a, b) => a.id - b.id);
  for (const person of people) {
    const task = person.task;
    const taskText =
      task.type === 'idle'
        ? 'idle'
        : task.type === 'build'
          ? `build${task.buildingId}`
          : `work${task.buildingId}${task.mode}${task.targetId}`;
    parts.push(
      `U${person.id}|${person.playerId}|${num(person.x)}|${num(person.y)}|${person.hp}|${taskText}|${person.cargo ?? ''}|${person.cargoQty}|${num(person.destX)}|${num(person.destY)}|${person.flee ? 1 : 0}`,
    );
  }
  const soldiers = [...state.soldiers].sort((a, b) => a.id - b.id);
  for (const soldier of soldiers) {
    parts.push(
      `S${soldier.id}|${soldier.playerId}|${num(soldier.x)}|${num(soldier.y)}|${soldier.hp}|${soldier.order}|${soldier.weapon}|${num(soldier.destX)}|${num(soldier.destY)}|${soldier.targetKind}|${soldier.targetId}|${soldier.waypointI}|${soldier.charge ?? 0}|${soldier.armor ?? 0}|${soldier.dock ?? 0}|${soldier.merc ?? 0}`,
    );
  }
  const oxen = [...state.oxen].sort((a, b) => a.id - b.id);
  for (const ox of oxen) {
    parts.push(`O${ox.id}|${ox.playerId}|${num(ox.x)}|${num(ox.y)}|${ox.cargo ?? ''}|${ox.cargoQty}|${ox.mode}|${ox.destBuildingId}`);
  }
  const clouds = [...(state.clouds ?? [])].sort((a, b) => a.id - b.id);
  for (const cloud of clouds) {
    parts.push(`C${cloud.id}|${cloud.playerId}|${num(cloud.x)}|${num(cloud.y)}|${cloud.ticks}|${num(cloud.radius)}`);
  }
  for (const sample of state.samples ?? []) {
    parts.push(`G${sample.t}|${sample.pop.join(',')}|${sample.gold.join(',')}`);
  }
  const mobs = [...state.mobs].sort((a, b) => a.id - b.id);
  for (const mob of mobs) {
    parts.push(
      `M${mob.id}|${mob.kind}|${mob.alive ? 1 : 0}|${num(mob.x)}|${num(mob.y)}|${mob.hp}|${num(mob.destX)}|${num(mob.destY)}|${mob.wander}${mob.raid ? '|raid' : ''}`,
    );
  }
  parts.push(...hashRoad(state));
  const roads = state.roads;
  if (roads) {
    for (let i = 0; i < roads.length; i++) if (roads[i]) parts.push(`R${i}`);
  }
  return fnv(parts.join('\n'));
}
