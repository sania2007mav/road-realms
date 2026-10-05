import {
  BUILDINGS,
  BUILD_MENU,
  CATEGORY_NAME,
  PRICES,
  RESOURCE_NAME,
  RESOURCES,
  FOODS,
  TAXES,
  TICKS_PER_GAME_MINUTE,
  TICKS_PER_SECOND,
  bloomKeepLevel,
  buildingById,
  buildingCenter,
  canPlace,
  createGame,
  createMob,
  createSoldier,
  currentTarget,
  housingCap,
  idleCount,
  KEEP_HOUSING,
  KEEP_UPGRADE_COST,
  KEEP_UPGRADE_TICKS,
  playerKeep,
  planOneAi,
  emptyStats,
  defaultProfiles,
  describeSetup,
  difficultyName,
  personalityName,
  normalizeSetup,
  packSeed,
  resultCopy,
  scoreOf,
  victoryName,
  viewerWon,
  CRUEL_BONUS_TEXT,
  SCORE_TEXT,
  step,
  suggestedTile,
  terrainAt,
  usedCount,
  workerStatus,
  Terrain,
  type AiProfile,
  type BuildingType,
  type Command,
  type DifficultyId,
  type GameState,
  type MatchSetup,
  type PersonalityId,
  type Ration,
  type Resource,
  type VictoryId,
  type Weapon,
} from './sim';
import { createBuilding, createOx, createPerson } from './sim/entities';
import { emptyStocks, PLAYER_NAMES } from './sim/balance';
import { isLineBuilding, wallLine } from './sim/siege';
import { cycleGfx, gfxLabel, loadGfx, setGfx } from './render/gfx';
import { bakeTerrain, clearTerrainChunks, minimapToTile, renderMinimap, renderWorld, setTerrainChunks, type Ghost, type OrderMarker } from './render/draw';
import { net } from './net/session';
import { NetView, type LobbyDraft } from './net/screens';
import { ZOOM_MAX, clampCamera, focusTile, screenToTile, screenToWorld, worldToScreen, type Camera } from './render/camera';
import { helpHtml } from './ui/help';
import { loadUiSettings, saveUiSettings, settingsHtml, type UiSettings } from './ui/settings';
import { clearSlots, migrateLegacy, newestSlot, readHeader, readSlot, sessionMeta, writeSlot, type SlotId } from './save/slots';
import { CAMPAIGN_KEY } from './campaign/progress';
import { createAudio } from './audio/bus';
import { friendlyNetError } from './firebase';
import { acceptInstall, acceptUpdate, bootRelease, versionLabel } from './release';
import type { AudioSettings } from './audio/settings';
import { botCommand } from './campaign/bot';
import { advanceCampaign } from './campaign/run';
import { openSession, scenarioBonus, type CampaignSession } from './campaign/director';
import { goalLine } from './campaign/goals';
import { award, isUnlocked, loadProgress, saveProgress, starsFor } from './campaign/progress';
import { SCENARIOS, createCampaignGame, scenarioById, scenarioIndex } from './campaign/scenarios';
import { campaignIntroHtml, campaignMapHtml, starMarkup } from './campaign/view';
import { soldiersInScreenRect } from './select';

const TUTORIAL_KEY = 'dorozhnye-kraya-tutorial';
const NAME_KEY = 'dorozhnye-kraya-name';
const ARMY_HINT_KEY = 'dorozhnye-kraya-army-hint';
const ARMY_HINT =
  'Щелчок выбирает солдата, рамка — нескольких (Shift добавляет). Двойной щелчок — всех такого оружия на экране. Правая кнопка: идти или атаковать цель. Клавиша A или кнопка «Атаковать область», затем щелчок. Ctrl+1…9 запоминает отряд, 1…9 выбирает его, повтор цифры показывает отряд на карте.';

const RATIONS: { id: Ration; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'half', label: 'Скромно' },
  { id: 'normal', label: 'Обычный' },
  { id: 'double', label: 'Двойной' },
  { id: 'feast', label: 'Пир' },
];

const TUTORIAL = [
  {
    title: 'Пять человек',
    body: 'В главном здании живут пять человек. Это весь ваш народ: каждый, кого вы отправили на работу, уже не сможет строить или занять другое место.',
  },
  {
    title: 'Амбар и склад',
    body: 'Сначала поставьте амбар и склад рядом с главным зданием. Еду несут в амбар, дерево и камень — на склад. Чем дальше путь, тем позже запас пополнится.',
  },
  {
    title: 'Свободные руки',
    body: 'Жёлтая точка над головой — человек без дела. Назначьте его кнопкой «+» в карточке постройки. Если свободных не осталось, новая стройка просто стоит и ждёт.',
  },
  {
    title: 'Оазис и тракт',
    body: 'Сады, пшеница и хмель растут только на зелёной траве. Лес даёт дерево, светлые скалы — камень, ржавые — железо, чёрные болота — смолу. Между посадами вдоль тракта бродят волки, медведи и разбойники.',
  },
  {
    title: 'Настроение',
    body: 'Новые люди приходят, только если настроение выше нуля и есть свободное жильё. Уходят, когда оно ниже нуля. Его поднимают сытный паёк, разные виды еды и пиво, а тяжёлый налог опускает.',
  },
];

const worldCanvas = document.querySelector<HTMLCanvasElement>('#world')!;
const miniCanvas = document.querySelector<HTMLCanvasElement>('#minimap')!;
const ctx = worldCanvas.getContext('2d')!;
const miniCtx = miniCanvas.getContext('2d')!;
const topbar = document.querySelector<HTMLElement>('#topbar')!;
const banner = document.querySelector<HTMLElement>('#banner')!;
const toast = document.querySelector<HTMLElement>('#toast')!;
const panel = document.querySelector<HTMLElement>('#panel')!;
const logEl = document.querySelector<HTMLElement>('#log')!;
const speeds = document.querySelector<HTMLElement>('#speeds')!;
const buildbar = document.querySelector<HTMLElement>('#buildbar')!;
const title = document.querySelector<HTMLElement>('#title')!;
const tutorial = document.querySelector<HTMLElement>('#tutorial')!;
const endScreen = document.querySelector<HTMLElement>('#end')!;
const menu = document.querySelector<HTMLElement>('#menu')!;
const popbox = document.querySelector<HTMLElement>('#popbox')!;
const peoplebox = document.querySelector<HTMLElement>('#peoplebox')!;
const hintEl = document.querySelector<HTMLElement>('#hint')!;
const tipEl = document.querySelector<HTMLElement>('#tip')!;
const armyEl = document.querySelector<HTMLElement>('#army')!;
const armyBody = document.querySelector<HTMLElement>('#army-body')!;
const armyCount = document.querySelector<HTMLElement>('#army-count')!;
const armyHint = document.querySelector<HTMLElement>('#army-hint')!;
const armyBox = document.querySelector<HTMLButtonElement>('#army-box')!;
const armyAttack = document.querySelector<HTMLButtonElement>('#army-attack')!;
const goalsEl = document.querySelector<HTMLElement>('#goals')!;

let state: GameState = createGame(20261003, { ai: 3 });
let playing = false;
let camera: Camera = { x: 0, y: 0, zoom: 1.15 };
loadGfx();
let baked = bakeTerrain(state);
let speed = 1;
let netPace: 1 | 2 | 3 = 1;
let localPlayer = 0;
let netMode = false;
let placing: BuildingType | null = null;
let selectedId: number | null = null;
let selectedPersonId: number | null = null;
let category: keyof typeof CATEGORY_NAME = 'storage';
let hover: { x: number; y: number } | null = null;
let tutorialStep = 0;
let campaignSession: CampaignSession | null = null;
let guideOn = false;
let roadMode = false;
let uiSettings: UiSettings = loadUiSettings();
let demolishArm: number | null = null;
let saveBusy = false;
let lastMouse = { x: -1, y: -1, mouse: false };
let longHandled = false;
let pinchMid: { x: number; y: number } | null = null;
let fpsProbe: { start: number; frames: number; dur: number; done: (n: number) => void } | null = null;
let resourceStamp = 0;
let resourceSig = '';
let logSig = '';
let guideFocus = '';
let guideSig = '';
let toastUntil = 0;
let lastMessage = '';
let panelSig = '';
let queue: Command[] = [];

function pushCmd(command: Command) {
  command.playerId = localPlayer;
  const me = state.players[localPlayer];
  if (me && !me.alive) return;
  if (command.kind === 'place') {
    const check = canPlace(state, command.playerId, command.building, command.x, command.y);
    if (check.ok) audio.play('place', command.x, command.y);
    else audio.play('ui-error');
  } else if (command.kind === 'market') audio.play('coins');
  else if (command.kind === 'army' || command.kind === 'train') audio.play('order');
  if (netMode) net.submit(command);
  else queue.push(command);
}
const keys = new Set<string>();
const audio = createAudio();
let acc = 0;
let lastFrame = performance.now();
let fps = 60;
let frames = 0;
let fpsStamp = performance.now();

const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
let dragging = false;
let dragDist = 0;
let lastPtr = { x: 0, y: 0 };
let titleDir = 1;

const selectedSoldiers = new Set<number>();
const controlGroups: number[][] = [[], [], [], [], [], [], [], [], [], []];
const markers: OrderMarker[] = [];
let attackArmed = false;
let boxMode = false;
let pointerMode: 'none' | 'pan' | 'box' | 'wall' | 'road' = 'none';
let wallAnchor: { x: number; y: number } | null = null;
let boxStart = { x: 0, y: 0 };
let boxNow = { x: 0, y: 0 };
let boxBase: number[] = [];
let boxAdditive = false;
let longTimer = 0;
let lastGesture = 0;
let lastSoldierClick = { id: 0, at: 0 };
let lastGroupTap = { n: 0, at: 0 };

function clampView() {
  const { w, h } = viewSize();
  clampCamera(camera, w, h, state.mapW, state.mapH);
}

function lookAtTile(x: number, y: number) {
  focusTile(camera, x, y);
}

function lookAtPoint(x: number, y: number) {
  focusTile(camera, x - 0.5, y - 0.5);
}

function viewSize() {
  return { w: worldCanvas.clientWidth, h: worldCanvas.clientHeight };
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, worldCanvas.clientWidth);
  const h = Math.max(1, worldCanvas.clientHeight);
  worldCanvas.width = Math.floor(w * dpr);
  worldCanvas.height = Math.floor(h * dpr);
  miniCanvas.width = Math.max(1, Math.floor(miniCanvas.clientWidth * dpr));
  miniCanvas.height = Math.max(1, Math.floor(miniCanvas.clientHeight * dpr));
  syncBuildScroll();
}

function syncBuildScroll() {
  const host = document.querySelector<HTMLElement>('#buttons');
  const prev = document.querySelector<HTMLButtonElement>('#build-prev');
  const next = document.querySelector<HTMLButtonElement>('#build-next');
  if (!host || !prev || !next) return;
  const overflow = host.scrollWidth > host.clientWidth + 4;
  prev.hidden = !overflow;
  next.hidden = !overflow;
}

let setupDraft: MatchSetup = normalizeSetup({ ai: 3 });

function readProfiles(): AiProfile[] {
  const difficulty = (index: number): DifficultyId =>
    (document.querySelector<HTMLSelectElement>(`#diff-${index}`)?.value as DifficultyId) || 'normal';
  const personality = (index: number): PersonalityId =>
    (document.querySelector<HTMLSelectElement>(`#pers-${index}`)?.value as PersonalityId) ||
    (['merchant', 'warlord', 'builder'] as const)[index];
  return [0, 1, 2].map((index) => ({ difficulty: difficulty(index), personality: personality(index) }));
}

function syncNeighbours() {
  const ai = Number(document.querySelector<HTMLSelectElement>('#ai-count')?.value ?? '3');
  for (let index = 0; index < 3; index++) {
    const row = document.querySelector<HTMLElement>(`#neighbour-${index}`);
    if (row) row.hidden = index >= ai;
  }
  const note = document.querySelector<HTMLElement>('#ai-note');
  if (note) note.hidden = !(ai > 0);
}

function syncSetupFields() {
  const victory = document.querySelector<HTMLSelectElement>('#victory')?.value ?? 'conquest';
  const show = (id: string, on: boolean) => {
    const field = document.querySelector<HTMLElement>(`#${id}`);
    if (field) field.hidden = !on;
  };
  show('field-gold', victory === 'wealth');
  show('field-pop', victory === 'bloom');
  show('field-survive', victory === 'survival');
  syncNeighbours();
}

function readSetup(): MatchSetup {
  const pick = <T extends string>(id: string, fallback: T): T =>
    (document.querySelector<HTMLSelectElement>(`#${id}`)?.value as T) || fallback;
  const num = (id: string, fallback: number) => {
    const value = Number(document.querySelector<HTMLSelectElement>(`#${id}`)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  setupDraft = normalizeSetup({
    victory: pick<VictoryId>('victory', 'conquest'),
    timeLimit: num('time-limit', 0),
    map: pick('map-size', 'normal'),
    start: pick('start-res', 'normal'),
    ai: num('ai-count', 3),
    goldTarget: num('gold-target', 2000),
    popTarget: num('pop-target', 20),
    surviveMinutes: num('survive-min', 20),
    profiles: readProfiles(),
  });
  return setupDraft;
}

function bootPreview() {
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const setup = readSetup();
  state = createGame(seed, { ai: setup.ai, setup });
  baked = bakeTerrain(state);
  lookAtTile(state.mapW / 2, state.roadY);
  camera.zoom = 0.55;
  playing = false;
  localPlayer = 0;
  guideOn = false;
  clampView();
}

function compactLayout() {
  return window.matchMedia('(max-width: 840px), (max-height: 500px)').matches;
}

function parkEcon(intoMenu: boolean) {
  const econ = document.querySelector<HTMLElement>('#econ');
  const slot = document.querySelector<HTMLElement>('#menu-econ');
  const dock = document.querySelector<HTMLElement>('#dock');
  if (!econ || !dock) return;
  if (intoMenu && slot) {
    slot.append(econ);
    econ.classList.add('in-menu');
  } else {
    dock.append(econ);
    econ.classList.remove('in-menu');
  }
}

function hideMenu() {
  parkEcon(false);
  menu.hidden = true;
}

function startGame() {
  netMode = false;
  localPlayer = 0;
  campaignSession = null;
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const setup = readSetup();
  state = createGame(seed >>> 0, { ai: setup.ai, setup });
  baked = bakeTerrain(state);
  clearTerrainChunks();
  const keep = playerKeep(state, localPlayer);
  if (keep) {
    const center = buildingCenter(keep);
    lookAtPoint(center.x, center.y);
  }
  camera.zoom = 1.15;
  clampView();
  playing = true;
  speed = uiSettings.speed;
  placing = null;
  roadMode = false;
  selectedId = compactLayout() ? null : (keep?.id ?? null);
  queue = [];
  acc = 0;
  resetArmy();
  title.hidden = true;
  netView.hide();
  netView.wait(null, null);
  endScreen.hidden = true;
  menu.hidden = true;
  buildChrome();
  tutorial.hidden = true;
  if (!netMode && !localStorage.getItem(TUTORIAL_KEY)) beginGuide();
  expose();
}

function applyUi() {
  document.documentElement.style.setProperty('--ui', String(uiSettings.uiScale));
}

function saveMeta(slot: SlotId) {
  return sessionMeta(campaignSession, slot);
}

async function storeSlot(slot: SlotId) {
  if (netMode) {
    flash('В сетевой игре сохранения нет');
    return;
  }
  if (!playing || saveBusy) return;
  saveBusy = true;
  try {
    await writeSlot(slot, state, saveMeta(slot));
    flash(slot === 'auto' ? 'Автосохранение' : `Сохранено в ячейку ${slot}`);
  } catch {
    flash('Не удалось сохранить');
  } finally {
    saveBusy = false;
  }
}

async function restoreSlot(slot: SlotId) {
  if (netMode) {
    flash('В сетевой игре сохранения нет');
    return;
  }
  const loaded = await readSlot(slot);
  if (!loaded) {
    flash('Сохранение повреждено или пусто');
    return;
  }
  state = loaded.state;
  baked = bakeTerrain(state);
  clearTerrainChunks();
  guideOn = false;
  roadMode = false;
  const scenario = loaded.meta.campaignId ? scenarioById(loaded.meta.campaignId) : undefined;
  if (scenario && loaded.meta.session) {
    campaignSession = {
      id: scenario.id,
      fired: loaded.meta.session.fired.slice(),
      drought: loaded.meta.session.drought,
      keepHp: loaded.meta.session.keepHp.slice(),
    };
  } else campaignSession = null;
  playing = true;
  speed = uiSettings.speed;
  title.hidden = true;
  netView.hide();
  netView.wait(null, null);
  endScreen.hidden = true;
  menu.hidden = true;
  hideBooks();
  const keep = playerKeep(state, localPlayer);
  if (keep) {
    const center = buildingCenter(keep);
    lookAtPoint(center.x, center.y);
  }
  clampView();
  resetArmy();
  buildChrome();
  flash('Поселение загружено');
  expose();
}

function hideBooks() {
  for (const id of ['#help-book', '#settings-panel', '#save-panel']) {
    const node = document.querySelector<HTMLElement>(id);
    if (node) node.hidden = true;
  }
}

function openHelp(anchor?: string) {
  const book = document.querySelector<HTMLElement>('#help-book');
  if (!book) return;
  book.hidden = false;
  book.innerHTML = helpHtml();
  book.querySelector<HTMLButtonElement>('#help-close')!.onclick = () => {
    book.hidden = true;
  };
  if (anchor) book.querySelector(`#help-${anchor}`)?.scrollIntoView({ block: 'start' });
}

function openSettings() {
  const host = document.querySelector<HTMLElement>('#settings-panel');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = settingsHtml(uiSettings, gfxLabel());
  host.querySelector<HTMLButtonElement>('#settings-close')!.onclick = () => {
    host.hidden = true;
  };
  host.querySelector<HTMLButtonElement>('#settings-gfx')!.onclick = () => {
    cycleGfx();
    clearTerrainChunks();
    const button = host.querySelector<HTMLButtonElement>('#settings-gfx');
    const menuButton = document.querySelector<HTMLButtonElement>('#gfx-btn');
    if (button) button.textContent = gfxLabel();
    if (menuButton) menuButton.textContent = gfxLabel();
  };
  host.querySelector<HTMLButtonElement>('#settings-audio')!.onclick = () => {
    mountAudio();
    const audioPanel = document.querySelector<HTMLElement>('#audio-panel');
    if (audioPanel) audioPanel.hidden = false;
  };
  host.querySelector<HTMLSelectElement>('#settings-speed')!.onchange = () => {
    const value = Number(host.querySelector<HTMLSelectElement>('#settings-speed')!.value);
    uiSettings.speed = value === 2 || value === 3 ? value : 1;
    saveUiSettings(uiSettings);
  };
  host.querySelector<HTMLInputElement>('#settings-edge')!.onchange = () => {
    uiSettings.edgeScroll = host.querySelector<HTMLInputElement>('#settings-edge')!.checked;
    saveUiSettings(uiSettings);
  };
  host.querySelector<HTMLSelectElement>('#settings-scale')!.onchange = () => {
    uiSettings.uiScale = Number(host.querySelector<HTMLSelectElement>('#settings-scale')!.value) || 1;
    saveUiSettings(uiSettings);
    applyUi();
  };
  host.querySelector<HTMLInputElement>('#settings-fps')!.onchange = () => {
    uiSettings.showFps = host.querySelector<HTMLInputElement>('#settings-fps')!.checked;
    saveUiSettings(uiSettings);
  };
  const reset = host.querySelector<HTMLButtonElement>('#settings-reset')!;
  const yes = host.querySelector<HTMLButtonElement>('#settings-reset-yes')!;
  reset.onclick = () => {
    yes.hidden = false;
  };
  yes.onclick = () => {
    clearSlots();
    localStorage.removeItem(CAMPAIGN_KEY);
    localStorage.removeItem(TUTORIAL_KEY);
    yes.hidden = true;
    flash('Прогресс сброшен');
    if (!playing) buildTitle();
  };
}

function slotLabel(id: SlotId): string {
  const header = readHeader(id);
  if (!header) return 'пусто';
  const when = header.savedAt ? new Date(header.savedAt).toLocaleString('ru') : 'старое';
  const where = header.campaignId ? 'кампания' : 'партия';
  return `${where}, ${when}`;
}

function openSavePanel() {
  if (netMode) {
    flash('В сетевой игре сохранения нет');
    return;
  }
  const host = document.querySelector<HTMLElement>('#save-panel');
  if (!host) return;
  host.hidden = false;
  const row = (id: SlotId, name: string) =>
    `<div class="save-row"><span>${name}: ${slotLabel(id)}</span>
      <button type="button" data-save="${id}" ${playing ? '' : 'disabled'}>Сохранить</button>
      <button type="button" data-load="${id}" ${readHeader(id) ? '' : 'disabled'}>Загрузить</button></div>`;
  host.innerHTML = `<div class="card">
    <h2>Сохранения</h2>
    ${row(1, 'Ячейка 1')}
    ${row(2, 'Ячейка 2')}
    ${row(3, 'Ячейка 3')}
    ${row('auto', 'Авто')}
    <p class="ai-note">Автосохранение каждые 2 игровые минуты. В сетевой игре ячеек нет.</p>
    <div class="actions"><button type="button" id="save-close" data-testid="save-close">Закрыть</button></div>
  </div>`;
  host.querySelector<HTMLButtonElement>('#save-close')!.onclick = () => {
    host.hidden = true;
  };
  host.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.save === 'auto' ? 'auto' : (Number(button.dataset.save) as SlotId);
      void storeSlot(id).then(() => openSavePanel());
    };
  });
  host.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.load === 'auto' ? 'auto' : (Number(button.dataset.load) as SlotId);
      void restoreSlot(id);
    };
  });
}

function continueGame() {
  const slot = newestSlot();
  if (!slot) {
    flash('Сохранения нет');
    return;
  }
  void restoreSlot(slot);
}

function closeOverlay(): boolean {
  const about = document.querySelector<HTMLElement>('#about');
  if (about && !about.hidden) {
    about.hidden = true;
    return true;
  }
  const help = document.querySelector<HTMLElement>('#help-book');
  if (help && !help.hidden) {
    help.hidden = true;
    return true;
  }
  const settings = document.querySelector<HTMLElement>('#settings-panel');
  if (settings && !settings.hidden) {
    settings.hidden = true;
    return true;
  }
  const saves = document.querySelector<HTMLElement>('#save-panel');
  if (saves && !saves.hidden) {
    saves.hidden = true;
    return true;
  }
  const audio = document.querySelector<HTMLElement>('#audio-panel');
  if (audio && !audio.hidden) {
    audio.hidden = true;
    return true;
  }
  if (!menu.hidden) {
    hideMenu();
    return true;
  }
  if (!tutorial.hidden) {
    tutorial.hidden = true;
    return true;
  }
  if (!popbox.hidden) {
    popbox.hidden = true;
    return true;
  }
  if (!peoplebox.hidden) {
    peoplebox.hidden = true;
    return true;
  }
  return false;
}

function showTutorial() {
  const step = TUTORIAL[tutorialStep];
  tutorial.hidden = false;
  tutorial.innerHTML = `<div class="card">
    <h2>${step.title}</h2>
    <p>${step.body}</p>
    <div class="actions">
      <button type="button" data-testid="tutorial-skip">Пропустить</button>
      <button type="button" data-testid="tutorial-next">${tutorialStep === TUTORIAL.length - 1 ? 'Понятно' : 'Дальше'}</button>
    </div>
  </div>`;
  tutorial.querySelector<HTMLButtonElement>('[data-testid="tutorial-skip"]')!.onclick = () => {
    tutorial.hidden = true;
  };
  tutorial.querySelector<HTMLButtonElement>('[data-testid="tutorial-next"]')!.onclick = () => {
    tutorialStep += 1;
    if (tutorialStep >= TUTORIAL.length) tutorial.hidden = true;
    else showTutorial();
  };
}

function storedName(): string {
  const raw = (localStorage.getItem(NAME_KEY) || '').trim().slice(0, 20);
  return raw || 'Путник';
}

function syncKnowButton() {
  const button = document.querySelector<HTMLButtonElement>('#know-game');
  if (!button) return;
  const skipped = localStorage.getItem(TUTORIAL_KEY) === '1';
  button.textContent = skipped ? 'Вернуть обучение' : 'Я умею играть';
  button.setAttribute('aria-pressed', skipped ? 'true' : 'false');
}

function rememberName() {
  const input = document.querySelector<HTMLInputElement>('#player-name');
  const value = (input?.value || storedName()).trim().slice(0, 20) || 'Путник';
  localStorage.setItem(NAME_KEY, value);
  if (input) input.value = value;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
}

function buildTitle() {
  const draft = setupDraft;
  title.hidden = false;
  title.innerHTML = `<div class="card menu-card">
    <div class="menu-scroll">
    <div class="brand">
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" fill="#d4c294"/>
        <rect y="40" width="64" height="8" fill="#7a5634"/>
        <rect x="24" y="18" width="16" height="24" fill="#e8d6b4" stroke="#a88c68"/>
        <polygon points="20,20 32,8 44,20" fill="#783030"/>
        <path d="M32 10 V2 H44 L32 10" fill="#c44030"/>
      </svg>
      <div>
        <h1>Дорожные края</h1>
        <p class="version" data-testid="version">${versionLabel()}</p>
      </div>
    </div>
    <p class="lede">Открытая стратегия вдоль большого тракта. Люди — редкость: их ровно столько, сколько влезает в жильё, и каждый занят только одним делом.</p>
    <label for="player-name">Ваше имя</label>
    <input id="player-name" data-testid="player-name" maxlength="20" />
    <div class="setup-grid">
      <label for="victory">Условие победы
        <select id="victory" data-testid="victory">
          ${option('conquest', 'Завоевание', draft.victory === 'conquest')}
          ${option('wealth', 'Богатство', draft.victory === 'wealth')}
          ${option('bloom', 'Расцвет', draft.victory === 'bloom')}
          ${option('survival', 'Выживание', draft.victory === 'survival')}
        </select>
      </label>
      <label for="ai-count">Соседи по тракту
        <select id="ai-count" data-testid="ai-count">
          ${option('0', 'Без соседей', draft.ai === 0)}
          ${option('1', 'Один сосед', draft.ai === 1)}
          ${option('2', 'Два соседа', draft.ai === 2)}
          ${option('3', 'Три соседа', draft.ai === 3)}
        </select>
      </label>
      <label id="field-gold" for="gold-target">Золото для «Богатства»
        <select id="gold-target" data-testid="gold-target">
          ${option('1000', '1000', draft.goldTarget === 1000)}
          ${option('2000', '2000', draft.goldTarget === 2000)}
          ${option('4000', '4000', draft.goldTarget === 4000)}
        </select>
      </label>
      <label id="field-pop" for="pop-target">Население для «Расцвета»
        <select id="pop-target" data-testid="pop-target">
          ${option('12', 'уровень 4 и 12 человек', draft.popTarget === 12)}
          ${option('20', 'уровень 5 и 20 человек', draft.popTarget === 20)}
          ${option('30', 'уровень 5 и 30 человек', draft.popTarget === 30)}
        </select>
      </label>
      <label id="field-survive" for="survive-min">Минуты «Выживания»
        <select id="survive-min" data-testid="survive-min">
          ${option('10', '10', draft.surviveMinutes === 10)}
          ${option('20', '20', draft.surviveMinutes === 20)}
          ${option('30', '30', draft.surviveMinutes === 30)}
        </select>
      </label>
    </div>
    <details id="advanced" class="advanced" data-testid="advanced">
      <summary>Дополнительно</summary>
      <label for="seed">Зерно мира</label>
      <input id="seed" data-testid="seed" type="number" value="20261003" />
      <div class="setup-grid">
        <label for="time-limit">Лимит времени
          <select id="time-limit" data-testid="time-limit">
            ${option('0', 'Без лимита', draft.timeLimit === 0)}
            ${option('15', '15 минут', draft.timeLimit === 15)}
            ${option('30', '30 минут', draft.timeLimit === 30)}
            ${option('45', '45 минут', draft.timeLimit === 45)}
          </select>
        </label>
        <label for="map-size">Размер карты
          <select id="map-size" data-testid="map-size">
            ${option('small', 'Малая', draft.map === 'small')}
            ${option('normal', 'Обычная', draft.map === 'normal')}
            ${option('large', 'Большая', draft.map === 'large')}
          </select>
        </label>
        <label for="start-res">Начальные запасы
          <select id="start-res" data-testid="start-res">
            ${option('low', 'Скудные', draft.start === 'low')}
            ${option('normal', 'Обычные', draft.start === 'normal')}
            ${option('high', 'Богатые', draft.start === 'high')}
          </select>
        </label>
      </div>
      <div id="neighbours" data-testid="neighbours">
        <p id="ai-note" class="ai-note" data-testid="ai-note">${CRUEL_BONUS_TEXT}</p>
        ${[0, 1, 2]
          .map((index) => {
            const profile = draft.profiles?.[index];
            const difficulty = profile?.difficulty ?? 'normal';
            const personality = profile?.personality ?? (['merchant', 'warlord', 'builder'] as const)[index];
            return `<div class="neighbour-row" id="neighbour-${index}" data-testid="neighbour-${index}">
              <span class="neighbour-name">${PLAYER_NAMES[index + 1]}</span>
              <label>Сложность
                <select id="diff-${index}" data-testid="diff-${index}">
                  ${option('easy', 'Лёгкий', difficulty === 'easy')}
                  ${option('normal', 'Нормальный', difficulty === 'normal')}
                  ${option('hard', 'Сложный', difficulty === 'hard')}
                  ${option('cruel', 'Жестокий', difficulty === 'cruel')}
                </select>
              </label>
              <label>Характер
                <select id="pers-${index}" data-testid="pers-${index}">
                  ${option('merchant', 'Купец', personality === 'merchant')}
                  ${option('warlord', 'Воевода', personality === 'warlord')}
                  ${option('builder', 'Зодчий', personality === 'builder')}
                  ${option('strategist', 'Стратег', personality === 'strategist')}
                </select>
              </label>
            </div>`;
          })
          .join('')}
      </div>
    </details>
    </div>
    <div class="menu-foot">
        <div class="menu-primary">
        <button type="button" id="start-title" class="start-main" data-testid="new-game">Начать</button>
        <button type="button" id="net-title" class="net-main" data-testid="net-game">Сетевая игра</button>
      </div>
      <div class="actions">
        <button type="button" id="continue-title" data-testid="continue-game"${newestSlot() ? '' : ' disabled'}>Продолжить</button>
        <button type="button" id="campaign-title" data-testid="campaign-open">Кампания</button>
        <button type="button" id="load-title" data-testid="load-game">Загрузить</button>
        <button type="button" id="help-title" data-testid="help-open">Справка</button>
        <button type="button" id="settings-title" data-testid="settings-open">Настройки</button>
        <button type="button" id="know-game" data-testid="know-game">Я умею играть</button>
        <button type="button" id="about-title" data-testid="about-open">Об игре</button>
      </div>
      <p class="fineprint"><a href="privacy.html">Политика конфиденциальности</a></p>
    </div>
  </div>`;
  const nameInput = document.querySelector<HTMLInputElement>('#player-name')!;
  nameInput.value = storedName();
  nameInput.addEventListener('change', () => rememberName());
  document.querySelector<HTMLInputElement>('#seed')!.addEventListener('change', () => {
    if (!playing) bootPreview();
  });
  syncSetupFields();
  title.querySelectorAll('select').forEach((select) => {
    select.addEventListener('change', () => {
      if (select.id === 'ai-count' || select.id === 'victory') syncSetupFields();
      readSetup();
      const rules = document.querySelector<HTMLElement>('#lobby-rules');
      if (rules) rules.textContent = `Условия матча задаёт хост: ${describeSetup(setupDraft)}`;
      if (!playing) bootPreview();
    });
  });
  document.querySelector<HTMLButtonElement>('#start-title')!.onclick = () => {
    rememberName();
    startGame();
  };
  document.querySelector<HTMLButtonElement>('#continue-title')!.onclick = () => continueGame();
  document.querySelector<HTMLButtonElement>('#load-title')!.onclick = () => openSavePanel();
  document.querySelector<HTMLButtonElement>('#help-title')!.onclick = () => openHelp();
  document.querySelector<HTMLButtonElement>('#settings-title')!.onclick = () => openSettings();
  document.querySelector<HTMLButtonElement>('#know-game')!.onclick = () => {
    if (localStorage.getItem(TUTORIAL_KEY) === '1') localStorage.removeItem(TUTORIAL_KEY);
    else localStorage.setItem(TUTORIAL_KEY, '1');
    syncKnowButton();
  };
  syncKnowButton();
  document.querySelector<HTMLButtonElement>('#net-title')!.onclick = () => openNet();
  document.querySelector<HTMLButtonElement>('#campaign-title')!.onclick = () => showCampaignMap();
  document.querySelector<HTMLButtonElement>('#about-title')!.onclick = () => openAbout();
}

function openAbout() {
  const about = document.querySelector<HTMLElement>('#about')!;
  about.hidden = false;
  about.innerHTML = `<div class="card">
    <h2>Об игре</h2>
    <p>Дорожные края. ${versionLabel()}.</p>
    <p>ИП Мельничук. Весь рисунок и весь звук собраны кодом в браузере: чужих картинок и записей нет.</p>
    <p><a href="privacy.html">Политика конфиденциальности</a></p>
    <div class="actions"><button type="button" id="about-close" data-testid="about-close">Закрыть</button></div>
  </div>`;
  document.querySelector<HTMLButtonElement>('#about-close')!.onclick = () => {
    about.hidden = true;
  };
}

function showCampaignMap() {
  playing = false;
  campaignSession = null;
  title.hidden = false;
  endScreen.hidden = true;
  goalsEl.hidden = true;
  const save = loadProgress();
  title.innerHTML = campaignMapHtml(save);
  document.querySelector<HTMLButtonElement>('#campaign-close')!.onclick = () => {
    buildTitle();
    bootPreview();
  };
  title.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
    button.onclick = () => {
      const scenario = scenarioById(button.dataset.scenario ?? '');
      if (scenario) showScenarioIntro(scenario);
    };
  });
}

function showScenarioIntro(scenario: ReturnType<typeof scenarioById>) {
  if (!scenario) return;
  title.hidden = false;
  endScreen.hidden = true;
  title.innerHTML = campaignIntroHtml(scenario);
  document.querySelector<HTMLButtonElement>('#scenario-start')!.onclick = () => startScenario(scenario.id);
  document.querySelector<HTMLButtonElement>('#scenario-back')!.onclick = () => showCampaignMap();
}

function startScenario(id: string) {
  const scenario = scenarioById(id);
  if (!scenario) return;
  netMode = false;
  localPlayer = 0;
  guideOn = false;
  campaignSession = openSession(scenario);
  state = createCampaignGame(scenario);
  baked = bakeTerrain(state);
  clearTerrainChunks();
  const keep = playerKeep(state, localPlayer);
  if (keep) {
    const center = buildingCenter(keep);
    lookAtPoint(center.x, center.y);
  }
  camera.zoom = 1.15;
  clampView();
  playing = true;
  speed = uiSettings.speed;
  placing = null;
  roadMode = false;
  selectedId = compactLayout() ? null : (keep?.id ?? null);
  selectedPersonId = null;
  queue = [];
  acc = 0;
  resetArmy();
  title.hidden = true;
  netView.hide();
  netView.wait(null, null);
  endScreen.hidden = true;
  menu.hidden = true;
  buildChrome();
  tutorial.hidden = true;
  expose();
}

function speakerIcon(muted: boolean): string {
  const slash = muted ? '<path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2"/>' : '';
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9h4l5-4v14l-5-4H3z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M16 9a4 4 0 010 6"/>${slash}</svg>`;
}

function paintMute() {
  const button = document.querySelector<HTMLButtonElement>('#mute-btn');
  const box = document.querySelector<HTMLInputElement>('#audio-muted');
  const muted = audio.settings().muted;
  if (button) {
    button.innerHTML = speakerIcon(muted);
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
    button.classList.toggle('is-muted', muted);
  }
  if (box) box.checked = muted;
}

function bindAudioRange(id: string, key: keyof AudioSettings) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) return;
  const current = audio.settings()[key];
  input.value = String(Math.round(Number(current) * 100));
  input.addEventListener('input', () => {
    audio.update({ [key]: Number(input.value) / 100 });
  });
}

function mountAudio() {
  const host = document.querySelector('#app');
  let panel = document.querySelector<HTMLElement>('#audio-panel');
  if (host && !panel) {
    panel = document.createElement('aside');
    panel.id = 'audio-panel';
    panel.dataset.testid = 'audio-settings';
    panel.hidden = true;
    panel.innerHTML = `<h2>Звук</h2>
      <label class="audio-mute"><input type="checkbox" id="audio-muted" data-testid="audio-muted" /> Без звука</label>
      <label>Общая <input type="range" id="audio-master" data-testid="audio-master" min="0" max="100" step="1" /></label>
      <label>Музыка <input type="range" id="audio-music" data-testid="audio-music" min="0" max="100" step="1" /></label>
      <label>Эффекты <input type="range" id="audio-sfx" data-testid="audio-sfx" min="0" max="100" step="1" /></label>
      <label>Фон <input type="range" id="audio-ambience" data-testid="audio-ambience" min="0" max="100" step="1" /></label>`;
    host.append(panel);
    bindAudioRange('audio-master', 'master');
    bindAudioRange('audio-music', 'music');
    bindAudioRange('audio-sfx', 'sfx');
    bindAudioRange('audio-ambience', 'ambience');
    document.querySelector<HTMLInputElement>('#audio-muted')!.addEventListener('change', () => {
      audio.update({ muted: document.querySelector<HTMLInputElement>('#audio-muted')!.checked });
      paintMute();
    });
  }
  paintMute();
  const sheet = panel;
  const mute = document.querySelector<HTMLButtonElement>('#mute-btn');
  if (mute) {
    mute.onclick = () => {
      audio.toggleMuted();
      paintMute();
    };
  }
  const opener = document.querySelector<HTMLButtonElement>('#audio-open');
  if (opener) {
    opener.onclick = () => {
      if (sheet) sheet.hidden = !sheet.hidden;
    };
  }
}

function buildChrome() {
  const player = () => state.players[localPlayer];
  topbar.innerHTML = `
    <div id="status">
      <button type="button" id="open-menu" data-testid="open-menu">Меню</button>
      <button type="button" class="readout" id="people-btn" data-testid="people-readout"></button>
      <button type="button" class="readout" id="mood-btn" data-testid="popularity"></button>
      <div class="readout" id="gold-readout"></div>
      <div class="readout" id="clock"></div>
      <div class="readout" id="fps">60 к/с</div>
      <button type="button" id="res-toggle" data-testid="res-toggle">Ресурсы</button>
      <button type="button" id="mute-btn" data-testid="mute-audio" aria-label="Без звука" aria-pressed="false"></button>
      <button type="button" id="audio-open" data-testid="audio-open" aria-label="Настройки звука">♪</button>
      <div id="presence" data-testid="presence" hidden></div>
    </div>
    <div id="resources"></div>`;
  document.querySelector<HTMLButtonElement>('#open-menu')!.onclick = () => {
    if (menu.hidden) {
      menu.hidden = false;
      renderMenu();
    } else hideMenu();
  };
  document.querySelector<HTMLButtonElement>('#res-toggle')!.onclick = () => {
    topbar.classList.toggle('show-res');
  };
  document.querySelector<HTMLButtonElement>('#map-toggle')!.onclick = () => {
    document.querySelector('#dock')?.classList.toggle('show-map');
  };
  document.querySelector<HTMLButtonElement>('#people-btn')!.onclick = () => {
    peoplebox.hidden = !peoplebox.hidden;
    popbox.hidden = true;
  };
  document.querySelector<HTMLButtonElement>('#mood-btn')!.onclick = () => {
    popbox.hidden = !popbox.hidden;
    peoplebox.hidden = true;
  };
  mountAudio();

  const econ = document.querySelector<HTMLElement>('#econ')!;
  econ.innerHTML = `<label>Паёк
      <select id="ration" data-testid="ration">${RATIONS.map((r) => `<option value="${r.id}">${r.label}</option>`).join('')}</select>
    </label>
    <label>Налог <span id="tax-label"></span>
      <input id="tax" data-testid="tax-slider" type="range" min="0" max="5" step="1" value="1" />
    </label>`;
  const ration = document.querySelector<HTMLSelectElement>('#ration')!;
  ration.value = player().ration;
  ration.addEventListener('change', () => {
    pushCmd({ kind: 'ration', playerId: localPlayer, ration: ration.value as Ration });
  });

  const tax = document.querySelector<HTMLInputElement>('#tax')!;
  tax.value = String(Math.max(0, TAXES.findIndex((t) => t.id === player().tax)));
  tax.addEventListener('input', () => {
    const def = TAXES[Number(tax.value)] ?? TAXES[1];
    pushCmd({ kind: 'tax', playerId: localPlayer, tax: def.id });
    const label = document.querySelector<HTMLElement>('#tax-label');
    if (label) label.textContent = def.label;
  });
  document.querySelector<HTMLElement>('#tax-label')!.textContent = TAXES.find((t) => t.id === player().tax)?.label ?? '';

  speeds.innerHTML = [
    ['0', 'Пауза', 'speed-0'],
    ['1', '1×', 'speed-1'],
    ['2', '2×', 'speed-2'],
    ['3', '3×', 'speed-3'],
  ]
    .map(([value, label, id]) => `<button type="button" data-speed="${value}" data-testid="${id}">${label}</button>`)
    .join('');
  speeds.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.onclick = () => setSpeed(Number(button.dataset.speed));
  });

  buildbar.innerHTML = `<div id="tabs"></div><div id="buttonrow"><button type="button" id="build-prev" data-testid="build-prev" aria-label="Листать постройки влево">‹</button><div id="buttons"></div><button type="button" id="build-next" data-testid="build-next" aria-label="Листать постройки вправо">›</button></div>`;
  const scrollBuild = (dir: number) => {
    document.querySelector<HTMLElement>('#buttons')?.scrollBy({ left: dir * 180, behavior: 'smooth' });
  };
  document.querySelector<HTMLButtonElement>('#build-prev')!.onclick = () => scrollBuild(-1);
  document.querySelector<HTMLButtonElement>('#build-next')!.onclick = () => scrollBuild(1);
  const tabEl = document.querySelector<HTMLElement>('#tabs')!;
  tabEl.innerHTML = (Object.keys(CATEGORY_NAME) as (keyof typeof CATEGORY_NAME)[])
    .map((key) => `<button type="button" data-cat="${key}" data-testid="tab-${key}">${CATEGORY_NAME[key]}</button>`)
    .join('');
  tabEl.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.onclick = () => {
      category = button.dataset.cat as keyof typeof CATEGORY_NAME;
      paintBuildButtons();
    };
  });
  paintBuildButtons();
  setSpeed(speed);
  panelSig = '';
}

function paintBuildButtons() {
  const tabEl = document.querySelector<HTMLElement>('#tabs');
  tabEl?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.cat === category);
    button.classList.toggle('guide-pulse', guidePulseTab(button.dataset.cat || ''));
  });
  const host = document.querySelector<HTMLElement>('#buttons');
  if (!host || !playing) return;
  const types = BUILD_MENU.filter((type) => BUILDINGS[type].category === category);
  const road =
    category === 'industry'
      ? `<button type="button" data-testid="build-road" class="${roadMode ? 'active' : ''}"><b>Дорога</b><small>1 дерево</small></button>`
      : '';
  host.innerHTML =
    types
      .map((type) => {
        const def = BUILDINGS[type];
        return `<button type="button" data-build="${type}" data-testid="build-${type}">
        <b>${def.name}</b><small>${buttonNote(type)}</small>
      </button>`;
      })
      .join('') + road;
  host.querySelector<HTMLButtonElement>('[data-testid="build-road"]')?.addEventListener('click', () => {
    if ((state.players[localPlayer]?.stocks.wood ?? 0) < 1) {
      flash('Не хватает дерева');
      audio.play('ui-error');
      return;
    }
    placing = null;
    roadMode = true;
    worldCanvas.classList.add('placing');
    flash('Проведите дорогу');
  });
  host.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (!button.dataset.build) return;
    button.onclick = () => {
      const type = button.dataset.build as BuildingType;
      const reason = blockReason(type);
      if (reason) {
        flash(reason);
        audio.play('ui-error');
        return;
      }
      roadMode = false;
      placing = type;
      worldCanvas.classList.add('placing');
      flash(`Выберите место: ${BUILDINGS[type].name}`);
    };
  });
  syncBuildScroll();
}

function buttonNote(type: BuildingType): string {
  const guided = guideLock(type);
  if (guided) return guided;
  const def = BUILDINGS[type];
  const level = playerKeep(state, localPlayer)?.level ?? 0;
  if (def.keepLevel > level) return `Нужен уровень главного здания ${def.keepLevel}`;
  const cost = Object.entries(def.cost)
    .map(([res, amount]) => `${amount} ${RESOURCE_NAME[res as keyof typeof RESOURCE_NAME]}`)
    .join(', ');
  return cost || 'без цены';
}

function blockReason(type: BuildingType): string | null {
  const guided = guideLock(type);
  if (guided) return guided;
  const def = BUILDINGS[type];
  const keep = playerKeep(state, localPlayer);
  const level = keep?.level ?? 0;
  if (!state.players[localPlayer]?.alive) return 'Поселение пало';
  if (def.keepLevel > level) return `Нужен уровень главного здания ${def.keepLevel}`;
  for (const res of RESOURCES) {
    if ((state.players[localPlayer].stocks[res] ?? 0) < (def.cost[res] ?? 0)) return 'Не хватает ресурсов';
  }
  return null;
}

function refreshBuildState() {
  const host = document.querySelector<HTMLElement>('#buttons');
  host?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (!button.dataset.build) {
      button.classList.toggle('active', roadMode);
      return;
    }
    const type = button.dataset.build as BuildingType;
    const locked = blockReason(type);
    button.classList.toggle('locked', !!locked);
    button.classList.toggle('active', placing === type);
    button.classList.toggle('guide-pulse', guidePulseBuild(type));
    const note = button.querySelector('small');
    const text = buttonNote(type);
    if (note && note.textContent !== text) note.textContent = text;
  });
}

function setSpeed(value: number) {
  if (netMode) value = netPace;
  speed = value;
  speeds.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === value);
    button.disabled = netMode;
  });
}

function renderMenu() {
  parkEcon(false);
  const compact = compactLayout();
  menu.innerHTML = `<div class="card">
    <h2>Меню</h2>
    <p>Зерно ${state.seed}. Игровое время: ${Math.floor(state.tick / TICKS_PER_GAME_MINUTE)} мин.</p>
    ${compact ? `<div class="actions" data-testid="menu-speeds">
      <button type="button" id="menu-speed-0">Пауза</button>
      <button type="button" id="menu-speed-1">1×</button>
      <button type="button" id="menu-speed-2">2×</button>
      <button type="button" id="menu-speed-3">3×</button>
    </div>
    <div class="actions">
      <button type="button" id="menu-mute">Без звука</button>
      <button type="button" id="menu-audio">Звук</button>
    </div>
    <div id="menu-econ"></div>` : ''}
    <div class="actions">
      <button type="button" id="save-btn" data-testid="save-game">Сохранить</button>
      <button type="button" id="load-btn">Загрузить</button>
    </div>
    <div class="actions">
      <button type="button" id="help-btn">Подсказки</button>
      <button type="button" id="book-btn" data-testid="help-menu">Справка</button>
      <button type="button" id="settings-btn" data-testid="settings-menu">Настройки</button>
      <button type="button" id="guide-restart" data-testid="guide-restart">Обучение</button>
      <button type="button" id="resign-btn">Новая игра</button>
    </div>
    <div class="actions">
      <button type="button" id="gfx-btn" data-testid="gfx-toggle">${gfxLabel()}</button>
    </div>
    <p>Мышь: тянуть карту, колесо — масштаб, край экрана листает карту. На телефоне: два пальца двигают и меняют масштаб, долгое нажатие открывает постройку. Клавиши: WASD, Z X C V B N — вкладки построек, пробел — пауза, 1–3 — скорость, Esc закрывает панели, H — подсказки.</p>
    <p class="version">${versionLabel()}</p>
    <div class="actions"><button type="button" id="close-menu">Закрыть</button></div>
  </div>`;
  if (compact) parkEcon(true);
  for (const value of [0, 1, 2, 3]) {
    document.querySelector<HTMLButtonElement>(`#menu-speed-${value}`)?.addEventListener('click', () => setSpeed(value));
  }
  document.querySelector<HTMLButtonElement>('#menu-mute')?.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('#mute-btn')?.click();
  });
  document.querySelector<HTMLButtonElement>('#menu-audio')?.addEventListener('click', () => {
    hideMenu();
    document.querySelector<HTMLButtonElement>('#audio-open')?.click();
  });
  document.querySelector<HTMLButtonElement>('#save-btn')!.onclick = () => openSavePanel();
  document.querySelector<HTMLButtonElement>('#load-btn')!.onclick = () => openSavePanel();
  document.querySelector<HTMLButtonElement>('#book-btn')!.onclick = () => {
    hideMenu();
    openHelp();
  };
  document.querySelector<HTMLButtonElement>('#settings-btn')!.onclick = () => {
    hideMenu();
    openSettings();
  };
  document.querySelector<HTMLButtonElement>('#help-btn')!.onclick = () => {
    hideMenu();
    if (guideOn) return;
    tutorialStep = 0;
    showTutorial();
  };
  document.querySelector<HTMLButtonElement>('#guide-restart')!.onclick = () => {
    hideMenu();
    localStorage.removeItem(TUTORIAL_KEY);
    playing = false;
    if (netMode) {
      netMode = false;
      localPlayer = 0;
      void net.destroyMatch();
    }
    netView.hide();
    netView.wait(null, null);
    startGame();
  };
  document.querySelector<HTMLButtonElement>('#resign-btn')!.onclick = () => {
    hideMenu();
    playing = false;
    campaignSession = null;
    if (netMode) {
      netMode = false;
      localPlayer = 0;
      void net.destroyMatch();
    }
    netView.hide();
    netView.wait(null, null);
    buildTitle();
    bootPreview();
  };
  document.querySelector<HTMLButtonElement>('#close-menu')!.onclick = () => {
    hideMenu();
  };
  document.querySelector<HTMLButtonElement>('#gfx-btn')!.onclick = () => {
    cycleGfx();
    clearTerrainChunks();
    baked = bakeTerrain(state);
    const button = document.querySelector<HTMLButtonElement>('#gfx-btn');
    if (button) button.textContent = gfxLabel();
  };
}

function goalText(playerId: number): string {
  const setup = state.match;
  const player = state.players[playerId];
  if (!player || !setup) return '';
  if (!player.alive) return 'пал';
  const keep = playerKeep(state, playerId);
  const pop = state.people.filter((person) => person.playerId === playerId && person.hp > 0).length;
  if (setup.victory === 'wealth') return `${player.gold} / ${setup.goldTarget} золота`;
  if (setup.victory === 'bloom') return `ур. ${keep?.level ?? 0}/${bloomKeepLevel(setup.popTarget)} · люди ${pop}/${setup.popTarget}`;
  if (setup.victory === 'survival') return 'держится';
  return 'главное здание стоит';
}

function setPhoneGoal(text: string) {
  const node = document.querySelector<HTMLElement>('#phone-goal');
  if (!node) return;
  node.hidden = !text;
  if (text && node.textContent !== text) node.textContent = text;
}

function jumpToLine(line: string) {
  for (const building of state.buildings) {
    if (building.playerId !== localPlayer || building.hp <= 0) continue;
    if (!line.includes(BUILDINGS[building.type].name)) continue;
    const center = buildingCenter(building);
    lookAtPoint(center.x, center.y);
    selectedId = building.id;
    panelSig = '';
    return;
  }
  const keep = playerKeep(state, localPlayer);
  if (!keep) return;
  const center = buildingCenter(keep);
  lookAtPoint(center.x, center.y);
}

function paintGoals() {
  if (campaignSession) {
    const scenario = scenarioById(campaignSession.id);
    if (!playing || !scenario || state.outcome !== 'playing') {
      goalsEl.hidden = true;
      setPhoneGoal('');
      return;
    }
    goalsEl.hidden = false;
    const bonus = scenarioBonus(campaignSession, state) ? 'выполнено' : 'ещё нет';
    goalsEl.innerHTML = `<div class="goal-title" data-testid="goal-title">${scenario.title}</div>
      <p class="goal-objective">${scenario.objective}</p>
      <p class="goal-progress">${goalLine(scenario.goal, state)}</p>
      <p class="goal-bonus">Дополнительно: ${scenario.bonus} — ${bonus}</p>`;
    setPhoneGoal(`${scenario.title}: ${scenario.objective}`);
    return;
  }
  const setup = state.match;
  if (!playing || !setup || state.outcome !== 'playing') {
    goalsEl.hidden = true;
    setPhoneGoal('');
    return;
  }
  goalsEl.hidden = false;
  const limit = setup.timeLimit > 0 ? ` · лимит ${setup.timeLimit} мин` : '';
  const clock =
    setup.victory === 'survival' ? ` · ${Math.max(0, setup.surviveMinutes - Math.floor(state.tick / TICKS_PER_GAME_MINUTE))} мин` : '';
    const rows = state.players
    .map((player) => {
      const name = player.id === localPlayer ? 'Вы' : player.name;
      const score = setup.timeLimit > 0 ? ` · ${scoreOf(state, player)}` : '';
      const face = player.isAi ? `<i>${personalityName(player.personality)} · ${difficultyName(player.difficulty)}</i>` : '';
      return `<div class="goal-row"><span>${name}${face}</span><b>${goalText(player.id)}${score}</b></div>`;
    })
    .join('');
  goalsEl.innerHTML = `<div class="goal-title">${victoryName(setup.victory)}${limit}${clock}</div>${rows}`;
  setPhoneGoal(`${victoryName(setup.victory)}: ${goalText(localPlayer)}`);
}

function syncHud() {
  const player = state.players[localPlayer];
  if (!player) return;
  const idle = idleCount(state, localPlayer);
  const used = usedCount(state, localPlayer);
  const cap = housingCap(state, localPlayer);
  const compact = compactLayout();
  const peopleBtn = document.querySelector<HTMLButtonElement>('#people-btn');
  if (peopleBtn) {
    peopleBtn.innerHTML = compact
      ? `<strong>${used}</strong>/<strong>${cap}</strong>`
      : `Люди <strong>${used}</strong>/<strong>${cap}</strong> · свободно <strong>${idle}</strong>`;
    peopleBtn.title = `Люди ${used} из ${cap}, свободно ${idle}`;
    peopleBtn.classList.toggle('idle-empty', idle === 0);
    peopleBtn.classList.toggle('idle-ready', idle > 0);
  }
  const mood = document.querySelector<HTMLButtonElement>('#mood-btn');
  if (mood) {
    const sign = player.popularity > 0 ? `+${player.popularity}` : String(player.popularity);
    mood.innerHTML = compact ? `<strong>${sign}</strong>` : `Настроение <strong>${sign}</strong>`;
    mood.title = `Настроение ${sign}`;
    mood.classList.remove('mood-up', 'mood-down');
    mood.classList.add(player.popularity >= 0 ? 'mood-up' : 'mood-down');
  }
  const gold = document.querySelector<HTMLElement>('#gold-readout');
  if (gold) {
    gold.innerHTML = compact ? `<strong>${player.gold}</strong>` : `Золото <strong>${player.gold}</strong>`;
    gold.title = `Золото ${player.gold}`;
  }
  const clock = document.querySelector<HTMLElement>('#clock');
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  if (clock) {
    clock.textContent = compact ? `${minute}м` : `${minute} мин`;
    clock.title = `${minute} мин`;
  }
  const fpsEl = document.querySelector<HTMLElement>('#fps');
  if (fpsEl) {
    fpsEl.hidden = !uiSettings.showFps;
    if (uiSettings.showFps) fpsEl.textContent = `${fps} к/с`;
  }

  const resources = document.querySelector<HTMLElement>('#resources');
  const stockSig = `${compact ? 'c' : 'd'}:${RESOURCES.map((res) => player.stocks[res]).join(',')}`;
  const nowHud = performance.now();
  if (resources && (stockSig !== resourceSig || nowHud - resourceStamp > 150)) {
    resourceSig = stockSig;
    resourceStamp = nowHud;
    const chip = (res: (typeof RESOURCES)[number]) => {
      const amount = player.stocks[res];
      return `<span class="res ${amount > 0 ? '' : 'zero'}"><i style="background:${cargoColor(res)}"></i>${RESOURCE_NAME[res]} <b>${amount}</b></span>`;
    };
    if (compact) {
      const order: (typeof RESOURCES)[number][] = ['wood', 'stone', 'iron', 'pitch', 'apples', 'cheese', 'meat', 'bread', 'beer'];
      resources.innerHTML = order.map(chip).join('');
    } else {
      const groups: { label: string; items: (typeof RESOURCES)[number][] }[] = [
        { label: 'Еда', items: ['apples', 'cheese', 'meat', 'bread'] },
        { label: 'Материалы', items: ['wood', 'stone', 'iron', 'pitch'] },
        { label: 'Пиво', items: ['beer'] },
      ];
      resources.innerHTML = groups
        .map((group) => `<div class="resgroup"><span class="glabel">${group.label}</span>${group.items.map(chip).join('')}</div>`)
        .join('');
    }
  }
  const ration = document.querySelector<HTMLSelectElement>('#ration');
  if (ration && document.activeElement !== ration) ration.value = player.ration;
  updateHint();
  paintGoals();
  const spectating = netMode && player && !player.alive && state.outcome === 'playing';
  const danger = spectating ? '' : dangerText();
  const waiting = !spectating &&
    !danger &&
    idle === 0 &&
    state.buildings.some(
      (b) =>
        b.playerId === localPlayer &&
        b.hp > 0 &&
        (!b.complete || b.upgrading || (b.complete && BUILDINGS[b.type].workers > b.workerIds.length)),
    );
  banner.hidden = !spectating && !danger && !waiting;
  banner.textContent = spectating
    ? 'Вы наблюдаете'
    : danger
      ? danger
      : waiting
        ? 'Нет свободных людей. Снимите кого-нибудь с работы или дождитесь переселенцев — иначе стройка и новые места будут стоять пустыми.'
        : '';

  if (!popbox.hidden) {
    const report = currentTarget(state, localPlayer);
    popbox.innerHTML = `<div class="card"><h2>Настроение ${report.value}</h2>${report.reasons
      .map(
        (reason) =>
          `<div class="reason"><span>${reason.label}</span><b class="${reason.value >= 0 ? 'plus' : 'minus'}">${reason.value > 0 ? `+${reason.value}` : reason.value}</b></div>`,
      )
      .join('')}<p>Люди приходят выше нуля, уходят ниже нуля.</p></div>`;
  }
  if (!peoplebox.hidden) {
    const mine = state.people.filter((p) => p.playerId === localPlayer && p.hp > 0);
    peoplebox.innerHTML = `<div class="card"><h2>Люди поселения</h2>${mine
      .map((person) => `<div class="reason"><span>${jobLabel(person)}</span></div>`)
      .join('')}<p>Солдат: ${state.soldiers.filter((s) => s.playerId === localPlayer && s.hp > 0).length}. Солдат больше не занимает жильё.</p></div>`;
  }
  const nextLog = state.log.join('\n');
  if (nextLog !== logSig) {
    logSig = nextLog;
    logEl.replaceChildren();
    for (const line of state.log) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'log-line';
      row.textContent = line;
      row.onclick = () => jumpToLine(line);
      logEl.append(row);
    }
  }
  syncGuide();
  syncArmy();
  if (state.message && state.message !== lastMessage) {
    lastMessage = state.message;
    flash(state.message);
    audio.play('ui-error');
  }
  refreshBuildState();
  syncPanel();
  syncPresence();
  if (state.outcome !== 'playing') showEnd();
}

type GuideStep = {
  id: string;
  title: string;
  type?: BuildingType;
  cat?: keyof typeof CATEGORY_NAME;
  body: string;
  done: boolean;
};

function ownBuilding(type: BuildingType) {
  return state.buildings.find((b) => b.playerId === localPlayer && b.hp > 0 && b.type === type);
}

function guideSteps(): GuideStep[] {
  const granary = !!ownBuilding('granary');
  const stockpile = !!ownBuilding('stockpile');
  const orchard = ownBuilding('orchard');
  const wood = ownBuilding('woodcutter');
  const orchardReady = !!orchard?.complete && orchard.workerIds.length > 0;
  const woodReady = !!wood?.complete && wood.workerIds.length > 0;
  let workerBody = 'Назначьте по человеку в яблоневый сад и в хижину лесоруба. Кнопка «+» в карточке здания.';
  if (!orchard?.complete || !wood?.complete) workerBody = 'Сад и хижина ещё строятся. Когда карточка откроется, нажмите «+» у каждого.';
  else if (!orchardReady) workerBody = 'Сад готов. Нажмите «+», чтобы отправить туда человека.';
  else if (!woodReady) workerBody = 'Хижина готова. Нажмите «+», чтобы отправить туда лесоруба.';
  return [
    {
      id: 'granary',
      title: 'Амбар',
      type: 'granary',
      cat: 'storage',
      body: 'Поставьте амбар рядом с главным зданием. Сюда носят еду. Без амбара урожай не попадёт в запас. Зелёный след на карте — подходящее место.',
      done: granary,
    },
    {
      id: 'stockpile',
      title: 'Склад',
      type: 'stockpile',
      cat: 'storage',
      body: 'Поставьте склад. Дерево и камень носят только на склад. Пока его нет, лес и каменоломня ничего не сохранят.',
      done: stockpile,
    },
    {
      id: 'orchard',
      title: 'Яблоневый сад',
      type: 'orchard',
      cat: 'food',
      body: 'Поставьте яблоневый сад на зелёном оазисе. Один работник в саду кормит начальный посад, и настроение не падает.',
      done: !!orchard,
    },
    {
      id: 'woodcutter',
      title: 'Хижина лесоруба',
      type: 'woodcutter',
      cat: 'industry',
      body: 'Поставьте хижину лесоруба рядом с лесом. Иначе дерево кончится, и новые постройки будет не из чего ставить.',
      done: !!wood,
    },
    {
      id: 'workers',
      title: 'Работники',
      body: workerBody,
      done: orchardReady && woodReady,
    },
  ];
}

function currentGuide(): GuideStep | null {
  return guideSteps().find((step) => !step.done) ?? null;
}

function guideLock(type: BuildingType): string | null {
  if (!guideOn || netMode) return null;
  const step = currentGuide();
  if (!step) return null;
  if (step.type && type !== step.type) return `Сначала поставьте ${step.title}`;
  if (!step.type) return 'Сначала назначьте работников';
  return null;
}

function guidePulseBuild(type: BuildingType): boolean {
  if (!guideOn || netMode) return false;
  return currentGuide()?.type === type;
}

function guidePulseTab(cat: string): boolean {
  if (!guideOn || netMode) return false;
  const step = currentGuide();
  return !!step?.cat && step.cat === cat;
}

function guidePulsePlus(type: BuildingType): boolean {
  if (!guideOn || netMode) return false;
  const step = currentGuide();
  if (!step || step.id !== 'workers') return false;
  const orchard = ownBuilding('orchard');
  const wood = ownBuilding('woodcutter');
  if (orchard?.complete && orchard.workerIds.length === 0) return type === 'orchard';
  if (wood?.complete && wood.workerIds.length === 0) return type === 'woodcutter';
  return false;
}

function beginGuide() {
  guideOn = true;
  guideFocus = '';
  guideSig = '';
  tutorial.hidden = false;
}

function finishGuide() {
  guideOn = false;
  guideFocus = '';
  guideSig = '';
  localStorage.setItem(TUTORIAL_KEY, '1');
  tutorial.hidden = true;
  tutorial.replaceChildren();
  flash('Основа заложена: еда и дерево пойдут в запас.');
  paintBuildButtons();
}

function focusGuide(step: GuideStep) {
  const key = step.id === 'workers' ? (workerTarget() ?? 'workers') : step.id;
  if (guideFocus === key) return;
  guideFocus = key;
  if (step.type && step.id !== 'workers') {
    category = step.cat ?? category;
    paintBuildButtons();
    const tile = suggestedTile(state, localPlayer, step.type);
    if (tile) {
      const def = BUILDINGS[step.type];
      lookAtTile(tile.x + def.w / 2, tile.y + def.h / 2);
      camera.zoom = 1.15;
      clampView();
    }
    document.querySelector(`[data-testid="build-${step.type}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    return;
  }
  const target = workerTarget();
  const building = target ? ownBuilding(target) : undefined;
  if (!building) return;
  selectedId = building.id;
  panelSig = '';
  const center = buildingCenter(building);
  lookAtPoint(center.x, center.y);
  camera.zoom = 1.15;
  clampView();
}

function workerTarget(): BuildingType | null {
  const orchard = ownBuilding('orchard');
  const wood = ownBuilding('woodcutter');
  if (orchard?.complete && orchard.workerIds.length === 0) return 'orchard';
  if (wood?.complete && wood.workerIds.length === 0) return 'woodcutter';
  return orchard && !orchard.complete ? 'orchard' : wood ? 'woodcutter' : null;
}

function syncGuide() {
  if (!guideOn || netMode || !playing) return;
  const steps = guideSteps();
  const step = steps.find((item) => !item.done);
  if (!step) {
    finishGuide();
    return;
  }
  const index = steps.indexOf(step);
  const sig = `${step.id}|${step.body}`;
  if (sig !== guideSig) {
    guideSig = sig;
    tutorial.hidden = false;
    tutorial.replaceChildren();
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.testid = 'guide';
    const title = document.createElement('h2');
    title.dataset.testid = 'guide-title';
    title.textContent = step.title;
    const count = document.createElement('p');
    count.className = 'guide-step';
    count.textContent = `Шаг ${index + 1} из ${steps.length}`;
    const body = document.createElement('p');
    body.dataset.testid = 'guide-body';
    body.textContent = step.body;
    card.append(title, count, body);
    tutorial.append(card);
  }
  focusGuide(step);
}

function foodOf(playerId: number): number {
  const player = state.players[playerId];
  if (!player) return 0;
  return FOODS.reduce((sum, food) => sum + (player.stocks[food] ?? 0), 0);
}

function foodComing(playerId: number): boolean {
  return state.buildings.some((building) => {
    if (building.playerId !== playerId || building.hp <= 0 || !building.complete || building.workerIds.length === 0) return false;
    const output = BUILDINGS[building.type].output;
    return !!output && (FOODS as readonly string[]).includes(output);
  });
}

function checklistText(): string {
  const pending = guideSteps().filter((step) => !step.done).map((step) => step.title);
  if (!pending.length) return '';
  return `Подсказка, игру не останавливает: ${pending.join(', ')}`;
}

function dangerText(): string | null {
  const player = state.players[localPlayer];
  if (!player?.alive) return null;
  const people = state.people.filter((person) => person.playerId === localPlayer && person.hp > 0).length;
  if (people === 0) return 'В поселении никого нет. Главное здание скоро примет одного человека — назначьте его в сад или к лесорубу.';
  if (!foodComing(localPlayer) && foodOf(localPlayer) < 40) {
    return 'Еда кончается, а её никто не добывает. Поставьте яблоневый сад на зелёном оазисе и назначьте работника кнопкой +.';
  }
  const cutter = !!ownBuilding('woodcutter');
  if (!cutter && (player.stocks.wood ?? 0) === 0) {
    return 'Дерева нет и лесоруба тоже. Главное здание понемногу отдаёт брёвна — поставьте хижину лесоруба у леса.';
  }
  return null;
}

function updateHint() {
  if (!playing || guideOn) {
    hintEl.hidden = true;
    return;
  }
  if (netMode) {
    const text = checklistText();
    hintEl.hidden = !text;
    hintEl.textContent = text;
    return;
  }
  if (state.tick >= 10 * TICKS_PER_GAME_MINUTE) {
    hintEl.hidden = true;
    return;
  }
  const mine = (type: string) => state.buildings.some((b) => b.playerId === localPlayer && b.hp > 0 && b.type === type);
  const orchard = state.buildings.find((b) => b.playerId === localPlayer && b.hp > 0 && b.type === 'orchard');
  let text = '';
  if (!mine('granary')) text = 'Поставьте амбар рядом с главным зданием';
  else if (!orchard) text = 'Поставьте яблоневый сад на зелёном оазисе';
  else if (orchard.workerIds.length === 0) text = 'Назначьте работника кнопкой + в карточке сада';
  else if (!mine('shack')) text = 'Поставьте шалаш, чтобы пришли новые люди';
  else text = 'Следите за настроением: выше нуля люди приходят';
  hintEl.hidden = false;
  hintEl.textContent = text;
}

function updateTip(clientX: number, clientY: number) {
  if (!playing || !hover) {
    tipEl.hidden = true;
    return;
  }
  let text = '';
  if (placing) {
    const check = canPlace(state, localPlayer, placing, hover.x, hover.y);
    text = check.ok ? `${BUILDINGS[placing].name}: можно строить` : `${BUILDINGS[placing].name}: ${check.reason}`;
  } else {
    for (const building of state.buildings) {
      if (building.hp <= 0) continue;
      const def = BUILDINGS[building.type];
      if (hover.x >= building.x && hover.x < building.x + def.w && hover.y >= building.y && hover.y < building.y + def.h) {
        text = def.name;
      }
    }
  }
  if (!text) {
    const terrain = terrainAt(state, hover.x, hover.y);
    if (terrain === Terrain.Forest) text = 'Лес';
    else if (terrain === Terrain.Limestone) text = 'Известняк';
    else if (terrain === Terrain.Iron) text = 'Железная руда';
    else if (terrain === Terrain.Swamp) text = 'Чёрное болото';
  }
  if (!text) {
    tipEl.hidden = true;
    return;
  }
  tipEl.hidden = false;
  tipEl.textContent = text;
  tipEl.style.left = `${clientX + 14}px`;
  tipEl.style.top = `${clientY + 16}px`;
}

function jobLabel(person: GameState['people'][number]): string {
  return workerStatus(state, person);
}

function keepUpgradeHtml(building: { level: number; upgrading: boolean }): string {
  if (building.upgrading) return '<p>Улучшение уже идёт.</p>';
  const player = state.players[localPlayer];
  const cost = KEEP_UPGRADE_COST[building.level] ?? {};
  const parts: string[] = [];
  let short = false;
  for (const res of RESOURCES) {
    const need = cost[res] ?? 0;
    if (!need) continue;
    const have = player.stocks[res] ?? 0;
    if (have < need) short = true;
    parts.push(`<span class="${have < need ? 'cost-short' : ''}">${RESOURCE_NAME[res]} ${have}/${need}</span>`);
  }
  const next = building.level + 1;
  const housing = KEEP_HOUSING[next] ?? 0;
  const names = BUILD_MENU.filter((type) => BUILDINGS[type].keepLevel === next).map((type) => BUILDINGS[type].name);
  const mins = Math.floor(KEEP_UPGRADE_TICKS / TICKS_PER_GAME_MINUTE);
  const secs = KEEP_UPGRADE_TICKS % TICKS_PER_GAME_MINUTE;
  const time = secs === 0 ? `${mins} мин` : `${mins} мин ${secs} с`;
  const noWorker = idleCount(state, localPlayer) <= 0;
  const reason = short ? 'Не хватает ресурсов' : noWorker ? 'Нужен свободный человек' : '';
  return `<p data-testid="upgrade-cost">${parts.join(', ')}</p>
    <p>Время стройки: ${time}. Нужен свободный человек.</p>
    <p>Уровень ${next}: жильё главного здания ${housing}. Откроется: ${names.join(', ')}.</p>
    <button type="button" data-testid="upgrade-keep" ${reason ? 'disabled' : ''}>Улучшить до уровня ${next}</button>
    ${reason ? `<p class="worker-status warn" data-testid="upgrade-reason">${reason}</p>` : ''}`;
}

function syncPanel() {
  if (!playing || state.outcome !== 'playing') {
    panel.hidden = true;
    return;
  }
  const personOnly = selectedPersonId != null ? state.people.find((p) => p.id === selectedPersonId && p.hp > 0) : undefined;
  const building = selectedId != null ? buildingById(state, selectedId) : undefined;
  if ((!building || building.hp <= 0) && personOnly) {
    const status = workerStatus(state, personOnly);
    const sig = `person|${personOnly.id}|${status}`;
    if (sig !== panelSig) {
      panelSig = sig;
      panel.hidden = false;
      const job = personOnly.task.type === 'idle' ? null : buildingById(state, personOnly.task.buildingId);
      panel.innerHTML = `<h2>Работник</h2>
        <p class="worker-status" data-testid="worker-status">${status}</p>
        <p>${job ? `Место: ${BUILDINGS[job.type].name}` : 'Свободен, стоит у главного здания.'}</p>
        <div class="row"><button type="button" id="close-panel">Закрыть</button></div>`;
      panel.querySelector<HTMLButtonElement>('#close-panel')!.onclick = () => {
        selectedId = null;
        selectedPersonId = null;
        panelSig = '';
      };
    }
    return;
  }
  if (!building || building.hp <= 0) {
    panel.hidden = true;
    panelSig = '';
    return;
  }
  const def = BUILDINGS[building.type];
  const statuses = building.workerIds
    .map((id) => state.people.find((p) => p.id === id && p.hp > 0))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => workerStatus(state, p))
    .join('|');
  const sig = [
    building.id,
    building.complete,
    building.workerIds.length,
    building.level,
    building.upgrading,
    building.plague > 0,
    building.buffer,
    building.input,
    building.hp,
    state.players[localPlayer].gold,
    state.players[localPlayer].stocks.wood,
    state.players[localPlayer].stocks.stone,
    state.players[localPlayer].stocks.iron,
    idleCount(state, localPlayer),
    selectedPersonId ?? '',
    statuses,
  ].join('|');
  if (sig === panelSig) return;
  panelSig = sig;
  panel.hidden = false;
  const mine = building.playerId === localPlayer;
  const workers = def.workers
    ? `<div class="row"><span>Работники ${building.workerIds.length} / ${def.workers}</span>
        <button type="button" data-testid="worker-minus">−</button>
        <button type="button" data-testid="worker-plus" class="${guidePulsePlus(building.type) ? 'guide-pulse' : ''}" ${idleCount(state, localPlayer) <= 0 || building.workerIds.length >= def.workers || !building.complete ? 'disabled' : ''}>+</button>
      </div>`
    : '';
  const upgrade = mine && building.type === 'keep' && building.level < 5 ? keepUpgradeHtml(building) : '';
  const train =
    mine && building.type === 'barracks' && building.complete
      ? `<div class="row">
          <button type="button" data-testid="train-club">Ополченец (2 дерева)</button>
          <button type="button" data-testid="train-sword">Мечник (2 железа)</button>
          <button type="button" data-testid="train-bow">Лучник (4 дерева)</button>
          <button type="button" data-testid="order-defend">Оборона</button>
          <button type="button" data-testid="order-raid">Набег</button>
        </div>`
      : mine && building.type === 'guild' && building.complete
        ? `<div class="row">
          <button type="button" data-testid="train-engineer">Инженер (3 дерева, 1 железо)</button>
          <button type="button" data-testid="train-ladder">Лестничник (8 дерева)</button>
          <button type="button" data-testid="train-ram">Таран (16 дерева, 4 камня)</button>
          <button type="button" data-testid="train-catapult">Катапульта (18 дерева, 10 камня, 4 железа)</button>
          <button type="button" data-testid="launch-cow">Пустить корову</button>
        </div>`
        : '';
  const market =
    mine && building.type === 'market'
      ? RESOURCES.map((res) => {
          const price = PRICES[res];
          return `<div class="market-row"><span>${RESOURCE_NAME[res]}</span>
            <button type="button" data-buy="${res}">Купить ${price.buy}</button>
            <button type="button" data-sell="${res}">Продать ${price.sell}</button></div>`;
        }).join('')
      : '';
  const demolish =
    mine && building.type !== 'keep'
      ? `<button type="button" data-testid="demolish">${demolishArm === building.id ? 'Точно снести?' : 'Снести'}</button>`
      : '';
  const stockNote =
    building.buffer > 0 && building.bufferRes
      ? `<p>На площадке: ${building.buffer} ${RESOURCE_NAME[building.bufferRes]}</p>`
      : '';
  const workerLines = building.workerIds
    .map((id) => state.people.find((p) => p.id === id && p.hp > 0))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map(
      (p) =>
        `<p class="worker-status${p.id === selectedPersonId ? ' picked' : ''}" data-testid="worker-status">${workerStatus(state, p)}</p>`,
    )
    .join('');
  const noPeople =
    mine && def.workers > building.workerIds.length && idleCount(state, localPlayer) === 0
      ? `<p class="worker-status warn" data-testid="worker-status">нет свободных людей</p>`
      : '';
  panel.innerHTML = `<h2>${def.name} <button type="button" class="help-mark" data-testid="building-help" data-help="${building.type}">?</button></h2>
    <p>${def.desc}</p>
    <p>${building.complete ? 'Построено' : 'Строится'} · прочность ${Math.max(0, building.hp)}/${building.maxHp}${building.type === 'keep' ? ` · уровень ${building.level}` : ''}</p>
    ${building.type === 'keep' ? `<p>Жильё этого здания: ${[0, 5, 8, 12, 18, 28][building.level] ?? building.level}. Общий предел людей: ${housingCap(state, building.playerId)}.</p>` : ''}
    ${def.housing ? `<p>Даёт жильё: ${def.housing}</p>` : ''}
    ${stockNote}
    ${workerLines}
    ${noPeople}
    ${building.plague > 0 ? '<p>На ферме чума, коровы не доятся.</p>' : ''}
    ${workers}${upgrade}${train}${market}
    <div class="row">${demolish}<button type="button" id="close-panel">Закрыть</button></div>
    ${idleCount(state, localPlayer) === 0 && mine && def.workers > building.workerIds.length ? '<p>Назначить некого: все люди заняты.</p>' : ''}`;
  panel.querySelector<HTMLButtonElement>('[data-testid="worker-plus"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'assign', playerId: localPlayer, buildingId: building.id, delta: 1 });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="worker-minus"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'assign', playerId: localPlayer, buildingId: building.id, delta: -1 });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="upgrade-keep"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'upgrade', playerId: localPlayer, buildingId: building.id });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="building-help"]')?.addEventListener('click', () => {
    openHelp(building.type);
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="demolish"]')?.addEventListener('click', () => {
    if (demolishArm !== building.id) {
      demolishArm = building.id;
      const button = panel.querySelector<HTMLButtonElement>('[data-testid="demolish"]');
      if (button) button.textContent = 'Точно снести?';
      return;
    }
    demolishArm = null;
    pushCmd({ kind: 'demolish', playerId: localPlayer, buildingId: building.id });
    selectedId = null;
    selectedPersonId = null;
    panelSig = '';
  });
  for (const weapon of ['club', 'sword', 'bow', 'engineer', 'ladder', 'ram', 'catapult'] as const) {
    panel.querySelector<HTMLButtonElement>(`[data-testid="train-${weapon}"]`)?.addEventListener('click', () => {
      pushCmd({ kind: 'train', playerId: localPlayer, weapon });
      panelSig = '';
    });
  }
  panel.querySelector<HTMLButtonElement>('[data-testid="launch-cow"]')?.addEventListener('click', () => {
    const catapult = state.soldiers.find((s) => s.playerId === localPlayer && s.hp > 0 && s.weapon === 'catapult');
    const dairy = state.buildings.some((b) => b.playerId === localPlayer && b.type === 'dairy' && b.complete && b.hp > 0);
    if (!catapult || !dairy) {
      flash('Нужны ферма и катапульта');
      return;
    }
    const enemy = state.buildings.find((b) => b.type === 'keep' && b.playerId !== localPlayer && b.hp > 0);
    const aim = enemy ? buildingCenter(enemy) : { x: catapult.x + 6, y: catapult.y + 6 };
    pushCmd({ kind: 'cow', playerId: localPlayer, soldierId: catapult.id, x: aim.x, y: aim.y });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="order-defend"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'order', playerId: localPlayer, order: 'defend' });
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="order-raid"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'order', playerId: localPlayer, order: 'raid' });
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((button) => {
    button.onclick = () => {
      pushCmd({ kind: 'market', playerId: localPlayer, resource: button.dataset.buy as (typeof RESOURCES)[number], mode: 'buy', qty: 1 });
      panelSig = '';
    };
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((button) => {
    button.onclick = () => {
      pushCmd({ kind: 'market', playerId: localPlayer, resource: button.dataset.sell as (typeof RESOURCES)[number], mode: 'sell', qty: 1 });
      panelSig = '';
    };
  });
  panel.querySelector<HTMLButtonElement>('#close-panel')!.onclick = () => {
    selectedId = null;
    selectedPersonId = null;
    panel.hidden = true;
    panelSig = '';
  };
}

function closeOverlays() {
  goalsEl.hidden = true;
  panel.hidden = true;
  popbox.hidden = true;
  peoplebox.hidden = true;
  menu.hidden = true;
  armyEl.hidden = true;
  armyBody.hidden = true;
  selectedId = null;
  selectedPersonId = null;
  panelSig = '';
}

function formatClock(ticks: number): string {
  const mins = Math.floor(ticks / TICKS_PER_GAME_MINUTE);
  const secs = ticks % TICKS_PER_GAME_MINUTE;
  return `${mins} мин ${secs} с`;
}

function paintResultsChart(canvas: HTMLCanvasElement) {
  const ctx2 = canvas.getContext('2d');
  if (!ctx2) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx2.clearRect(0, 0, w, h);
  ctx2.fillStyle = '#1c1612';
  ctx2.fillRect(0, 0, w, h);
  const samples = state.samples ?? [];
  if (samples.length < 2) return;
  const maxPop = Math.max(1, ...samples.flatMap((sample) => sample.pop));
  const maxGold = Math.max(1, ...samples.flatMap((sample) => sample.gold));
  const draw = (values: number[], max: number, color: string, dashed: boolean) => {
    ctx2.beginPath();
    ctx2.strokeStyle = color;
    ctx2.lineWidth = 2;
    ctx2.setLineDash(dashed ? [5, 4] : []);
    values.forEach((value, index) => {
      const x = (index / (values.length - 1)) * (w - 16) + 8;
      const y = h - 8 - (value / max) * (h - 20);
      if (index === 0) ctx2.moveTo(x, y);
      else ctx2.lineTo(x, y);
    });
    ctx2.stroke();
  };
  state.players.forEach((player, index) => {
    draw(
      samples.map((sample) => sample.pop[index] ?? 0),
      maxPop,
      player.color,
      false,
    );
    draw(
      samples.map((sample) => sample.gold[index] ?? 0),
      maxGold,
      player.color,
      true,
    );
  });
  ctx2.setLineDash([]);
}

function showEnd() {
  if (!endScreen.hidden) return;
  closeOverlays();
  const copy = resultCopy(state, localPlayer, netMode);
  endScreen.hidden = false;
  const cells = state.players.map((player) => {
    const food = player.stats?.food;
    const foodSum = food ? food.apples + food.cheese + food.meat + food.bread : 0;
    const foodText = food ? `яблоки ${food.apples}, сыр ${food.cheese}, мясо ${food.meat}, хлеб ${food.bread}` : '—';
    const stats = player.stats;
    return {
      name: player.name,
      score: scoreOf(state, player),
      pop: stats?.peakPop ?? 0,
      foodSum,
      foodText,
      gold: stats?.goldEarned ?? 0,
      buildings: stats?.buildings ?? 0,
      soldiers: stats?.soldiers ?? 0,
      kills: stats?.kills ?? 0,
      razed: stats?.razed ?? 0,
    };
  });
  const rows = cells
    .map(
      (row) => `<tr>
        <td>${row.name}</td>
        <td>${row.score}</td>
        <td>${row.pop}</td>
        <td title="${row.foodText}">${row.foodSum}</td>
        <td>${row.gold}</td>
        <td>${row.buildings}</td>
        <td>${row.soldiers}</td>
        <td>${row.kills}</td>
        <td>${row.razed}</td>
      </tr>`,
    )
    .join('');
  const cards = cells
    .map(
      (row) => `<article class="results-player">
        <h3>${row.name}</h3>
        <p class="results-score">Счёт ${row.score}</p>
        <dl>
          <dt>Пик людей</dt><dd>${row.pop}</dd>
          <dt>Еда</dt><dd>${row.foodText}</dd>
          <dt>Золото</dt><dd>${row.gold}</dd>
          <dt>Постройки</dt><dd>${row.buildings}</dd>
          <dt>Воины</dt><dd>${row.soldiers}</dd>
          <dt>Убито</dt><dd>${row.kills}</dd>
          <dt>Разрушено</dt><dd>${row.razed}</dd>
        </dl>
      </article>`,
    )
    .join('');
  const scenario = campaignSession ? scenarioById(campaignSession.id) : undefined;
  let titleText = copy.title;
  let detailText = `${copy.detail} Время: ${formatClock(state.tick)}.`;
  let starsHtml = '';
  let actionHtml = `<button type="button" id="again" data-testid="again">Реванш</button>
      <button type="button" id="to-menu" data-testid="to-menu">В меню</button>`;
  if (scenario && campaignSession) {
    const won = state.outcome === 'victory';
    const minutes = Math.round((state.tick / TICKS_PER_GAME_MINUTE) * 10) / 10;
    const bonus = scenarioBonus(campaignSession, state);
    const stars = starsFor(won, minutes, scenario.parMinutes, bonus);
    if (won) saveProgress(award(loadProgress(), scenario.id, stars, minutes));
    titleText = won ? 'Победа' : 'Поражение';
    detailText = won
      ? `Цель «${scenario.objective}» выполнена. ${bonus ? 'Дополнительная цель тоже.' : 'Дополнительная цель не выполнена.'} Время: ${formatClock(state.tick)}.`
      : `Поражение. ${scenario.objective} Время: ${formatClock(state.tick)}.`;
    starsHtml = `<p class="campaign-stars" data-testid="campaign-stars" aria-label="${stars} из 3">${starMarkup(stars)}</p>`;
    actionHtml = won
      ? `<button type="button" id="campaign-next" data-testid="campaign-next">Далее</button>
      <button type="button" id="to-menu" data-testid="to-menu">К карте</button>`
      : `<button type="button" id="again" data-testid="again">Ещё раз</button>
      <button type="button" id="to-menu" data-testid="to-menu">К карте</button>`;
  }
  endScreen.innerHTML = `<div class="card results-card">
    <h1 data-testid="results-title">${titleText}</h1>
    ${starsHtml}
    <p data-testid="results-detail">${detailText}</p>
    <div class="results-scroll">
    <table class="results-table">
      <thead><tr><th>Посад</th><th>Счёт</th><th>Люди</th><th>Еда</th><th>Золото</th><th>Дома</th><th>Воины</th><th>Убито</th><th>Руины</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <div class="results-cards">${cards}</div>
    <canvas id="results-chart" width="840" height="140"></canvas>
    <p class="chart-note">Сплошная линия — население, пунктир — золото.</p>
    <p class="score-formula">${SCORE_TEXT}</p>
    <div class="actions">
      ${actionHtml}
    </div>
  </div>`;
  const chart = document.querySelector<HTMLCanvasElement>('#results-chart');
  if (chart) paintResultsChart(chart);
  document.querySelector<HTMLButtonElement>('#again')?.addEventListener('click', () => {
    endScreen.hidden = true;
    if (campaignSession) {
      const id = campaignSession.id;
      startScenario(id);
      return;
    }
    if (netMode) {
      playing = false;
      netMode = false;
      localPlayer = 0;
      void net.leave().catch(() => {});
      openNet();
      return;
    }
    startGame();
  });
  document.querySelector<HTMLButtonElement>('#campaign-next')?.addEventListener('click', () => {
    const current = campaignSession ? scenarioIndex(campaignSession.id) : -1;
    const next = SCENARIOS[current + 1];
    const save = loadProgress();
    endScreen.hidden = true;
    playing = false;
    goalsEl.hidden = true;
    if (next && isUnlocked(save, current + 1, SCENARIOS.map((item) => item.id))) showScenarioIntro(next);
    else showCampaignMap();
  });
  document.querySelector<HTMLButtonElement>('#to-menu')!.onclick = () => {
    playing = false;
    netMode = false;
    localPlayer = 0;
    void net.leave().catch(() => {});
    netView.hide();
    netView.wait(null, null);
    endScreen.hidden = true;
    goalsEl.hidden = true;
    if (campaignSession) {
      showCampaignMap();
      return;
    }
    buildTitle();
    bootPreview();
  };
}

function flash(text: string) {
  toast.hidden = false;
  toast.textContent = text;
  toastUntil = performance.now() + 2400;
}

function cargoColor(res: string): string {
  const map: Record<string, string> = {
    apples: '#d6453c',
    cheese: '#f2d15a',
    meat: '#a33b3b',
    bread: '#e0a15a',
    wood: '#8a5a32',
    stone: '#d9d3c6',
    iron: '#9a4e32',
    pitch: '#111',
    beer: '#e0a11b',
  };
  return map[res] ?? '#ccc';
}

function resetArmy() {
  selectedSoldiers.clear();
  attackArmed = false;
  boxMode = false;
  pointerMode = 'none';
  markers.length = 0;
  for (const group of controlGroups) group.length = 0;
  worldCanvas.classList.remove('attacking');
  syncArmy();
}

function livingSelection() {
  for (const id of [...selectedSoldiers]) {
    const soldier = state.soldiers.find((s) => s.id === id && s.playerId === localPlayer && s.hp > 0);
    if (!soldier) selectedSoldiers.delete(id);
  }
}

function syncArmy() {
  armyEl.hidden = !playing || state.outcome !== 'playing';
  armyBox.textContent = compactLayout() ? 'Войска' : 'Выделить войска';
  livingSelection();
  const list = state.soldiers.filter((s) => selectedSoldiers.has(s.id));
  armyBody.hidden = list.length === 0;
  const clubs = list.filter((s) => s.weapon === 'club').length;
  const swords = list.filter((s) => s.weapon === 'sword').length;
  const bows = list.filter((s) => s.weapon === 'bow').length;
  armyCount.textContent = `Всего ${list.length} · ополченцы ${clubs} · мечники ${swords}${bows ? ` · лучники ${bows}` : ''}`;
  armyAttack.setAttribute('aria-pressed', attackArmed ? 'true' : 'false');
  armyBox.setAttribute('aria-pressed', boxMode ? 'true' : 'false');
  worldCanvas.classList.toggle('attacking', attackArmed);
  if (!list.length) armyHint.hidden = true;
}

function noteFirstSelection() {
  if (!selectedSoldiers.size) return;
  audio.play('select');
  if (localStorage.getItem(ARMY_HINT_KEY)) {
    armyHint.hidden = true;
    return;
  }
  armyHint.hidden = false;
  armyHint.textContent = ARMY_HINT;
  localStorage.setItem(ARMY_HINT_KEY, '1');
}

function issueArmy(
  mode: 'move' | 'attackmove' | 'hold' | 'home' | 'attack',
  x: number,
  y: number,
  target: 'none' | 'soldier' | 'mob' | 'building' = 'none',
  targetId = 0,
) {
  if (!selectedSoldiers.size) return;
  pushCmd({
    kind: 'army',
    playerId: localPlayer,
    ids: [...selectedSoldiers],
    mode,
    x,
    y,
    target,
    targetId,
  });
  if (mode === 'move' || mode === 'home') markers.push({ kind: 'move', x, y, born: performance.now() });
  if (mode === 'attack' || mode === 'attackmove') markers.push({ kind: 'attack', x, y, born: performance.now() });
  if (markers.length > 12) markers.splice(0, markers.length - 12);
  attackArmed = false;
  syncArmy();
}

function ownSoldierAt(x: number, y: number) {
  let best: (typeof state.soldiers)[number] | null = null;
  let bestD = 0.75;
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.playerId !== localPlayer) continue;
    const d = Math.hypot(soldier.x - x, soldier.y - y);
    if (d < bestD) {
      best = soldier;
      bestD = d;
    }
  }
  return best;
}

function hostileAt(x: number, y: number, tileX: number, tileY: number) {
  let bestD = 0.75;
  let soldierHit: (typeof state.soldiers)[number] | null = null;
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.playerId === localPlayer) continue;
    if (!state.players[soldier.playerId]?.alive) continue;
    const d = Math.hypot(soldier.x - x, soldier.y - y);
    if (d < bestD) {
      soldierHit = soldier;
      bestD = d;
    }
  }
  if (soldierHit) return { target: 'soldier' as const, targetId: soldierHit.id, x: soldierHit.x, y: soldierHit.y };
  let mobHit: (typeof state.mobs)[number] | null = null;
  bestD = 0.75;
  for (const mob of state.mobs) {
    if (!mob.alive || mob.kind === 'deer') continue;
    const d = Math.hypot(mob.x - x, mob.y - y);
    if (d < bestD) {
      mobHit = mob;
      bestD = d;
    }
  }
  if (mobHit) return { target: 'mob' as const, targetId: mobHit.id, x: mobHit.x, y: mobHit.y };
  for (const building of state.buildings) {
    if (building.hp <= 0 || building.playerId === localPlayer) continue;
    if (!state.players[building.playerId]?.alive) continue;
    const def = BUILDINGS[building.type];
    if (tileX >= building.x && tileX < building.x + def.w && tileY >= building.y && tileY < building.y + def.h) {
      const center = buildingCenter(building);
      return { target: 'building' as const, targetId: building.id, x: center.x, y: center.y };
    }
  }
  return null;
}

function selectWeaponOnScreen(weapon: Weapon) {
  const { w, h } = viewSize();
  selectedSoldiers.clear();
  for (const soldier of state.soldiers) {
    if (soldier.playerId !== localPlayer || soldier.hp <= 0 || soldier.weapon !== weapon) continue;
    const point = worldToScreen(camera, w, h, soldier.x, soldier.y);
    if (point.x >= 0 && point.x <= w && point.y >= 0 && point.y <= h) selectedSoldiers.add(soldier.id);
  }
}

function paintBox() {
  const { w, h } = viewSize();
  const ids = soldiersInScreenRect(
    state.soldiers,
    camera,
    w,
    h,
    { left: boxStart.x, top: boxStart.y, right: boxNow.x, bottom: boxNow.y },
    localPlayer,
  );
  selectedSoldiers.clear();
  if (boxAdditive) for (const id of boxBase) selectedSoldiers.add(id);
  for (const id of ids) selectedSoldiers.add(id);
  if (selectedSoldiers.size) noteFirstSelection();
  syncArmy();
}

function centreSquad(ids: number[]) {
  const list = state.soldiers.filter((s) => ids.includes(s.id) && s.hp > 0);
  if (!list.length) return;
  const x = list.reduce((sum, s) => sum + s.x, 0) / list.length;
  const y = list.reduce((sum, s) => sum + s.y, 0) / list.length;
  lookAtPoint(x, y);
  clampView();
}

function onMapClick(screenX: number, screenY: number, shift: boolean, touch: boolean) {
  const { w, h } = viewSize();
  const world = screenToWorld(camera, w, h, screenX, screenY);
  const tile = screenToTile(camera, w, h, screenX, screenY);
  if (placing) {
    pick(screenX, screenY);
    return;
  }
  if (attackArmed && selectedSoldiers.size) {
    issueArmy('attackmove', world.x, world.y);
    return;
  }
  const soldier = ownSoldierAt(world.x, world.y);
  if (soldier) {
    const now = performance.now();
    if (!shift && lastSoldierClick.id === soldier.id && now - lastSoldierClick.at < 400) selectWeaponOnScreen(soldier.weapon);
    else if (shift) {
      if (selectedSoldiers.has(soldier.id)) selectedSoldiers.delete(soldier.id);
      else selectedSoldiers.add(soldier.id);
    } else {
      selectedSoldiers.clear();
      selectedSoldiers.add(soldier.id);
    }
    lastSoldierClick = { id: soldier.id, at: now };
    if (selectedSoldiers.size) noteFirstSelection();
    syncArmy();
    return;
  }
  if (touch && selectedSoldiers.size) {
    const hostile = hostileAt(world.x, world.y, tile.x, tile.y);
    if (hostile) issueArmy('attack', hostile.x, hostile.y, hostile.target, hostile.targetId);
    else issueArmy('move', world.x, world.y);
    return;
  }
  selectedSoldiers.clear();
  attackArmed = false;
  syncArmy();
  pick(screenX, screenY);
}

function orderAt(screenX: number, screenY: number) {
  if (!selectedSoldiers.size) return;
  const { w, h } = viewSize();
  const world = screenToWorld(camera, w, h, screenX, screenY);
  const tile = screenToTile(camera, w, h, screenX, screenY);
  const hostile = hostileAt(world.x, world.y, tile.x, tile.y);
  if (hostile) issueArmy('attack', hostile.x, hostile.y, hostile.target, hostile.targetId);
  else issueArmy('move', world.x, world.y);
}

function ghost(): Ghost | null {
  if (placing && hover && playing) {
    if (isLineBuilding(placing) && wallAnchor) {
      const type = placing;
      const cells = wallLine(wallAnchor.x, wallAnchor.y, hover.x, hover.y);
      const first = cells[0] ?? hover;
      return {
        type,
        x: first.x,
        y: first.y,
        ok: canPlace(state, localPlayer, type, first.x, first.y).ok,
        extras: cells.slice(1).map((cell) => ({
          x: cell.x,
          y: cell.y,
          ok: canPlace(state, localPlayer, type, cell.x, cell.y).ok,
        })),
      };
    }
    const check = canPlace(state, localPlayer, placing, hover.x, hover.y);
    return { type: placing, x: hover.x, y: hover.y, ok: check.ok };
  }
  const step = guideOn && !netMode ? currentGuide() : null;
  if (step?.type && playing) {
    const tile = suggestedTile(state, localPlayer, step.type);
    if (tile) return { type: step.type, x: tile.x, y: tile.y, ok: true };
  }
  return null;
}

function pick(screenX: number, screenY: number) {
  const { w, h } = viewSize();
  const tile = screenToTile(camera, w, h, screenX, screenY);
  if (placing) {
    const command: Command = { kind: 'place', playerId: localPlayer, building: placing, x: tile.x, y: tile.y };
    pushCmd(command);
    placing = null;
    worldCanvas.classList.remove('placing');
    return;
  }
  const world = screenToWorld(camera, w, h, screenX, screenY);
  let personHit: number | null = null;
  let personD = 0.7;
  for (const person of state.people) {
    if (person.hp <= 0 || person.playerId !== localPlayer) continue;
    const d = Math.hypot(person.x - world.x, person.y - world.y);
    if (d < personD) {
      personD = d;
      personHit = person.id;
    }
  }
  if (personHit != null) {
    selectedPersonId = personHit;
    audio.play('select');
    const person = state.people.find((p) => p.id === personHit);
    selectedId = person && person.task.type !== 'idle' ? person.task.buildingId : null;
    panelSig = '';
    return;
  }
  selectedPersonId = null;
  let found: number | null = null;
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const def = BUILDINGS[building.type];
    if (tile.x >= building.x && tile.x < building.x + def.w && tile.y >= building.y && tile.y < building.y + def.h) {
      found = building.id;
    }
  }
  selectedId = found;
  panelSig = '';
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  frames += 1;
  if (now - fpsStamp > 500) {
    fps = Math.round((frames * 1000) / (now - fpsStamp));
    frames = 0;
    fpsStamp = now;
  }
  if (fpsProbe) {
    fpsProbe.frames += 1;
    if (now - fpsProbe.start >= fpsProbe.dur) {
      const sample = Math.round((fpsProbe.frames * 1000) / (now - fpsProbe.start) * 10) / 10;
      const done = fpsProbe.done;
      fpsProbe = null;
      done(sample);
    }
  }
  if (toastUntil && now > toastUntil) toast.hidden = true;

  const pan = 520 / camera.zoom;
  if (playing && uiSettings.edgeScroll && lastMouse.mouse && pointers.size === 0) {
    const rect = worldCanvas.getBoundingClientRect();
    const margin = 28;
    if (lastMouse.x > rect.left && lastMouse.x < rect.right && lastMouse.y > rect.top && lastMouse.y < rect.bottom) {
      if (lastMouse.x < rect.left + margin) camera.x -= pan * dt;
      if (lastMouse.x > rect.right - margin) camera.x += pan * dt;
      if (lastMouse.y < rect.top + margin) camera.y -= pan * dt;
      if (lastMouse.y > rect.bottom - margin) camera.y += pan * dt;
    }
  }
  if (playing && keys.has('w')) camera.y -= pan * dt;
  if (playing && keys.has('s')) camera.y += pan * dt;
  if (playing && keys.has('a')) camera.x -= pan * dt;
  if (playing && keys.has('d')) camera.x += pan * dt;
  if (playing && keys.has('arrowup')) camera.y -= pan * dt;
  if (playing && keys.has('arrowdown')) camera.y += pan * dt;
  if (playing && keys.has('arrowleft')) camera.x -= pan * dt;
  if (playing && keys.has('arrowright')) camera.x += pan * dt;

  if (!playing) {
    const intended = camera.x + 22 * dt * titleDir;
    camera.x = intended;
    clampView();
    if (camera.x < intended - 0.01) titleDir = -1;
    else if (camera.x > intended + 0.01) titleDir = 1;
  } else if (netMode && state.outcome === 'playing') {
    net.pump(now);
  } else if (speed > 0 && state.outcome === 'playing') {
    acc += dt * TICKS_PER_SECOND * speed;
    let guard = 0;
    while (acc >= 1 && guard < 8) {
      const commands = guard === 0 ? queue.splice(0) : [];
      if (campaignSession) advanceCampaign(state, campaignSession, commands);
      else step(state, commands, guideOn && !netMode ? { shelter: true } : undefined);
      if (!netMode && !guideOn && state.tick > 0 && state.tick % (TICKS_PER_GAME_MINUTE * 2) === 0) {
        void storeSlot('auto');
      }
      acc -= 1;
      guard += 1;
    }
  }

  if (playing) clampView();
  const { w, h } = viewSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const liveMarkers = markers.filter((marker) => now - marker.born < 1400);
  if (liveMarkers.length !== markers.length) {
    markers.length = 0;
    markers.push(...liveMarkers);
  }
  renderWorld(ctx, state, camera, w, h, dpr, baked, ghost(), selectedId, now, selectedPersonId, {
    selected: selectedSoldiers,
    box:
      pointerMode === 'box' && dragDist >= 8
        ? { x: boxStart.x, y: boxStart.y, w: boxNow.x - boxStart.x, h: boxNow.y - boxStart.y }
        : null,
    markers: liveMarkers,
  });
  renderMinimap(miniCtx, state, camera, w, h, baked, miniCanvas.width, miniCanvas.height);
  if (playing) syncHud();
  else {
    hintEl.hidden = true;
    tipEl.hidden = true;
    armyEl.hidden = true;
    goalsEl.hidden = true;
  }
  audio.follow(
    state,
    localPlayer,
    camera,
    w,
    h,
    playing,
    state.outcome === 'playing' ? null : viewerWon(state, localPlayer, netMode),
  );
  requestAnimationFrame(frame);
}

function stageAiScene(kind: string) {
  const foe = state.players.find((player) => player.isAi && player.personality === (kind === 'ai-walls' ? 'builder' : 'warlord')) ?? state.players[1];
  const home = playerKeep(state, localPlayer);
  const nest = foe ? playerKeep(state, foe.id) : undefined;
  if (!home || !foe || !nest) return;
  if (kind === 'ai-walls') {
    nest.level = 3;
    const put = (type: BuildingType, x: number, y: number) => createBuilding(state, foe.id, type, x, y, true);
    const x0 = nest.x - 3;
    const x1 = nest.x + 6;
    const y0 = nest.y - 3;
    const y1 = nest.y + 6;
    const gateX = nest.x + 1;
    for (let x = x0; x <= x1; x++) {
      put(x === gateX ? 'gate' : 'palisade', x, y0);
      put(x === gateX ? 'gate' : 'palisade', x, y1);
    }
    for (let y = y0 + 1; y < y1; y++) put('palisade', x0, y);
    for (let y = y0 + 1; y < y1; y++) put('palisade', x1, y);
    put('stairs', nest.x + 1, y1 - 1);
    const west = put('woodtower', x0 - 2, y0 - 1);
    const east = put('stonetower', x1 + 1, y1 - 1);
    put('brazier', gateX + 2, y1 + 1);
    const man = (tower: { x: number; y: number }, ox: number, oy: number) => {
      const archer = createSoldier(state, foe.id, tower.x + ox, tower.y + oy, 'bow');
      archer.order = 'defend';
    };
    man(west, 0.75, 0.75);
    man(east, 0.8, 0.85);
    lookAtPoint(nest.x + 1.6, nest.y + 2.2);
    camera.zoom = 0.92;
    clampView();
    return;
  }
  const granary = createBuilding(state, localPlayer, 'granary', home.x + 5, home.y, true);
  const farm = createBuilding(state, localPlayer, 'orchard', home.x + 5, home.y + 4, true);
  const spot = buildingCenter(farm);
  const frontX = spot.x + 5.2;
  const frontY = spot.y + 1.6;
  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const soldier = createSoldier(state, foe.id, frontX + col * 0.95, frontY + row * 0.95, i < 4 ? 'club' : 'bow');
    soldier.order = 'attack';
    soldier.targetKind = 'building';
    soldier.targetId = granary.id;
    soldier.destX = spot.x;
    soldier.destY = spot.y;
  }
  for (const mob of state.mobs) {
    if (Math.hypot(mob.x - spot.x, mob.y - spot.y) < 9) {
      mob.x += 24;
      mob.y += 16;
    }
  }
  const line = 'Воевода угрожает вам';
  if (!state.log.includes(line)) state.log.push(line);
  if (state.log.length > 8) state.log.shift();
  markers.push({ kind: 'attack', x: spot.x, y: spot.y, born: performance.now() });
  lookAtPoint((spot.x + frontX) / 2, (spot.y + frontY) / 2);
  camera.zoom = 1.08;
  clampView();
}

function hushShowcase() {
  guideOn = false;
  tutorial.hidden = true;
  hintEl.hidden = true;
  banner.hidden = true;
  state.log = [];
  logSig = '\0';
  state.message = '';
  if (state.tick < 18 * TICKS_PER_GAME_MINUTE) state.tick = 18 * TICKS_PER_GAME_MINUTE;
  selectedId = null;
  selectedPersonId = null;
  panel.hidden = true;
  panelSig = '';
}

function paveRoad(x: number, y: number) {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return;
  if (!state.roads || state.roads.length !== state.mapW * state.mapH) state.roads = new Uint8Array(state.mapW * state.mapH);
  state.roads[y * state.mapW + x] = 1;
}

function shoveHostiles(x: number, y: number, radius: number) {
  for (const mob of state.mobs) {
    if (!mob.alive) continue;
    if (Math.hypot(mob.x - x, mob.y - y) >= radius) continue;
    mob.x += 36;
    mob.y += 22;
    mob.destX = mob.x;
    mob.destY = mob.y;
  }
}

function expose() {
  window.__game = {
    suggest(type: string) {
      return suggestedTile(state, localPlayer, type as BuildingType);
    },
    focusTile(x: number, y: number) {
      lookAtTile(x, y);
      clampView();
    },
    focusHome() {
      const keep = playerKeep(state, localPlayer);
      if (!keep) return;
      const center = buildingCenter(keep);
      lookAtPoint(center.x, center.y);
      clampView();
    },
    zoom(z: number) {
      camera.zoom = Math.max(0.05, Math.min(ZOOM_MAX, z));
      clampView();
    },
    tileCenter(x: number, y: number) {
      const { w, h } = viewSize();
      return worldToScreen(camera, w, h, x + 0.5, y + 0.5);
    },
    select(id: number) {
      selectedId = id;
      panelSig = '';
    },
    setSpeed(n: number) {
      setSpeed(n);
    },
    debugArmy() {
      state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
      const keep = playerKeep(state, localPlayer);
      if (!keep) return [];
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) {
        const soldier = createSoldier(
          state,
          localPlayer,
          keep.x + 0.6 + (i % 2) * 1.1,
          keep.y + 3.4 + Math.floor(i / 2) * 0.9,
          i < 2 ? 'club' : 'sword',
        );
        ids.push(soldier.id);
      }
      createMob(state, 'bandit', keep.x + 11, keep.y + 7);
      return ids;
    },
    armyPoints() {
      const { w, h } = viewSize();
      return state.soldiers
        .filter((s) => s.playerId === localPlayer && s.hp > 0)
        .map((s) => ({ id: s.id, ...worldToScreen(camera, w, h, s.x, s.y) }));
    },
    banditScreen() {
      const mob = state.mobs.find((m) => m.alive && m.kind === 'bandit');
      if (!mob) return null;
      const { w, h } = viewSize();
      return worldToScreen(camera, w, h, mob.x, mob.y);
    },
    markerKind() {
      const live = markers.filter((marker) => performance.now() - marker.born < 1400);
      return live.length ? live[live.length - 1].kind : '';
    },
    debugScene(kind: string) {
      setSpeed(0);
      selectedId = null;
      selectedPersonId = null;
      placing = null;
      panel.hidden = true;
      if (kind === 'mid') {
        guideOn = false;
        const player = state.players[localPlayer];
        player.difficulty = 'normal';
        player.personality = 'builder';
        const horizon = 16 * TICKS_PER_GAME_MINUTE;
        while (state.tick < horizon && state.outcome === 'playing') {
          const command = state.tick % 40 === 0 ? planOneAi(state, player) : null;
          step(state, command ? [command] : []);
        }
        const home = playerKeep(state, localPlayer);
        if (home) {
          lookAtPoint(home.x + 3, home.y + 2);
          camera.zoom = 0.72;
          clampView();
        }
        return;
      }
      if (kind === 'ai-attack' || kind === 'ai-walls') {
        stageAiScene(kind);
        return;
      }
      const keep = playerKeep(state, localPlayer);
      if (!keep) return;
      state.buildings = state.buildings.filter((building) => building.id === keep.id);
      const put = (type: BuildingType, x: number, y: number, level = 1, progress?: number) => {
        const building = createBuilding(state, localPlayer, type, x, y, progress === undefined);
        building.level = level;
        if (progress !== undefined) building.buildProgress = progress;
        return building;
      };
      const line = (types: BuildingType[], x: number, y: number, levels?: number[]) => {
        const placed = [];
        for (let i = 0; i < types.length; i++) {
          const type = types[i];
          placed.push(put(type, x, y, levels?.[i] ?? 1));
          const step = Math.max(BUILDINGS[type].w, BUILDINGS[type].h) + 1;
          x += step;
          y -= step;
        }
        return placed;
      };
      const focusAverage = (list: { x: number; y: number; type: BuildingType }[], biasY: number) => {
        let sx = 0;
        let sy = 0;
        for (const building of list) {
          const def = BUILDINGS[building.type];
          sx += building.x + def.w / 2;
          sy += building.y + def.h / 2;
        }
        lookAtPoint(sx / list.length, sy / list.length + biasY);
      };
      if (kind === 'housing') {
        const placed = line(['shack', 'cabin', 'house', 'khrush', 'highrise'], keep.x + 20, keep.y + 6);
        focusAverage(placed, -1.2);
        camera.zoom = 1.02;
      } else if (kind === 'keep') {
        keep.level = 1;
        const row = [keep];
        let x = keep.x;
        let y = keep.y;
        for (let level = 2; level <= 5; level++) {
          x += 4;
          y -= 4;
          row.push(put('keep', x, y, level));
        }
        focusAverage(row, -2.4);
        camera.zoom = 0.82;
      } else if (kind === 'food') {
        const top = line(['orchard', 'dairy', 'wheat', 'mill'], keep.x + 28, keep.y - 4);
        const bottom = line(['bakery', 'hop', 'brewery', 'tavern'], keep.x + 28, keep.y + 5);
        focusAverage([...top, ...bottom], -1.2);
        camera.zoom = 1.05;
      } else if (kind === 'site') {
        const house = put('house', keep.x + 22, keep.y, 1, Math.floor(BUILDINGS.house.buildTicks * 0.45));
        const shack = put('shack', keep.x + 26, keep.y - 4, 1, Math.floor(BUILDINGS.shack.buildTicks * 0.7));
        focusAverage([house, shack], -0.6);
        camera.zoom = 1.55;
      } else if (kind === 'walls' || kind === 'siege') {
        keep.level = 4;
        state.players[localPlayer].stocks.wood = 200;
        state.players[localPlayer].stocks.stone = 200;
        state.players[localPlayer].stocks.iron = 40;
        state.players[localPlayer].stocks.pitch = 20;
        const x0 = keep.x - 2;
        const x1 = keep.x + 4;
        const y0 = keep.y - 2;
        const y1 = keep.y + 4;
        const gateX = keep.x + 1;
        for (let x = x0; x <= x1; x++) {
          put(x === gateX ? 'gate' : 'palisade', x, y0);
          if (x !== gateX) put('palisade', x, y1);
          else put('gate', x, y1);
        }
        for (let y = y0 + 1; y < y1; y++) {
          put(y === keep.y + 1 ? 'stairs' : 'palisade', x0, y);
          put('palisade', x1, y);
        }
        const south = kind === 'siege';
        const west = put('woodtower', x0 - 2, south ? y1 - 1 : y0 - 1);
        const east = put('stonetower', x1 + 1, south ? y1 - 1 : y0 - 1);
        put('brazier', south ? gateX - 1 : gateX + 1, y1 + 1);
        const ditch = put('pitchditch', gateX, y1 + 1);
        const extra = south ? put('pitchditch', gateX + 1, y1 + 1) : null;
        if (south) {
          ditch.buffer = 1;
          ditch.work = 80;
          if (extra) {
            extra.buffer = 1;
            extra.work = 80;
          }
        }
        const man = (tower: { x: number; y: number }, ox: number, oy: number) => {
          const archer = createSoldier(state, localPlayer, tower.x + ox, tower.y + oy, 'bow');
          archer.order = 'defend';
        };
        man(west, 0.95, 0.85);
        man(east, 1.05, 0.9);
        if (south) {
          if (!state.players[1]) {
            state.players.push({
              id: 1,
              name: 'Осада',
              isAi: true,
              alive: true,
              side: 'south',
              spawnX: gateX,
              spawnY: y1 + 8,
              color: '#d6453d',
              gold: 0,
              stocks: emptyStocks(),
              popularity: 10,
              ration: 'normal',
              tax: 'low',
              hunger: false,
              beerMood: 0,
              migrate: 0,
              stats: emptyStats(0),
              difficulty: 'hard',
              personality: 'warlord',
            });
          }
          const gate = state.buildings.find((building) => building.type === 'gate' && building.y === y1);
          const ram = createSoldier(state, 1, gateX + 0.25, y1 + 2.15, 'ram');
          ram.order = 'attack';
          ram.targetKind = 'building';
          ram.targetId = gate?.id ?? keep.id;
          ram.destX = gateX + 0.5;
          ram.destY = y1 + 0.8;
          const catapult = createSoldier(state, 1, gateX + 2.2, y1 + 3.25, 'catapult');
          catapult.order = 'attack';
          catapult.targetKind = 'building';
          catapult.targetId = gate?.id ?? keep.id;
          const stocks = state.players[localPlayer].stocks;
          stocks.apples = Math.max(stocks.apples, 64);
          stocks.wood = Math.max(stocks.wood, 40);
          for (const person of state.people) {
            if (person.playerId !== localPlayer || person.hp <= 0) continue;
            person.x = keep.x + 1.15 + (person.id % 3) * 0.4;
            person.y = keep.y + 1.35;
            person.destX = person.x;
            person.destY = person.y;
            person.cargo = null;
            person.task = { type: 'work', buildingId: keep.id, mode: 'labor', targetId: 0 };
          }
          shoveHostiles(gateX, y1, 22);
          for (const beast of state.oxen) {
            beast.x += 48;
            beast.y += 28;
            beast.destX = beast.x;
            beast.destY = beast.y;
          }
          hushShowcase();
          lookAtPoint(gateX + 2.2, y1 + 1.15);
          camera.zoom = 1.55;
        } else {
          lookAtPoint(gateX + 0.5, keep.y + 1.5);
          camera.zoom = 1.12;
        }
      } else {
        keep.level = 3;
        const granary = put('granary', keep.x + 4, keep.y);
        const stock = put('stockpile', keep.x + 8, keep.y + 1);
        put('shack', keep.x - 3, keep.y + 1);
        put('cabin', keep.x - 3, keep.y + 4);
        put('house', keep.x + 4, keep.y + 4);
        const woodcutter = put('woodcutter', keep.x + 7, keep.y + 4);
        const orchard = put('orchard', keep.x - 6, keep.y - 4);
        const wheat = put('wheat', keep.x + 4, keep.y - 4);
        const bakery = put('bakery', keep.x + 11, keep.y - 2);
        put('khrush', keep.x + 8, keep.y + 8);
        for (let i = -2; i <= 9; i++) paveRoad(keep.x + i, keep.y + 3);
        for (let i = 1; i <= 3; i++) paveRoad(keep.x + 1, keep.y + 3 - i);
        for (let i = 1; i <= 2; i++) paveRoad(keep.x - 4, keep.y + 3 - i);
        const hands = state.people.filter((person) => person.playerId === localPlayer && person.hp > 0);
        const post = (
          person: (typeof hands)[number] | undefined,
          building: ReturnType<typeof put>,
          x: number,
          y: number,
          cargo: Resource | null,
          join: boolean,
        ) => {
          const worker = person ?? createPerson(state, localPlayer, x, y, building.id);
          worker.x = x;
          worker.y = y;
          worker.destX = x;
          worker.destY = y;
          worker.cargo = cargo;
          worker.task = { type: 'work', buildingId: building.id, mode: 'labor', targetId: 0 };
          if (join && !building.workerIds.includes(worker.id)) building.workerIds.push(worker.id);
          return worker;
        };
        const defOf = (building: ReturnType<typeof put>) => BUILDINGS[building.type];
        post(hands[0], orchard, orchard.x + defOf(orchard).w * 0.45, orchard.y + defOf(orchard).h + 0.2, 'apples', true);
        post(hands[1], wheat, wheat.x + 0.8, wheat.y + defOf(wheat).h + 0.15, 'bread', true);
        post(hands[2], woodcutter, woodcutter.x + 0.7, woodcutter.y + defOf(woodcutter).h + 0.2, 'wood', true);
        post(hands[3], bakery, bakery.x + 1.1, bakery.y + defOf(bakery).h + 0.25, 'bread', true);
        post(hands[4], granary, keep.x + 2.4, keep.y + 3.35, 'apples', false);
        const porter = createPerson(state, localPlayer, keep.x + 5.6, keep.y + 3.15, 4);
        porter.cargo = 'wood';
        porter.task = { type: 'work', buildingId: stock.id, mode: 'labor', targetId: 0 };
        porter.destX = porter.x;
        porter.destY = porter.y;
        const ox = createOx(state, localPlayer, stock.id, keep.x + 0.4, keep.y + 3.45);
        ox.cargo = 'stone';
        ox.cargoQty = 4;
        const stocks = state.players[localPlayer].stocks;
        stocks.apples = Math.max(stocks.apples, 48);
        stocks.wood = Math.max(stocks.wood, 36);
        stocks.bread = Math.max(stocks.bread, 12);
        stocks.stone = Math.max(stocks.stone, 22);
        shoveHostiles(keep.x, keep.y, 22);
        hushShowcase();
        lookAtPoint(keep.x + 2.2, keep.y + 1.4);
        camera.zoom = 0.9;
      }
      clampView();
    },
    focusArmy() {
      const mine = state.soldiers.filter((s) => s.playerId === localPlayer && s.hp > 0);
      const bandit = state.mobs.find((m) => m.alive && m.kind === 'bandit');
      if (!mine.length) return;
      let x = mine.reduce((sum, s) => sum + s.x, 0) / mine.length;
      let y = mine.reduce((sum, s) => sum + s.y, 0) / mine.length;
      if (bandit) {
        x = (x + bandit.x) / 2;
        y = (y + bandit.y) / 2;
      }
      lookAtPoint(x, y);
      clampView();
    },
    snapshot() {
      return {
        tick: state.tick,
        idle: idleCount(state, localPlayer),
        used: usedCount(state, localPlayer),
        cap: housingCap(state, localPlayer),
        popularity: state.players[localPlayer]?.popularity ?? 0,
        people: state.people.filter((p) => p.playerId === localPlayer).length,
        apples: state.players[localPlayer]?.stocks.apples ?? 0,
        buildings: state.buildings
          .filter((b) => b.playerId === localPlayer)
          .map((b) => ({
            id: b.id,
            type: b.type,
            complete: b.complete,
            workers: b.workerIds.length,
            x: b.x,
            y: b.y,
          })),
      };
    },
    mp() {
      return {
        hash: net.hash(),
        turn: net.turn(),
        tick: state.tick,
        local: localPlayer,
        names: state.players.map((p) => p.name),
      };
    },
    cleanupNet() {
      return net.destroyMatch();
    },
    debugBoard() {
      setSpeed(0);
      state.players.forEach((player, index) => {
        player.gold = 180 + index * 220;
        if (player.stats) {
          player.stats.goldEarned = index * 40;
          player.stats.peakPop = 5 + index;
        }
        const keep = playerKeep(state, player.id);
        if (keep && index > 0) keep.level = Math.min(5, 1 + index);
      });
      const line = 'Сосед «Ковыль» достиг 4 уровня';
      if (!state.log.includes(line)) state.log.push(line);
      if (state.log.length > 8) state.log.shift();
    },
    playCampaignScript() {
      if (!campaignSession) return null;
      const scenario = scenarioById(campaignSession.id);
      if (!scenario) return null;
      setSpeed(0);
      const cap = scenario.proofMinutes * TICKS_PER_GAME_MINUTE;
      while (state.outcome === 'playing' && state.tick < cap) {
        const command = botCommand(scenario.bot, state);
        advanceCampaign(state, campaignSession, command ? [command] : []);
      }
      return { outcome: state.outcome, tick: state.tick };
    },
    measureFps(ms: number) {
      return new Promise<number>((resolve) => {
        fpsProbe = { start: performance.now(), frames: 0, dur: Math.max(200, ms), done: resolve };
      });
    },
    setChunks(on: boolean) {
      setTerrainChunks(on);
    },
    focusTerrain(kind: string, zoom?: number) {
      const want = kind === 'road' ? Terrain.Road : Terrain.Desert;
      let best: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      for (let y = 3; y < state.mapH - 3; y++) {
        for (let x = 3; x < state.mapW - 3; x++) {
          if (state.terrain[y * state.mapW + x] !== want) continue;
      let score = 0;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= state.mapW || ny >= state.mapH) continue;
          if (state.terrain[ny * state.mapW + nx] === want) score += 1;
        }
      }
          for (const building of state.buildings) {
            if (building.hp <= 0) continue;
            if (Math.abs(building.x - x) < 8 && Math.abs(building.y - y) < 8) score -= 30;
          }
          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
      if (!best) return;
      selectedId = null;
      selectedPersonId = null;
      panel.hidden = true;
      panelSig = '';
      hideMenu();
      lookAtPoint(best.x, best.y);
      camera.zoom = typeof zoom === 'number' ? zoom : 2.55;
      clampView();
      setSpeed(0);
    },
    offerInstall() {
      showInstallOffer();
    },
    setGfxMode(mode: 'high' | 'simple') {
      setGfx(mode);
      clearTerrainChunks();
      baked = bakeTerrain(state);
    },
    stageRoad() {
      const keep = playerKeep(state, localPlayer);
      if (!keep) return;
      const y = keep.y + 3;
      for (let x = keep.x; x <= keep.x + 4; x++) queue.push({ kind: 'road', playerId: localPlayer, x, y });
      const person = state.people.find((p) => p.playerId === localPlayer && p.hp > 0);
      if (person) {
        person.x = keep.x + 0.6;
        person.y = y + 0.45;
        person.destX = keep.x + 4.2;
        person.destY = y + 0.45;
        person.task = { type: 'idle' };
        person.idlePhase = 90;
      }
      lookAtPoint(keep.x + 2, y);
      camera.zoom = 1.6;
      clampView();
      setSpeed(1);
    },
    debugResults() {
      setSpeed(0);
      state.tick = 18 * 60 + 12;
      const target = state.match?.goldTarget ?? 2000;
      if (state.match?.victory === 'wealth') {
        state.players.forEach((player, index) => {
          player.gold = player.id === localPlayer ? target : Math.max(0, target - 400 - index * 120);
        });
      }
      state.players.forEach((player, index) => {
        if (state.match?.victory !== 'wealth') player.gold = 400 + index * 180;
        if (!player.stats) player.stats = emptyStats(5);
        player.stats.peakPop = 6 + index;
        player.stats.goldEarned = 80 + index * 30;
        player.stats.buildings = 3 + index;
        player.stats.soldiers = index;
        player.stats.kills = index * 2;
        player.stats.razed = index === 0 ? 1 : 0;
        player.stats.food.apples = 12 + index;
        player.stats.food.cheese = index;
        player.stats.food.meat = index;
        player.stats.food.bread = index * 2;
      });
      state.samples = [0, 6, 12, 18].map((minute, stepIndex) => ({
        t: minute * 60,
        pop: state.players.map((_, index) => 5 + stepIndex + index),
        gold: state.players.map((_, index) => 100 + stepIndex * 40 + index * 20),
      }));
      state.winnerId = localPlayer;
      state.outcome = 'victory';
    },
  };
}

worldCanvas.addEventListener('pointerdown', (event) => {
  worldCanvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    window.clearTimeout(longTimer);
    pointerMode = 'none';
    pinchMid = null;
    return;
  }
  dragging = true;
  dragDist = 0;
  longHandled = false;
  lastPtr = { x: event.clientX, y: event.clientY };
  const rect = worldCanvas.getBoundingClientRect();
  boxStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  boxNow = { ...boxStart };
  const touch = event.pointerType === 'touch';
  const downRect = worldCanvas.getBoundingClientRect();
  const downTile = screenToTile(camera, viewSize().w, viewSize().h, event.clientX - downRect.left, event.clientY - downRect.top);
  const lineDrag = playing && !!placing && isLineBuilding(placing) && (event.button === 0 || touch);
  const roadDrag = playing && roadMode && (event.button === 0 || touch);
  const selectDrag = playing && (event.button === 0 || touch) && (!touch || boxMode);
  if (lineDrag) {
    pointerMode = 'wall';
    wallAnchor = { x: downTile.x, y: downTile.y };
  } else if (roadDrag) {
    pointerMode = 'road';
    wallAnchor = { x: downTile.x, y: downTile.y };
  } else if (selectDrag) {
    pointerMode = 'box';
    boxAdditive = event.shiftKey;
    boxBase = boxAdditive ? [...selectedSoldiers] : [];
  } else {
    pointerMode = 'pan';
    if (touch && playing && !boxMode) {
      window.clearTimeout(longTimer);
      longTimer = window.setTimeout(() => {
        if (dragDist >= 14 || pointers.size !== 1) return;
        let found: number | null = null;
        for (const building of state.buildings) {
          if (building.hp <= 0) continue;
          const def = BUILDINGS[building.type];
          if (downTile.x >= building.x && downTile.x < building.x + def.w && downTile.y >= building.y && downTile.y < building.y + def.h) {
            found = building.id;
          }
        }
        if (found != null) {
          selectedId = found;
          selectedPersonId = null;
          panelSig = '';
          pointerMode = 'none';
          longHandled = true;
          return;
        }
        pointerMode = 'box';
        boxAdditive = false;
        boxBase = [];
        boxStart = { ...boxNow };
      }, 480);
    }
  }
});
worldCanvas.addEventListener('pointermove', (event) => {
  const rect = worldCanvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const { w, h } = viewSize();
  hover = screenToTile(camera, w, h, localX, localY);
  updateTip(event.clientX, event.clientY);
  if (event.pointerType === 'mouse') lastMouse = { x: event.clientX, y: event.clientY, mouse: true };
  else lastMouse = { x: event.clientX, y: event.clientY, mouse: false };
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (pinch > 0 && pinchMid) {
      camera.x -= (mid.x - pinchMid.x) / camera.zoom;
      camera.y -= (mid.y - pinchMid.y) / camera.zoom;
      camera.zoom = Math.min(ZOOM_MAX, camera.zoom * (dist / pinch));
      clampView();
    }
    pinch = dist;
    pinchMid = mid;
    dragging = false;
    pointerMode = 'none';
    window.clearTimeout(longTimer);
    return;
  }
  pinch = 0;
  pinchMid = null;
  if (!dragging) return;
  const dx = event.clientX - lastPtr.x;
  const dy = event.clientY - lastPtr.y;
  dragDist += Math.hypot(dx, dy);
  boxNow = { x: localX, y: localY };
  if (pointerMode === 'box') {
    if (dragDist >= 8) paintBox();
  } else if (pointerMode !== 'wall' && pointerMode !== 'road') {
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    clampView();
  }
  lastPtr = { x: event.clientX, y: event.clientY };
});
worldCanvas.addEventListener('pointerup', (event) => {
  const start = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  window.clearTimeout(longTimer);
  if (pointers.size < 2) {
    pinch = 0;
    pinchMid = null;
  }
  if (pointers.size === 0) {
    if (pointerMode === 'road' && wallAnchor && roadMode) {
      const end = hover ?? wallAnchor;
      for (const cell of wallLine(wallAnchor.x, wallAnchor.y, end.x, end.y)) {
        pushCmd({ kind: 'road', playerId: localPlayer, x: cell.x, y: cell.y });
      }
      roadMode = false;
      wallAnchor = null;
      pointerMode = 'none';
      dragging = false;
      worldCanvas.classList.remove('placing');
      return;
    }
    if (pointerMode === 'wall' && wallAnchor && placing && isLineBuilding(placing)) {
      const end = hover ?? wallAnchor;
      const type = placing;
      for (const cell of wallLine(wallAnchor.x, wallAnchor.y, end.x, end.y)) {
        pushCmd({ kind: 'place', playerId: localPlayer, building: type, x: cell.x, y: cell.y });
      }
      placing = null;
      wallAnchor = null;
      pointerMode = 'none';
      dragging = false;
      worldCanvas.classList.remove('placing');
      return;
    }
    lastGesture = dragDist;
    const boxed = pointerMode === 'box' && dragDist >= 8;
    pointerMode = 'none';
    dragging = false;
    if (longHandled) {
      longHandled = false;
      return;
    }
    if (!boxed && dragDist < 8 && playing && (event.button === 0 || event.pointerType === 'touch')) {
      const rect = worldCanvas.getBoundingClientRect();
      onMapClick((start?.x ?? event.clientX) - rect.left, (start?.y ?? event.clientY) - rect.top, event.shiftKey, event.pointerType === 'touch');
    }
  } else dragging = true;
});
worldCanvas.addEventListener('pointercancel', (event) => {
  pointers.delete(event.pointerId);
  window.clearTimeout(longTimer);
  dragging = false;
  pointerMode = 'none';
});
worldCanvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    camera.zoom = Math.min(ZOOM_MAX, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
    clampView();
  },
  { passive: false },
);
worldCanvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const wasPlacing = placing != null || roadMode;
  placing = null;
  roadMode = false;
  wallAnchor = null;
  worldCanvas.classList.remove('placing');
  if (!playing || wasPlacing || lastGesture >= 8 || !selectedSoldiers.size) return;
  const rect = worldCanvas.getBoundingClientRect();
  orderAt(event.clientX - rect.left, event.clientY - rect.top);
});
miniCanvas.addEventListener('pointerdown', (event) => {
  if (!playing) return;
  const rect = miniCanvas.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / rect.width) * miniCanvas.width;
  const py = ((event.clientY - rect.top) / rect.height) * miniCanvas.height;
  const tile = minimapToTile(state.mapW, state.mapH, miniCanvas.width, miniCanvas.height, px, py);
  lookAtPoint(tile.x, tile.y);
  clampView();
});
document.querySelector<HTMLButtonElement>('#home')!.onclick = () => {
  const keep = playerKeep(state, localPlayer);
  if (!keep) return;
  const center = buildingCenter(keep);
  lookAtPoint(center.x, center.y);
  camera.zoom = 1.15;
  clampView();
};

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (playing && !event.repeat && (event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    controlGroups[Number(event.key)] = [...selectedSoldiers];
    flash(`Отряд ${event.key}`);
    return;
  }
  if (playing && !event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
    const n = Number(event.key);
    const living = controlGroups[n].filter((id) => state.soldiers.some((s) => s.id === id && s.hp > 0 && s.playerId === localPlayer));
    if (living.length) {
      event.preventDefault();
      if (!event.repeat) {
        const now = performance.now();
        selectedSoldiers.clear();
        for (const id of living) selectedSoldiers.add(id);
        if (lastGroupTap.n === n && now - lastGroupTap.at < 400) centreSquad(living);
        lastGroupTap = { n, at: now };
        noteFirstSelection();
        syncArmy();
      }
      return;
    }
  }
  if (key === 'a' && !event.ctrlKey && !event.metaKey && !event.altKey && playing && selectedSoldiers.size) {
    event.preventDefault();
    if (!event.repeat) {
      attackArmed = !attackArmed;
      syncArmy();
    }
    return;
  }
  if (playing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const cats: Partial<Record<string, keyof typeof CATEGORY_NAME>> = {
      z: 'housing',
      x: 'food',
      c: 'industry',
      v: 'military',
      b: 'storage',
      n: 'defence',
    };
    const next = cats[key];
    if (next) {
      category = next;
      paintBuildButtons();
      return;
    }
  }
  keys.add(key);
  if (event.code === 'Space') {
    event.preventDefault();
    if (!netMode) setSpeed(speed === 0 ? 1 : 0);
  } else if (!netMode && event.key === '1') setSpeed(1);
  else if (!netMode && event.key === '2') setSpeed(2);
  else if (!netMode && event.key === '3') setSpeed(3);
  else if (event.key === 'Escape') {
    if (closeOverlay()) return;
    placing = null;
    roadMode = false;
    worldCanvas.classList.remove('placing');
    selectedId = null;
    selectedPersonId = null;
    attackArmed = false;
    selectedSoldiers.clear();
    syncArmy();
  } else if (event.key.toLowerCase() === 'h' && playing && !guideOn) {
    tutorialStep = 0;
    showTutorial();
  } else if (event.key === '+' || event.key === '=') {
    camera.zoom = Math.min(ZOOM_MAX, camera.zoom * 1.1);
    clampView();
  } else if (event.key === '-' || event.key === '_') {
    camera.zoom *= 0.9;
    clampView();
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) event.preventDefault();
  },
  { passive: false },
);
window.addEventListener('resize', resize);
document.addEventListener('pointerover', (event) => {
  if (event.target instanceof HTMLButtonElement) audio.play('ui-hover');
});
document.addEventListener('pointerdown', (event) => {
  const target = event.target;
  if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) audio.play('ui-click');
});

declare global {
  interface Window {
    __game?: {
      suggest: (type: string) => { x: number; y: number } | null;
      focusTile: (x: number, y: number) => void;
      focusHome: () => void;
      zoom: (z: number) => void;
      tileCenter: (x: number, y: number) => { x: number; y: number };
      select: (id: number) => void;
      setSpeed: (n: number) => void;
      debugArmy: () => number[];
      armyPoints: () => { id: number; x: number; y: number }[];
      banditScreen: () => { x: number; y: number } | null;
      markerKind: () => string;
      focusArmy: () => void;
      snapshot: () => {
        tick: number;
        idle: number;
        used: number;
        cap: number;
        popularity: number;
        people: number;
        apples: number;
        buildings: { id: number; type: string; complete: boolean; workers: number; x: number; y: number }[];
      };
      mp: () => { hash: string; turn: number; tick: number; local: number; names: string[] };
      cleanupNet: () => Promise<void>;
      debugScene: (kind: string) => void;
      debugBoard: () => void;
      debugResults: () => void;
      playCampaignScript: () => { outcome: string; tick: number } | null;
      measureFps: (ms: number) => Promise<number>;
      setChunks: (on: boolean) => void;
      focusTerrain: (kind: string, zoom?: number) => void;
      offerInstall: () => void;
      setGfxMode: (mode: 'high' | 'simple') => void;
      stageRoad: () => void;
    };
  }
}

armyBox.onclick = () => {
  boxMode = !boxMode;
  syncArmy();
};
document.querySelector<HTMLButtonElement>('#army-hold')!.onclick = () => issueArmy('hold', 0, 0);
document.querySelector<HTMLButtonElement>('#army-home')!.onclick = () => {
  const keep = playerKeep(state, localPlayer);
  const center = keep ? buildingCenter(keep) : { x: 0, y: 0 };
  issueArmy('home', center.x, center.y + 1.6);
};
document.querySelector<HTMLButtonElement>('#army-clear')!.onclick = () => {
  selectedSoldiers.clear();
  attackArmed = false;
  syncArmy();
};
armyAttack.onclick = () => {
  attackArmed = !attackArmed;
  syncArmy();
};

function syncPresence() {
  const node = document.querySelector<HTMLElement>('#presence');
  if (!node) return;
  if (!netMode || !playing) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  node.hidden = false;
  node.replaceChildren();
  for (const line of net.presenceLines()) {
    const span = document.createElement('span');
    span.textContent = `${line.name}: ${line.online ? 'в сети' : 'не в сети'}`;
    node.append(span);
  }
}

function beginNet(next: GameState, playerId: number) {
  state = next;
  localPlayer = playerId;
  netMode = true;
  netPace = net.speed();
  campaignSession = null;
  baked = bakeTerrain(state);
  const keep = playerKeep(state, localPlayer);
  if (keep) {
    const center = buildingCenter(keep);
    lookAtPoint(center.x, center.y);
  }
  camera.zoom = 1.15;
  clampView();
  playing = true;
  speed = 1;
  placing = null;
  selectedId = compactLayout() ? null : (keep?.id ?? null);
  selectedPersonId = null;
  queue = [];
  acc = 0;
  resetArmy();
  title.hidden = true;
  endScreen.hidden = true;
  menu.hidden = true;
  tutorial.hidden = true;
  guideOn = false;
  netView.hide();
  netView.wait(null, null);
  buildChrome();
  setSpeed(1);
  expose();
}

let inviteHandled = false;

function openNet() {
  rememberName();
  title.hidden = true;
  playing = false;
  const setup = readSetup();
  netView.showList({
    victory: setup.victory,
    timeLimit: setup.timeLimit,
    map: setup.map,
    start: setup.start,
    ai: Math.max(0, Math.min(3, setup.ai)),
    goldTarget: setup.goldTarget,
    popTarget: setup.popTarget,
    surviveMinutes: setup.surviveMinutes,
    difficulty: setup.profiles?.[0]?.difficulty ?? 'normal',
  });
  void net.listenList().catch((err) => netMessage(err, 'Не удалось открыть список'));
  const invite = new URLSearchParams(location.search).get('lobby');
  if (invite && !inviteHandled) {
    inviteHandled = true;
    void net.join(invite).catch((err) => netMessage(err, 'Не удалось войти'));
  }
}

function closeNet() {
  netView.hide();
  netView.wait(null, null);
  buildTitle();
  bootPreview();
}

function netMessage(err: unknown, fallback: string) {
  netView.error(friendlyNetError(err, fallback));
}

function lobbyPack(draft: LobbyDraft, worldSeed: number) {
  const profiles = defaultProfiles().map((profile) => ({ ...profile, difficulty: draft.difficulty }));
  const setup = normalizeSetup({
    victory: draft.victory,
    timeLimit: draft.timeLimit,
    map: draft.map,
    start: draft.start,
    ai: draft.ai,
    goldTarget: draft.goldTarget,
    popTarget: draft.popTarget,
    surviveMinutes: draft.surviveMinutes,
    teams: draft.teams,
    profiles,
  });
  return {
    name: draft.name,
    maxPlayers: draft.maxPlayers,
    seed: packSeed(worldSeed, setup),
    profiles,
    speed: draft.speed,
    teams: draft.teams,
    password: draft.password,
  };
}

const netView = new NetView(document.querySelector<HTMLElement>('#net')!, document.querySelector<HTMLElement>('#syncbox')!, {
  create: (draft) => {
    rememberName();
    const world = Number(document.querySelector<HTMLInputElement>('#seed')?.value ?? '1') >>> 0;
    const packed = lobbyPack(draft, world);
    void net.create(packed).catch((err) => netMessage(err, 'Не удалось создать лобби'));
  },
  join: (id, password) => {
    rememberName();
    void net.join(id, password).catch((err) => netMessage(err, 'Не удалось войти'));
  },
  leave: () => {
    void net.leave().then(() => openNet()).catch((err) => netMessage(err, 'Не удалось выйти'));
  },
  ready: (value) => {
    void net.setReady(value).catch((err) => netMessage(err, 'Не удалось сменить готовность'));
  },
  start: () => {
    void net.start().catch((err) => netMessage(err, 'Не удалось начать'));
  },
  back: () => {
    void net.leave().catch(() => {});
    closeNet();
  },
  exclude: (uid) => net.exclude(uid),
  copy: (url) => {
    void navigator.clipboard.writeText(url).then(
      () => flash('Ссылка скопирована'),
      () => flash('Ссылка показана в комнате'),
    );
  },
});

net.hooks = {
  onList: (rows) => netView.setRows(rows),
  onRoom: (room) => netView.showRoom(room),
  onStart: (game, playerId) => beginNet(game, playerId),
  onWait: (wait) => netView.wait(wait, null),
  onDesync: (detail) => netView.wait(null, detail),
  onClosed: () => {
    if (!playing) openNet();
  },
  onError: (message) => netView.error(message),
  onEnded: () => {},
};

function showInstallOffer() {
  const banner = document.querySelector<HTMLElement>('#install-banner');
  if (banner) banner.hidden = false;
}

function showCrash(detail: string) {
  const box = document.querySelector<HTMLElement>('#crash');
  if (!box || !box.hidden) return;
  if (playing && !netMode) void writeSlot('auto', state, saveMeta('auto')).catch(() => {});
  const node = document.querySelector<HTMLElement>('#crash-detail');
  if (node) node.textContent = detail.slice(0, 280);
  box.hidden = false;
}

document.querySelector<HTMLButtonElement>('#install-apply')!.onclick = () => {
  void acceptInstall().finally(() => {
    const banner = document.querySelector<HTMLElement>('#install-banner');
    if (banner) banner.hidden = true;
  });
};
document.querySelector<HTMLButtonElement>('#install-dismiss')!.onclick = () => {
  const banner = document.querySelector<HTMLElement>('#install-banner');
  if (banner) banner.hidden = true;
};
document.querySelector<HTMLButtonElement>('#update-apply')!.onclick = () => acceptUpdate();
document.querySelector<HTMLButtonElement>('#crash-recover')!.onclick = () => {
  document.querySelector<HTMLElement>('#crash')!.hidden = true;
  continueGame();
};
document.querySelector<HTMLButtonElement>('#crash-menu')!.onclick = () => {
  document.querySelector<HTMLElement>('#crash')!.hidden = true;
  playing = false;
  netMode = false;
  buildTitle();
  bootPreview();
};
window.addEventListener('error', (event) => {
  if (/ResizeObserver/.test(event.message || '')) return;
  showCrash(event.message || 'Ошибка');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (!message || /ResizeObserver/.test(message)) return;
  showCrash(message);
});
bootRelease({
  onUpdate: () => {
    const banner = document.querySelector<HTMLElement>('#update-banner');
    if (banner) banner.hidden = false;
  },
  onInstall: showInstallOffer,
});

resize();
applyUi();
buildTitle();
bootPreview();
void migrateLegacy().then(() => {
  if (!playing) buildTitle();
});
expose();
if (new URLSearchParams(location.search).get('lobby')) openNet();
requestAnimationFrame(frame);
