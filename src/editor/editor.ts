import {
  blankMap,
  cloneMap,
  decodeShare,
  deleteMap,
  encodeShare,
  exportJson,
  importMap,
  listMaps,
  loadMap,
  MAP_SHARE_LIMIT,
  mapDims,
  renameMap,
  roadMask,
  saveMap,
  sizeName,
  validateMap,
  type CustomMap,
  type PropKind,
  type RoadLayout,
  type SeasonStart,
} from '../sim/custom';
import { Terrain, type EventPace, type MapSizeId } from '../sim/types';

type Tool = 'grass' | 'sand' | 'forest' | 'rock' | 'water' | 'swamp' | 'stone' | 'iron' | 'clay' | 'pitch' | 'tree' | 'wolf' | 'bear' | 'deer' | 'bandit' | 'camp' | 'start' | 'erase';

const TERRAIN: Record<'grass' | 'sand' | 'forest' | 'rock' | 'water' | 'swamp' | 'stone' | 'iron' | 'clay' | 'pitch' | 'tree', number> = {
  grass: Terrain.Land,
  sand: Terrain.Desert,
  forest: Terrain.Forest,
  rock: Terrain.Rock,
  water: Terrain.Water,
  swamp: Terrain.Swamp,
  stone: Terrain.Limestone,
  iron: Terrain.Iron,
  clay: Terrain.Clay,
  pitch: Terrain.Swamp,
  tree: Terrain.Forest,
};

const FILL = ['#c9b48a', '#d8c07a', '#4e924a', '#5f8a3e', '#c8c2b2', '#945c44', '#2c3a2c', '#8a643c', '#76746e', '#306094', '#b07048'];

interface Stroke {
  cells: { i: number; prev: number }[];
  starts: CustomMap['starts'];
  props: CustomMap['props'];
}

export interface EditorHooks {
  land: () => boolean;
  flash: (text: string) => void;
  onPlay: (map: CustomMap) => void;
  onClose: () => void;
}

let root: HTMLElement | null = null;
let hooks: EditorHooks | null = null;
let map: CustomMap = blankMap();
let tool: Tool = 'grass';
let brush = 1;
let team: 0 | 1 | 2 | 3 = 0;
let undo: Stroke[] = [];
let redo: Stroke[] = [];
let stroke: Stroke | null = null;
let painting = false;
let ghost: { x: number; y: number } | null = null;
let view: 'map' | 'list' = 'map';
let savedId = '';

function paintValue(kind: Tool): number | null {
  if (kind in TERRAIN) return TERRAIN[kind as keyof typeof TERRAIN];
  return null;
}

function radius(): number {
  if (tool === 'tree') return 0;
  return brush === 5 ? 2 : brush === 3 ? 1 : 0;
}

function mount(host: HTMLElement) {
  host.innerHTML = `<div class="editor-shell">
    <div class="editor-tools" data-testid="editor-tools">
      <header class="help-head"><h2>Редактор карт</h2></header>
      <label>Название <input id="editor-name" data-testid="editor-name" maxlength="24" /></label>
      <label>Размер <select id="editor-size" data-testid="editor-size">
        <option value="small">Малая</option>
        <option value="normal">Средняя</option>
        <option value="large">Большая</option>
      </select></label>
      <label>Тракт <select id="editor-road" data-testid="editor-road">
        <option value="straight">Прямой</option>
        <option value="bend">Изгиб</option>
        <option value="cross">Перекрёсток</option>
      </select></label>
      <p>Кисть</p>
      <div class="editor-row">
        <button type="button" data-brush="1" data-testid="brush-1">1</button>
        <button type="button" data-brush="3" data-testid="brush-3">3</button>
        <button type="button" data-brush="5" data-testid="brush-5">5</button>
      </div>
      <p>Земля</p>
      <div class="editor-row">
        <button type="button" data-tool="grass" data-testid="tool-grass">Трава</button>
        <button type="button" data-tool="sand" data-testid="tool-sand">Песок</button>
        <button type="button" data-tool="forest" data-testid="tool-forest">Лес</button>
        <button type="button" data-tool="rock" data-testid="tool-rock">Скала</button>
        <button type="button" data-tool="water" data-testid="tool-water">Вода</button>
        <button type="button" data-tool="swamp" data-testid="tool-swamp">Болото</button>
      </div>
      <p>Залежи и деревья</p>
      <div class="editor-row">
        <button type="button" data-tool="stone" data-testid="tool-stone">Камень</button>
        <button type="button" data-tool="iron" data-testid="tool-iron">Железо</button>
        <button type="button" data-tool="clay" data-testid="tool-clay">Глина</button>
        <button type="button" data-tool="pitch" data-testid="tool-pitch">Смола</button>
        <button type="button" data-tool="tree" data-testid="tool-tree">Дерево</button>
      </div>
      <p>Живое</p>
      <div class="editor-row">
        <button type="button" data-tool="wolf" data-testid="tool-wolf">Волк</button>
        <button type="button" data-tool="bear" data-testid="tool-bear">Медведь</button>
        <button type="button" data-tool="deer" data-testid="tool-deer">Олень</button>
        <button type="button" data-tool="bandit" data-testid="tool-bandit">Разбойник</button>
        <button type="button" data-tool="camp" data-testid="tool-camp">Лагерь</button>
      </div>
      <p>Старты</p>
      <div class="editor-row">
        <button type="button" data-tool="start" data-testid="tool-start">Старт</button>
        <button type="button" data-tool="erase" data-testid="tool-erase">Снять</button>
      </div>
      <label>Знак команды <select id="editor-team" data-testid="editor-team">
        <option value="0">1</option><option value="1">2</option><option value="2">3</option><option value="3">4</option>
      </select></label>
      <label>Старт сезона <select id="editor-season" data-testid="editor-season">
        <option value="off">Без смены</option>
        <option value="spring">Весна</option>
        <option value="summer">Лето</option>
        <option value="autumn">Осень</option>
        <option value="winter">Зима</option>
      </select></label>
      <label>События <select id="editor-events" data-testid="editor-events">
        <option value="off">Выкл</option>
        <option value="rare">Редко</option>
        <option value="normal">Обычно</option>
        <option value="often">Часто</option>
      </select></label>
      <div class="editor-row">
        <button type="button" id="editor-undo" data-testid="editor-undo">Отменить</button>
        <button type="button" id="editor-redo" data-testid="editor-redo">Вернуть</button>
      </div>
      <button type="button" id="editor-validate" data-testid="editor-validate">Проверить</button>
      <p id="editor-errors" data-testid="editor-errors"></p>
      <div class="editor-row">
        <button type="button" id="editor-save" data-testid="editor-save">Сохранить</button>
        <button type="button" id="editor-list" data-testid="editor-list-open">Мои карты</button>
      </div>
      <div class="editor-row">
        <button type="button" id="editor-export" data-testid="editor-export">Файл JSON</button>
        <button type="button" id="editor-import" data-testid="editor-import">Открыть JSON</button>
      </div>
      <input id="editor-file" data-testid="editor-file" type="file" accept="application/json,.json" hidden />
      <label>Код <textarea id="editor-code" data-testid="editor-code" rows="3" readonly></textarea></label>
      <div class="editor-row">
        <button type="button" id="editor-copy" data-testid="editor-copy">Копировать код</button>
        <button type="button" id="editor-paste" data-testid="editor-paste">Вставить код</button>
      </div>
      <div class="actions">
        <button type="button" id="editor-play" data-testid="editor-play">Играть</button>
        <button type="button" id="editor-close" data-testid="editor-close">Закрыть</button>
      </div>
    </div>
    <div class="editor-stage">
      <canvas id="editor-canvas" data-testid="editor-canvas"></canvas>
      <p id="editor-ghost" data-testid="editor-ghost" hidden></p>
      <button type="button" id="editor-confirm" class="editor-confirm" data-testid="editor-confirm">Поставить</button>
      <div id="editor-catalog" data-testid="editor-catalog" hidden></div>
    </div>
  </div>`;
  bind(host);
  syncForm();
  draw();
}

function bind(host: HTMLElement) {
  host.querySelector('#editor-name')!.addEventListener('change', () => {
    map.name = (host.querySelector<HTMLInputElement>('#editor-name')!.value || 'Новый край').slice(0, 24);
  });
  host.querySelector('#editor-size')!.addEventListener('change', () => {
    const size = host.querySelector<HTMLSelectElement>('#editor-size')!.value as MapSizeId;
    if (size === map.size) return;
    undo = [];
    redo = [];
    const next = blankMap(size, map.road);
    next.name = map.name;
    next.seasonStart = map.seasonStart;
    next.events = map.events;
    map = next;
    draw();
  });
  host.querySelector('#editor-road')!.addEventListener('change', () => {
    map.road = host.querySelector<HTMLSelectElement>('#editor-road')!.value as RoadLayout;
    draw();
  });
  host.querySelector('#editor-team')!.addEventListener('change', () => {
    const value = Number(host.querySelector<HTMLSelectElement>('#editor-team')!.value);
    team = value === 1 || value === 2 || value === 3 ? value : 0;
  });
  host.querySelector('#editor-season')!.addEventListener('change', () => {
    map.seasonStart = host.querySelector<HTMLSelectElement>('#editor-season')!.value as SeasonStart;
  });
  host.querySelector('#editor-events')!.addEventListener('change', () => {
    map.events = host.querySelector<HTMLSelectElement>('#editor-events')!.value as EventPace;
  });
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-brush]')) {
    button.onclick = () => {
      brush = Number(button.dataset.brush) === 5 ? 5 : Number(button.dataset.brush) === 3 ? 3 : 1;
      markTools();
    };
  }
  for (const button of host.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.onclick = () => {
      tool = (button.dataset.tool || 'grass') as Tool;
      markTools();
    };
  }
  host.querySelector<HTMLButtonElement>('#editor-undo')!.onclick = () => pop(undo, redo);
  host.querySelector<HTMLButtonElement>('#editor-redo')!.onclick = () => pop(redo, undo);
  host.querySelector<HTMLButtonElement>('#editor-validate')!.onclick = () => showErrors(validateMap(readForm()));
  host.querySelector<HTMLButtonElement>('#editor-save')!.onclick = () => {
    const current = readForm();
    const record = saveMap(current, savedId || undefined);
    savedId = record.id;
    hooks?.flash(`Карта «${record.name}» сохранена`);
    refreshCode();
    if (view === 'list') showList();
  };
  host.querySelector<HTMLButtonElement>('#editor-list')!.onclick = () => {
    view = view === 'list' ? 'map' : 'list';
    showList();
  };
  host.querySelector<HTMLButtonElement>('#editor-export')!.onclick = () => {
    const blob = new Blob([exportJson(readForm())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${map.name || 'karta'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  host.querySelector<HTMLButtonElement>('#editor-import')!.onclick = () => host.querySelector<HTMLInputElement>('#editor-file')!.click();
  host.querySelector<HTMLInputElement>('#editor-file')!.onchange = () => {
    const file = host.querySelector<HTMLInputElement>('#editor-file')!.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        adopt(importMap(text));
        hooks?.flash('Карта открыта');
      } catch (err) {
        hooks?.flash(err instanceof Error ? err.message : 'Файл карты не читается');
      }
    });
  };
  host.querySelector<HTMLButtonElement>('#editor-copy')!.onclick = () => {
    const code = encodeShare(readForm());
    const area = host.querySelector<HTMLTextAreaElement>('#editor-code')!;
    area.value = code;
    void navigator.clipboard?.writeText(code).then(
      () => hooks?.flash(code.length > MAP_SHARE_LIMIT ? 'Код длинный для сетевой комнаты' : 'Код скопирован'),
      () => hooks?.flash('Код показан в поле'),
    );
  };
  host.querySelector<HTMLButtonElement>('#editor-paste')!.onclick = () => {
    const area = host.querySelector<HTMLTextAreaElement>('#editor-code')!;
    const typed = window.prompt('Вставьте код карты', area.value) ?? '';
    if (!typed.trim()) return;
    try {
      adopt(decodeShare(typed.trim()));
      hooks?.flash('Код принят');
    } catch (err) {
      hooks?.flash(err instanceof Error ? err.message : 'Код карты не читается');
    }
  };
  host.querySelector<HTMLButtonElement>('#editor-play')!.onclick = () => {
    const current = readForm();
    const errors = validateMap(current);
    showErrors(errors);
    if (errors.length) return;
    hooks?.onPlay(current);
  };
  host.querySelector<HTMLButtonElement>('#editor-close')!.onclick = () => hooks?.onClose();
  host.querySelector<HTMLButtonElement>('#editor-confirm')!.onclick = () => {
    if (!ghost) return;
    beginStroke();
    apply(ghost.x, ghost.y);
    commitStroke();
    draw();
  };
  const canvas = host.querySelector<HTMLCanvasElement>('#editor-canvas')!;
  canvas.addEventListener('pointerdown', (event) => {
    const tile = tileAt(event);
    if (!tile) return;
    if (hooks?.land()) {
      ghost = tile;
      draw();
      return;
    }
    painting = true;
    canvas.setPointerCapture(event.pointerId);
    beginStroke();
    apply(tile.x, tile.y);
    draw();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!painting || hooks?.land()) return;
    const tile = tileAt(event);
    if (!tile) return;
    apply(tile.x, tile.y);
    draw();
  });
  const stop = () => {
    if (!painting) return;
    painting = false;
    commitStroke();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  markTools();
}

function markTools() {
  if (!root) return;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.classList.toggle('on', button.dataset.tool === tool);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-brush]')) button.classList.toggle('on', Number(button.dataset.brush) === brush);
}

function syncForm() {
  if (!root) return;
  root.querySelector<HTMLInputElement>('#editor-name')!.value = map.name;
  root.querySelector<HTMLSelectElement>('#editor-size')!.value = map.size;
  root.querySelector<HTMLSelectElement>('#editor-road')!.value = map.road;
  root.querySelector<HTMLSelectElement>('#editor-season')!.value = map.seasonStart;
  root.querySelector<HTMLSelectElement>('#editor-events')!.value = map.events;
  refreshCode();
}

function readForm(): CustomMap {
  if (!root) return map;
  map.name = (root.querySelector<HTMLInputElement>('#editor-name')!.value || 'Новый край').slice(0, 24);
  map.seasonStart = root.querySelector<HTMLSelectElement>('#editor-season')!.value as SeasonStart;
  map.events = root.querySelector<HTMLSelectElement>('#editor-events')!.value as EventPace;
  map.road = root.querySelector<HTMLSelectElement>('#editor-road')!.value as RoadLayout;
  return map;
}

function refreshCode() {
  if (!root) return;
  const code = encodeShare(map);
  const area = root.querySelector<HTMLTextAreaElement>('#editor-code');
  if (area) area.value = code;
}

function showErrors(errors: string[]) {
  const node = root?.querySelector<HTMLElement>('#editor-errors');
  if (!node) return;
  node.textContent = errors.length ? errors.join(' ') : 'Карта годится.';
}

function beginStroke() {
  stroke = { cells: [], starts: map.starts.map((start) => ({ ...start })), props: map.props.map((prop) => ({ ...prop })) };
}

function commitStroke() {
  if (!stroke) return;
  if (stroke.cells.length || JSON.stringify(stroke.starts) !== JSON.stringify(map.starts) || JSON.stringify(stroke.props) !== JSON.stringify(map.props)) {
    undo.push(stroke);
    if (undo.length > 40) undo.shift();
    redo = [];
  }
  stroke = null;
}

function pop(from: Stroke[], to: Stroke[]) {
  const step = from.pop();
  if (!step) return;
  const back: Stroke = { cells: [], starts: map.starts.map((start) => ({ ...start })), props: map.props.map((prop) => ({ ...prop })) };
  for (const cell of step.cells) {
    back.cells.push({ i: cell.i, prev: map.paint[cell.i] });
    map.paint[cell.i] = cell.prev;
  }
  map.starts = step.starts.map((start) => ({ ...start }));
  map.props = step.props.map((prop) => ({ ...prop }));
  to.push(back);
  draw();
}

function apply(x: number, y: number) {
  const value = paintValue(tool);
  if (value != null) {
    const { w, h } = mapDims(map.size);
    const r = radius();
    const mask = roadMask(w, h, map.road);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const index = ty * w + tx;
        if (mask[index]) continue;
        if (!stroke) beginStroke();
        if (!stroke!.cells.some((cell) => cell.i === index)) stroke!.cells.push({ i: index, prev: map.paint[index] });
        map.paint[index] = value;
      }
    }
    return;
  }
  if (tool === 'erase') {
    map.props = map.props.filter((prop) => Math.max(Math.abs(prop.x - x), Math.abs(prop.y - y)) > 1);
    map.starts = map.starts.filter((start) => Math.max(Math.abs(start.x - x), Math.abs(start.y - y)) > 1);
    return;
  }
  if (tool === 'start') {
    const hit = map.starts.find((start) => Math.max(Math.abs(start.x - x), Math.abs(start.y - y)) <= 1);
    if (hit) {
      hit.team = team;
      return;
    }
    if (map.starts.length >= 4) {
      hooks?.flash('Стартов уже четыре');
      return;
    }
    map.starts.push({ x, y, team });
    return;
  }
  const kind = tool as PropKind;
  if (kind === 'wolf' || kind === 'bear' || kind === 'deer' || kind === 'bandit' || kind === 'camp') {
    if (map.props.length >= 80) return;
    map.props.push({ kind, x, y });
  }
}

function tileAt(event: PointerEvent): { x: number; y: number } | null {
  const canvas = root?.querySelector<HTMLCanvasElement>('#editor-canvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const { w, h } = mapDims(map.size);
  const cell = fitCell(canvas.clientWidth, canvas.clientHeight, w, h);
  const originX = Math.floor((canvas.clientWidth - w * cell) / 2);
  const originY = Math.floor((canvas.clientHeight - h * cell) / 2);
  const x = Math.floor((event.clientX - rect.left - originX) / cell);
  const y = Math.floor((event.clientY - rect.top - originY) / cell);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  return { x, y };
}

function fitCell(viewW: number, viewH: number, w: number, h: number): number {
  return Math.max(2, Math.min(8, Math.floor(Math.min(viewW / w, viewH / h))));
}

function draw() {
  const canvas = root?.querySelector<HTMLCanvasElement>('#editor-canvas');
  const ghostLine = root?.querySelector<HTMLElement>('#editor-ghost');
  if (!canvas) return;
  const stage = canvas.parentElement;
  const viewW = Math.max(200, stage?.clientWidth ?? 640);
  const viewH = Math.max(160, stage?.clientHeight ?? 480);
  canvas.width = viewW;
  canvas.height = viewH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { w, h } = mapDims(map.size);
  const cell = fitCell(viewW, viewH, w, h);
  const originX = Math.floor((viewW - w * cell) / 2);
  const originY = Math.floor((viewH - h * cell) / 2);
  ctx.fillStyle = '#1c1612';
  ctx.fillRect(0, 0, viewW, viewH);
  const mask = roadMask(w, h, map.road);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      ctx.fillStyle = mask[index] ? '#8a643c' : FILL[map.paint[index]] ?? FILL[0];
      ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
    }
  }
  ctx.font = `${Math.max(8, cell * 2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const prop of map.props) {
    ctx.fillStyle = '#1c1612';
    const mark = prop.kind === 'camp' ? 'Л' : prop.kind === 'bandit' ? 'Р' : prop.kind === 'wolf' ? 'В' : prop.kind === 'bear' ? 'М' : 'О';
    ctx.fillText(mark, originX + prop.x * cell + cell / 2, originY + prop.y * cell + cell / 2);
  }
  map.starts.forEach((start, index) => {
    ctx.fillStyle = ['#e6b15a', '#8dce67', '#7eb6e6', '#e15b45'][start.team];
    ctx.beginPath();
    ctx.arc(originX + start.x * cell + cell / 2, originY + start.y * cell + cell / 2, Math.max(4, cell * 1.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1612';
    ctx.fillText(String(index + 1), originX + start.x * cell + cell / 2, originY + start.y * cell + cell / 2);
  });
  if (ghost && hooks?.land()) {
    ctx.strokeStyle = '#e6b15a';
    ctx.lineWidth = 2;
    const r = radius();
    const size = (r * 2 + 1) * cell;
    ctx.strokeRect(originX + (ghost.x - r) * cell, originY + (ghost.y - r) * cell, size, size);
    if (ghostLine) {
      ghostLine.hidden = false;
      ghostLine.textContent = `Кисть ${tool === 'tree' ? 1 : brush} · ${ghost.x}, ${ghost.y}`;
    }
  } else if (ghostLine) ghostLine.hidden = true;
}

function showList() {
  const catalog = root?.querySelector<HTMLElement>('#editor-catalog');
  if (!catalog) return;
  catalog.hidden = view !== 'list';
  if (view !== 'list') return;
  const rows = listMaps();
  catalog.innerHTML = `<div class="card editor-list"><h2>Мои карты</h2><div data-testid="editor-saved">${
    rows.length
      ? rows
          .map(
            (row) => `<div class="history-row" data-id="${row.id}">
              <input data-testid="editor-rename" value="${row.name.replace(/"/g, '&quot;')}" maxlength="24" />
              <button type="button" data-act="rename">Имя</button>
              <button type="button" data-act="open">Открыть</button>
              <button type="button" data-act="delete">Удалить</button>
            </div>`,
          )
          .join('')
      : '<p>Пока пусто.</p>'
  }</div><button type="button" id="editor-list-close" data-testid="editor-list-close">К карте</button></div>`;
  catalog.querySelector('#editor-list-close')!.addEventListener('click', () => {
    view = 'map';
    showList();
  });
  for (const row of catalog.querySelectorAll<HTMLElement>('.history-row')) {
    const id = row.dataset.id || '';
    row.querySelector<HTMLButtonElement>('[data-act="open"]')!.onclick = () => {
      const loaded = loadMap(id);
      if (!loaded) {
        hooks?.flash('Карта не читается');
        return;
      }
      savedId = id;
      adopt(loaded);
      view = 'map';
      showList();
    };
    row.querySelector<HTMLButtonElement>('[data-act="rename"]')!.onclick = () => {
      const name = row.querySelector<HTMLInputElement>('input')!.value;
      renameMap(id, name);
      if (savedId === id) map.name = name;
      showList();
    };
    row.querySelector<HTMLButtonElement>('[data-act="delete"]')!.onclick = () => {
      deleteMap(id);
      if (savedId === id) savedId = '';
      showList();
    };
  }
}

function adopt(next: CustomMap) {
  map = cloneMap(next);
  undo = [];
  redo = [];
  ghost = null;
  view = 'map';
  syncForm();
  showList();
  draw();
}

export function openMapEditor(host: HTMLElement, next: EditorHooks, initial?: CustomMap) {
  root = host;
  hooks = next;
  map = cloneMap(initial ?? blankMap());
  tool = 'grass';
  brush = 1;
  undo = [];
  redo = [];
  ghost = null;
  view = 'map';
  savedId = '';
  host.hidden = false;
  mount(host);
}

export function closeMapEditor() {
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
  root = null;
}

export function editorMap(): CustomMap {
  return readForm();
}

export function editorShowList() {
  view = 'list';
  showList();
}

export function editorLoad(next: CustomMap) {
  adopt(next);
}

export function currentShare(): string {
  return encodeShare(readForm());
}

export { sizeName };
