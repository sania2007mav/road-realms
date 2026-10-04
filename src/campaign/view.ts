import { isUnlocked, type CampaignSave } from './progress';
import { SCENARIOS, scenarioIndex } from './scenarios';
import type { Scenario } from './types';

function starText(count: number): string {
  const full = Math.max(0, Math.min(3, count));
  return `${'★'.repeat(full)}${'☆'.repeat(3 - full)}`;
}

export function campaignMapHtml(save: CampaignSave): string {
  const nodes = SCENARIOS.map((scenario, index) => {
    const open = isUnlocked(save, index, SCENARIOS.map((item) => item.id));
    const stars = save.stars[scenario.id] ?? 0;
    const best = save.minutes[scenario.id];
    const time = best != null ? `<small>${best} мин</small>` : '';
    return `<button type="button" class="scenario-node${open ? '' : ' locked'}" data-testid="campaign-node-${index + 1}" data-scenario="${scenario.id}" ${open ? '' : 'disabled'}>
      <span class="node-index">${index + 1}</span>
      <span><b>${scenario.title}</b><br />${scenario.objective}</span>
      <span class="stars" aria-label="${stars} из 3">${starText(stars)}${time}</span>
    </button>`;
  }).join('');
  return `<div class="card menu-card" data-testid="campaign-map">
    <div class="menu-scroll">
      <h1>Кампания</h1>
      <p class="lede">Десять стоянок вдоль тракта. Следующая открывается, когда предыдущая взята хотя бы на одну звезду. Звезда — за победу, вторая — за срок, третья — за дополнительную цель.</p>
      <div class="campaign-road">${nodes}</div>
    </div>
    <div class="menu-foot">
      <button type="button" id="campaign-close" data-testid="campaign-close">В меню</button>
    </div>
  </div>`;
}

export function campaignIntroHtml(scenario: Scenario): string {
  const index = scenarioIndex(scenario.id) + 1;
  return `<div class="card menu-card" data-testid="scenario-intro">
    <div class="menu-scroll">
      <p class="node-kicker">Стоянка ${index} из ${SCENARIOS.length}</p>
      <h1>${scenario.title}</h1>
      <p class="lede">${scenario.intro}</p>
      <p><b>Цель.</b> ${scenario.objective}</p>
      <p><b>Дополнительно.</b> ${scenario.bonus}</p>
      <p class="muted">Срок на вторую звезду: ${scenario.parMinutes} мин. Третья — если дополнительно выполнено тоже.</p>
    </div>
    <div class="menu-foot">
      <button type="button" id="scenario-start" class="start-main" data-testid="scenario-start">В путь</button>
      <div class="actions">
        <button type="button" id="scenario-back" data-testid="scenario-back">К карте</button>
      </div>
    </div>
  </div>`;
}

export function starMarkup(count: number): string {
  return starText(count);
}
