# Market Dashboard

Веб-приложение для сравнения исторического торгового оборота двух prediction markets: **Polymarket** и **Kalshi**.

Дашборд показывает объем торгов по времени, позволяет фильтровать данные по категориям и сравнивать платформы в одном интерфейсе.

## Что делает проект

- строит общий график объема торгов Polymarket и Kalshi;
- поддерживает диапазоны `7D / 30D / 90D / All time`;
- позволяет включать и отключать категории;
- умеет экспортировать видимый срез в CSV;
- показывает загрузку, ошибки и empty state;
- работает локально на `localhost`.

## Архитектура

Проект состоит из двух частей:

- **Backend**: `FastAPI`
- **Frontend**: `React + Vite + TypeScript`

### Как устроен backend

Backend **не использует локальную БД**.  
Он берет данные только из **двух Dune saved queries**, объединяет их в один payload и отдает фронтенду через единый endpoint:

- `GET /api/dashboard-data`

Также backend хранит **последний успешный snapshot** в JSON cache и работает по схеме **stale-while-revalidate**:

1. если кэш свежий — сразу возвращает его;
2. если кэш отсутствует — загружает данные из Dune, объединяет и сохраняет;
3. если кэш устарел — отдает последний успешный snapshot и запускает обновление в фоне.

### Как устроен frontend

Frontend читает только один endpoint:

- `GET /api/dashboard-data`

После этого уже на клиенте применяются:

- выбор диапазона;
- фильтрация по категориям;
- режим отображения графика;
- скрытие/показ платформ;
- экспорт видимого среза в CSV.

## Откуда берутся данные

Источник данных — **Dune saved queries**:

- **Polymarket**: `7345278`
- **Kalshi**: `7345291`

Backend читает **latest saved result** этих запросов через Dune API.

Оба запроса должны возвращать одинаковый набор столбцов:

```text
day
platform
category
volume_usd
```

### Что означают столбцы

- `day` — дата
- `platform` — платформа (`Polymarket` или `Kalshi`)
- `category` — категория рынка
- `volume_usd` — объем торгов в USD

Backend валидирует строки, нормализует их в один формат, объединяет массивы, сортирует по `day` и отдает фронтенду.

## Как пользоваться

В интерфейсе доступны:

- **диапазоны**: `7D / 30D / 90D / All time`;
- **фильтр категорий**;
- **режим применения фильтра**:
  - к обеим платформам;
  - только к Polymarket;
  - только к Kalshi;
- **переключение вида графика**;
- **скрытие/показ платформ**;
- **экспорт CSV**.

Если снять все категории, на месте графика показывается понятное сообщение, а сами фильтры остаются доступны.

## Запуск проекта

### 1. Подготовить `.env`

Скопируйте `.env.example` в `.env` и заполните Dune API key:

```env
DUNE_API_KEY=your_dune_api_key
DUNE_POLYMARKET_QUERY_ID=7345278
DUNE_KALSHI_QUERY_ID=7345291
CACHE_TTL_MINUTES=60
VITE_API_BASE_URL=http://localhost:8000
```

### 2. Запустить backend

```bash
cd E:\market-dashboard\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend будет доступен на:

```text
http://localhost:8000
```

### 3. Запустить frontend

Во втором терминале:

```bash
cd E:\market-dashboard\frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

Frontend будет доступен на:

```text
http://localhost:3000
```

## Docker

Можно запустить проект через Docker Compose:

```bash
copy .env.example .env
docker compose up --build
```

## API

### `GET /api/dashboard-data`

Возвращает merged dataset:

```json
{
  "rows": [
    {
      "day": "2026-04-20",
      "platform": "Polymarket",
      "category": "Politics",
      "volume_usd": 102.0
    }
  ],
  "meta": {
    "cached_at": "2026-04-21T19:42:10.000000+00:00",
    "is_stale": false,
    "kalshi_query_id": 7345291,
    "polymarket_query_id": 7345278,
    "kalshi_last_day": "2026-04-20",
    "polymarket_last_day": "2026-04-21",
    "common_last_day": "2026-04-20",
    "categories": ["Politics", "Economy"]
  }
}
```

## Ограничения и риски

Важно понимать ограничения данных:

- данные зависят от **актуальности saved result в Dune**, а не от мгновенного live API;
- последние даты у платформ могут не совпадать;
- `common_last_day` нужен для честного сравнения только по общей доступной части данных;
- backend **не заполняет пропуски нулями**, **не интерполирует** и **не дорисовывает** отсутствующие дни;
- если в Dune query есть ошибка, задержка обновления или неполная категория, это повлияет на дашборд;
- при проблемах с Dune backend старается отдать **последний успешный snapshot**, если он уже есть в кэше.

