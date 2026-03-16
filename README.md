# Presentator

Микросервисное веб-приложение для генерации презентаций (PPTX) по текстовому промпту и прикреплённым файлам с помощью LLM.

## Архитектура

```
┌────────────┐    ┌───────────────────────────────────────────────┐
│  Браузер   │───▶│  Nginx (gateway, :80)                         │
└────────────┘    │   /        → Frontend (Vue 3 SPA)             │
                  │   /api/*   → API Service (Express, :3001)     │
                  │   /n8n/*   → n8n (Workflow Engine, :5678)     │
                  └───────────────────────────────────────────────┘
                        │                │                │
                        ▼                ▼                ▼
               ┌──────────────┐  ┌────────────┐  ┌──────────────┐
               │ API Service  │  │    n8n     │  │   Frontend   │
               │  (Express)   │  │            │  │  (Vue 3 +    │
               │              │  │  Webhook ◀─┼──│   Vite)      │
               │  Auth (JWT)  │  │  trigger   │  └──────────────┘
               │  Jobs CRUD   │  │            │
               │  File upload │  │  LLM call  │
               └──────┬───────┘  │  Parse     │
                      │          │  Callback  │
                      │          └─────┬──────┘
                      ▼                │
               ┌──────────────┐        ▼
               │  PostgreSQL  │  ┌──────────────┐
               │  (schemas:   │  │  Converter   │
               │   n8n,       │  │  Service     │
               │   presentator│  │  (pptxgenjs) │
               │  )           │  └──────────────┘
               └──────────────┘
                      ▲                │
                      │                ▼
                 shared_data     /data/results/*.pptx
                   volume
```

### Сервисы

| Сервис | Технологии | Порт | Назначение |
|--------|-----------|------|------------|
| **nginx** | Nginx 1.25 | 80 (внешний) | Reverse proxy, единая точка входа |
| **api-service** | Node.js 22 + Express | 3001 | REST API: авторизация, управление задачами, загрузка файлов |
| **n8n** | n8n (latest) | 5678 | Оркестратор пайплайна: принимает webhook, вызывает LLM, парсит ответ, вызывает конвертер |
| **converter-service** | Node.js 22 + pptxgenjs | 3002 | Конвертация структурированного JSON в PPTX |
| **frontend** | Vue 3 + Vite + TailwindCSS | 80 (внутренний) | SPA: логин, создание задач, превью слайдов, скачивание PPTX |
| **postgres** | PostgreSQL 16 | 5432 | БД с двумя схемами: `n8n` (данные n8n) и `presentator` (пользователи, задачи) |

### Поток данных (pipeline)

1. Пользователь вводит промпт и прикрепляет файлы через **Frontend**
2. **API Service** сохраняет задачу в БД (`status: pending`), загружает файлы в `/data/uploads/{job_id}/`, отправляет webhook в **n8n**
3. **n8n** обновляет статус на `processing`, формирует prompt для LLM, вызывает LLM API
4. LLM возвращает структурированный JSON со слайдами
5. **n8n** сохраняет `slide_data` в БД через callback в API Service
6. **n8n** отправляет `slide_data` в **Converter Service**
7. **Converter Service** генерирует PPTX файл в `/data/results/{job_id}.pptx`
8. **n8n** обновляет задачу: `status: done`, `result_path: /data/results/{job_id}.pptx`
9. **Frontend** показывает превью слайдов и кнопку скачивания PPTX

## Быстрый старт

### Требования

- Docker Desktop
- Git

### Установка

```bash
git clone https://github.com/timamikh/presentator.git
cd presentator
cp .env.example .env
# Заполнить реальные значения в .env (особенно секреты и LLM-ключ)
```

### Запуск

```bash
docker compose up -d --build
```

Все 6 контейнеров поднимутся автоматически. Первый запуск может занять несколько минут (скачивание образов и npm install).

### Проверка

- Frontend: http://localhost/
- n8n UI: http://localhost/n8n/
- API Health: http://localhost/api/health

### Первый вход

При первом запуске автоматически создаётся seed-пользователь.
Логин и пароль задаются через `SEED_USER_EMAIL` и `SEED_USER_PASSWORD` в `.env`.

### Настройка n8n Workflow

После первого запуска нужно импортировать workflow в n8n:

1. Открыть http://localhost/n8n/
2. Зарегистрироваться / войти в n8n
3. Импортировать `n8n-workflows/presentator-pipeline.json`
4. Активировать workflow

## Структура проекта

```
presentator/
├── docker-compose.yml          # Оркестрация всех сервисов
├── .env.example                # Шаблон переменных окружения
├── .gitignore
│
├── nginx/
│   └── nginx.conf              # Конфигурация reverse proxy
│
├── init-db/
│   ├── 01-schemas.sql          # Создание схем n8n и presentator
│   └── 02-users-table.sql      # Таблицы users и jobs
│
├── api-service/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # Express-приложение, точка входа
│       ├── config.js           # Конфигурация из env (fail-fast при отсутствии секретов)
│       ├── db.js               # Пул соединений PostgreSQL
│       ├── middleware/
│       │   └── auth.js         # JWT-авторизация + internal API key
│       ├── routes/
│       │   ├── auth.js         # POST /api/auth/login
│       │   └── jobs.js         # CRUD /api/jobs, загрузка файлов, webhook trigger
│       └── scripts/
│           └── seed-user.js    # Создание seed-пользователя при запуске
│
├── converter-service/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # Express-приложение, POST /convert
│       └── converter.js        # JSON slide_data → PPTX (pptxgenjs)
│
├── frontend/
│   ├── Dockerfile              # Multi-stage: Vite build → Nginx
│   ├── nginx.conf              # SPA fallback для Vue Router
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── App.vue
│       ├── main.js
│       ├── router.js           # Vue Router: /login, /, /create, /jobs/:id
│       ├── style.css           # TailwindCSS
│       ├── api/
│       │   └── client.js       # Axios с JWT-интерцептором
│       ├── components/
│       │   └── SlidePreview.vue# Превью слайдов (HTML-рендеринг slide_data)
│       └── views/
│           ├── LoginView.vue
│           ├── DashboardView.vue
│           ├── CreateJobView.vue
│           └── JobStatusView.vue
│
├── n8n-workflows/
│   └── presentator-pipeline.json  # Экспорт n8n workflow
│
└── service-llm/
    ├── config.yaml.example     # Шаблон конфигурации LLM-агента
    └── agents.yaml             # Конфигурация агентов (SGR Deep Research)
```

## База данных

### Схема `presentator`

**users**
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| email | VARCHAR(255) UNIQUE | Логин пользователя |
| password_hash | VARCHAR(255) | bcrypt hash |
| name | VARCHAR(255) | Имя пользователя |
| created_at | TIMESTAMPTZ | Дата создания |

**jobs**
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| user_id | UUID (FK → users) | Владелец задачи |
| prompt | TEXT | Пользовательский промпт |
| file_paths | JSONB | Массив путей загруженных файлов |
| status | VARCHAR(20) | `pending` → `processing` → `done` / `error` |
| slide_data | JSONB | Структурированные данные слайдов от LLM |
| result_path | TEXT | Путь к готовому PPTX |
| error_message | TEXT | Текст ошибки (если status = error) |
| created_at | TIMESTAMPTZ | Дата создания |
| updated_at | TIMESTAMPTZ | Дата обновления |

### Схема `n8n`

Используется n8n для хранения своих workflows, credentials и execution history. Управляется автоматически.

## Формат slide_data (JSON)

LLM генерирует и система оперирует единым JSON-форматом для описания слайдов:

```json
{
  "title": "Название презентации",
  "slides": [
    {
      "layout": "title",
      "title": "Заголовок слайда",
      "subtitle": "Подзаголовок"
    },
    {
      "layout": "content",
      "title": "Заголовок",
      "bullets": ["Пункт 1", "Пункт 2", "Пункт 3"]
    },
    {
      "layout": "two_column",
      "title": "Заголовок",
      "left": ["Левая колонка"],
      "right": ["Правая колонка"]
    },
    {
      "layout": "image",
      "title": "Заголовок",
      "image_url": "/path/to/image.png",
      "caption": "Подпись"
    },
    {
      "layout": "section",
      "title": "Название раздела"
    }
  ]
}
```

Поддерживаемые layouts: `title`, `content`, `section`, `image`, `two_column`.

Этот же формат используется:
- **Frontend** (`SlidePreview.vue`) — для HTML-превью слайдов
- **Converter Service** (`converter.js`) — для генерации PPTX через pptxgenjs

## API

### Публичные эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/auth/login | Авторизация, возвращает JWT |
| GET | /api/health | Healthcheck |

### Защищённые (JWT) эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/jobs | Список задач текущего пользователя |
| POST | /api/jobs | Создать задачу (multipart: prompt + files) |
| GET | /api/jobs/:id | Детали задачи (включая slide_data) |
| GET | /api/jobs/:id/download | Скачать готовый PPTX |

### Внутренний (X-Internal-Key) эндпоинт

| Метод | Путь | Описание |
|-------|------|----------|
| PATCH | /api/jobs/internal/:id | Обновление статуса задачи из n8n |

## Переменные окружения

Все секреты и конфигурация — в `.env`. Шаблон: `.env.example`.

Критически важные переменные:

| Переменная | Описание |
|-----------|----------|
| `POSTGRES_PASSWORD` | Пароль БД |
| `JWT_SECRET` | Секрет для подписи JWT (min 64 символа) |
| `INTERNAL_API_KEY` | Ключ для inter-service коммуникации (n8n → API) |
| `SEED_USER_PASSWORD` | Пароль seed-пользователя |
| `LLM_API_KEY` | API-ключ для LLM-сервиса |
| `LLM_BASE_URL` | URL LLM API (OpenAI-совместимый формат) |
| `LLM_MODEL` | Название модели |

API Service падает при запуске, если обязательные env-переменные отсутствуют (fail-fast).

## Просмотр логов

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f api-service
docker compose logs -f n8n
docker compose logs -f converter-service
docker compose logs -f frontend
docker compose logs -f postgres
docker compose logs -f nginx
```

Визуальные логи выполнения workflow: http://localhost/n8n/ → Executions.

## Заметки для LLM-контекста

### Ключевые архитектурные решения

- **Structured JSON вместо HTML**: LLM генерирует не HTML, а структурированный JSON (`slide_data`). Это позволяет использовать один и тот же формат для превью на фронтенде и для генерации PPTX. HTML-вёрстка происходит только на стороне фронтенда (`SlidePreview.vue`).

- **n8n как оркестратор**: Вся логика пайплайна (вызов LLM, парсинг, callback'и, вызов конвертера) реализована в n8n workflow, а не в коде. Это даёт визуальное управление и быстрое прототипирование. Workflow хранится в `n8n-workflows/presentator-pipeline.json`.

- **Секреты через webhook payload**: n8n (v2+) ограничивает доступ к `$env` из expressions. Поэтому API Service передаёт секреты (LLM-ключ, internal API key) в теле webhook-запроса как объект `_secrets`. Workflow извлекает их из `$json.body._secrets` / `$json.secrets`.

- **Shared volume `/data`**: Загруженные файлы (`/data/uploads/{job_id}/`) и результаты (`/data/results/{job_id}.pptx`) доступны через Docker volume `shared_data`, подключённый к `api-service`, `n8n` и `converter-service`.

- **Изоляция БД**: PostgreSQL с двумя схемами (`n8n`, `presentator`) в одном инстансе. Для production рекомендуется разделить на отдельные БД.

### Известные ограничения MVP

- **Нет регистрации**: Только seed-пользователь. Регистрация не реализована.
- **JWT в localStorage**: Для MVP допустимо, для production рекомендуется httpOnly cookie.
- **Нет rate limiting**: API не защищён от brute-force.
- **Нет обработки изображений**: LLM получает только текстовый промпт. Загруженные изображения сохраняются, но пока не анализируются LLM (нужен multimodal model или OCR-пайплайн).
- **Нет очереди задач**: При большом количестве запросов n8n может стать узким местом. Рекомендуется добавить Redis + Bull для очереди.
- **Один воркер n8n**: Для масштабирования нужен n8n в режиме queue с отдельными worker'ами.
- **Нет тестов**: TDD-подход запланирован, но в MVP тесты не написаны.
- **Converter поддерживает 5 layouts**: `title`, `content`, `section`, `image`, `two_column`. Для сложных презентаций нужно расширять.

### Зависимости и версии

- Node.js 22 (alpine)
- PostgreSQL 16 (alpine)
- Nginx 1.25 (alpine)
- n8n: latest
- pptxgenjs: 3.12.0
- Vue 3.5+, Vite 5.4+, TailwindCSS 3.4+

### Папка service-llm

Содержит конфигурацию для SGR Deep Research Agent — внешнего инструмента для глубокого исследования. Не является частью основного пайплайна Presentator, но может использоваться для подготовки контента. Конфигурация (`config.yaml`) в `.gitignore`, т.к. содержит API-ключи. Шаблон: `config.yaml.example`.
