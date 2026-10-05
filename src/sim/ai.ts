import {
  AXE_GOLD,
  BUILDINGS,
  KEEP_UPGRADE_COST,
  PRICES,
  RAIDER_GOLD,
  TICKS_PER_GAME_MINUTE,
  TRAIN_COST,
  TRAIN_GOLD,
  foodTypesIn,
} from './balance';
import { totalFood } from './economy';
import { bloomKeepLevel, hostile, personalityName, scoreOf } from './match';
import { nextAiSiege } from './siege';
import type { Building, BuildingType, Command, DifficultyId, GameState, Player, Soldier, TaxId, Weapon } from './types';
import { canPlace, housingCap, idleCount, playerKeep, suggestedTile } from './update';

/**
 * Decisions read the shared sim and issue the same commands a player would.
 * The only randomness is the sim's seeded RNG, and this planner does not draw it:
 * the same state always yields the same command.
 *
 * Difficulty changes how often planAi asks, how tightly resources are spent,
 * and when an army is allowed to march. «Жестокий» also receives
 * CRUEL_GOLD_PER_MINUTE gold at each game minute. No other difficulty adds resources.
 */

export function reactionTicks(difficulty: DifficultyId | undefined): number {
  if (difficulty === 'easy') return 80;
  if (difficulty === 'hard') return 20;
  if (difficulty === 'cruel') return 10;
  return 40;
}

const FORTS = new Set<BuildingType>(['palisade', 'wall', 'gate', 'woodtower', 'stonetower']);

function afford(stocks: Player['stocks'], cost: Partial<Record<string, number>> | undefined): boolean {
  if (!cost) return true;
  for (const key of Object.keys(cost)) {
    const need = cost[key] ?? 0;
    if (need > 0 && (stocks[key as keyof Player['stocks']] ?? 0) < need) return false;
  }
  return true;
}

function countOf(state: GameState, playerId: number, type: BuildingType): number {
  let count = 0;
  for (const building of state.buildings) {
    if (building.playerId === playerId && building.type === type && building.hp > 0) count += 1;
  }
  return count;
}

function place(state: GameState, playerId: number, type: BuildingType): Command | null {
  const tile = suggestedTile(state, playerId, type);
  if (!tile || !canPlace(state, playerId, type, tile.x, tile.y).ok) return null;
  return { kind: 'place', playerId, building: type, x: tile.x, y: tile.y };
}

function peopleOf(state: GameState, playerId: number): number {
  let count = 0;
  for (const person of state.people) if (person.playerId === playerId && person.hp > 0) count += 1;
  return count;
}

function soldiersOf(state: GameState, playerId: number) {
  return state.soldiers.filter((soldier) => soldier.playerId === playerId && soldier.hp > 0).sort((a, b) => a.id - b.id);
}

function staff(state: GameState, player: Player): Command | null {
  if (idleCount(state, player.id) <= 0) return null;
  const building = state.buildings.find((site) => {
    if (site.playerId !== player.id || !site.complete || site.hp <= 0) return false;
    const workers = BUILDINGS[site.type].workers;
    return workers > 0 && site.workerIds.length < workers;
  });
  if (!building) return null;
  return { kind: 'assign', playerId: player.id, buildingId: building.id, delta: 1 };
}

function chooseRation(state: GameState, player: Player): Command | null {
  const people = Math.max(1, peopleOf(state, player.id));
  const food = totalFood(player.stocks);
  const per = food / people;
  const types = foodTypesIn(player.stocks);
  let ration = player.ration;
  if (player.hunger || per < 6) ration = 'half';
  else if (types >= 2 && per > 18) ration = 'double';
  else if (per > 8) ration = 'normal';
  else ration = 'half';
  if (player.difficulty === 'easy' && ration === 'double') ration = 'normal';
  if (ration === player.ration) return null;
  return { kind: 'ration', playerId: player.id, ration };
}

function chooseTax(state: GameState, player: Player): Command | null {
  const pop = player.popularity;
  const victory = state.match?.victory;
  const merchant = player.personality === 'merchant' || victory === 'wealth';
  let tax: TaxId = 'low';
  if (pop < 0) tax = 'none';
  else if (player.difficulty === 'easy') tax = pop >= 28 ? 'normal' : 'low';
  else if (merchant && pop >= 18) tax = player.difficulty === 'cruel' && pop >= 36 ? 'harsh' : 'high';
  else if (pop >= (player.difficulty === 'cruel' ? 16 : 25)) tax = 'high';
  else if (pop >= (player.difficulty === 'cruel' ? 8 : 12)) tax = 'normal';
  else if (player.personality === 'warlord' && pop < 8) tax = 'none';
  if (tax === player.tax) return null;
  return { kind: 'tax', playerId: player.id, tax };
}

function headroomWanted(player: Player, victory: string | undefined): number {
  if (victory === 'bloom' || player.personality === 'builder') return 4;
  if (player.personality === 'warlord') return 1;
  return 2;
}

function housing(state: GameState, player: Player): Command | null {
  const victory = state.match?.victory;
  const cap = housingCap(state, player.id);
  const people = peopleOf(state, player.id);
  if (cap - people >= headroomWanted(player, victory)) return null;
  const ladder: BuildingType[] = ['shack', 'cabin', 'house', 'khrush', 'highrise'];
  if (victory === 'bloom' || player.personality === 'builder') ladder.reverse();
  for (const type of ladder) {
    const command = place(state, player.id, type);
    if (command) return command;
  }
  return null;
}

function upgradeKeep(state: GameState, player: Player): Command | null {
  const keep = playerKeep(state, player.id);
  if (!keep || keep.upgrading || keep.level >= 5) return null;
  const cost = KEEP_UPGRADE_COST[keep.level];
  if (!cost || !afford(player.stocks, cost)) return null;
  const victory = state.match?.victory;
  const eager = victory === 'bloom' || player.personality === 'builder' || player.difficulty === 'cruel' || player.difficulty === 'hard';
  if (!eager && (player.stocks.wood ?? 0) < (cost.wood ?? 0) + 2) return null;
  return { kind: 'upgrade', playerId: player.id, buildingId: keep.id };
}

function trade(state: GameState, player: Player): Command | null {
  const market = state.buildings.find(
    (building) => building.playerId === player.id && building.type === 'market' && building.complete && building.hp > 0 && building.workerIds.length > 0,
  );
  if (!market) return null;
  const people = Math.max(1, peopleOf(state, player.id));
  const food = totalFood(player.stocks);
  if (food < people * 6 && player.gold >= PRICES.apples.buy) {
    return { kind: 'market', playerId: player.id, resource: 'apples', mode: 'buy', qty: 1 };
  }
  if ((player.stocks.wood ?? 0) < 8 && player.gold >= PRICES.wood.buy) {
    return { kind: 'market', playerId: player.id, resource: 'wood', mode: 'buy', qty: 1 };
  }
  if ((player.stocks.stone ?? 0) < 4 && player.gold >= PRICES.stone.buy && countOf(state, player.id, 'quarry') === 0) {
    return { kind: 'market', playerId: player.id, resource: 'stone', mode: 'buy', qty: 1 };
  }
  if ((player.stocks.wood ?? 0) > 48) return { kind: 'market', playerId: player.id, resource: 'wood', mode: 'sell', qty: 1 };
  if (food > people * 24 && (player.stocks.apples ?? 0) > 40) {
    return { kind: 'market', playerId: player.id, resource: 'apples', mode: 'sell', qty: 1 };
  }
  if (state.match?.victory === 'wealth' && (player.stocks.stone ?? 0) > 24) {
    return { kind: 'market', playerId: player.id, resource: 'stone', mode: 'sell', qty: 1 };
  }
  return null;
}

function ringTiles(keep: Building, radius: number): { x: number; y: number }[] {
  const cx = keep.x + 1;
  const cy = keep.y + 1;
  const tiles: { x: number; y: number }[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
      tiles.push({ x, y });
    }
  }
  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}

function wallCommand(state: GameState, player: Player): Command | null {
  const keep = playerKeep(state, player.id);
  if (!keep || keep.level < 2) return null;
  const victory = state.match?.victory;
  const early = player.personality === 'builder' || victory === 'survival';
  const wait =
    player.personality === 'warlord' ? 3200 : player.personality === 'merchant' ? 2800 : early ? 0 : 1800;
  const delay = player.difficulty === 'easy' ? 800 : player.difficulty === 'cruel' ? 0 : 0;
  if (state.tick < wait + delay) return null;
  const ring = ringTiles(keep, 5);
  if (!ring.length) return null;
  const gateTile = ring.reduce((best, tile) => (tile.y > best.y || (tile.y === best.y && tile.x < best.x) ? tile : best), ring[0]);
  const palisades = countOf(state, player.id, 'palisade');
  const want = player.personality === 'builder' ? 14 : victory === 'survival' ? 12 : 8;
  if (palisades < want) {
    for (const tile of ring) {
      if (tile.x === gateTile.x && tile.y === gateTile.y) continue;
      if (canPlace(state, player.id, 'palisade', tile.x, tile.y).ok) {
        return { kind: 'place', playerId: player.id, building: 'palisade', x: tile.x, y: tile.y };
      }
    }
  }
  if (countOf(state, player.id, 'gate') < 1 && palisades >= 6 && canPlace(state, player.id, 'gate', gateTile.x, gateTile.y).ok) {
    return { kind: 'place', playerId: player.id, building: 'gate', x: gateTile.x, y: gateTile.y };
  }
  const towers = player.personality === 'builder' ? 3 : 2;
  if (countOf(state, player.id, 'woodtower') < towers) {
    const spots = [
      { x: keep.x - 3, y: keep.y - 3 },
      { x: keep.x + 4, y: keep.y - 3 },
      { x: keep.x - 3, y: keep.y + 4 },
    ];
    for (const spot of spots) {
      if (canPlace(state, player.id, 'woodtower', spot.x, spot.y).ok) {
        return { kind: 'place', playerId: player.id, building: 'woodtower', x: spot.x, y: spot.y };
      }
    }
  }
  return null;
}

function stockForWinter(state: GameState, player: Player): Command | null {
  if (state.season !== 'summer' && state.season !== 'autumn') return null;
  const id = player.id;
  if ((player.stocks.wood ?? 0) < 30 && countOf(state, id, 'woodcutter') < 2) {
    const hut = place(state, id, 'woodcutter');
    if (hut) return hut;
  }
  const food = (player.stocks.apples ?? 0) + (player.stocks.cheese ?? 0) + (player.stocks.meat ?? 0) + (player.stocks.bread ?? 0);
  if (food < 48 && countOf(state, id, 'orchard') < 2) {
    const trees = place(state, id, 'orchard');
    if (trees) return trees;
  }
  if (state.season === 'autumn' && food < 24 && player.ration !== 'half' && player.ration !== 'none') {
    return { kind: 'ration', playerId: id, ration: 'half' };
  }
  return null;
}

function economyCommand(state: GameState, player: Player): Command | null {
  const id = player.id;
  const victory = state.match?.victory;
  const assigned = staff(state, player);
  if (assigned) return assigned;
  if (countOf(state, id, 'granary') === 0) return place(state, id, 'granary');
  if (countOf(state, id, 'orchard') === 0) return place(state, id, 'orchard');
  if (countOf(state, id, 'stockpile') === 0) return place(state, id, 'stockpile');
  if (countOf(state, id, 'woodcutter') === 0) return place(state, id, 'woodcutter');

  const winter = stockForWinter(state, player);
  if (winter) return winter;

  const ration = chooseRation(state, player);
  if (ration) return ration;
  const tax = chooseTax(state, player);
  if (tax) return tax;

  if ((player.stocks.stone ?? 0) < 16 && countOf(state, id, 'quarry') === 0) {
    const quarry = place(state, id, 'quarry');
    if (quarry) return quarry;
  }

  const keep = upgradeKeep(state, player);
  const levelNow = playerKeep(state, id)?.level ?? 1;
  if (keep && levelNow < 2) return keep;

  const rooms = housing(state, player);
  if (rooms) return rooms;

  if (keep && (victory === 'bloom' || player.personality === 'builder')) return keep;

  if (foodTypesIn(player.stocks) < 2 && countOf(state, id, 'hunter') === 0) {
    const hunter = place(state, id, 'hunter');
    if (hunter) return hunter;
  }

  if (victory === 'survival' || player.personality === 'builder') {
    const walls = wallCommand(state, player);
    if (walls) return walls;
  }

  if (keep) return keep;

  if (player.personality === 'merchant' || victory === 'wealth') {
    if (countOf(state, id, 'market') === 0) {
      const market = place(state, id, 'market');
      if (market) return market;
    }
    const deal = trade(state, player);
    if (deal) return deal;
  }

  if (foodTypesIn(player.stocks) < 3 && countOf(state, id, 'wheat') === 0) {
    const wheat = place(state, id, 'wheat');
    if (wheat) return wheat;
  }
  if (countOf(state, id, 'wheat') > 0 && countOf(state, id, 'mill') === 0) {
    const mill = place(state, id, 'mill');
    if (mill) return mill;
  }
  if (countOf(state, id, 'mill') > 0 && countOf(state, id, 'bakery') === 0) {
    const bakery = place(state, id, 'bakery');
    if (bakery) return bakery;
  }
  if (countOf(state, id, 'dairy') === 0 && (player.personality === 'merchant' || foodTypesIn(player.stocks) < 3)) {
    const dairy = place(state, id, 'dairy');
    if (dairy) return dairy;
  }
  if (countOf(state, id, 'market') === 0 && (player.stocks.wood ?? 0) > 40) {
    const market = place(state, id, 'market');
    if (market) return market;
  }
  const deal = trade(state, player);
  if (deal) return deal;
  const keepLevel = playerKeep(state, id)?.level ?? 1;
  if (keepLevel >= 2 && countOf(state, id, 'mine') === 0 && (player.stocks.iron ?? 0) < 4) {
    const mine = place(state, id, 'mine');
    if (mine) return mine;
  }
  if (player.personality !== 'warlord') {
    const walls = wallCommand(state, player);
    if (walls) return walls;
  }
  return supplyCommand(state, player);
}

function supplyCommand(state: GameState, player: Player): Command | null {
  if (player.personality !== 'warlord' && player.personality !== 'strategist') return null;
  if (soldiersOf(state, player.id).length < 3) return null;
  if ((playerKeep(state, player.id)?.level ?? 1) < 2) return null;
  if (countOf(state, player.id, 'armoury') === 0) return place(state, player.id, 'armoury');
  const ironReady = (player.stocks.iron ?? 0) > 0 || countOf(state, player.id, 'mine') > 0;
  if (ironReady && countOf(state, player.id, 'smith') === 0) return place(state, player.id, 'smith');
  const fodder = (player.stocks.apples ?? 0) > 8 || (player.stocks.wheat ?? 0) > 0;
  if (fodder && countOf(state, player.id, 'stable') === 0) return place(state, player.id, 'stable');
  return null;
}

function centerOf(building: Building): { x: number; y: number } {
  const def = BUILDINGS[building.type];
  return { x: building.x + def.w / 2, y: building.y + def.h / 2 };
}

function leaderId(state: GameState, self: number): number {
  let best = -1;
  let bestScore = -1;
  for (const player of state.players) {
    if (!player.alive || !hostile(state, player.id, self)) continue;
    const value = scoreOf(state, player);
    if (best < 0 || value > bestScore || (value === bestScore && player.id < best)) {
      best = player.id;
      bestScore = value;
    }
  }
  return best;
}

function threatened(state: GameState, player: Player): boolean {
  const keep = playerKeep(state, player.id);
  if (!keep) return false;
  const center = centerOf(keep);
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || !hostile(state, soldier.playerId, player.id)) continue;
    if (!state.players[soldier.playerId]?.alive) continue;
    if (Math.hypot(soldier.x - center.x, soldier.y - center.y) < 12) return true;
  }
  return false;
}

function losing(state: GameState, player: Player): boolean {
  const mine = soldiersOf(state, player.id);
  const out = mine.filter((soldier) => soldier.order === 'raid' || soldier.order === 'attack' || soldier.order === 'attackmove' || soldier.order === 'move');
  if (!out.length) return false;
  let own = 0;
  let foe = 0;
  for (const soldier of out) own += soldier.hp;
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.playerId === player.id) continue;
    if (!out.some((unit) => Math.hypot(unit.x - soldier.x, unit.y - soldier.y) < 8)) continue;
    foe += soldier.hp;
  }
  return foe > own * 1.15;
}

function repairWall(state: GameState, player: Player): boolean {
  const damaged = state.buildings
    .filter((building) => building.playerId === player.id && building.complete && building.hp > 0 && FORTS.has(building.type) && building.hp < building.maxHp * 0.7)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)[0];
  if (!damaged) return false;
  const stonework = damaged.type === 'wall' || damaged.type === 'stonetower';
  if (stonework) {
    if ((player.stocks.stone ?? 0) < 6) return false;
    player.stocks.stone -= 1;
  } else {
    if ((player.stocks.wood ?? 0) < 16) return false;
    player.stocks.wood -= 1;
  }
  damaged.hp = Math.min(damaged.maxHp, damaged.hp + 24);
  return true;
}

function groupSize(player: Player): number {
  if (player.personality === 'merchant') return 2;
  if (player.personality === 'warlord') {
    if (player.difficulty === 'hard' || player.difficulty === 'cruel') return 4;
    return 3;
  }
  return Math.max(3, trainCap(player) - 1);
}

function attackTick(player: Player): number {
  const base =
    player.personality === 'warlord' ? 780 : player.personality === 'strategist' ? 1200 : player.personality === 'builder' ? 1500 : 1400;
  const scale = player.difficulty === 'easy' ? 1.8 : player.difficulty === 'hard' ? 0.7 : player.difficulty === 'cruel' ? 0.4 : 1;
  return Math.floor(base * scale);
}

function enemyWeapons(state: GameState, victim: number) {
  let infantry = 0;
  let archers = 0;
  let walls = 0;
  let cavalry = 0;
  let spears = 0;
  let swords = 0;
  let heavies = 0;
  let crossbows = 0;
  for (const soldier of state.soldiers) {
    if (soldier.playerId !== victim || soldier.hp <= 0) continue;
    if (soldier.weapon === 'bow') archers += 1;
    else if (soldier.weapon === 'horsebow') {
      archers += 1;
      cavalry += 1;
    } else if (soldier.weapon === 'crossbow') crossbows += 1;
    else if (soldier.weapon === 'spear') spears += 1;
    else if (soldier.weapon === 'light') cavalry += 1;
    else if (soldier.weapon === 'heavy') {
      cavalry += 1;
      heavies += 1;
    } else if (soldier.weapon === 'sword') {
      swords += 1;
      infantry += 1;
    } else if (soldier.weapon !== 'ram' && soldier.weapon !== 'catapult') infantry += 1;
  }
  for (const building of state.buildings) {
    if (building.playerId !== victim || building.hp <= 0) continue;
    if (building.type === 'palisade' || building.type === 'wall' || building.type === 'gate' || building.type === 'stonetower') walls += 1;
  }
  return { infantry, archers, walls, cavalry, spears, swords, heavies, crossbows };
}

function canTrain(player: Player, weapon: Weapon): boolean {
  return afford(player.stocks, TRAIN_COST[weapon]) && player.gold >= (TRAIN_GOLD[weapon] ?? 0);
}

/** What this personality would train against the army it can see. */
export function pickWeapon(state: GameState, player: Player, victim: number): Weapon {
  return desiredWeapon(state, player, victim);
}

function desiredWeapon(state: GameState, player: Player, victim: number): Weapon {
  const seen = enemyWeapons(state, victim);
  if (player.personality === 'merchant') {
    if (seen.cavalry >= 2 && canTrain(player, 'spear')) return 'spear';
    return 'club';
  }
  if (player.personality === 'warlord' && (player.stocks.horses ?? 0) >= 1 && soldiersOf(state, player.id).length >= 2) {
    if (seen.spears >= 2 && canTrain(player, 'bow')) return 'bow';
    if (seen.crossbows >= 2 && canTrain(player, 'spear')) return 'spear';
    if (seen.spears < 2 && (seen.swords >= 2 || seen.archers >= 2) && canTrain(player, 'horsebow')) return 'horsebow';
    if (seen.spears < 2 && canTrain(player, 'heavy')) return 'heavy';
    if (canTrain(player, 'light')) return 'light';
  }
  if (seen.cavalry >= 2 && seen.spears < seen.cavalry && canTrain(player, 'spear')) return 'spear';
  if (player.personality === 'strategist') {
    if (seen.swords + seen.heavies >= 2 && canTrain(player, 'crossbow')) return 'crossbow';
    if ((seen.archers >= 2 || seen.crossbows >= 2) && canTrain(player, 'shield')) return 'shield';
    if (seen.spears > seen.archers && seen.spears > 0 && canTrain(player, 'bow')) return 'bow';
    if (seen.archers > seen.infantry && seen.archers > 0 && canTrain(player, 'sword')) return 'sword';
  }
  const have = (weapon: Weapon) => soldiersOf(state, player.id).some((soldier) => soldier.weapon === weapon);
  if (seen.walls >= 6) {
    if ((player.personality === 'builder' || player.personality === 'strategist') && !have('engineer') && canTrain(player, 'engineer')) return 'engineer';
    if (!have('ram')) return 'ram';
    if (!have('catapult')) return 'catapult';
    if ((player.personality === 'builder' || player.personality === 'strategist') && !have('ladder') && canTrain(player, 'ladder')) return 'ladder';
    if ((player.personality === 'builder' || player.personality === 'strategist') && !have('siegetower') && canTrain(player, 'siegetower')) return 'siegetower';
  }
  if (seen.archers > seen.infantry && seen.archers > 0) return 'sword';
  if (seen.infantry > seen.archers) return 'bow';
  const mine = soldiersOf(state, player.id);
  if (mine.filter((soldier) => soldier.weapon === 'club').length < 2) return 'club';
  return player.personality === 'builder' ? 'bow' : 'club';
}

function trainCap(player: Player): number {
  if (player.difficulty === 'easy') return 3;
  if (player.difficulty === 'hard') return 7;
  if (player.difficulty === 'cruel') return 8;
  return 5;
}

function freeHand(state: GameState, player: Player): Command | null {
  const order: BuildingType[] = ['hunter', 'dairy', 'wheat', 'hop', 'market', 'mine', 'pitch', 'mill', 'bakery', 'brewery'];
  for (const type of order) {
    const building = state.buildings.find((site) => site.playerId === player.id && site.type === type && site.hp > 0 && site.workerIds.length > 0);
    if (!building) continue;
    return { kind: 'assign', playerId: player.id, buildingId: building.id, delta: -1 };
  }
  return null;
}

function trainCommand(state: GameState, player: Player, victim: number): Command | null {
  const barracks = state.buildings.find((building) => building.playerId === player.id && building.type === 'barracks' && building.complete && building.hp > 0);
  if (!barracks) {
    if (player.personality === 'merchant' && state.match?.victory !== 'conquest') return null;
    return place(state, player.id, 'barracks');
  }
  if (idleCount(state, player.id) < 1) return freeHand(state, player);
  const cap = player.personality === 'merchant' ? Math.min(2, trainCap(player)) : trainCap(player);
  if (soldiersOf(state, player.id).length >= cap) return null;
  const weapon = desiredWeapon(state, player, victim);
  if (!canTrain(player, weapon)) {
    if (weapon !== 'club' && afford(player.stocks, TRAIN_COST.club)) {
      return { kind: 'train', playerId: player.id, weapon: 'club' };
    }
    return null;
  }
  return { kind: 'train', playerId: player.id, weapon };
}

function weakBuilding(state: GameState, victim: number): Building | null {
  const sites = state.buildings.filter((building) => building.playerId === victim && building.hp > 0 && building.complete);
  const defended = (building: Building) => {
    const spot = centerOf(building);
    return state.soldiers.some(
      (soldier) => soldier.playerId === victim && soldier.hp > 0 && Math.hypot(soldier.x - spot.x, soldier.y - spot.y) < 5,
    );
  };
  const order: BuildingType[] = ['granary', 'orchard', 'wheat', 'dairy', 'hunter', 'bakery', 'mill'];
  for (const type of order) {
    const open = sites.filter((building) => building.type === type && !defended(building)).sort((a, b) => a.hp - b.hp || a.id - b.id);
    if (open[0]) return open[0];
  }
  const walls = sites
    .filter((building) => building.type === 'palisade' || building.type === 'wall' || building.type === 'gate')
    .sort((a, b) => a.hp - b.hp || a.id - b.id);
  if (walls[0]) return walls[0];
  return sites.find((building) => building.type === 'keep') ?? null;
}

function threaten(state: GameState, player: Player, victim: number) {
  const who = personalityName(player.personality);
  const target = state.players[victim];
  const line = target && !target.isAi ? `${who} угрожает вам` : `${who} угрожает: ${target?.name ?? 'соседу'}`;
  if (state.log.includes(line)) return;
  state.log.push(line);
  if (state.log.length > 8) state.log.shift();
}

function army(playerId: number, ids: number[], mode: 'move' | 'home' | 'attack', x: number, y: number, targetId = 0): Command {
  return {
    kind: 'army',
    playerId,
    ids,
    mode,
    x,
    y,
    target: mode === 'attack' ? 'building' : 'none',
    targetId: mode === 'attack' ? targetId : 0,
  };
}

function readyHealer(state: GameState, player: Player, mine: Soldier[]): boolean {
  if (player.personality !== 'warlord' || state.tick < 2400 || mine.length < 4) return false;
  const chapel = state.buildings.find((building) => building.playerId === player.id && building.type === 'chapel' && building.hp > 0);
  const healers = mine.filter((soldier) => soldier.weapon === 'healer').length;
  return Boolean(chapel?.complete && healers < 1 && idleCount(state, player.id) >= 1 && canTrain(player, 'healer'));
}

function militaryCommand(state: GameState, player: Player): Command | null {
  const id = player.id;
  if (state.match?.victory === 'bloom' && player.personality !== 'warlord') {
    const need = bloomKeepLevel(state.match.popTarget);
    const level = playerKeep(state, id)?.level ?? 1;
    if (level < need) return null;
  }
  const mine = soldiersOf(state, id);
  const victim = leaderId(state, id);
  if (victim < 0) return null;
  const group = groupSize(player);
  if (mine.length < group) {
    const trained = trainCommand(state, player, victim);
    if (trained) return trained;
    if (mine.length >= 1 && mine[0].order === 'defend' && state.tick >= Math.floor(attackTick(player) * 0.45)) {
      const foe = playerKeep(state, victim);
      if (foe) {
        const spot = centerOf(foe);
        const home = playerKeep(state, id);
        const hx = home ? centerOf(home).x : spot.x;
        const hy = home ? centerOf(home).y : spot.y;
        const dx = hx - spot.x;
        const dy = hy - spot.y;
        const dist = Math.hypot(dx, dy) || 1;
        return army(id, [mine[0].id], 'move', spot.x + (dx / dist) * 8, spot.y + (dy / dist) * 8);
      }
    }
    return nextAiSiege(state, player, canPlace, afford, idleCount(state, id));
  }

  if (readyHealer(state, player, mine)) return { kind: 'train', playerId: id, weapon: 'healer' };

  if (state.tick < attackTick(player)) {
    return trainCommand(state, player, victim) ?? wallCommand(state, player);
  }

  let sx = 0;
  let sy = 0;
  for (const soldier of mine) {
    sx += soldier.x;
    sy += soldier.y;
  }
  sx /= mine.length;
  sy /= mine.length;
  let spread = 0;
  for (const soldier of mine) spread = Math.max(spread, Math.hypot(soldier.x - sx, soldier.y - sy));
  const home = playerKeep(state, id);
  const foeKeep = playerKeep(state, victim);
  const rally = home && foeKeep
    ? {
        x: centerOf(home).x + Math.sign(centerOf(foeKeep).x - centerOf(home).x) * 4,
        y: centerOf(home).y + Math.sign(centerOf(foeKeep).y - centerOf(home).y) * 3,
      }
    : { x: sx, y: sy };
  if (spread > 2.6) {
    if (mine.every((soldier) => soldier.order === 'move')) return null;
    return army(id, mine.map((soldier) => soldier.id), 'move', rally.x, rally.y);
  }

  const target = weakBuilding(state, victim);
  if (!target) return trainCommand(state, player, victim);
  if (mine.every((soldier) => soldier.order === 'attack' && soldier.targetId === target.id)) {
    if (player.personality === 'warlord' && state.tick >= 2400 && mine.length >= 4) {
      const chapel = state.buildings.find((building) => building.playerId === id && building.type === 'chapel' && building.hp > 0);
      if (!chapel) return place(state, id, 'chapel');
    }
    return null;
  }
  const spot = centerOf(target);
  threaten(state, player, victim);
  return army(id, mine.map((soldier) => soldier.id), 'attack', spot.x, spot.y, target.id);
}

function mercHire(state: GameState, player: Player): Command | null {
  const camp = state.buildings.find((building) => building.playerId === player.id && building.type === 'merccamp' && building.complete && building.hp > 0);
  if (!camp) {
    if (state.tick >= 2400) return place(state, player.id, 'merccamp');
    return null;
  }
  if (camp.buffer > 0 && player.gold >= RAIDER_GOLD) return { kind: 'hire', playerId: player.id, weapon: 'raider' };
  if (camp.input > 0 && player.gold >= AXE_GOLD) return { kind: 'hire', playerId: player.id, weapon: 'axe' };
  return null;
}

function emergency(state: GameState, player: Player): Command | null | 'spent' {
  const mine = soldiersOf(state, player.id);
  if (threatened(state, player)) {
    if (player.personality === 'merchant') {
      const hired = mercHire(state, player);
      if (hired) return hired;
    }
    if (repairWall(state, player)) return 'spent';
    if (mine.some((soldier) => soldier.order !== 'defend')) return { kind: 'order', playerId: player.id, order: 'defend' };
    return 'spent';
  }
  if (losing(state, player)) return army(player.id, mine.map((soldier) => soldier.id), 'home', 0, 0);
  if (repairWall(state, player)) return 'spent';
  return null;
}

function roadCommand(state: GameState, player: Player): Command | null {
  if ((state.match?.events ?? 'off') === 'off') return null;
  const keep = playerKeep(state, player.id);
  if (!keep) return null;
  const home = centerOf(keep);
  const bandit = state.mobs.find((mob) => mob.alive && mob.raid && Math.hypot(mob.x - home.x, mob.y - home.y) < 16);
  const mine = soldiersOf(state, player.id);
  if (bandit && mine.length) {
    return {
      kind: 'army',
      playerId: player.id,
      ids: mine.map((soldier) => soldier.id),
      mode: 'attack',
      x: bandit.x,
      y: bandit.y,
      target: 'mob',
      targetId: bandit.id,
    };
  }
  const foe = state.road?.anger[player.id] ?? -1;
  if (foe >= 0 && state.players[foe]?.alive && mine.length) {
    state.road!.anger[player.id] = -1;
    const nest = playerKeep(state, foe);
    if (nest) {
      const spot = centerOf(nest);
      return {
        kind: 'army',
        playerId: player.id,
        ids: mine.map((soldier) => soldier.id),
        mode: 'attack',
        x: spot.x,
        y: spot.y,
        target: 'building',
        targetId: nest.id,
      };
    }
  }
  if (player.personality !== 'merchant') return null;
  const caravan = state.road?.caravans.find((item) => item.alive && Math.abs(item.x - home.x) < 12);
  if (!caravan || player.gold < PRICES.wood.buy * 2 || (player.stocks.wood ?? 0) >= 20) return null;
  if (state.tick % (TICKS_PER_GAME_MINUTE * 8) !== player.id) return null;
  return { kind: 'trade', playerId: player.id, caravanId: caravan.id, resource: 'wood', mode: 'buy', qty: 2 };
}

export function planOneAi(state: GameState, player: Player): Command | null {
  if (!player.alive) return null;
  const urgent = emergency(state, player);
  if (urgent === 'spent') return null;
  if (urgent) return urgent;
  const along = roadCommand(state, player);
  if (along) return along;
  const pressing = state.match?.victory === 'conquest' || player.personality === 'warlord';
  const fed = state.buildings.some(
    (building) => building.playerId === player.id && building.type === 'orchard' && building.complete && building.hp > 0 && building.workerIds.length > 0,
  );
  if (pressing && fed) {
    const early = militaryCommand(state, player);
    if (early?.kind === 'train' || (early?.kind === 'assign' && early.delta < 0) || (early?.kind === 'place' && early.building === 'barracks')) return early;
    if (early?.kind === 'army' && soldiersOf(state, player.id).length >= groupSize(player)) return early;
  }
  const economy = economyCommand(state, player);
  if (economy) return economy;
  const war = militaryCommand(state, player);
  if (war) return war;
  return nextAiSiege(state, player, canPlace, afford, idleCount(state, player.id));
}

export function cruelMinute(state: GameState) {
  if (state.tick <= 0 || state.tick % TICKS_PER_GAME_MINUTE !== 0) return;
  for (const player of state.players) {
    if (!player.isAi || !player.alive || player.difficulty !== 'cruel') continue;
    player.gold += 1;
  }
}
