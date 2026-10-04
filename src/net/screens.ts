import type { LobbyRow, RoomView, WaitView } from './session';

export interface NetActions {
  create: (name: string, maxPlayers: 2 | 3 | 4) => void;
  join: (id: string) => void;
  leave: () => void;
  ready: (value: boolean) => void;
  start: () => void;
  back: () => void;
  exclude: (uid: string) => void;
  copy: (url: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export class NetView {
  private actions: NetActions;
  private root: HTMLElement;
  private sync: HTMLElement;
  private listBuilt = false;
  private waitSig = '';

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

  showList(rules?: string) {
    this.show();
    this.listBuilt = true;
    this.root.replaceChildren();
    const card = el('div', 'card');
    const title = el('h1');
    title.textContent = 'Сетевая игра';
    const note = el('p');
    note.id = 'lobby-rules';
    note.textContent = rules
      ? `Открытые лобби. В комнате от двух до четырёх игроков. Условия матча задаёт хост: ${rules}`
      : 'Открытые лобби. В комнате от двух до четырёх игроков.';
    const list = el('div');
    list.id = 'lobby-list';
    list.dataset.testid = 'lobby-list';
    const form = el('div', 'actions');
    const name = el('input');
    name.id = 'lobby-name';
    name.dataset.testid = 'lobby-name';
    name.maxLength = 32;
    name.placeholder = 'Название лобби';
    const stored = (localStorage.getItem('dorozhnye-kraya-name') || '').trim();
    name.value = (stored ? `${stored} — тракт` : 'Новый тракт').slice(0, 32);
    const max = el('select');
    max.id = 'lobby-max';
    max.dataset.testid = 'lobby-max';
    for (const count of [2, 3, 4] as const) {
      const option = el('option');
      option.value = String(count);
      option.textContent = `${count} игрока`;
      if (count === 2) option.selected = true;
      max.append(option);
    }
    const create = el('button');
    create.type = 'button';
    create.dataset.testid = 'lobby-create';
    create.textContent = 'Создать лобби';
    create.onclick = () => {
      const picked = Number(max.value);
      const cap = picked === 3 || picked === 4 ? picked : 2;
      this.actions.create(name.value, cap);
    };
    const back = el('button');
    back.type = 'button';
    back.dataset.testid = 'lobby-back';
    back.textContent = 'Назад';
    back.onclick = () => this.actions.back();
    const err = el('p');
    err.id = 'net-error';
    err.dataset.testid = 'net-error';
    form.append(name, max, create, back);
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
      const text = el('span');
      text.textContent = `${row.name} · ${row.count}/${row.max} · ${row.host} · ${row.age}`;
      const join = el('button');
      join.type = 'button';
      join.dataset.testid = 'lobby-join';
      join.dataset.id = row.id;
      join.textContent = 'Войти';
      join.onclick = () => this.actions.join(row.id);
      line.append(text, join);
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
    meta.textContent = `Игроки ${room.seats.length}/${room.maxPlayers}. Зерно ${room.seed}. ${room.rules}`;
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
    ready.textContent = mine?.ready ? 'Готов' : 'Готов';
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
    if (room.me === room.hostUid) {
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
    card.append(title, meta, seats, invite, actions, err);
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
