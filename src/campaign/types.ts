import type { BuildingType, MatchSetup, Ration, Resource, TaxId, Weapon } from '../sim/types';

export type GoalKind =
  | { kind: 'population'; count: number }
  | { kind: 'keep-stone'; level: number; stone: number }
  | { kind: 'hold'; minutes: number }
  | { kind: 'gold-mood'; gold: number; mood: number }
  | { kind: 'bread'; count: number }
  | { kind: 'conquest' }
  | { kind: 'bloom' };

export interface BuildStep {
  type: BuildingType;
  max: number;
  /** Placed before the keep is upgraded. */
  beforeUpgrade?: boolean;
}

export interface TrainStep {
  weapon: Weapon;
  count: number;
  keepPeople: number;
}

export interface BotPlan {
  tax?: TaxId;
  ration?: Ration;
  buildings: BuildStep[];
  upgradeTo?: number;
  ring?: number;
  gate?: boolean;
  tower?: boolean;
  /** Placed after the wall ring, so the palisade goes up before the barracks. */
  later?: BuildStep[];
  train?: TrainStep[];
  sell?: { resource: Resource; above: number };
  attack?: 'none' | 'raid';
  attackSoldiers?: number;
  attackMinute?: number;
  /** Wait until this weapon exists, so a ram leads the assault. */
  attackWeapon?: Weapon;
  bloom?: boolean;
}

export type CampaignEvent =
  | { minute: number; kind: 'log'; text: string }
  | { minute: number; kind: 'wave'; count: number; text: string }
  | { minute: number; kind: 'raiders'; count: number; text: string }
  | { minute: number; kind: 'caravan'; gold: number; text: string }
  | { minute: number; kind: 'drought'; on: boolean; text: string }
  | { minute: number; kind: 'blight'; apples: number; text: string };

export interface Scenario {
  id: string;
  title: string;
  intro: string;
  objective: string;
  bonus: string;
  goal: GoalKind;
  bonusKind: 'orchards' | 'quarry' | 'soldiers' | 'market' | 'chain' | 'walls' | 'keep-hp' | 'mood' | 'stores' | 'people';
  seed: number;
  setup: MatchSetup;
  parMinutes: number;
  /** Headless proof stops here. A real match uses failMinutes, if set. */
  proofMinutes: number;
  failMinutes: number;
  /** Tutorial safety: meals and mood wait this many game minutes. */
  shelterMinutes: number;
  events: CampaignEvent[];
  bot: BotPlan;
}
