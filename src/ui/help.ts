import { BUILDINGS, CATEGORY_NAME, RESOURCE_NAME, counterFactor } from '../sim/balance';
import type { BuildingDef } from '../sim/balance';
import type { BuildingType, Resource, Weapon } from '../sim/types';

function costLine(cost: BuildingDef['cost']): string {
  const parts = (Object.keys(cost) as Resource[])
    .filter((key) => (cost[key] ?? 0) > 0)
    .map((key) => `${cost[key]} ${RESOURCE_NAME[key]}`);
  return parts.length ? parts.join(', ') : 'бесплатно';
}

function flow(def: BuildingDef): string {
  const inn = def.input ? RESOURCE_NAME[def.input] : '';
  const out = def.output ? `${def.outputQty} ${RESOURCE_NAME[def.output]}` : '';
  if (inn && out) return `${inn} → ${out}`;
  if (out) return `→ ${out}`;
  return '—';
}

function tip(def: BuildingDef): string {
  const bits = [def.desc];
  if (def.nearHint) bits.push(def.nearHint);
  if (def.needsDeer) bits.push('Рядом должны водиться олени.');
  if (def.terrain && def.terrain.length) bits.push('Встаёт только на подходящую землю.');
  return bits.filter(Boolean).join(' ');
}

function buildingRows(): string {
  const groups = Object.keys(CATEGORY_NAME) as (keyof typeof CATEGORY_NAME)[];
  return groups
    .map((category) => {
      const rows = (Object.keys(BUILDINGS) as BuildingType[])
        .filter((type) => BUILDINGS[type].category === category)
        .map((type) => {
          const def = BUILDINGS[type];
          return `<article class="help-entry" id="help-${type}">
            <h3>${def.name}</h3>
            <p>Цена: ${costLine(def.cost)}. Работников: ${def.workers}. Открывается с уровня главного здания ${def.keepLevel}.</p>
            <p>Вход и выход: ${flow(def)}.</p>
            <p>${tip(def)}</p>
          </article>`;
        })
        .join('');
      return `<section><h2>${CATEGORY_NAME[category]}</h2>${rows}</section>`;
    })
    .join('');
}

const MATRIX_COLS: { id: Weapon; name: string }[] = [
  { id: 'club', name: 'Ополченец' },
  { id: 'spear', name: 'Копейщик' },
  { id: 'sword', name: 'Мечник' },
  { id: 'bow', name: 'Лучник' },
  { id: 'light', name: 'Лёгкая' },
  { id: 'heavy', name: 'Тяжёлая' },
  { id: 'ram', name: 'Таран' },
];

function matrixCell(value: number): string {
  if (value >= 1.5) return 'сильный';
  if (value <= 0.7) return 'слабый';
  if (value >= 1.15) return 'выше';
  if (value <= 0.9) return 'ниже';
  return 'ровно';
}

function matrixTable(): string {
  const head = MATRIX_COLS.map((col) => `<th>${col.name}</th>`).join('');
  const rows = MATRIX_COLS.map((row) => {
    const cells = MATRIX_COLS.map((col) => {
      if (row.id === col.id) return '<td>—</td>';
      const factor = counterFactor(row.id, col.id);
      return `<td>${matrixCell(factor)}</td>`;
    }).join('');
    return `<tr><th>${row.name}</th>${cells}</tr>`;
  }).join('');
  return `<div id="help-matrix" data-testid="help-matrix"><h3>Кто кого бьёт</h3>
    <p>Строка бьёт столбец. «Сильный» и «слабый» — множитель урона, не скорость и не запас жизни.</p>
    <table class="counter-matrix"><thead><tr><th>Бьёт ↓ / кого →</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function helpHtml(): string {
  return `<div class="card help-card">
    <h2>Справка</h2>
    <p>Короткий справочник построек, войска, еды и клавиш.</p>
    ${buildingRows()}
    <section id="help-units" data-testid="help-units">
      <h2>Войско</h2>
      <p>Нет одной фигуры, которая бьёт всех. Копьё держит конницу, лук и меч бьют копьё, лёгкая конница рвёт обозы и осадные машины, тяжёлая бьёт первым наскоком и вязнет в копьях.</p>
      <ul>
        <li><b>Ополченец</b> — дёшево из дерева. Слабее меча и лука в чистом поле. Несколько дубин проламывают палисад и, дольше, стену.</li>
        <li><b>Копейщик</b> — дерево, немного золота и оружие из кузницы. Сильный бонус против лёгкой и тяжёлой конницы. Слаб против лучников и мечников.</li>
        <li><b>Мечник</b> — оружие и доспехи. Сильнее лучника и копейщика вплотную, сильнее тарана. На дистанции проигрывает луку. Доспех снижает урон стрел.</li>
        <li><b>Лучник</b> — сильнее копейщика и мечника, пока держит дистанцию. Таран доходит сквозь стрелы.</li>
        <li><b>Лёгкая конница</b> — лошадь, дерево и немного золота. Быстрый набег: бонус по носильщикам, работникам и осадным машинам. Слаба против копий.</li>
        <li><b>Тяжёлая конница</b> — лошадь, оружие, доспехи и много золота. Первый удар — наскок, дальше слабее. Копья её останавливают.</li>
        <li><b>Таран</b> — ломает палисад и стену быстрее дубин. Вплотную проигрывает мечу и лёгкой коннице.</li>
        <li><b>Катапульта</b> — бьёт стену издалека. Против лучников в чистом поле не держится.</li>
        <li><b>Инженер</b> и <b>лестничник</b> — для стены и башни. В чистом поле проигрывают мечу.</li>
      </ul>
      ${matrixTable()}
      <p>Цепь, как в крепости: рудник → кузница → оружейная → казарма. Конюшня на траве или в оазисе кормит лошадей яблоками или пшеницей. В оружейной можно потратить 4 доспеха и укрепить кольчугу: стрелы бьют слабее весь отряд.</p>
    </section>
    <section id="help-chains">
      <h2>Еда и цепи</h2>
      <pre class="chain">сад → яблоки
ферма → сыр
охота → мясо
пшеница → мельница → мука → пекарня → хлеб
хмель → пивоварня → пиво → таверна
рудник → кузница → оружие и доспехи → оружейная → казарма
конюшня → лошади → оружейная → конница</pre>
      <p>Разные виды еды поднимают настроение. Пиво из таверны тоже. Дорога из одного дерева ускоряет ношу и войско в 1.45 раза, пока они стоят на ней. Большой тракт уже считается дорогой.</p>
    </section>
    <section id="help-keys">
      <h2>Клавиши</h2>
      <ul>
        <li>Z — жильё, X — еда, C — добыча, V — войско, B — запасы, N — оборона.</li>
        <li>WASD и стрелки двигают карту. Колесо и +/− меняют масштаб.</li>
        <li>Пробел — пауза. 1, 2, 3 — скорость, если на цифре нет запомненного отряда.</li>
        <li>Ctrl+1…9 запоминает отряд, 1…9 выбирает его, повтор показывает отряд.</li>
        <li>A — атака области, когда войско выделено. H — короткие подсказки. Esc закрывает панель.</li>
        <li>Двойной щелчок по копейщику или всаднику выбирает всех таких на экране. В казарме отдельные кнопки на копьё, лёгкую и тяжёлую конницу.</li>
      </ul>
    </section>
    <div class="actions"><button type="button" id="help-close" data-testid="help-close">Закрыть</button></div>
  </div>`;
}
