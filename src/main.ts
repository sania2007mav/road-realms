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
  buildingById,
  buildingCenter,
  canPlace,
  createGame,
  createMob,
  createSoldier,
  currentTarget,
  deserialize,
  housingCap,
  idleCount,
  KEEP_HOUSING,
  KEEP_UPGRADE_COST,
  KEEP_UPGRADE_TICKS,
  playerKeep,
  serialize,
  step,
  suggestedTile,
  terrainAt,
  usedCount,
  workerStatus,
  Terrain,
  type BuildingType,
  type Command,
  type GameState,
  type Ration,
  type Resource,
} from './sim';
import { createBuilding } from './sim/entities';
import { cycleGfx, gfxLabel, loadGfx } from './render/gfx';
import { net } from './net/session';
import { NetView } from './net/screens';
import { ZOOM_MAX, clampCamera, focusTile, screenToTile, screenToWorld, worldToScreen, type Camera } from './render/camera';
import { bakeTerrain, minimapToTile, renderMinimap, renderWorld, type Ghost, type OrderMarker } from './render/draw';
import { soldiersInScreenRect } from './select';

const SAVE_KEY = 'dorozhnye-kraya-v1';
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

let state: GameState = createGame(20261003, { ai: 3 });
let playing = false;
let camera: Camera = { x: 0, y: 0, zoom: 1.15 };
loadGfx();
let baked = bakeTerrain(state);
let speed = 1;
let localPlayer = 0;
let netMode = false;
let placing: BuildingType | null = null;
let selectedId: number | null = null;
let selectedPersonId: number | null = null;
let category: keyof typeof CATEGORY_NAME = 'storage';
let hover: { x: number; y: number } | null = null;
let tutorialStep = 0;
let guideOn = false;
let guideFocus = '';
let guideSig = '';
let toastUntil = 0;
let lastMessage = '';
let panelSig = '';
let queue: Command[] = [];

function pushCmd(command: Command) {
  command.playerId = localPlayer;
  if (netMode) net.submit(command);
  else queue.push(command);
}
const keys = new Set<string>();
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
let pointerMode: 'none' | 'pan' | 'box' = 'none';
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

function bootPreview() {
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const ai = Number(document.querySelector<HTMLSelectElement>('#ai-count')?.value ?? '3');
  state = createGame(seed, { ai: Number.isFinite(ai) ? ai : 3 });
  baked = bakeTerrain(state);
  lookAtTile(state.mapW / 2, state.roadY);
  camera.zoom = 0.55;
  playing = false;
  localPlayer = 0;
  guideOn = false;
  clampView();
}

function startGame() {
  netMode = false;
  localPlayer = 0;
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const ai = Number(document.querySelector<HTMLSelectElement>('#ai-count')?.value ?? '3');
  state = createGame(seed >>> 0, { ai: ai === 2 ? 2 : 3 });
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
  selectedId = keep?.id ?? null;
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

function loadGame() {
  if (netMode) {
    flash('В сетевой игре сохранения нет');
    return;
  }
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    flash('Сохранения нет');
    return;
  }
  try {
    state = deserialize(raw);
    baked = bakeTerrain(state);
    playing = true;
    guideOn = false;
    title.hidden = true;
    netView.hide();
    netView.wait(null, null);
    endScreen.hidden = true;
    menu.hidden = true;
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
  } catch {
    flash('Сохранение повреждено');
  }
}

function saveGame() {
  if (netMode) {
    flash('В сетевой игре сохранения нет');
    return;
  }
  if (!playing) return;
  localStorage.setItem(SAVE_KEY, serialize(state));
  flash('Сохранено на этом устройстве');
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

function buildTitle() {
  title.hidden = false;
  title.innerHTML = `<div class="card">
    <h1>Дорожные края</h1>
    <p class="lede">Открытая стратегия вдоль большого тракта. Люди — редкость: их ровно столько, сколько влезает в жильё, и каждый занят только одним делом.</p>
    <label for="player-name">Ваше имя</label>
    <input id="player-name" data-testid="player-name" maxlength="20" />
    <label for="seed">Зерно мира</label>
    <input id="seed" data-testid="seed" type="number" value="20261003" />
    <label for="ai-count">Соседи по тракту</label>
    <select id="ai-count" data-testid="ai-count">
      <option value="2">Два поселения</option>
      <option value="3" selected>Три поселения</option>
    </select>
    <div class="actions">
      <button type="button" id="load-title" data-testid="load-game">Загрузить</button>
      <button type="button" id="start-title" data-testid="new-game">Одиночная игра</button>
    </div>
    <div class="actions">
      <button type="button" id="know-game" data-testid="know-game">Я умею играть</button>
      <button type="button" id="net-title" data-testid="net-game">Сетевая игра</button>
    </div>
  </div>`;
  const nameInput = document.querySelector<HTMLInputElement>('#player-name')!;
  nameInput.value = storedName();
  nameInput.addEventListener('change', () => rememberName());
  document.querySelector<HTMLInputElement>('#seed')!.addEventListener('change', () => {
    if (!playing) bootPreview();
  });
  document.querySelector<HTMLButtonElement>('#start-title')!.onclick = () => {
    rememberName();
    startGame();
  };
  document.querySelector<HTMLButtonElement>('#load-title')!.onclick = () => loadGame();
  document.querySelector<HTMLButtonElement>('#know-game')!.onclick = () => {
    if (localStorage.getItem(TUTORIAL_KEY) === '1') localStorage.removeItem(TUTORIAL_KEY);
    else localStorage.setItem(TUTORIAL_KEY, '1');
    syncKnowButton();
  };
  syncKnowButton();
  document.querySelector<HTMLButtonElement>('#net-title')!.onclick = () => openNet();
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
      <div id="presence" data-testid="presence" hidden></div>
    </div>
    <div id="resources"></div>`;
  document.querySelector<HTMLButtonElement>('#open-menu')!.onclick = () => {
    menu.hidden = !menu.hidden;
    if (!menu.hidden) renderMenu();
  };
  document.querySelector<HTMLButtonElement>('#people-btn')!.onclick = () => {
    peoplebox.hidden = !peoplebox.hidden;
    popbox.hidden = true;
  };
  document.querySelector<HTMLButtonElement>('#mood-btn')!.onclick = () => {
    popbox.hidden = !popbox.hidden;
    peoplebox.hidden = true;
  };

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
  host.innerHTML = types
    .map((type) => {
      const def = BUILDINGS[type];
      return `<button type="button" data-build="${type}" data-testid="build-${type}">
        <b>${def.name}</b><small>${buttonNote(type)}</small>
      </button>`;
    })
    .join('');
  host.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.onclick = () => {
      const type = button.dataset.build as BuildingType;
      const reason = blockReason(type);
      if (reason) {
        flash(reason);
        return;
      }
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
  if (netMode) value = 1;
  speed = value;
  speeds.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === value);
    button.disabled = netMode;
  });
}

function renderMenu() {
  menu.innerHTML = `<div class="card">
    <h2>Меню</h2>
    <p>Зерно ${state.seed}. Игровое время: ${Math.floor(state.tick / TICKS_PER_GAME_MINUTE)} мин.</p>
    <div class="actions">
      <button type="button" id="save-btn" data-testid="save-game">Сохранить</button>
      <button type="button" id="load-btn">Загрузить</button>
    </div>
    <div class="actions">
      <button type="button" id="help-btn">Подсказки</button>
      <button type="button" id="guide-restart" data-testid="guide-restart">Обучение</button>
      <button type="button" id="resign-btn">Новая игра</button>
    </div>
    <div class="actions">
      <button type="button" id="gfx-btn" data-testid="gfx-toggle">${gfxLabel()}</button>
    </div>
    <p>Мышь: тянуть карту, колесо — масштаб. На телефоне: жест и щипок. Клавиши: WASD, пробел — пауза, 1–3 — скорость, Esc — отмена стройки, H — подсказки.</p>
    <div class="actions"><button type="button" id="close-menu">Закрыть</button></div>
  </div>`;
  document.querySelector<HTMLButtonElement>('#save-btn')!.onclick = () => saveGame();
  document.querySelector<HTMLButtonElement>('#load-btn')!.onclick = () => loadGame();
  document.querySelector<HTMLButtonElement>('#help-btn')!.onclick = () => {
    menu.hidden = true;
    if (guideOn) return;
    tutorialStep = 0;
    showTutorial();
  };
  document.querySelector<HTMLButtonElement>('#guide-restart')!.onclick = () => {
    menu.hidden = true;
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
    menu.hidden = true;
    playing = false;
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
    menu.hidden = true;
  };
  document.querySelector<HTMLButtonElement>('#gfx-btn')!.onclick = () => {
    cycleGfx();
    baked = bakeTerrain(state);
    const button = document.querySelector<HTMLButtonElement>('#gfx-btn');
    if (button) button.textContent = gfxLabel();
  };
}

function syncHud() {
  const player = state.players[localPlayer];
  if (!player) return;
  const idle = idleCount(state, localPlayer);
  const used = usedCount(state, localPlayer);
  const cap = housingCap(state, localPlayer);
  const peopleBtn = document.querySelector<HTMLButtonElement>('#people-btn');
  if (peopleBtn) {
    peopleBtn.innerHTML = `Люди <strong>${used}</strong>/<strong>${cap}</strong> · свободно <strong>${idle}</strong>`;
    peopleBtn.classList.toggle('idle-empty', idle === 0);
  }
  const mood = document.querySelector<HTMLButtonElement>('#mood-btn');
  if (mood) {
    const sign = player.popularity > 0 ? `+${player.popularity}` : String(player.popularity);
    mood.innerHTML = `Настроение <strong>${sign}</strong>`;
    mood.classList.remove('mood-up', 'mood-down');
    mood.classList.add(player.popularity >= 0 ? 'mood-up' : 'mood-down');
  }
  const gold = document.querySelector<HTMLElement>('#gold-readout');
  if (gold) gold.innerHTML = `Золото <strong>${player.gold}</strong>`;
  const clock = document.querySelector<HTMLElement>('#clock');
  if (clock) clock.textContent = `${Math.floor(state.tick / TICKS_PER_GAME_MINUTE)} мин`;
  const fpsEl = document.querySelector<HTMLElement>('#fps');
  if (fpsEl) fpsEl.textContent = `${fps} к/с`;

  const resources = document.querySelector<HTMLElement>('#resources');
  if (resources) {
    const groups: { label: string; items: (typeof RESOURCES)[number][] }[] = [
      { label: 'Еда', items: ['apples', 'cheese', 'meat', 'bread'] },
      { label: 'Материалы', items: ['wood', 'stone', 'iron', 'pitch'] },
      { label: 'Пиво', items: ['beer'] },
    ];
    resources.innerHTML = groups
      .map(
        (group) =>
          `<div class="resgroup"><span class="glabel">${group.label}</span>${group.items
            .map((res) => {
              const amount = player.stocks[res];
              return `<span class="res ${amount > 0 ? '' : 'zero'}"><i style="background:${cargoColor(res)}"></i>${RESOURCE_NAME[res]} <b>${amount}</b></span>`;
            })
            .join('')}</div>`,
      )
      .join('');
  }
  const ration = document.querySelector<HTMLSelectElement>('#ration');
  if (ration && document.activeElement !== ration) ration.value = player.ration;
  updateHint();
  const danger = dangerText();
  const waiting =
    !danger &&
    idle === 0 &&
    state.buildings.some(
      (b) =>
        b.playerId === localPlayer &&
        b.hp > 0 &&
        (!b.complete || b.upgrading || (b.complete && BUILDINGS[b.type].workers > b.workerIds.length)),
    );
  banner.hidden = !danger && !waiting;
  banner.textContent = danger
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
  logEl.replaceChildren();
  for (const line of state.log) {
    const row = document.createElement('div');
    row.textContent = line;
    logEl.append(row);
  }
  syncGuide();
  syncArmy();
  if (state.message && state.message !== lastMessage) {
    lastMessage = state.message;
    flash(state.message);
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
  if (!playing) {
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
          <button type="button" data-testid="order-defend">Оборона</button>
          <button type="button" data-testid="order-raid">Набег</button>
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
  const demolish = mine && building.type !== 'keep' ? `<button type="button" data-testid="demolish">Снести</button>` : '';
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
  panel.innerHTML = `<h2>${def.name}</h2>
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
  panel.querySelector<HTMLButtonElement>('[data-testid="demolish"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'demolish', playerId: localPlayer, buildingId: building.id });
    selectedId = null;
    selectedPersonId = null;
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="train-club"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'train', playerId: localPlayer, weapon: 'club' });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="train-sword"]')?.addEventListener('click', () => {
    pushCmd({ kind: 'train', playerId: localPlayer, weapon: 'sword' });
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

function showEnd() {
  if (!endScreen.hidden) return;
  const victory = netMode ? !!state.players[localPlayer]?.alive : state.outcome === 'victory';
  endScreen.hidden = false;
  endScreen.innerHTML = `<div class="card">
    <h1>${victory ? 'Тракт ваш' : 'Поселение пало'}</h1>
    <p>${victory ? 'Главные здания соседей разрушены.' : 'Ваше главное здание уничтожено.'}</p>
    <div class="actions"><button type="button" id="again" data-testid="again">Ещё раз</button></div>
  </div>`;
  document.querySelector<HTMLButtonElement>('#again')!.onclick = () => {
    playing = false;
    if (netMode) {
      netMode = false;
      localPlayer = 0;
    }
    netView.hide();
    netView.wait(null, null);
    endScreen.hidden = true;
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
  armyEl.hidden = !playing;
  livingSelection();
  const list = state.soldiers.filter((s) => selectedSoldiers.has(s.id));
  armyBody.hidden = list.length === 0;
  const clubs = list.filter((s) => s.weapon === 'club').length;
  const swords = list.filter((s) => s.weapon === 'sword').length;
  armyCount.textContent = `Всего ${list.length} · ополченцы ${clubs} · мечники ${swords}`;
  armyAttack.setAttribute('aria-pressed', attackArmed ? 'true' : 'false');
  armyBox.setAttribute('aria-pressed', boxMode ? 'true' : 'false');
  worldCanvas.classList.toggle('attacking', attackArmed);
  if (!list.length) armyHint.hidden = true;
}

function noteFirstSelection() {
  if (!selectedSoldiers.size) return;
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

function selectWeaponOnScreen(weapon: 'club' | 'sword') {
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
  if (toastUntil && now > toastUntil) toast.hidden = true;

  const pan = 520 / camera.zoom;
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
      step(state, commands, guideOn && !netMode ? { shelter: true } : undefined);
      if (!guideOn && state.tick > 0 && state.tick % (TICKS_PER_GAME_MINUTE * 2) === 0) {
        try {
          localStorage.setItem(SAVE_KEY, serialize(state));
        } catch {
          /* private mode */
        }
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
  }
  requestAnimationFrame(frame);
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
      } else {
        keep.level = 3;
        put('granary', keep.x + 4, keep.y);
        put('stockpile', keep.x + 8, keep.y + 1);
        put('shack', keep.x - 3, keep.y + 1);
        put('cabin', keep.x - 3, keep.y + 4);
        put('house', keep.x + 4, keep.y + 4);
        put('woodcutter', keep.x + 7, keep.y + 4);
        put('orchard', keep.x - 6, keep.y - 4);
        put('wheat', keep.x + 4, keep.y - 4);
        put('mill', keep.x + 8, keep.y - 3);
        put('bakery', keep.x + 11, keep.y - 2);
        put('dairy', keep.x - 4, keep.y + 7);
        put('tavern', keep.x + 1, keep.y + 7);
        put('khrush', keep.x + 8, keep.y + 8);
        const sites = state.buildings.filter((building) =>
          ['woodcutter', 'orchard', 'wheat', 'mill', 'bakery'].includes(building.type),
        );
        const cargos: (Resource | null)[] = ['apples', 'wood', null, 'bread', null];
        state.people
          .filter((person) => person.playerId === localPlayer)
          .forEach((person, index) => {
            const site = sites[index % sites.length];
            if (!site) return;
            const def = BUILDINGS[site.type];
            person.x = site.x + def.w * 0.4;
            person.y = site.y + def.h + 0.15;
            person.task = { type: 'work', buildingId: site.id, mode: 'labor', targetId: 0 };
            person.cargo = cargos[index] ?? null;
            person.destX = person.x;
            person.destY = person.y;
          });
        lookAtPoint(keep.x + 3, keep.y + 2);
        camera.zoom = 1.15;
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
  };
}

worldCanvas.addEventListener('pointerdown', (event) => {
  worldCanvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    window.clearTimeout(longTimer);
    pointerMode = 'none';
    return;
  }
  dragging = true;
  dragDist = 0;
  lastPtr = { x: event.clientX, y: event.clientY };
  const rect = worldCanvas.getBoundingClientRect();
  boxStart = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  boxNow = { ...boxStart };
  const touch = event.pointerType === 'touch';
  const selectDrag = playing && (event.button === 0 || touch) && (!touch || boxMode);
  if (selectDrag) {
    pointerMode = 'box';
    boxAdditive = event.shiftKey;
    boxBase = boxAdditive ? [...selectedSoldiers] : [];
  } else {
    pointerMode = 'pan';
    if (touch && playing && !boxMode) {
      window.clearTimeout(longTimer);
      longTimer = window.setTimeout(() => {
        if (dragDist < 14 && pointers.size === 1) {
          pointerMode = 'box';
          boxAdditive = false;
          boxBase = [];
          boxStart = { ...boxNow };
        }
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
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pinch > 0) {
      camera.zoom = Math.min(ZOOM_MAX, camera.zoom * (dist / pinch));
      clampView();
    }
    pinch = dist;
    dragging = false;
    pointerMode = 'none';
    window.clearTimeout(longTimer);
    return;
  }
  pinch = 0;
  if (!dragging) return;
  const dx = event.clientX - lastPtr.x;
  const dy = event.clientY - lastPtr.y;
  dragDist += Math.hypot(dx, dy);
  boxNow = { x: localX, y: localY };
  if (pointerMode === 'box') {
    if (dragDist >= 8) paintBox();
  } else {
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
  if (pointers.size < 2) pinch = 0;
  if (pointers.size === 0) {
    lastGesture = dragDist;
    const boxed = pointerMode === 'box' && dragDist >= 8;
    pointerMode = 'none';
    dragging = false;
    if (!boxed && dragDist < 8 && playing && event.button === 0) {
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
  const wasPlacing = placing != null;
  placing = null;
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
  keys.add(key);
  if (event.code === 'Space') {
    event.preventDefault();
    if (!netMode) setSpeed(speed === 0 ? 1 : 0);
  } else if (!netMode && event.key === '1') setSpeed(1);
  else if (!netMode && event.key === '2') setSpeed(2);
  else if (!netMode && event.key === '3') setSpeed(3);
  else if (event.key === 'Escape') {
    placing = null;
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
window.addEventListener('resize', resize);

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
  selectedId = keep?.id ?? null;
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
  netView.showList();
  void net.listenList().catch((err) => netMessage(err, 'Не удалось открыть список'));
  const invite = new URLSearchParams(location.search).get('lobby');
  if (invite && !inviteHandled) {
    inviteHandled = true;
    void net.join(invite).catch((err) => netView.error(err instanceof Error ? err.message : 'Не удалось войти'));
  }
}

function closeNet() {
  netView.hide();
  netView.wait(null, null);
  buildTitle();
  bootPreview();
}

function netMessage(err: unknown, fallback: string) {
  netView.error(err instanceof Error ? err.message : fallback);
}

const netView = new NetView(document.querySelector<HTMLElement>('#net')!, document.querySelector<HTMLElement>('#syncbox')!, {
  create: (name, maxPlayers) => {
    rememberName();
    void net.create(name, maxPlayers).catch((err) => netMessage(err, 'Не удалось создать лобби'));
  },
  join: (id) => {
    rememberName();
    void net.join(id).catch((err) => netMessage(err, 'Не удалось войти'));
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

resize();
buildTitle();
bootPreview();
expose();
if (new URLSearchParams(location.search).get('lobby')) openNet();
requestAnimationFrame(frame);
