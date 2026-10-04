export interface UiSettings {
  speed: 1 | 2 | 3;
  edgeScroll: boolean;
  uiScale: number;
  showFps: boolean;
}

const KEY = 'dorozhnye-kraya-settings';

export const UI_SCALES = [0.85, 1, 1.15, 1.3] as const;

const DEFAULTS: UiSettings = { speed: 1, edgeScroll: true, uiScale: 1, showFps: true };

export function loadUiSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw) as Partial<UiSettings>;
    const speed = data.speed === 2 || data.speed === 3 ? data.speed : 1;
    const uiScale = UI_SCALES.includes(data.uiScale as (typeof UI_SCALES)[number]) ? (data.uiScale as number) : 1;
    return {
      speed,
      edgeScroll: data.edgeScroll !== false,
      uiScale,
      showFps: data.showFps !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUiSettings(settings: UiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
}

export function settingsHtml(settings: UiSettings, gfx: string): string {
  const speeds = [1, 2, 3]
    .map((value) => `<option value="${value}"${settings.speed === value ? ' selected' : ''}>${value}×</option>`)
    .join('');
  const scales = UI_SCALES.map(
    (value) => `<option value="${value}"${settings.uiScale === value ? ' selected' : ''}>${Math.round(value * 100)}%</option>`,
  ).join('');
  return `<div class="card">
    <h2>Настройки</h2>
    <label>Графика
      <button type="button" id="settings-gfx" data-testid="settings-gfx">${gfx}</button>
    </label>
    <label>Звук
      <button type="button" id="settings-audio" data-testid="settings-audio">Открыть звук</button>
    </label>
    <label for="settings-speed">Скорость по умолчанию
      <select id="settings-speed" data-testid="settings-speed">${speeds}</select>
    </label>
    <label class="checkline"><input type="checkbox" id="settings-edge" data-testid="settings-edge"${settings.edgeScroll ? ' checked' : ''} /> Прокрутка у края экрана</label>
    <label for="settings-scale">Размер интерфейса
      <select id="settings-scale" data-testid="settings-scale">${scales}</select>
    </label>
    <label class="checkline"><input type="checkbox" id="settings-fps" data-testid="settings-fps"${settings.showFps ? ' checked' : ''} /> Счётчик кадров</label>
    <p class="ai-note">Язык: русский. Другие языки пока не поддерживаются.</p>
    <div class="actions">
      <button type="button" id="settings-reset" data-testid="reset-progress">Сбросить прогресс</button>
      <button type="button" id="settings-reset-yes" data-testid="reset-confirm" hidden>Точно сбросить?</button>
    </div>
    <div class="actions"><button type="button" id="settings-close" data-testid="settings-close">Закрыть</button></div>
  </div>`;
}
