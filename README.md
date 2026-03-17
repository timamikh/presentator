# Presentator

Микросервисное веб-приложение для генерации презентаций (PDF / PPTX) по текстовому промпту через LLM. Слайды генерируются как HTML/CSS, рендерятся Puppeteer, конвертируются в PDF и PPTX.

## Release notes

Список изменений по версиям см. в `CHANGELOG.md`.

## Архитектура

```
┌────────────┐    ┌───────────────────────────────────────────────────────┐
│  Браузер   │───▶│  Nginx (gateway, :80)                                 │
└────────────┘    │   /           → Frontend (Vue 3 SPA)                  │
                  │   /api/*      → API Service (Express, :3001)          │
                  │   /n8n/*      → n8n (Workflow Engine, :5678)          │
                  │   /converter/ → Converter Service (:3002)             │
                  └───────────────────────────────────────────────────────┘
                        │                │                │
                        ▼                ▼                ▼
               ┌──────────────┐  ┌────────────┐  ┌──────────────┐
               │ API Service  │  │    n8n     │  │   Frontend   │
               │  (Express)   │  │            │  │  (Vue 3 +    │
               │              │  │  Webhook ◀─┼──│   Vite)      │
               │  Auth (JWT)  │  │  trigger   │  └──────────────┘
               │  Jobs CRUD   │  │            │
               │  Settings    │  │  LLM call  │
               │  File upload │  │  Parse     │
               └──────┬───────┘  │  Callback  │
                      │          └─────┬──────┘
                      ▼                │
               ┌──────────────┐        ▼
               │  PostgreSQL  │  ┌──────────────┐
               │  (schemas:   │  │  Converter   │
               │   n8n,       │  │  Service     │
               │   presentator│  │  (Puppeteer  │
               │  )           │  │  + pptxgenjs)│
               └──────────────┘  └──────────────┘
                      ▲                │
                      │                ▼
                 shared_data     /data/results/
                   volume       ├── presentation.pdf
                                └── presentation.pptx
```

### Сервисы

| Сервис | Технологии | Порт | Назначение |
|--------|-----------|------|------------|
| **nginx** | Nginx 1.25 | 80 (внешний) | Reverse proxy, единая точка входа |
| **api-service** | Node.js 22 + Express | 3001 | REST API: авторизация, управление задачами, настройки, загрузка файлов |
| **n8n** | n8n (latest) | 5678 | Оркестратор пайплайна: webhook, вызов LLM, парсинг, конвертер, callback'и |
| **converter-service** | Node.js + Puppeteer + pptxgenjs | 3002 | HTML-слайды → PDF (Puppeteer) + PPTX (скриншоты → pptxgenjs) |
| **frontend** | Vue 3 + Vite + TailwindCSS | 80 (внутренний) | SPA: логин, создание задач, iframe-превью слайдов, скачивание PDF/PPTX |
| **postgres** | PostgreSQL 16 | 5432 | БД: схемы `n8n` и `presentator` |

### Поток данных (pipeline)

1. Пользователь вводит промпт, настраивает презентацию и прикрепляет файлы через **Frontend**
2. **API Service** сохраняет задачу в БД (`status: pending`), загружает файлы в `/data/uploads/{job_id}/`, отправляет webhook в **n8n**
3. **n8n** обновляет статус на `processing`, формирует prompt для LLM (системный промпт + CSS-фреймворк + пользовательский промпт)
4. LLM возвращает JSON с HTML/CSS-слайдами
5. **n8n** параллельно: сохраняет `llm_request` / `llm_response` и парсит ответ
6. **n8n** сохраняет `slide_data` в БД через callback в API Service
7. **n8n** отправляет `slide_data` в **Converter Service**
8. **Converter Service** рендерит HTML через Puppeteer → генерирует PDF + PPTX
9. **n8n** обновляет задачу: `status: done`, `result_paths: {pdf: ..., pptx: ...}`
10. **Frontend** показывает iframe-превью слайдов и кнопки скачивания PDF/PPTX

## Быстрый старт

### Требования

- Docker Desktop (с поддержкой `shm_size`, т.к. Puppeteer использует /dev/shm)
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

Все 6 контейнеров поднимутся автоматически. Первый запуск может занять несколько минут (скачивание образов, Puppeteer Chrome, npm install).

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
├── docker-compose.yml
├── .env.example
├── .gitignore
│
├── nginx/
│   └── nginx.conf
│
├── init-db/
│   ├── 01-schemas.sql          # Создание схем n8n и presentator
│   ├── 02-users-table.sql      # Таблицы users и jobs
│   ├── 03-settings-table.sql   # Таблица settings (key/value)
│   └── 04-result-paths.sql     # Колонка result_paths JSONB в jobs
│   ├── 05-attachments.sql      # attachments + job_attachments (хранилище вложений)
│   └── 06-job-revisions.sql    # job_revisions (версии/уточнения)
│
├── api-service/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js             # Express-приложение
│       ├── config.js            # Конфиг из env (fail-fast)
│       ├── db.js                # Пул PostgreSQL
│       ├── middleware/
│       │   └── auth.js          # JWT + internal API key
│       ├── routes/
│       │   ├── auth.js          # POST /api/auth/login
│       │   ├── jobs.js          # CRUD задач, webhook trigger, скачивание
│       │   ├── attachments.js   # CRUD хранилища вложений
│       │   ├── files.js         # GET /api/files/attachment/:id (preview/serve)
│       │   └── settings.js      # GET/PUT системного промпта
│       └── scripts/
│           └── seed-user.js
│
├── converter-service/
│   ├── Dockerfile               # ghcr.io/puppeteer/puppeteer:24.6.1
│   ├── package.json             # puppeteer, pptxgenjs, express
│   └── src/
│       ├── index.js             # Express: /convert, /framework.css, /preview-html
│       ├── converter.js         # buildHtml(), convertToFiles() → PDF + PPTX
│       ├── slide-template.html  # HTML-шаблон с плейсхолдерами
│       └── slide-framework.css  # CSS-фреймворк для слайдов 1920×1080
│
├── frontend/
│   ├── Dockerfile               # Multi-stage: Vite build → Nginx
│   ├── nginx.conf               # SPA fallback
│   ├── package.json
│   └── src/
│       ├── App.vue
│       ├── main.js
│       ├── router.js            # /login, /, /create, /jobs/:id
│       ├── api/
│       │   └── client.js        # Axios с JWT-интерцептором
│       ├── components/
│       │   ├── SlidePreview.vue         # iframe-превью с масштабированием
│       │   ├── LlmLogViewer.vue         # Просмотр llm_request/llm_response
│       │   ├── SystemPromptModal.vue    # Редактирование системного промпта
│       │   ├── SlidePromptsEditor.vue   # Промпты по отдельным слайдам
│       │   └── PresentationSettings.vue # Шрифты, цвета, стиль
│       │   └── StoragePicker.vue        # Выбор вложений из хранилища
│       ├── composables/
│       │   ├── usePromptAggregator.js   # Сборка payload для создания job
│       │   └── usePromptAggregator.test.js
│       └── views/
│           ├── LoginView.vue
│           ├── DashboardView.vue
│           ├── CreateJobView.vue
│           ├── JobStatusView.vue
│           └── StorageView.vue
│
├── n8n-workflows/
│   └── presentator-pipeline.json
│
└── service-llm/
    ├── agents.yaml
    └── config.yaml.example
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
| slide_count | INTEGER | Желаемое кол-во слайдов |
| slide_prompts | JSONB | Промпты для отдельных слайдов |
| presentation_settings | JSONB | Настройки (шрифт, цвета) |
| system_prompt | TEXT | Кастомный системный промпт (или NULL для дефолтного) |
| status | VARCHAR(20) | `pending` → `processing` → `done` / `error` |
| slide_data | JSONB | HTML/CSS слайды от LLM |
| result_path | TEXT | Путь к PDF (для обратной совместимости) |
| result_paths | JSONB | `{pdf: "...", pptx: "..."}` |
| llm_request | JSONB | Сохранённый промпт к LLM |
| llm_response | JSONB | Полный ответ LLM |
| error_message | TEXT | Текст ошибки |
| created_at | TIMESTAMPTZ | Дата создания |
| updated_at | TIMESTAMPTZ | Дата обновления |

**settings**

| Колонка | Тип | Описание |
|---------|-----|----------|
| key | VARCHAR(100) PK | Ключ настройки |
| value | TEXT | Значение |

Ключ `default_system_prompt` — системный промпт по умолчанию. Если пуст, API отдаёт встроенный `DEFAULT_SYSTEM_PROMPT` из `settings.js`.

### Схема `n8n`

Управляется автоматически n8n (workflows, credentials, execution history).

## Формат slide_data (JSON)

LLM генерирует HTML/CSS-слайды в JSON-формате:

```json
{
  "theme": {
    "css": ":root { --primary: #2563eb; --font-heading: 'Inter', sans-serif; }",
    "fonts": ["Inter", "Roboto"]
  },
  "slides": [
    {
      "html": "<div class=\"centered\"><h1 class=\"heading-xl\">Заголовок</h1></div>",
      "css": ".custom { color: red; }",
      "notes": "Заметки спикера"
    }
  ]
}
```

- **theme.css** — переопределение CSS-переменных фреймворка
- **theme.fonts** — шрифты Google Fonts (загружаются автоматически)
- **slides[].html** — HTML-контент слайда внутри `.slide` контейнера (1920×1080)
- **slides[].css** — CSS для конкретного слайда
- **slides[].notes** — заметки спикера (опционально)

### CSS-фреймворк слайдов

Каждый слайд рендерится внутри `<div class="slide">` (1920×1080px, padding 80px). Фреймворк (`slide-framework.css`) предоставляет:

**CSS-переменные** (переопределяются в `theme.css`):
`--primary`, `--primary-light`, `--primary-dark`, `--bg`, `--bg-alt`, `--text`, `--text-light`, `--text-muted`, `--accent`, `--font-heading`, `--font-body`, `--font-mono`

**Layouts**: `.centered`, `.top-title`, `.split-2`, `.split-3`, `.split-left-wide`, `.split-right-wide`

**Типографика**: `.heading-xl` (72px), `.heading-lg` (52px), `.heading-md` (40px), `.heading-sm` (32px), `.subtitle`, `.body-text`, `.body-lg`, `.caption`, `.small`, `.bold`, `.semibold`, `.uppercase`

**Компоненты**: `.card`, `.card-bordered`, `.card-primary`, `.accent-line`, `.divider`, `.tag`, `.tag-outline`, `.icon-circle`, `.number-big`, `.quote`, `.code-block`

**Списки**: `.bullets`, `.bullets-lg`, `.numbered`

**Таблицы**: `.table` (стилизованные с цветной шапкой)

**Диаграммы**: `.bar-container` + `.bar`, `.stat-value` + `.stat-label`

**Фоны**: `.bg-primary`, `.bg-dark`, `.bg-gradient`, `.bg-gradient-light`, `.bg-alt`

**Утилиты**: `.mt-1`..`.mt-4`, `.mb-1`..`.mb-3`, `.gap-1`..`.gap-4`, `.p-1`..`.p-3`, `.w-full`, `.h-full`

## Конвертер

**Converter Service** принимает `slide_data` и генерирует оба формата:

1. **HTML → PDF**: Puppeteer рендерит все слайды в headless Chrome, `page.pdf()` с размером 1920×1080px
2. **HTML → PPTX**: Puppeteer делает скриншоты каждого `.slide` элемента, pptxgenjs вставляет их как изображения (13.333×7.5 дюймов, 16:9)

Эндпоинты:
- `POST /convert` — `{slideData, outputDir}` → `{paths: {pdf, pptx}}`
- `GET /framework.css` — CSS-фреймворк (нужен фронтенду для iframe-превью)
- `POST /preview-html` — `{slideData}` → HTML (для отладки)

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
| POST | /api/jobs | Создать задачу (multipart: prompt, slideCount, slidePrompts, presentationSettings, systemPrompt, files) |
| GET | /api/jobs/:id | Детали задачи (включая slide_data, llm_request, llm_response) |
| GET | /api/jobs/:id/download?format=pdf\|pptx | Скачать результат (по умолчанию pdf) |
| GET | /api/jobs/:id/revisions | История версий (уточнений) |
| POST | /api/jobs/:id/revisions | Запустить «уточнение» (refinement) текущей презентации |
| POST | /api/jobs/:id/revisions/:rev/restore | Откатить к выбранной версии |
| GET | /api/attachments | Список вложений пользователя (поиск/фильтры) |
| POST | /api/attachments | Загрузить вложение в хранилище |
| PATCH | /api/attachments/:id | Обновить промпт/метаданные вложения |
| DELETE | /api/attachments/:id | Удалить вложение |
| GET | /api/files/attachment/:id | Скачать/превью вложения (JWT через header или `?token=`) |
| GET | /api/settings/system-prompt | Получить системный промпт |
| PUT | /api/settings/system-prompt | Обновить системный промпт |

### Внутренний (X-Internal-Key) эндпоинт

| Метод | Путь | Описание |
|-------|------|----------|
| PATCH | /api/jobs/internal/:id | Обновление из n8n: status, slideData, resultPath, resultPaths, llmRequest, llmResponse, errorMessage |

## n8n Workflow

Файл: `n8n-workflows/presentator-pipeline.json`

Ноды пайплайна:

1. **Webhook** — принимает POST от API (`$json.body.jobId`, `$json.body.prompt`, `$json.body._secrets`)
2. **Update Status to Processing** — PATCH `/api/jobs/internal/{jobId}` → `{status: "processing"}`
3. **Build LLM Prompt** — собирает systemPrompt + userMessage из webhook data; агрегирует slideCount, slidePrompts, presentationSettings
4. **Call LLM API** — POST к LLM (OpenAI-совместимый `/chat/completions`)
5. **Save LLM Logs** (параллельно) — сохраняет llm_request / llm_response в БД
6. **Parse LLM Response** — парсит JSON из LLM, валидирует `slides[].html`
7. **Save Slide Data** — сохраняет slide_data в БД
8. **Call Converter** — POST `/convert` → PDF + PPTX
9. **Update Status Done** — сохраняет `result_paths` и `status: done`

Error-ветка: **Error Trigger** → **Extract Error Info** → **Update Status Error**

Секреты передаются через webhook payload (`_secrets.internalApiKey`, `_secrets.llmApiKey`, `_secrets.llmBaseUrl`, `_secrets.llmModel`), т.к. n8n v2+ ограничивает `$env`.

## Переменные окружения

Все в `.env`. Шаблон: `.env.example`.

| Переменная | Описание |
|-----------|----------|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | PostgreSQL |
| `JWT_SECRET` | Секрет JWT (min 64 символа) |
| `INTERNAL_API_KEY` | Ключ для n8n → API коммуникации |
| `LLM_API_KEY` | API-ключ LLM (OpenAI-совместимый) |
| `LLM_BASE_URL` | URL LLM API |
| `LLM_MODEL` | Название модели |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | Seed-пользователь |
| `N8N_WEBHOOK_URL` | URL webhook'а n8n (по умолчанию `http://n8n:5678/webhook/presentator-pipeline`) |
| `N8N_PAYLOAD_SIZE_MAX` | Максимальный размер тела webhook'ов n8n (МБ), рекомендуется 64 для больших вложений/уточнений |

## Просмотр логов

```bash
docker compose logs -f              # Все сервисы
docker compose logs -f api-service   # API
docker compose logs -f n8n           # Оркестратор
docker compose logs -f converter-service  # Конвертер
```

Логи LLM-взаимодействий доступны в UI: страница задачи → раскрывающийся блок «LLM Request/Response».

Визуальные логи workflow: http://localhost/n8n/ → Executions.

## Контекст для LLM (доработки)

### Ключевые архитектурные решения

- **HTML/CSS-слайды**: LLM генерирует полноценный HTML/CSS для каждого слайда (1920×1080). Используется CSS-фреймворк (`slide-framework.css`) для единообразия. Конвертер рендерит HTML через Puppeteer и создаёт PDF + PPTX (скриншоты).

- **n8n как оркестратор**: Логика пайплайна реализована в n8n workflow, не в коде. Workflow хранится в `n8n-workflows/presentator-pipeline.json`. При обновлении — реимпорт через UI n8n или API n8n (не через прямое обновление SQL).

- **Секреты через webhook payload**: n8n v2+ ограничивает `$env`. API передаёт секреты в теле webhook как `_secrets`. Workflow читает их через `$json.body._secrets`.

- **Shared volume `/data`**: Загрузки → `/data/uploads/{job_id}/`, результаты → `/data/results/{job_id}/presentation.{pdf,pptx}`. Volume `shared_data` подключён к `api-service`, `n8n`, `converter-service`.

- **Iframe-превью**: `SlidePreview.vue` загружает CSS-фреймворк с `/converter/framework.css` и рендерит слайды в `<iframe srcdoc>` с масштабированием через `ResizeObserver`.

- **Системный промпт**: хранится в `presentator.settings` (`key='default_system_prompt'`). Если пуст — API отдаёт встроенный `DEFAULT_SYSTEM_PROMPT` из `api-service/src/routes/settings.js`. Пользователь может переопределить промпт в модалке создания задачи.

### Стек и версии

- Node.js 22 (Alpine для API, Puppeteer-образ для converter)
- PostgreSQL 16 (Alpine)
- Nginx 1.25 (Alpine)
- n8n: latest (v2.11+)
- Puppeteer 24.6+ (headless Chrome в Docker)
- pptxgenjs 3.12+
- Vue 3.5+, Vite 5.4+, TailwindCSS 3.4+

### Известные ограничения

- **Нет регистрации**: Только seed-пользователь
- **JWT в localStorage**: Для production → httpOnly cookie
- **Нет rate limiting**
- **Зависимость от лимитов webhook/payload**: большие изображения увеличивают payload; для стабильности избегайте хранения base64 в `previousSlideData` (уточнения)
- **Один воркер n8n**: Для масштабирования → n8n queue mode
- **PPTX = скриншоты**: Текст в PPTX не редактируемый (растровые изображения)

### Частые задачи при доработке

- **Изменить CSS-фреймворк слайдов**: `converter-service/src/slide-framework.css`
- **Изменить HTML-шаблон слайдов**: `converter-service/src/slide-template.html`
- **Изменить системный промпт по умолчанию**: `api-service/src/routes/settings.js` → `DEFAULT_SYSTEM_PROMPT`
- **Изменить workflow n8n**: редактировать в UI n8n, экспортировать в `n8n-workflows/presentator-pipeline.json`
- **Добавить новую таблицу/колонку**: создать SQL-файл в `init-db/` (нумерация: `05-...sql`)
- **Пересобрать сервис**: `docker compose up -d --build <service-name>`

### Папка service-llm

Конфигурация SGR Deep Research Agent — внешний инструмент для подготовки контента. Не часть основного пайплайна. `config.yaml` в `.gitignore`.
