# Выпуск «Дорожных краёв»

Версия в меню — `v1.0.0` и короткий хеш сборки. Сайт: https://sania2007mav.github.io/road-realms/

Этот файл готовит выкладку. Слияние в `main` делает владелец.

## Тексты витрины

Коротко (до 80 знаков):

> Стратегия вдоль тракта: люди, жильё, дороги и соседи.

Полное описание:

> «Дорожные края» — изометрическая стратегия вдоль одного большого тракта. Людей ровно столько, сколько влезает в жильё, и каждый занят одним делом. Ставьте амбар, поля и мастерские, держите настроение, растите посад и встречайте соседей.
>
> Можно играть одному, пройти кампанию из остановок со звёздами или сесть за сетевой стол на двоих–четверых. Стены, ворота и осадные машины есть. Весь рисунок и весь звук собраны кодом, без чужих картинок и записей.
>
> Сохранения лежат в браузере. Рекламы и слежки нет. Для сети используется только анонимный вход.

## Шесть кадров 1280×720

Снимаются тестом `кадры для витрины` в `e2e/play.spec.ts` и лежат в `test-results/screenshots/`:

1. `store_settlement.png` — живой посад: жильё, поля, люди с ношей.
2. `store_siege.png` — осада: частокол, ворота, башни, таран и катапульта.
3. `store_campaign.png` — карта кампании.
4. `store_lobby.png` — список сетевых лобби.
5. `store_encyclopedia.png` — справка по постройкам.
6. `store_phone.png` — телефонный портрет 360×640, вписанный в кадр 1280×720 (исходник `store_phone_raw.png`).

## Яндекс Игры

План SDK, когда владелец заведёт игру в консоли:

1. Подключить `https://sdk.games.yandex.ru/sdk.js` только в сборке для Яндекса.
2. После загрузки вызвать `YaGames.init()` и дождаться `ysdk`.
3. На старте партии вызывать `ysdk.features.GameplayAPI.start()`, на паузе, поражении и уходе в меню — `stop()`.
4. Рекламу не включать, пока владелец отдельно не решит. Внешние ссылки из игры убрать или открывать через SDK.
5. Язык интерфейса уже русский.
6. Сборка должна открываться по относительным путям из корня архива.

Команда:

```bash
npm run build:yandex
```

Она проверяет типы, собирает Vite с `base: ./` в `dist-yandex` и кладёт `road-realms-yandex.zip`. В архиве пути относительные, без префикса `/road-realms/assets/`. Service worker в эту сборку не пишется: он нужен сайту на GitHub Pages.

Чеклист перед отправкой в консоль:

- [ ] Архив открывается с `index.html` в корне, без абсолютных `/road-realms/`.
- [ ] Игра стартует офлайн внутри песочницы Яндекса (одиночная и кампания).
- [ ] `GameplayAPI.start/stop` расставлены.
- [ ] Нет запросов на чужие домены, кроме разрешённых консолью (Firebase для сети — отдельно согласовать или отключить кнопку «Сетевая игра» в этой сборке).
- [ ] Звук начинается после жеста игрока.
- [ ] Кадры и тексты выше загружены в карточку.

## Google Play через TWA

Пакет: `kz.melnichuk.roadrealms`.

Заготовка Digital Asset Links лежит в `public/.well-known/assetlinks.json` и уезжает на сайт как `https://sania2007mav.github.io/road-realms/.well-known/assetlinks.json`. Отпечаток сейчас заглушка `REPLACE_WITH_SIGNING_CERT_SHA256`.

Что делает владелец:

1. Завести аккаунт разработчика Google Play и оплатить регистрацию.
2. Создать ключ подписи (Play App Signing либо свой upload key) и снять SHA-256.
3. Вписать отпечаток в `assetlinks.json` и дождаться, пока Pages отдаёт файл.
4. Поставить Bubblewrap и собрать TWA с манифестом сайта:

```bash
bubblewrap init --manifest=https://sania2007mav.github.io/road-realms/manifest.webmanifest
```

В мастере указать пакет `kz.melnichuk.roadrealms`, имя «Дорожные края», стартовый URL `https://sania2007mav.github.io/road-realms/`.

5. `bubblewrap build` даёт AAB. Загрузить его в консоль Play, заполнить карточку текстами и шестью кадрами выше, политикой `https://sania2007mav.github.io/road-realms/privacy.html`.
6. Пройти проверку Digital Asset Links (`bubblewrap validate` или отчёт Play Console).

## Ключ Firebase и App Check

Веб-ключ лежит в `src/firebase.ts`. Его нужно ограничить в Google Cloud Console, проект `road-realms-eu7k2`:

1. APIs & Services → Credentials → ключ `AIzaSyBsQFRMhv9O6pKeUvbGl7PzvTYuZ4ohvuo` (Browser key этого веб-приложения).
2. Application restrictions → HTTP referrers.
3. Разрешить только:
   - `https://sania2007mav.github.io/*`
   - `https://sania2007mav.github.io/road-realms/*`
4. API restrictions → ограничить ключ теми API, которыми игра реально пользуется: Identity Toolkit API и Firebase Realtime Database (Token Service / Secure Token при необходимости входа). Не оставлять ключ без ограничения API, если консоль это позволяет.
5. Сохранить и проверить сетевую комнату на Pages. Локальный `npm run dev` после этого перестанет входить в Firebase — так и задумано, пока referrer не расширен.

App Check (необязательно, по умолчанию выключен):

1. Firebase Console → App Check → веб-приложение → reCAPTCHA v3. Получить site key.
2. Вписать ключ в `appCheckSiteKey` в `src/firebase.ts`. Пустая строка не грузит модуль `firebase/app-check` и ничего не меняет в игре.
3. В консоли сначала мониторинг, enforcement включать только когда токены стабильно приходят.
4. В правилах Realtime Database enforcement App Check включается отдельно и в эту копию `firebase/database.rules.json` не входит.

Правила по-прежнему в `firebase/database.rules.json`. Корень закрыт на чтение и запись. Проверка: `firebase/rules-test/rules.test.mjs` против эмулятора на `127.0.0.1:9000`.

Рейтинг (ещё не выложен): к тем же правилам добавлены `matches/$id/reports`, `matches/$id/settled`, `players`, `claims` и `history`. Пока эта копия не опубликована в консоли, клиент пишет «Рейтинг скоро» и не трогает живую базу сам. Публикует владелец.
