import { mkdirSync, writeFileSync } from 'node:fs';
import { BUILDINGS, KEEP_UPGRADE_COST, KEEP_UPGRADE_TICKS, PRICES, TAXES, counterFactor } from '../src/sim/balance';
import {
  CHAINS,
  craftMargins,
  difficultySnapshot,
  housingRows,
  measureChain,
  measureDuel,
  measureKeepClimb,
  measureTaxes,
  measureWall,
  popularityLines,
  priceRows,
  runMatch,
  scriptedBloom,
  scriptedConquest,
} from '../src/sim/measure';
import type { ChainResult, DuelResult, MatchResult, WallResult } from '../src/sim/measure';
import type { DifficultyId } from '../src/sim/types';

const BEFORE = {
  apples: { perMinute: 30, perTile: 2.5, payback: 1.2 },
  cheese: { perMinute: 0.5, perTile: 0.06, payback: 32 },
  meat: { perMinute: 0.17, perTile: 0.17, payback: 45 },
  bread: { perMinute: 0.17, perTile: 0.02, payback: 504 },
  beer: { perMinute: 0.33, perTile: 0.04, payback: 117 },
  wood: { perMinute: 0.33, payback: 27 },
  stone: { perMinute: 0.17, payback: 72 },
  iron: { perMinute: 0, payback: -1 },
  swordBowClose: 'мечи, 192 hp',
  clubBow: 'дубины, 30 hp',
  bowRam: 'тараны',
  conquest: 'за 25–40 минут уровень 2 не взят, матч не кончился',
};

function n(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function average(rows: ChainResult[]): ChainResult {
  const placed = rows.filter((row) => row.placed);
  const source = placed.length ? placed : rows;
  const mean = (pick: (row: ChainResult) => number) => source.reduce((sum, row) => sum + pick(row), 0) / source.length;
  return {
    ...source[0],
    placed: placed.length > 0,
    note: placed.length ? '' : source[0].note,
    perMinute: mean((row) => row.perMinute),
    perTile: mean((row) => row.perTile),
    paybackMin: mean((row) => (Number.isFinite(row.paybackMin) ? row.paybackMin : 0)),
    firstMinute: mean((row) => (Number.isFinite(row.firstMinute) ? row.firstMinute : 0)),
    produced: mean((row) => row.produced),
    plague: mean((row) => row.plague),
    beerMinutes: mean((row) => row.beerMinutes),
    buyCost: source[0].buyCost,
    oasisTiles: source[0].oasisTiles,
  };
}

function chainTable(rows: ChainResult[]): string {
  const lines = ['| Цепочка | В минуту | На клетку оазиса | Окупаемость, мин | Первый воз, мин | Чума за окно |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const row of rows) {
    const before = BEFORE[row.id as keyof typeof BEFORE];
    const was = before && typeof before === 'object' && 'perMinute' in before ? ` (было ${n(before.perMinute)})` : '';
    lines.push(
      `| ${row.name}${was} | ${row.placed ? n(row.perMinute) : 'нет'} | ${row.oasisTiles ? n(row.perTile, 2) : '—'} | ${n(row.paybackMin)} | ${n(row.firstMinute)} | ${n(row.plague, 1)} |`,
    );
  }
  return lines.join('\n');
}

function wallLine(row: WallResult): string {
  return `| ${row.count}× ${row.weapon} → ${row.wall} | ${row.broke ? n(row.minutes) : 'не пробит'} | ${row.hpLeft} |`;
}

function matchLine(row: MatchResult): string {
  const keep = row.keepMinute.map((levels) => levels.map((minute) => (minute ? n(minute, 0) : '—')).join('/')).join('; ');
  return `| ${row.kind} зерно ${row.seed} ${row.map} | ${row.finished ? n(row.minutes) : '>' + n(row.minutes)} | ${row.finished ? String(row.winnerId) : '—'} | ${keep} |`;
}

const chainSeeds = [4, 8, 15];
const chains = CHAINS.map((spec) => average(chainSeeds.map((seed) => measureChain(spec, seed, 10))));

const duels: DuelResult[] = [
  measureDuel('sword', 'bow', 6, 3.2),
  measureDuel('bow', 'sword', 6, 3.2),
  measureDuel('sword', 'bow', 6, 6),
  measureDuel('bow', 'sword', 6, 6),
  measureDuel('club', 'bow', 6, 3.2),
  measureDuel('bow', 'club', 6, 6),
  measureDuel('sword', 'club', 6, 2),
  measureDuel('sword', 'ram', 4, 2),
  measureDuel('ram', 'sword', 4, 2),
  measureDuel('bow', 'ram', 4, 5),
  measureDuel('ram', 'bow', 4, 5),
  measureDuel('bow', 'catapult', 4, 6),
  measureDuel('catapult', 'bow', 4, 6),
  measureDuel('club', 'catapult', 4, 3),
  measureDuel('engineer', 'sword', 4, 2),
  measureDuel('ladder', 'sword', 4, 2),
  measureDuel('spear', 'light', 4, 1.2),
  measureDuel('spear', 'heavy', 4, 1.2),
  measureDuel('light', 'spear', 4, 1.2),
  measureDuel('heavy', 'spear', 4, 1.2),
  measureDuel('sword', 'spear', 4, 1.2),
  measureDuel('bow', 'spear', 4, 6),
  measureDuel('light', 'ram', 4, 2),
  measureDuel('crossbow', 'heavy', 4, 5),
  measureDuel('crossbow', 'sword', 4, 5),
  measureDuel('sword', 'shield', 4, 1.2),
  measureDuel('bow', 'shield', 4, 5),
  measureDuel('spear', 'horsebow', 4, 1.2),
  measureDuel('crossbow', 'horsebow', 4, 5),
];

const walls: WallResult[] = [
  measureWall('club', 'palisade', 6),
  measureWall('ram', 'palisade', 1),
  measureWall('catapult', 'palisade', 1),
  measureWall('club', 'wall', 6),
  measureWall('ram', 'wall', 1),
  measureWall('catapult', 'wall', 1),
  measureWall('club', 'keep', 6),
];

const conquestSeeds = [3, 7, 11];
const conquest = conquestSeeds.map((seed) => scriptedConquest(seed, 50, 'normal'));
const arena = [3, 7].map((seed) =>
  runMatch(
    seed,
    {
      ai: 2,
      victory: 'conquest',
      map: 'normal',
      timeLimit: 0,
      profiles: [
        { difficulty: 'normal', personality: 'merchant' },
        { difficulty: 'normal', personality: 'warlord' },
      ],
    },
    50,
    'арена',
    false,
  ),
);
const other = [
  runMatch(5, { ai: 1, victory: 'wealth', map: 'small', goldTarget: 2000, timeLimit: 0, profiles: [{ difficulty: 'normal', personality: 'merchant' }] }, 40, 'богатство', true),
  runMatch(5, { ai: 1, victory: 'survival', map: 'small', surviveMinutes: 20, timeLimit: 0, profiles: [{ difficulty: 'normal', personality: 'builder' }] }, 25, 'выживание', true),
];
const bloom = [3, 7, 11].map((seed) => scriptedBloom(seed, 60, 'normal'));
const taxes = measureTaxes(8);
const climb = [4, 8, 15].map((seed) => measureKeepClimb(seed, 120));
const difficultySeeds = [4, 9];
const difficulty = difficultySeeds.map((seed) => ({ seed, rows: difficultySnapshot(seed, 12) }));
const prices = priceRows();
const crafts = craftMargins();
const houses = housingRows();

const lines: string[] = [];
lines.push('# Баланс «Дорожных краёв»');
lines.push('');
lines.push('Отчёт собирает `npm run balance`: короткие поселения с одним работником на звено и полные матчи на обычной карте. Минуты — игровые (60 тиков). Окупаемость — закупочная цена построек, делённая на продажную цену выпуска за минуту steady-окна после второй минуты.');
lines.push('');
lines.push('## Что изменено');
lines.push('');
lines.push('| Рычаг | Было | Стало | Зачем |');
lines.push('| --- | --- | --- | --- |');
lines.push('| Яблоки, шт / цикл | 36 / 18 | 12 / 24 | Сад кормит стартовый посад и занимает 12 клеток, а не весь город |');
lines.push('| Сыр, шт / цикл | 1 / 80 | 22 / 24 | На клетку оазиса сыр выгоднее яблок, пока ферма не в чуме |');
lines.push('| Чума фермы | 5% и 420 тиков | 5% и 160 тиков | Провал заметный, но ферма успевает отбиться |');
lines.push('| Мясо, шт / цикл | 1 / 100 | 4 / 36 | Мясо есть, только пока живы олени (урон по оленю 4 → 2) |');
lines.push('| Пшеница / мука / хлеб | 1 за 55 / 50 / 50 | 24 за 10 / 8 / 8 | Хлеб — лучший выпуск; мельница и пекарня открываются с уровня 3 |');
lines.push('| Хмель / пиво | 1 за 60 / 70 | 6 за 20 / 16 | Цепочка пива окупается меньше чем за 12 минут работы |');
lines.push('| Дерево | 1 / 45 | 5 / 18 | Иначе улучшение главного здания не на что копить |');
lines.push('| Камень и волы | 1 / 70, вол 0.05, воз 4 | 6 / 30, вол 0.08, воз 6 | Уровень 2 до армии, а не к сороковой минуте |');
lines.push('| Железо | 1 / 100 | 6 / 36 | Мечи и уровень 3 успевают в той же партии |');
lines.push('| Смола | 1 / 80 | 2 / 40 | Смолокурня окупается, если болото в радиусе |');
lines.push('| Болото у посада | только у нечётного соседа | у каждого посада, рядом с железом | Иначе смолу нельзя поставить у своего главного здания |');
lines.push('| Покупка пшеницы | 4 | 5 | Продажа хлеба (4) и муки (2) не печатает золото |');
lines.push('| Казарма | уровень 3, 14 дерева и 10 камня, 200 тиков | уровень 1, 8 дерева, 140 тиков | Войско выходит, не дожидаясь каменного замка |');
lines.push('| Прочность главного здания | 520 | 360, +90 за уровень | Отряд ломает посад, стена его задерживает |');
lines.push('| Лучник | 22 hp, урон 4, даль 4.2 | 20 hp, урон 8, даль 5.4 | С дистанции бьёт пехоту и катапульту |');
lines.push('| Мечник | 48 hp, урон 8 | 46 hp, урон 9 | Вплотную берёт лучников и таран |');
lines.push('| Таран | 80 hp, урон 6 | 100 hp, урон 3 | Живёт под стрелами, плохо бьёт людей, по стене по-прежнему 28 |');
lines.push('| Катапульта | 50 hp, урон 4 | 40 hp, урон 2 | Ломает стены (18), в поле проигрывает |');
lines.push('| Скорость солдата | 0.11 | 0.2 | Переход через обычную карту укладывается в окно матча |');
lines.push('| Первый залп, тики | воевода 900, стратег 1500, зодчий 2200, купец 2600 | 780 / 1200 / 1500 / 1400 | Купец больше не ждёт 43-й минуты |');
lines.push(`| Пекарня | уровень 4 | уровень ${BUILDINGS.bakery.keepLevel} | Хлебная цепочка открывается вместе с мельницей, а не к 64-й минуте |`);
const costText = (level: number) => {
  const cost = KEEP_UPGRADE_COST[level];
  return `${cost.wood}/${cost.stone}/${cost.iron ?? 0}`;
};
lines.push(`| Улучшение главного здания | 220 тиков; уровни 2/3/4 стоили 35/30/4, 45/45/10, 60/70/18 | ${KEEP_UPGRADE_TICKS} тиков; ${costText(2)}, ${costText(3)}, ${costText(4)} | Мирный уровень 5 был около 95-й минуты, «Расцвет» не укладывался в партию |`);
lines.push('');
lines.push('Стартовые запасы, обучение и подстраховка без лесоруба не менялись. «Жестокий» по-прежнему получает только 1 золото в игровую минуту.');
lines.push('');
lines.push('ИИ больше не ставит бесконечных охотников, каменоломня идёт раньше лишних шалашей, первый уровень главного здания — раньше новой улицы, а после работающего сада завоеватель копит войско и снимает одного человека с второстепенной работы, если нанимать некого.');
lines.push('');
lines.push('## Цены и арбитраж');
lines.push('');
lines.push('Покупка дороже продажи у каждого ресурса. Передел 1:1 тоже в минусе: купить сырьё и продать продукт нельзя в плюс даже при бесплатном труде.');
lines.push('');
lines.push('| Ресурс | Купить | Продать | Разница |');
lines.push('| --- | ---: | ---: | ---: |');
for (const row of prices) lines.push(`| ${row.resource} | ${row.buy} | ${row.sell} | ${row.spread} |`);
lines.push('');
lines.push('| Цепочка | Маржа за штуку |');
lines.push('| --- | ---: |');
for (const row of crafts) lines.push(`| ${row.name} | ${row.margin} |`);
lines.push('');
lines.push('## Еда и промыслы');
lines.push('');
lines.push('Три зерна, окно 10 минут, постройки сразу достроены, один работник. В скобках у еды — прежний выпуск в минуту.');
lines.push('');
lines.push(chainTable(chains));
lines.push('');
lines.push('Ниши по этим замерам:');
lines.push('');
const apples = chains.find((row) => row.id === 'apples')!;
const cheese = chains.find((row) => row.id === 'cheese')!;
const meat = chains.find((row) => row.id === 'meat')!;
const bread = chains.find((row) => row.id === 'bread')!;
const beer = chains.find((row) => row.id === 'beer')!;
const tavern = chains.find((row) => row.id === 'tavern')!;
lines.push(`- Яблоки: ${n(apples.perMinute)} в минуту на 12 клетках оазиса (${n(apples.perTile, 2)} на клетку), окупаемость ${n(apples.paybackMin)} мин. Дёшево и прожорливо по земле.`);
lines.push(`- Сыр: ${n(cheese.perMinute)} в минуту на 9 клетках (${n(cheese.perTile, 2)} на клетку), окупаемость ${n(cheese.paybackMin)} мин. Плотнее яблок; в окне чума случалась ${n(cheese.plague, 1)} раза и на ${n(160 / 60)} мин останавливает ферму.`);
lines.push(`- Мясо: ${n(meat.perMinute)} в минуту и только рядом с оленями. Окупаемость ${n(meat.paybackMin)} мин. Это добавка к разнообразию, не кормушка.`);
lines.push(`- Хлеб: ${n(bread.perMinute)} в минуту, ${n(bread.perTile, 2)} на клетку оазиса, окупаемость ${n(bread.paybackMin)} мин. Лучший выпуск. Пшеница с уровня 2, мельница и пекарня с уровня ${BUILDINGS.bakery.keepLevel}.`);
lines.push(`- Пиво без таверны: ${n(beer.perMinute)} в минуту, окупаемость ${n(beer.paybackMin)} мин. Таверна не продаёт пиво, а выпивает его: золотая окупаемость всей цепочки ${n(tavern.paybackMin)} мин, зато настроение от пива держится ${n(tavern.beerMinutes)} мин за окно (+12 к цели, можно поднять налог).`);
const pitch = chains.find((row) => row.id === 'pitch')!;
lines.push(`- Смола: ${pitch.placed ? `${n(pitch.perMinute)} в минуту, окупаемость ${n(pitch.paybackMin)} мин` : 'на этих зёрнах болото не встало'}. Это припас для рва со смолой, не статья дохода.`);
lines.push('');
lines.push('## Жильё');
lines.push('');
lines.push('Каждый следующий дом селит больше людей на клетку. Его и строят, когда у главного здания кончается место, а не вместо шалаша в чистом поле.');
lines.push('');
lines.push('| Дом | Люди | Клетки | На клетку | Закупка | Плотнее предыдущего |');
lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
for (const row of houses) lines.push(`| ${row.name} | ${row.people} | ${row.tiles} | ${n(row.perTile, 2)} | ${row.buyGold} | ${row.denserThanPrevious ? 'да' : 'нет'} |`);
lines.push('');
lines.push('## Настроение и налог');
lines.push('');
lines.push('| Вклад | К цели |');
lines.push('| --- | ---: |');
for (const row of popularityLines()) lines.push(`| ${row.label} | ${row.value} |`);
lines.push('');
lines.push('Восемь минут с обычным пайком, яблоками и пятью людьми. Жёсткий налог даёт больше золота и уводит настроение вниз, так что люди начинают уходить. Это развилка, а не одна верная ставка.');
lines.push('');
lines.push('| Налог | Настроение | Золото за человека | Людей к концу | Настроение | Золото за 8 мин |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const row of taxes) lines.push(`| ${row.label} | ${row.pop} | ${row.goldRate} | ${row.people} | ${row.popularity} | ${row.gold} |`);
lines.push('');
lines.push('## Войско и стены');
lines.push('');
lines.push('До правок вплотную мечи и дубины били лучников, а таран бил лучников. Сейчас атакующие лучники отходят, пока пехота дальше 3.4 клетки, и стреляют. Ближе этого пехота их догоняет. Таран живёт под стрелами и ломает стены. Катапульта ломает стены и проигрывает в поле.');
lines.push('');
lines.push('Копейщик дешёвый: 8 дерева, 1 оружие и 6 золота. Мечник берёт 1 оружие и 1 доспех вместо двух железа. Лёгкая конница — лошадь, 4 дерева и 10 золота. Тяжёлая — лошадь, оружие, доспехи и 24 золота, первый удар множится на 1.8. Арбалетчик берёт арбалет из кузницы (железо и дерево) и 12 золота, стреляет раз в 28 тактов и не смотрит на доспех. Щитоносец медленный: стрелы по нему режутся до 0.32, соседний щит режет стрелы друзьям до 0.72. Степной лучник — лошадь, лук и 14 золота, стреляет на скаку. Доспех на мечнике и тяжёлой коннице, и кольчуга из оружейной, режут урон стрел до 0.75. Рудник кормит кузницу, кузница по очереди выдаёт оружие, доспехи и арбалет, оружейная их принимает. Конюшня на траве или в оазисе съедает 2 яблока или 2 пшеницы и выводит лошадь.');
lines.push('');
const matrixWeapons = ['club', 'spear', 'sword', 'bow', 'crossbow', 'shield', 'light', 'heavy', 'horsebow', 'engineer', 'ladder', 'siegetower', 'healer', 'raider', 'axe', 'ram', 'catapult'] as const;
const matrixName: Record<(typeof matrixWeapons)[number], string> = {
  club: 'ополченец',
  spear: 'копейщик',
  sword: 'мечник',
  bow: 'лучник',
  crossbow: 'арбалет',
  shield: 'щит',
  light: 'лёгкая',
  heavy: 'тяжёлая',
  horsebow: 'степь',
  engineer: 'инженер',
  ladder: 'лестница',
  siegetower: 'башня',
  healer: 'лекарь',
  raider: 'налёт',
  axe: 'топор',
  ram: 'таран',
  catapult: 'катапульта',
};
lines.push('| Бьёт ↓ / кого → | ' + matrixWeapons.map((weapon) => matrixName[weapon]).join(' | ') + ' |');
lines.push('| --- | ' + matrixWeapons.map(() => '---:').join(' | ') + ' |');
for (const row of matrixWeapons) {
  const cells = matrixWeapons.map((col) => (row === col ? '—' : String(counterFactor(row, col))));
  lines.push(`| ${matrixName[row]} | ${cells.join(' | ')} |`);
}
lines.push('');
lines.push('Число — множитель урона бьющего по цели. Копьё выше 2 против обеих конниц и ниже 0.7 против лука и меча. Арбалет выше 1.5 по мечу и тяжёлой коннице и не режется доспехом. Щит слаб против меча и катапульты. Степь ниже 0.5 по копью и арбалету. Инженер и лестница слабы в поле. Осадная башня не получает урон от стрел. Лекарь не бьёт. Налётчик слаб против копий, топорник силён против щита. Воевода, когда уже есть лошади, берёт тяжёлую конницу, против копий — лук, против мечей и лучников — степного, а к большому войску после сороковой минуты берёт лекаря. Стратег и зодчий на стену отвечают инженером, лестницей и башней, на конницу — копьём, на мечи и тяжёлую — арбалетом, на лучников — щитом. Купец держит не больше двух солдат и, если на посад напали, нанимает наёмника за золото.');
lines.push('');
lines.push('| Бой | Победитель | Оставшиеся hp (левые / правые) |');
lines.push('| --- | --- | --- |');
for (const row of duels) {
  const winner = row.winner === 'left' ? row.left : row.winner === 'right' ? row.right : 'ничья';
  lines.push(`| ${row.count}× ${row.left} / ${row.right}, ${n(row.minutes)} мин | ${winner} | ${n(row.leftHp, 0)} / ${n(row.rightHp, 0)} |`);
}
lines.push('');
lines.push('| Осада | Минуты | Остаток hp |');
lines.push('| --- | ---: | ---: |');
for (const row of walls) lines.push(wallLine(row));
lines.push('');
const wallOf = (weapon: DuelResult['left'], wall: string) => walls.find((row) => row.weapon === weapon && row.wall === wall)!;
const clubsPalisade = wallOf('club', 'palisade');
const clubsWall = wallOf('club', 'wall');
const ramWall = wallOf('ram', 'wall');
const catapultWall = wallOf('catapult', 'wall');
const clubsKeep = wallOf('club', 'keep');
lines.push(
  `Шесть дубин проламывают палисад за ${n(clubsPalisade.minutes)} мин и каменную стену за ${n(clubsWall.minutes)} мин. Один таран вскрывает стену за ${n(ramWall.minutes)} мин, одна катапульта за ${n(catapultWall.minutes)} мин. Шесть дубин доламывают главное здание за ${n(clubsKeep.minutes)} мин. Стена задерживает, но не делает посад неприступным.`,
);
lines.push('');
lines.push('## Матчи');
lines.push('');
lines.push('До правок за 25–40 минут ни сценарий, ни арена не брали даже уровень 2. «Завоевание» против одного нормального воеводы на обычной карте теперь кончается внутри 20–40 минут. Уровни в таблице — минуты, когда взят уровень 2/3/4/5.');
lines.push('');
lines.push('| Матч | Минуты | Победитель | Уровни |');
lines.push('| --- | ---: | ---: | --- |');
for (const row of [...conquest, ...arena, ...bloom, ...other]) lines.push(matchLine(row));
lines.push('');
lines.push('Выживание закрывается ровно в заданную минуту, если посад жив. «Расцвет» — уровень 5 и 20 человек против одного нормального зодчего: сосед не начинает осаду, пока сам не достроил нужный уровень, а сценарий копит людей шалашами и вторым садом, не откладывая улучшение. Цель на 12 человек требует только уровень 4.');
for (const row of other) {
  if (row.finished) continue;
  lines.push(`${row.kind}, зерно ${row.seed}, за ${n(row.minutes, 0)} минут не закрылось: золото ${row.gold.map((value) => Math.round(value)).join(' / ')}, люди живы: ${row.alive.map((value) => (value ? 'да' : 'нет')).join(' / ')}.`);
}
lines.push('');
const climbLevel = (index: number) => {
  const hit = climb.filter((row) => row.minutes[index] > 0);
  if (!hit.length) return 0;
  return hit.reduce((sum, row) => sum + row.minutes[index], 0) / hit.length;
};
lines.push(`Мирная стройка без соседа (обычная карта, один лесоруб, сад, каменоломня, потом рудник) берёт уровни 2/3/4/5 в такие минуты. Уровень 3, с которого открываются мельница и пекарня, приходится на ${n(climbLevel(1), 0)}-ю минуту: в получасовой партии хлеб успевают заложить в конце, а в «Расцвете» цепочка уже работает.`);
lines.push('');
lines.push('| Зерно | Уровень 2 | Уровень 3 | Уровень 4 | Уровень 5 | Золото | Люди |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const row of climb) {
  const cell = (index: number) => (row.minutes[index] ? n(row.minutes[index], 0) : '—');
  lines.push(`| ${row.seed} | ${cell(0)} | ${cell(1)} | ${cell(2)} | ${cell(3)} | ${Math.round(row.gold)} | ${row.people} |`);
}
lines.push('');
lines.push('## Сложность');
lines.push('');
lines.push('Один сосед-стратег, малая карта, 12 минут, победа по богатству недостижима, сравнивается счёт. Лёгкий думает реже и держит меньшее войско, жестокий думает чаще и получает 1 золото в минуту.');
lines.push('');
lines.push('| Зерно | Лёгкий | Нормальный | Сложный | Жестокий |');
lines.push('| --- | ---: | ---: | ---: | ---: |');
for (const snap of difficulty) {
  const cell = (id: DifficultyId) => {
    const row = snap.rows.find((item) => item.difficulty === id)!;
    return `${Math.round(row.score)} (ур. ${row.keep}, люд. ${row.people})`;
  };
  lines.push(`| ${snap.seed} | ${cell('easy')} | ${cell('normal')} | ${cell('hard')} | ${cell('cruel')} |`);
}
lines.push('');
lines.push('Открывающая корзина, настроение первых десяти минут и возврат человека в пустое главное здание не трогались.');
lines.push('');
lines.push(`Цены в этом прогоне: хлеб продаётся за ${PRICES.bread.sell}, пшеница покупается за ${PRICES.wheat.buy}. Казарма открыта с уровня ${BUILDINGS.barracks.keepLevel}. Налогов в таблице: ${TAXES.length}.`);

const body = lines.join('\n');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/balance.md', body + '\n', 'utf8');
console.log('wrote docs/balance.md');
console.log(
  'conquest',
  conquest.map((row) => n(row.minutes)).join(', '),
  'bread',
  n(bread.paybackMin),
  'beer',
  n(beer.paybackMin),
);
