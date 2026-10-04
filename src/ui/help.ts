import { BUILDINGS, CATEGORY_NAME, RESOURCE_NAME } from '../sim/balance';
import type { BuildingDef } from '../sim/balance';
import type { BuildingType, Resource } from '../sim/types';

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

export function helpHtml(): string {
  return `<div class="card help-card">
    <h2>Справка</h2>
    <p>Короткий справочник построек, войска, еды и клавиш.</p>
    ${buildingRows()}
    <section id="help-units">
      <h2>Войско</h2>
      <p>Нет одной фигуры, которая бьёт всех. Меч побеждает лук вблизи, лук побеждает меч на дистанции. Таран побеждает лучников, меч побеждает таран вплотную.</p>
      <ul>
        <li><b>Ополченец</b> — дёшево из дерева. Слабее меча и лука в чистом поле. Несколько дубин проламывают палисад и, дольше, стену.</li>
        <li><b>Мечник</b> — сильнее лучника, когда сходится вплотную, и сильнее тарана. На дистанции проигрывает луку.</li>
        <li><b>Лучник</b> — сильнее мечника, пока держит дистанцию, и слабее, когда меч уже рядом. Таран доходит сквозь стрелы.</li>
        <li><b>Таран</b> — ломает палисад и стену быстрее дубин. Вплотную проигрывает мечу.</li>
        <li><b>Катапульта</b> — бьёт стену издалека. Против лучников в чистом поле не держится.</li>
        <li><b>Инженер</b> и <b>лестничник</b> — для стены и башни. В чистом поле проигрывают мечу.</li>
      </ul>
    </section>
    <section id="help-chains">
      <h2>Еда и цепи</h2>
      <pre class="chain">сад → яблоки
ферма → сыр
охота → мясо
пшеница → мельница → мука → пекарня → хлеб
хмель → пивоварня → пиво → таверна</pre>
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
      </ul>
    </section>
    <div class="actions"><button type="button" id="help-close" data-testid="help-close">Закрыть</button></div>
  </div>`;
}
