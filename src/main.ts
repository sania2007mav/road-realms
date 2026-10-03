import {
  BUILDINGS,
  BUILD_MENU,
  CATEGORY_NAME,
  PRICES,
  RESOURCE_NAME,
  RESOURCES,
  TAXES,
  TICKS_PER_GAME_MINUTE,
  TICKS_PER_SECOND,
  buildingById,
  buildingCenter,
  canPlace,
  createGame,
  currentTarget,
  deserialize,
  housingCap,
  idleCount,
  playerKeep,
  serialize,
  step,
  suggestedTile,
  usedCount,
  type BuildingType,
  type Command,
  type GameState,
  type Ration,
} from './sim';
import { TILE, focusTile, screenToTile, type Camera } from './render/camera';
import { bakeMinimap, bakeTerrain, renderMinimap, renderWorld, type Ghost } from './render/draw';

const SAVE_KEY = 'dorozhnye-kraya-v1';
const TUTORIAL_KEY = 'dorozhnye-kraya-tutorial';

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

let state: GameState = createGame(20261003, { ai: 3 });
let playing = false;
let camera: Camera = { x: 0, y: 0, zoom: 1.15 };
let baked = bakeTerrain(state);
let miniBaked = bakeMinimap(state);
let speed = 1;
let placing: BuildingType | null = null;
let selectedId: number | null = null;
let category: keyof typeof CATEGORY_NAME = 'storage';
let hover: { x: number; y: number } | null = null;
let tutorialStep = 0;
let toastUntil = 0;
let lastMessage = '';
let panelSig = '';
let queue: Command[] = [];
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

function viewSize() {
  return { w: worldCanvas.clientWidth, h: worldCanvas.clientHeight };
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, worldCanvas.clientWidth);
  const h = Math.max(1, worldCanvas.clientHeight);
  worldCanvas.width = Math.floor(w * dpr);
  worldCanvas.height = Math.floor(h * dpr);
  miniCanvas.width = 180;
  miniCanvas.height = 120;
}

function bootPreview() {
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const ai = Number(document.querySelector<HTMLSelectElement>('#ai-count')?.value ?? '3');
  state = createGame(seed, { ai: Number.isFinite(ai) ? ai : 3 });
  baked = bakeTerrain(state);
  miniBaked = bakeMinimap(state);
  camera.x = (state.mapW / 2) * TILE;
  camera.y = state.roadY * TILE;
  camera.zoom = 0.55;
  playing = false;
}

function startGame() {
  const seed = Number((document.querySelector<HTMLInputElement>('#seed')?.value ?? '20261003')) || 1;
  const ai = Number(document.querySelector<HTMLSelectElement>('#ai-count')?.value ?? '3');
  state = createGame(seed >>> 0, { ai: ai === 2 ? 2 : 3 });
  baked = bakeTerrain(state);
  miniBaked = bakeMinimap(state);
  const keep = playerKeep(state, 0);
  if (keep) {
    const center = buildingCenter(keep);
    camera.x = center.x * TILE;
    camera.y = center.y * TILE;
  }
  camera.zoom = 1.15;
  playing = true;
  speed = 1;
  placing = null;
  selectedId = keep?.id ?? null;
  queue = [];
  acc = 0;
  title.hidden = true;
  endScreen.hidden = true;
  menu.hidden = true;
  buildChrome();
  if (!localStorage.getItem(TUTORIAL_KEY)) {
    tutorialStep = 0;
    showTutorial();
  } else tutorial.hidden = true;
  expose();
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    flash('Сохранения нет');
    return;
  }
  try {
    state = deserialize(raw);
    baked = bakeTerrain(state);
    miniBaked = bakeMinimap(state);
    playing = true;
    title.hidden = true;
    endScreen.hidden = true;
    menu.hidden = true;
    const keep = playerKeep(state, 0);
    if (keep) {
      const center = buildingCenter(keep);
      camera.x = center.x * TILE;
      camera.y = center.y * TILE;
    }
    buildChrome();
    flash('Поселение загружено');
    expose();
  } catch {
    flash('Сохранение повреждено');
  }
}

function saveGame() {
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
    localStorage.setItem(TUTORIAL_KEY, '1');
    tutorial.hidden = true;
  };
  tutorial.querySelector<HTMLButtonElement>('[data-testid="tutorial-next"]')!.onclick = () => {
    tutorialStep += 1;
    if (tutorialStep >= TUTORIAL.length) {
      localStorage.setItem(TUTORIAL_KEY, '1');
      tutorial.hidden = true;
    } else showTutorial();
  };
}

function buildTitle() {
  title.hidden = false;
  title.innerHTML = `<div class="card">
    <h1>Дорожные края</h1>
    <p class="lede">Открытая стратегия вдоль большого тракта. Люди — редкость: их ровно столько, сколько влезает в жильё, и каждый занят только одним делом.</p>
    <label for="seed">Зерно мира</label>
    <input id="seed" data-testid="seed" type="number" value="20261003" />
    <label for="ai-count">Соседи по тракту</label>
    <select id="ai-count" data-testid="ai-count">
      <option value="2">Два поселения</option>
      <option value="3" selected>Три поселения</option>
    </select>
    <div class="actions">
      <button type="button" id="load-title" data-testid="load-game">Загрузить</button>
      <button type="button" id="start-title" data-testid="new-game">Начать путь</button>
    </div>
  </div>`;
  document.querySelector<HTMLInputElement>('#seed')!.addEventListener('change', () => {
    if (!playing) bootPreview();
  });
  document.querySelector<HTMLButtonElement>('#start-title')!.onclick = () => startGame();
  document.querySelector<HTMLButtonElement>('#load-title')!.onclick = () => loadGame();
}

function buildChrome() {
  const player = () => state.players[0];
  topbar.innerHTML = `
    <button type="button" id="open-menu" data-testid="open-menu">Меню</button>
    <button type="button" class="readout" id="people-btn" data-testid="people-readout"></button>
    <button type="button" class="readout" id="mood-btn" data-testid="popularity"></button>
    <div class="readout" id="gold-readout"></div>
    <div class="readout" id="clock"></div>
    <div class="readout" id="fps">60 к/с</div>
    <div id="resources"></div>
    <div id="rations"></div>
    <div id="taxwrap"></div>`;
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

  const rations = document.querySelector<HTMLElement>('#rations')!;
  rations.innerHTML = RATIONS.map(
    (r) => `<button type="button" data-ration="${r.id}" data-testid="ration-${r.id}">${r.label}</button>`,
  ).join('');
  rations.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.onclick = () => {
      const ration = button.dataset.ration as Ration;
      queue.push({ kind: 'ration', playerId: 0, ration });
    };
  });

  const taxwrap = document.querySelector<HTMLElement>('#taxwrap')!;
  taxwrap.innerHTML = `<span id="tax-label"></span><input id="tax" data-testid="tax-slider" type="range" min="0" max="5" step="1" value="1" />`;
  const tax = document.querySelector<HTMLInputElement>('#tax')!;
  tax.value = String(Math.max(0, TAXES.findIndex((t) => t.id === player().tax)));
  tax.addEventListener('input', () => {
    const def = TAXES[Number(tax.value)] ?? TAXES[1];
    queue.push({ kind: 'tax', playerId: 0, tax: def.id });
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

  buildbar.innerHTML = `<div id="tabs"></div><div id="buttons"></div>`;
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
  });
  const host = document.querySelector<HTMLElement>('#buttons');
  if (!host || !playing) return;
  const types = BUILD_MENU.filter((type) => BUILDINGS[type].category === category);
  host.innerHTML = types
    .map((type) => {
      const def = BUILDINGS[type];
      const cost = Object.entries(def.cost)
        .map(([res, amount]) => `${amount} ${RESOURCE_NAME[res as keyof typeof RESOURCE_NAME]}`)
        .join(', ');
      return `<button type="button" data-build="${type}" data-testid="build-${type}">
        <b>${def.name}</b><small>${cost || 'без цены'}</small>
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
}

function blockReason(type: BuildingType): string | null {
  const def = BUILDINGS[type];
  const keep = playerKeep(state, 0);
  const level = keep?.level ?? 0;
  if (!state.players[0]?.alive) return 'Поселение пало';
  if (def.keepLevel > level) return `Нужен уровень главного здания ${def.keepLevel}`;
  for (const res of RESOURCES) {
    if ((state.players[0].stocks[res] ?? 0) < (def.cost[res] ?? 0)) return 'Не хватает ресурсов';
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
  });
}

function setSpeed(value: number) {
  speed = value;
  speeds.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.speed) === value);
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
      <button type="button" id="resign-btn">Новая игра</button>
    </div>
    <p>Мышь: тянуть карту, колесо — масштаб. На телефоне: жест и щипок. Клавиши: WASD, пробел — пауза, 1–3 — скорость, Esc — отмена стройки, H — подсказки.</p>
    <div class="actions"><button type="button" id="close-menu">Закрыть</button></div>
  </div>`;
  document.querySelector<HTMLButtonElement>('#save-btn')!.onclick = () => saveGame();
  document.querySelector<HTMLButtonElement>('#load-btn')!.onclick = () => loadGame();
  document.querySelector<HTMLButtonElement>('#help-btn')!.onclick = () => {
    menu.hidden = true;
    tutorialStep = 0;
    showTutorial();
  };
  document.querySelector<HTMLButtonElement>('#resign-btn')!.onclick = () => {
    menu.hidden = true;
    playing = false;
    buildTitle();
    bootPreview();
  };
  document.querySelector<HTMLButtonElement>('#close-menu')!.onclick = () => {
    menu.hidden = true;
  };
}

function syncHud() {
  const player = state.players[0];
  if (!player) return;
  const idle = idleCount(state, 0);
  const used = usedCount(state, 0);
  const cap = housingCap(state, 0);
  const peopleBtn = document.querySelector<HTMLButtonElement>('#people-btn');
  if (peopleBtn) {
    peopleBtn.innerHTML = `Люди <strong>${used}</strong> занято · <strong>${idle}</strong> свободно · предел <strong>${cap}</strong>`;
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
    const show: (typeof RESOURCES)[number][] = ['apples', 'cheese', 'meat', 'bread', 'wood', 'stone', 'iron', 'pitch', 'beer'];
    resources.innerHTML = show
      .map((res) => {
        const amount = player.stocks[res];
        return `<span class="res ${amount > 0 ? '' : 'zero'}"><i style="background:${cargoColor(res)}"></i>${RESOURCE_NAME[res]} <b>${amount}</b></span>`;
      })
      .join('');
  }
  document.querySelectorAll<HTMLButtonElement>('#rations button').forEach((button) => {
    button.classList.toggle('active', button.dataset.ration === player.ration);
  });
  const waiting =
    idle === 0 &&
    state.buildings.some(
      (b) =>
        b.playerId === 0 &&
        b.hp > 0 &&
        (!b.complete || b.upgrading || (b.complete && BUILDINGS[b.type].workers > b.workerIds.length)),
    );
  banner.hidden = !waiting;
  banner.textContent = waiting
    ? 'Нет свободных людей. Снимите кого-нибудь с работы или дождитесь переселенцев — иначе стройка и новые места будут стоять пустыми.'
    : '';

  if (!popbox.hidden) {
    const report = currentTarget(state, 0);
    popbox.innerHTML = `<div class="card"><h2>Настроение ${report.value}</h2>${report.reasons
      .map(
        (reason) =>
          `<div class="reason"><span>${reason.label}</span><b class="${reason.value >= 0 ? 'plus' : 'minus'}">${reason.value > 0 ? `+${reason.value}` : reason.value}</b></div>`,
      )
      .join('')}<p>Люди приходят выше нуля, уходят ниже нуля.</p></div>`;
  }
  if (!peoplebox.hidden) {
    const mine = state.people.filter((p) => p.playerId === 0 && p.hp > 0);
    peoplebox.innerHTML = `<div class="card"><h2>Люди поселения</h2>${mine
      .map((person) => `<div class="reason"><span>${jobLabel(person)}</span></div>`)
      .join('')}<p>Солдат: ${state.soldiers.filter((s) => s.playerId === 0 && s.hp > 0).length}. Солдат больше не занимает жильё.</p></div>`;
  }
  logEl.innerHTML = state.log.map((line) => `<div>${line}</div>`).join('');
  if (state.message && state.message !== lastMessage) {
    lastMessage = state.message;
    flash(state.message);
  }
  refreshBuildState();
  syncPanel();
  if (state.outcome !== 'playing') showEnd();
}

function jobLabel(person: GameState['people'][number]): string {
  if (person.task.type === 'idle') return 'Без дела';
  const building = buildingById(state, person.task.buildingId);
  const name = building ? BUILDINGS[building.type].name : 'постройка';
  if (person.task.type === 'build') return `Строит: ${name}`;
  return `Работает: ${name}`;
}

function syncPanel() {
  if (!playing) {
    panel.hidden = true;
    return;
  }
  const building = selectedId != null ? buildingById(state, selectedId) : undefined;
  if (!building || building.hp <= 0) {
    panel.hidden = true;
    panelSig = '';
    return;
  }
  const def = BUILDINGS[building.type];
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
    state.players[0].gold,
    idleCount(state, 0),
  ].join('|');
  if (sig === panelSig) return;
  panelSig = sig;
  panel.hidden = false;
  const mine = building.playerId === 0;
  const workers = def.workers
    ? `<div class="row"><span>Работники ${building.workerIds.length} / ${def.workers}</span>
        <button type="button" data-testid="worker-minus">−</button>
        <button type="button" data-testid="worker-plus" ${idleCount(state, 0) <= 0 || building.workerIds.length >= def.workers || !building.complete ? 'disabled' : ''}>+</button>
      </div>`
    : '';
  const upgrade =
    mine && building.type === 'keep' && building.level < 5
      ? `<button type="button" data-testid="upgrade-keep">Улучшить до уровня ${building.level + 1}</button>`
      : '';
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
  panel.innerHTML = `<h2>${def.name}</h2>
    <p>${def.desc}</p>
    <p>${building.complete ? 'Построено' : 'Строится'} · прочность ${Math.max(0, building.hp)}/${building.maxHp}${building.type === 'keep' ? ` · уровень ${building.level}` : ''}</p>
    ${building.type === 'keep' ? `<p>Жильё этого здания: ${[0, 5, 8, 12, 18, 28][building.level] ?? building.level}. Общий предел людей: ${housingCap(state, building.playerId)}.</p>` : ''}
    ${def.housing ? `<p>Даёт жильё: ${def.housing}</p>` : ''}
    ${stockNote}
    ${building.plague > 0 ? '<p>На ферме чума, коровы не доятся.</p>' : ''}
    ${workers}${upgrade}${train}${market}
    <div class="row">${demolish}<button type="button" id="close-panel">Закрыть</button></div>
    ${idleCount(state, 0) === 0 && mine && def.workers > building.workerIds.length ? '<p>Нет свободных людей — назначить некого.</p>' : ''}`;
  panel.querySelector<HTMLButtonElement>('[data-testid="worker-plus"]')?.addEventListener('click', () => {
    queue.push({ kind: 'assign', playerId: 0, buildingId: building.id, delta: 1 });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="worker-minus"]')?.addEventListener('click', () => {
    queue.push({ kind: 'assign', playerId: 0, buildingId: building.id, delta: -1 });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="upgrade-keep"]')?.addEventListener('click', () => {
    queue.push({ kind: 'upgrade', playerId: 0, buildingId: building.id });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="demolish"]')?.addEventListener('click', () => {
    queue.push({ kind: 'demolish', playerId: 0, buildingId: building.id });
    selectedId = null;
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="train-club"]')?.addEventListener('click', () => {
    queue.push({ kind: 'train', playerId: 0, weapon: 'club' });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="train-sword"]')?.addEventListener('click', () => {
    queue.push({ kind: 'train', playerId: 0, weapon: 'sword' });
    panelSig = '';
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="order-defend"]')?.addEventListener('click', () => {
    queue.push({ kind: 'order', playerId: 0, order: 'defend' });
  });
  panel.querySelector<HTMLButtonElement>('[data-testid="order-raid"]')?.addEventListener('click', () => {
    queue.push({ kind: 'order', playerId: 0, order: 'raid' });
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((button) => {
    button.onclick = () => {
      queue.push({ kind: 'market', playerId: 0, resource: button.dataset.buy as (typeof RESOURCES)[number], mode: 'buy', qty: 1 });
      panelSig = '';
    };
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((button) => {
    button.onclick = () => {
      queue.push({ kind: 'market', playerId: 0, resource: button.dataset.sell as (typeof RESOURCES)[number], mode: 'sell', qty: 1 });
      panelSig = '';
    };
  });
  panel.querySelector<HTMLButtonElement>('#close-panel')!.onclick = () => {
    selectedId = null;
    panel.hidden = true;
    panelSig = '';
  };
}

function showEnd() {
  if (!endScreen.hidden) return;
  const victory = state.outcome === 'victory';
  endScreen.hidden = false;
  endScreen.innerHTML = `<div class="card">
    <h1>${victory ? 'Тракт ваш' : 'Поселение пало'}</h1>
    <p>${victory ? 'Главные здания соседей разрушены.' : 'Ваше главное здание уничтожено.'}</p>
    <div class="actions"><button type="button" id="again" data-testid="again">Ещё раз</button></div>
  </div>`;
  document.querySelector<HTMLButtonElement>('#again')!.onclick = () => {
    playing = false;
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

function ghost(): Ghost | null {
  if (!placing || !hover || !playing) return null;
  const check = canPlace(state, 0, placing, hover.x, hover.y);
  return { type: placing, x: hover.x, y: hover.y, ok: check.ok };
}

function pick(screenX: number, screenY: number) {
  const { w, h } = viewSize();
  const tile = screenToTile(camera, w, h, screenX, screenY);
  if (placing) {
    const command: Command = { kind: 'place', playerId: 0, building: placing, x: tile.x, y: tile.y };
    queue.push(command);
    placing = null;
    worldCanvas.classList.remove('placing');
    return;
  }
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
    camera.x += 18 * dt;
    if (camera.x > state.mapW * TILE) camera.x = 0;
  } else if (speed > 0 && state.outcome === 'playing') {
    acc += dt * TICKS_PER_SECOND * speed;
    let guard = 0;
    while (acc >= 1 && guard < 8) {
      const commands = guard === 0 ? queue.splice(0) : [];
      step(state, commands);
      if (state.tick > 0 && state.tick % (TICKS_PER_GAME_MINUTE * 2) === 0) {
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

  const { w, h } = viewSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderWorld(ctx, state, camera, w, h, dpr, baked, ghost(), selectedId, now);
  const map = document.querySelector<HTMLElement>('#mapwrap');
  if (map) renderMinimap(miniCtx, state, camera, w, h, miniBaked, miniCanvas.width, miniCanvas.height);
  if (playing) syncHud();
  requestAnimationFrame(frame);
}

function expose() {
  window.__game = {
    suggest(type: string) {
      return suggestedTile(state, 0, type as BuildingType);
    },
    focusTile(x: number, y: number) {
      focusTile(camera, x, y);
    },
    focusHome() {
      const keep = playerKeep(state, 0);
      if (!keep) return;
      const center = buildingCenter(keep);
      camera.x = center.x * TILE;
      camera.y = center.y * TILE;
    },
    zoom(z: number) {
      camera.zoom = Math.max(0.25, Math.min(2.4, z));
    },
    select(id: number) {
      selectedId = id;
      panelSig = '';
    },
    setSpeed(n: number) {
      setSpeed(n);
    },
    snapshot() {
      return {
        tick: state.tick,
        idle: idleCount(state, 0),
        used: usedCount(state, 0),
        cap: housingCap(state, 0),
        popularity: state.players[0]?.popularity ?? 0,
        people: state.people.filter((p) => p.playerId === 0).length,
        buildings: state.buildings
          .filter((b) => b.playerId === 0)
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
  };
}

worldCanvas.addEventListener('pointerdown', (event) => {
  worldCanvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    dragging = true;
    dragDist = 0;
    lastPtr = { x: event.clientX, y: event.clientY };
  }
});
worldCanvas.addEventListener('pointermove', (event) => {
  const rect = worldCanvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const { w, h } = viewSize();
  hover = screenToTile(camera, w, h, localX, localY);
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pinch > 0) camera.zoom = Math.max(0.28, Math.min(2.4, camera.zoom * (dist / pinch)));
    pinch = dist;
    dragging = false;
    return;
  }
  pinch = 0;
  if (!dragging) return;
  const dx = event.clientX - lastPtr.x;
  const dy = event.clientY - lastPtr.y;
  dragDist += Math.hypot(dx, dy);
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
  lastPtr = { x: event.clientX, y: event.clientY };
});
worldCanvas.addEventListener('pointerup', (event) => {
  const start = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = 0;
  if (pointers.size === 0 && dragging && dragDist < 8 && playing) {
    const rect = worldCanvas.getBoundingClientRect();
    pick((start?.x ?? event.clientX) - rect.left, (start?.y ?? event.clientY) - rect.top);
  }
  dragging = pointers.size > 0;
});
worldCanvas.addEventListener('pointercancel', (event) => {
  pointers.delete(event.pointerId);
  dragging = false;
});
worldCanvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    camera.zoom = Math.max(0.28, Math.min(2.4, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
  },
  { passive: false },
);
worldCanvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  placing = null;
  worldCanvas.classList.remove('placing');
});
miniCanvas.addEventListener('pointerdown', (event) => {
  if (!playing) return;
  const rect = miniCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * state.mapW;
  const y = ((event.clientY - rect.top) / rect.height) * state.mapH;
  camera.x = x * TILE;
  camera.y = y * TILE;
});
document.querySelector<HTMLButtonElement>('#home')!.onclick = () => {
  const keep = playerKeep(state, 0);
  if (!keep) return;
  const center = buildingCenter(keep);
  camera.x = center.x * TILE;
  camera.y = center.y * TILE;
  camera.zoom = 1.15;
};

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  keys.add(event.key.toLowerCase());
  if (event.code === 'Space') {
    event.preventDefault();
    setSpeed(speed === 0 ? 1 : 0);
  } else if (event.key === '1') setSpeed(1);
  else if (event.key === '2') setSpeed(2);
  else if (event.key === '3') setSpeed(3);
  else if (event.key === 'Escape') {
    placing = null;
    worldCanvas.classList.remove('placing');
    selectedId = null;
  } else if (event.key.toLowerCase() === 'h' && playing) {
    tutorialStep = 0;
    showTutorial();
  } else if (event.key === '+' || event.key === '=') camera.zoom = Math.min(2.4, camera.zoom * 1.1);
  else if (event.key === '-' || event.key === '_') camera.zoom = Math.max(0.28, camera.zoom * 0.9);
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
      select: (id: number) => void;
      setSpeed: (n: number) => void;
      snapshot: () => {
        tick: number;
        idle: number;
        used: number;
        cap: number;
        popularity: number;
        people: number;
        buildings: { id: number; type: string; complete: boolean; workers: number; x: number; y: number }[];
      };
    };
  }
}

resize();
buildTitle();
bootPreview();
expose();
requestAnimationFrame(frame);
