import type { LobbyRow, RoomView, WaitView } from './session';

export interface LobbyDraft {
  name: string;
  maxPlayers: 2 | 3 | 4;
  password: string;
  victory: RoomView['draft']['victory'];
  timeLimit: number;
  map: RoomView['draft']['map'];
  start: RoomView['draft']['start'];
  ai: number;
  speed: 1 | 2 | 3;
  teams: 'ffa' | 'pairs';
  difficulty: RoomView['draft']['difficulty'];
  goldTarget: number;
  popTarget: number;
  surviveMinutes: number;
}

export interface NetActions {
  create: (draft: LobbyDraft) => void;
  join: (id: string, password: string) => void;
  leave: () => void;
  ready: (value: boolean) => void;
  start: () => void;
  back: () => void;
  exclude: (uid: string) => void;
  copy: (url: string) => void;
}

const DEFAULT_DRAFT: LobbyDraft = {
  name: '',
  maxPlayers: 2,
  password: '',
  victory: 'conquest',
  timeLimit: 0,
  map: 'normal',
  start: 'normal',
  ai: 1,
  speed: 1,
  teams: 'ffa',
  difficulty: 'normal',
  goldTarget: 2000,
  popTarget: 20,
  surviveMinutes: 20,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function select(testid: string, value: string, options: readonly (readonly [string, string])[]): HTMLSelectElement {
  const node = el('select');
  node.dataset.testid = testid;
  for (const [optionValue, label] of options) {
    const option = el('option');
    option.value = optionValue;
    option.textContent = label;
    if (optionValue === value) option.selected = true;
    node.append(option);
  }
  return node;
}

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
  const node = el('label');
  node.append(document.createTextNode(text), control);
  return node;
}

function lockIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-label', 'Закрыто паролем');
  svg.dataset.testid = 'lobby-lock';
  svg.classList.add('lobby-lock');
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  body.setAttribute('x', '3');
  body.setAttribute('y', '7');
  body.setAttribute('width', '10');
  body.setAttribute('height', '7');
  body.setAttribute('rx', '1');
  body.setAttribute('fill', 'none');
  body.setAttribute('stroke', 'currentColor');
  body.setAttribute('stroke-width', '1.4');
  const shackle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shackle.setAttribute('d', 'M5 7 V5 a3 3 0 0 1 6 0 V7');
  shackle.setAttribute('fill', 'none');
  shackle.setAttribute('stroke', 'currentColor');
  shackle.setAttribute('stroke-width', '1.4');
  svg.append(body, shackle);
  return svg;
}

function setupGrid(draft: LobbyDraft, testPrefix: string): HTMLDivElement {
  const grid = el('div', 'setup-grid lobby-setup');
  grid.dataset.testid = testPrefix === 'lobby' ? 'lobby-setup' : 'room-setup';
  const victory = select(`${testPrefix}-victory`, draft.victory, [
    ['conquest', 'Завоевание'],
    ['wealth', 'Богатство'],
    ['bloom', 'Расцвет'],
    ['survival', 'Выживание'],
  ]);
  const time = select(`${testPrefix}-time`, String(draft.timeLimit), [
    ['0', 'Без лимита'],
    ['15', '15 минут'],
    ['30', '30 минут'],
    ['45', '45 минут'],
  ]);
  const map = select(`${testPrefix}-map`, draft.map, [
    ['small', 'Малая'],
    ['normal', 'Обычная'],
    ['large', 'Большая'],
  ]);
  const speed = select(`${testPrefix}-speed`, String(draft.speed), [
    ['1', '1×'],
    ['2', '2×'],
    ['3', '3×'],
  ]);
  const start = select(`${testPrefix}-start`, draft.start, [
    ['low', 'Скудные'],
    ['normal', 'Обычные'],
    ['high', 'Богатые'],
  ]);
  const ai = select(`${testPrefix}-ai`, String(draft.ai), [
    ['0', 'Не заполнять'],
    ['1', 'Один сосед'],
    ['2', 'Два соседа'],
    ['3', 'Три соседа'],
  ]);
  const difficulty = select(`${testPrefix}-diff`, draft.difficulty, [
    ['easy', 'Лёгкий'],
    ['normal', 'Нормальный'],
    ['hard', 'Сложный'],
    ['cruel', 'Жестокий'],
  ]);
  const teams = select(`${testPrefix}-teams`, draft.teams, [
    ['ffa', 'Каждый сам'],
    ['pairs', 'Двое на двое'],
  ]);
  const gold = select(`${testPrefix}-gold`, String(draft.goldTarget), [
    ['1000', '1000 золота'],
    ['2000', '2000 золота'],
    ['4000', '4000 золота'],
  ]);
  const pop = select(`${testPrefix}-pop`, String(draft.popTarget), [
    ['12', 'уровень 4 и 12'],
    ['20', 'уровень 5 и 20'],
    ['30', 'уровень 5 и 30'],
  ]);
  const survive = select(`${testPrefix}-survive`, String(draft.surviveMinutes), [
    ['10', '10 минут'],
    ['20', '20 минут'],
    ['30', '30 минут'],
  ]);
  const goldField = labeled('Золото для «Богатства»', gold);
  const popField = labeled('Население для «Расцвета»', pop);
  const surviveField = labeled('Минуты «Выживания»', survive);
  const syncExtra = () => {
    goldField.hidden = victory.value !== 'wealth';
    popField.hidden = victory.value !== 'bloom';
    surviveField.hidden = victory.value !== 'survival';
  };
  victory.addEventListener('change', syncExtra);
  syncExtra();
  grid.append(
    labeled('Условие победы', victory),
    labeled('Лимит времени', time),
    labeled('Размер карты', map),
    labeled('Скорость', speed),
    labeled('Начальные запасы', start),
    labeled('Соседи на пустые места', ai),
    labeled('Сложность соседей', difficulty),
    labeled('Команды', teams),
    goldField,
    popField,
    surviveField,
  );
  return grid;
}

function readDraft(root: ParentNode, prefix: string, fallback: LobbyDraft): LobbyDraft {
  const value = (id: string) => (root.querySelector<HTMLSelectElement>(`[data-testid="${prefix}-${id}"]`)?.value ?? '');
  const max = Number(root.querySelector<HTMLSelectElement>('#lobby-max')?.value ?? fallback.maxPlayers);
  const name = root.querySelector<HTMLInputElement>('#lobby-name')?.value ?? fallback.name;
  const password = root.querySelector<HTMLInputElement>(`[data-testid="${prefix}-pass"]`)?.value ?? '';
  const victory = value('victory');
  const map = value('map');
  const start = value('start');
  const teams = value('teams');
  const difficulty = value('diff');
  const speed = Number(value('speed'));
  return {
    name,
    maxPlayers: max === 3 || max === 4 ? max : 2,
    password,
    victory: victory === 'wealth' || victory === 'bloom' || victory === 'survival' ? victory : 'conquest',
    timeLimit: [0, 15, 30, 45].includes(Number(value('time'))) ? Number(value('time')) : 0,
    map: map === 'small' || map === 'large' ? map : 'normal',
    start: start === 'low' || start === 'high' ? start : 'normal',
    ai: Math.max(0, Math.min(3, Number(value('ai')) || 0)),
    speed: speed === 2 || speed === 3 ? speed : 1,
    teams: teams === 'pairs' ? 'pairs' : 'ffa',
    difficulty: difficulty === 'easy' || difficulty === 'hard' || difficulty === 'cruel' ? difficulty : 'normal',
    goldTarget: [1000, 2000, 4000].includes(Number(value('gold'))) ? Number(value('gold')) : 2000,
    popTarget: [12, 20, 30].includes(Number(value('pop'))) ? Number(value('pop')) : 20,
    surviveMinutes: [10, 20, 30].includes(Number(value('survive'))) ? Number(value('survive')) : 20,
  };
}

export class NetView {
  private actions: NetActions;
  private root: HTMLElement;
  private sync: HTMLElement;
  private listBuilt = false;
  private waitSig = '';
  private prefill: LobbyDraft = { ...DEFAULT_DRAFT };

  constructor(root: HTMLElement, sync: HTMLElement, actions: NetActions) {
    this.root = root;
    this.sync = sync;
    this.actions = actions;
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  showList(prefill?: Partial<LobbyDraft>) {
    this.show();
    this.listBuilt = true;
    this.prefill = { ...DEFAULT_DRAFT, ...prefill };
    this.root.replaceChildren();
    const card = el('div', 'card');
    const title = el('h1');
    title.textContent = 'Сетевая игра';
    const note = el('p');
    note.id = 'lobby-rules';
    note.textContent = 'Открытые лобби. Хост задаёт условия до старта, их видят все в комнате.';
    const list = el('div');
    list.id = 'lobby-list';
    list.dataset.testid = 'lobby-list';
    const form = el('div', 'lobby-create');
    const name = el('input');
    name.id = 'lobby-name';
    name.dataset.testid = 'lobby-name';
    name.maxLength = 32;
    name.placeholder = 'Название лобби';
    const stored = (localStorage.getItem('dorozhnye-kraya-name') || '').trim();
    name.value = (this.prefill.name || (stored ? `${stored} — тракт` : 'Новый тракт')).slice(0, 32);
    const max = select('lobby-max', String(this.prefill.maxPlayers), [
      ['2', '2 игрока'],
      ['3', '3 игрока'],
      ['4', '4 игрока'],
    ]);
    max.id = 'lobby-max';
    const pass = el('input');
    pass.type = 'password';
    pass.dataset.testid = 'lobby-pass';
    pass.maxLength = 32;
    pass.placeholder = 'Пароль, если нужен';
    pass.autocomplete = 'off';
    const grid = setupGrid(this.prefill, 'lobby');
    const buttons = el('div', 'actions');
    const create = el('button');
    create.type = 'button';
    create.dataset.testid = 'lobby-create';
    create.textContent = 'Создать лобби';
    create.onclick = () => this.actions.create(readDraft(card, 'lobby', { ...this.prefill, name: name.value }));
    const back = el('button');
    back.type = 'button';
    back.dataset.testid = 'lobby-back';
    back.textContent = 'Назад';
    back.onclick = () => this.actions.back();
    const err = el('p');
    err.id = 'net-error';
    err.dataset.testid = 'net-error';
    buttons.append(create, back);
    form.append(labeled('Название', name), labeled('Игроков в комнате', max), labeled('Пароль комнаты', pass), grid, buttons);
    card.append(title, note, list, form, err);
    this.root.append(card);
    const empty = el('p');
    empty.textContent = 'Пока нет открытых лобби.';
    list.append(empty);
  }

  setRows(rows: LobbyRow[]) {
    if (!this.listBuilt || this.root.hidden) return;
    const list = this.root.querySelector('#lobby-list');
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      const empty = el('p');
      empty.textContent = 'Пока нет открытых лобби.';
      list.append(empty);
      return;
    }
    for (const row of rows) {
      const line = el('div', 'lobby-row');
      const brief = el('div', 'lobby-brief');
      const text = el('span');
      text.textContent = `${row.name} · ${row.count}/${row.max} · ${row.host} · ${row.age}`;
      const meta = el('span', 'lobby-meta');
      meta.dataset.testid = 'lobby-summary';
      meta.textContent = row.summary;
      brief.append(text, meta);
      const join = el('button');
      join.type = 'button';
      join.dataset.testid = 'lobby-join';
      join.dataset.id = row.id;
      join.textContent = 'Войти';
      join.onclick = () => {
        const password = this.root.querySelector<HTMLInputElement>('[data-testid="lobby-pass"]')?.value ?? '';
        this.actions.join(row.id, password);
      };
      line.append(brief);
      if (row.locked) line.append(lockIcon());
      line.append(join);
      list.append(line);
    }
  }

  showRoom(room: RoomView) {
    this.listBuilt = false;
    this.show();
    this.root.replaceChildren();
    const card = el('div', 'card');
    card.dataset.testid = 'lobby-room';
    const title = el('h1');
    title.textContent = room.name;
    const meta = el('p');
    meta.textContent = `Игроки ${room.seats.length}/${room.maxPlayers}. Зерно ${room.seed}.`;
    const settings = el('div', 'lobby-settings');
    settings.dataset.testid = 'lobby-settings';
    const line = el('p');
    line.textContent = room.summary;
    const rules = el('p');
    rules.textContent = room.rules;
    const lockNote = el('p');
    lockNote.textContent = room.locked ? 'Комната закрыта паролем.' : 'Пароль не задан.';
    settings.append(line, rules, lockNote);
    const host = room.me === room.hostUid;
    const seats = el('div');
    seats.id = 'lobby-seats';
    for (const seat of room.seats) {
      const line = el('div', 'lobby-row');
      const text = el('span');
      const role = seat.host ? 'хост' : `место ${seat.seat + 1}`;
      text.textContent = `${seat.name} — ${role} — ${seat.ready ? 'готов' : 'не готов'}`;
      line.append(text);
      seats.append(line);
    }
    const invite = el('p');
    const inviteLabel = el('span');
    inviteLabel.textContent = 'Ссылка: ';
    const inviteText = el('span');
    inviteText.dataset.testid = 'lobby-invite';
    inviteText.textContent = room.invite;
    invite.append(inviteLabel, inviteText);
    const actions = el('div', 'actions');
    const mine = room.seats.find((seat) => seat.uid === room.me);
    const ready = el('button');
    ready.type = 'button';
    ready.dataset.testid = 'lobby-ready';
    ready.setAttribute('aria-pressed', mine?.ready ? 'true' : 'false');
    ready.textContent = mine?.ready ? 'Не готов' : 'Готов';
    ready.onclick = () => this.actions.ready(!mine?.ready);
    const leave = el('button');
    leave.type = 'button';
    leave.dataset.testid = 'lobby-leave';
    leave.textContent = 'Выйти';
    leave.onclick = () => this.actions.leave();
    const copy = el('button');
    copy.type = 'button';
    copy.textContent = 'Скопировать ссылку';
    copy.onclick = () => this.actions.copy(room.invite);
    actions.append(ready, leave, copy);
    if (host) {
      const start = el('button');
      start.type = 'button';
      start.dataset.testid = 'lobby-start';
      start.textContent = 'Старт';
      start.disabled = !room.canStart;
      start.onclick = () => this.actions.start();
      actions.append(start);
    }
    const err = el('p');
    err.id = 'net-error';
    err.dataset.testid = 'net-error';
    card.append(title, meta, settings, seats, invite, actions, err);
    this.root.append(card);
  }

  error(message: string) {
    const node = this.root.querySelector('#net-error');
    if (node) node.textContent = message;
  }

  wait(view: WaitView | null, desync: string | null) {
    const sig = desync
      ? `d:${desync}`
      : view
        ? `w:${view.names.join('|')}:${view.exclude.map((player) => player.uid).join('|')}`
        : '';
    if (sig === this.waitSig) return;
    this.waitSig = sig;
    if (!view && !desync) {
      this.sync.hidden = true;
      this.sync.replaceChildren();
      return;
    }
    this.sync.hidden = false;
    this.sync.replaceChildren();
    const card = el('div', 'card');
    card.dataset.testid = 'syncbox';
    const title = el('h2');
    if (desync) {
      title.textContent = 'Рассинхронизация';
      const detail = el('p');
      detail.dataset.testid = 'sync-detail';
      detail.textContent = desync;
      card.append(title, detail);
    } else if (view) {
      title.textContent = view.names.length ? `Ждём игрока ${view.names.join(', ')}` : 'Ждём ход';
      card.append(title);
      for (const player of view.exclude) {
        const button = el('button');
        button.type = 'button';
        button.dataset.testid = 'sync-exclude';
        button.dataset.uid = player.uid;
        button.textContent = 'Исключить и продолжить';
        const name = el('span');
        name.textContent = ` ${player.name}`;
        button.append(name);
        button.onclick = () => this.actions.exclude(player.uid);
        card.append(button);
      }
    }
    this.sync.append(card);
  }
}
