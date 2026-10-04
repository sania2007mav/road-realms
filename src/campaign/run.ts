import { TICKS_PER_GAME_MINUTE } from '../sim/balance';
import { step } from '../sim/update';
import type { Command, GameState } from '../sim/types';
import { botCommand } from './bot';
import { enact, openSession, scenarioBonus, type CampaignSession } from './director';
import { minutesOf } from './goals';
import { starsFor } from './progress';
import { createCampaignGame, scenarioById } from './scenarios';

export interface PlayResult {
  id: string;
  title: string;
  won: boolean;
  minutes: number;
  stars: 0 | 1 | 2 | 3;
  bonus: boolean;
  outcome: GameState['outcome'];
}

/** One campaign tick: the player's command, then the sim, then scenario events. */
export function advanceCampaign(state: GameState, session: CampaignSession, commands: Command[] = []): void {
  const scenario = scenarioById(session.id);
  const shelter = !!scenario && scenario.shelterMinutes > 0 && state.tick < scenario.shelterMinutes * TICKS_PER_GAME_MINUTE;
  step(state, commands, shelter ? { shelter: true } : undefined);
  enact(session, state);
}

export function playScenario(id: string, capMinutes?: number): PlayResult {
  const scenario = scenarioById(id);
  if (!scenario) throw new Error(`нет сценария ${id}`);
  const state = createCampaignGame(scenario);
  const session = openSession(scenario);
  const cap = (capMinutes ?? scenario.proofMinutes) * TICKS_PER_GAME_MINUTE;
  while (state.outcome === 'playing' && state.tick < cap) {
    const command = botCommand(scenario.bot, state);
    advanceCampaign(state, session, command ? [command] : []);
  }
  const won = state.outcome === 'victory' && state.winnerId === 0;
  const minutes = Math.round(minutesOf(state) * 10) / 10;
  const bonus = won && scenarioBonus(session, state);
  return {
    id,
    title: scenario.title,
    won,
    minutes,
    stars: starsFor(won, minutes, scenario.parMinutes, bonus),
    bonus,
    outcome: state.outcome,
  };
}
