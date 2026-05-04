# Presentator

Микросервисное веб-приложение для генерации презентаций (PDF / PPTX) по текстовому промпту через LLM. Слайды генерируются как HTML/CSS, рендерятся Puppeteer, конвертируются в PDF и PPTX.

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
| **api-service** | Node.js 22 + Express | 3001 | REST API: авторизация, задачи, настройки, хранилище вложений, отдача файлов |
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
│   ├── 04-result-paths.sql     # Колонка result_paths JSONB в jobs
│   ├── 05-folders.sql          # Дерево папок хранилища (folders)
│   ├── 06-attachments.sql      # Библиотека вложений (attachments)
│   └── 07-job-attachments.sql  # Связь jobs ↔ attachments + snapshot описания
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
│       │   ├── settings.js      # GET/PUT системного промпта
│       │   ├── folders.js       # CRUD дерева папок
│       │   ├── attachments.js   # CRUD библиотеки вложений
│       │   └── files.js         # GET /api/files/attachment/:id (приватная отдача)
│       ├── utils/
│       │   ├── attachmentTokens.js       # Подмена {{attachment:<ref>}} в HTML/CSS
│       │   └── attachmentTokens.test.js
│       └── scripts/
│           └── seed-user.js
│
├── converter-service/
│   ├── Dockerfile               # Node 22 (bookworm) + system Chromium
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
│       │   ├── PresentationSettings.vue # Шрифты, цвета, стиль
│       │   └── storage/
│       │       ├── FolderTree.vue       # Рекурсивный компонент дерева
│       │       ├── AttachmentGrid.vue   # Грид с inline-редактированием описания
│       │       └── StoragePicker.vue    # Модальный селектор вложений для CreateJob
│       ├── composables/
│       │   ├── usePromptAggregator.js   # Сборка payload для создания job
│       │   ├── usePromptAggregator.test.js
│       │   └── useStorage.js            # CRUD-обёртки для хранилища
│       ├── utils/
│       │   ├── assetPaths.js            # rewriteUploadAssetPaths + rewriteAttachmentTokens
│       │   └── assetPaths.test.js
│       └── views/
│           ├── LoginView.vue
│           ├── DashboardView.vue
│           ├── CreateJobView.vue
│           ├── JobStatusView.vue
│           └── StorageView.vue          # Древовидное хранилище вложений
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

**folders** — древовидная структура папок хранилища (произвольная глубина)

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| user_id | UUID (FK → users) | Владелец |
| parent_folder_id | UUID (FK → folders, NULL) | Родительская папка (NULL = корень) |
| name | VARCHAR(255) | Имя папки (уникально среди sibling'ов) |
| created_at / updated_at | TIMESTAMPTZ | |

**attachments** — библиотека вложений пользователя

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| user_id | UUID (FK → users) | Владелец |
| folder_id | UUID (FK → folders, NULL) | Папка (NULL = корень) |
| ref | VARCHAR(32) UNIQUE | Короткий стабильный ID для `{{attachment:<ref>}}` (например, `att_a3f12c4b`) |
| original_name | VARCHAR(512) | Исходное имя файла |
| storage_path | TEXT | Путь на диске (`/data/library/<uid>/<id>_<safe_name>`) |
| mime_type | VARCHAR(255) | |
| file_size | BIGINT | |
| kind | VARCHAR(20) | `image` / `document` / `other` |
| description | TEXT | Описание для LLM |
| extracted_text | TEXT | (Резерв) текст из документа после предобработки |
| content_summary | TEXT | (Резерв) сжатое описание контента |
| width / height | INTEGER | Только для изображений |
| created_at / updated_at | TIMESTAMPTZ | |

Файлы лежат **плоско** в `/data/library/<user_id>/`. Папки — только в БД, поэтому перемещение между папками — это `UPDATE folder_id` без файлового I/O.

**job_attachments** — связь job ↔ attachment + snapshot описания

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| job_id | UUID (FK → jobs, ON DELETE CASCADE) | |
| attachment_id | UUID (FK → attachments, ON DELETE RESTRICT) | |
| description_snapshot | TEXT | Копия описания в момент добавления к задаче (snapshot semantics) |
| sort_order | INTEGER | Порядок отображения |
| created_at | TIMESTAMPTZ | |

Snapshot гарантирует, что задачи не «дрейфуют» при правках в библиотеке. Удаление вложения, используемого в задаче, требует `?force=true` (отвязывает от всех jobs).

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
| GET | /api/jobs/uploads/:jobId/* | Приватная отдача файлов задачи (Bearer или `?token=`) |
| GET | /api/settings/system-prompt | Получить системный промпт |
| PUT | /api/settings/system-prompt | Обновить системный промпт |
| GET | /api/folders | Дерево папок текущего пользователя |
| POST | /api/folders | Создать папку `{name, parentId?}` |
| PATCH | /api/folders/:id | Переименовать / переместить (с защитой от циклов) |
| DELETE | /api/folders/:id?force=true | Удалить (по умолчанию 409 если непуста) |
| GET | /api/attachments?folderId=&q=&kind= | Список вложений (folderId: `root` / UUID / `all`) |
| POST | /api/attachments | Загрузить вложение в библиотеку (multipart) |
| PATCH | /api/attachments/:id | Обновить description / folderId / original_name |
| DELETE | /api/attachments/:id?force=true | Удалить (по умолчанию 409 если используется в jobs) |
| GET | /api/files/attachment/:id | Приватная отдача вложения (Bearer или `?token=`) |

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
| `PROCESSING_TIMEOUT_MINUTES` | Таймаут job в статусе `processing`, после которого API помечает задачу как `error` |

## Просмотр логов

```bash
docker compose logs -f              # Все сервисы
docker compose logs -f api-service   # API
docker compose logs -f n8n           # Оркестратор
docker compose logs -f converter-service  # Конвертер
```

Логи LLM-взаимодействий доступны в UI: страница задачи → раскрывающийся блок «LLM Request/Response».

Визуальные логи workflow: http://localhost/n8n/ → Executions.

## Хранилище вложений и интеграция с LLM

Хранилище — древовидная библиотека файлов пользователя (страница **Хранилище** во фронтенде, `StorageView.vue`). Каждое вложение имеет описание для LLM, которое подтягивается на странице создания презентации (snapshot — не редактирует оригинал в библиотеке).

### Пайплайн передачи изображений в LLM

LLM в проекте текстовая (не мультимодальная) и не анализирует изображения. Поэтому архитектура построена так, чтобы **передавать в LLM только метаданные**, а реальные файлы подставлять рендерерами:

```
Пользователь
  │ выбирает вложения из библиотеки
  ▼
api-service: POST /api/jobs
  │ INSERT в job_attachments (snapshot описания)
  │ строит attachmentMap: { ref → {localPath, mimeType, filename} }
  ▼
n8n webhook payload
  ├─ attachments[]: метаданные (ref, kind, filename, description, w×h, mime)
  └─ attachmentMap: { ref → {localPath, ...} }            (компактно, без base64)
  ▼
n8n: Build LLM Prompt
  │ добавляет блок "Available attachments" в user-message
  │ дополняет system-prompt правилами по {{attachment:<ref>}}
  ▼
LLM
  │ генерирует HTML/CSS, в <img src> пишет {{attachment:<ref>}}
  ▼
n8n: Save Slide Data → api-service (raw, с плейсхолдерами)
n8n: Call Converter → передаёт slideData + attachmentMap
  ▼
converter-service                         api-service / frontend
  │ {{attachment:X}} → file://...           │ {{attachment:X}} → /api/files/attachment/<id>?token=
  ▼                                         ▼
PDF / PPTX                                Iframe preview
```

### Правила плейсхолдера

- Формат: `{{attachment:<ref>}}` где `<ref>` соответствует `[A-Za-z0-9_-]+`.
- Подменяется в **трёх точках** через единую утилиту:
  - `api-service/src/utils/attachmentTokens.js` — для `GET /api/jobs/:id` (URL вида `/api/files/attachment/<id>?token=<jwt>`).
  - `frontend/src/utils/assetPaths.js` (`rewriteAttachmentTokens`) — defense-in-depth в `SlidePreview`.
  - `converter-service/src/converter.js` (`substituteAttachmentTokens`) — рендеринг в `file://...` для Puppeteer.
- В БД `slide_data` хранится **с плейсхолдерами**, без data-URL и без приватных URL.
- Webhook payload и LLM-промт **никогда** не содержат `base64` — только метаданные и описания.

### Заделы под следующие этапы

- `attachments.extracted_text` и `attachments.content_summary` зарезервированы под предобработку документов (RAG / суммаризация).
- `job_attachments.sort_order` + snapshot `description_snapshot` готовы под версии презентаций (refinement).
- `attachmentMap` строится централизованно в `api-service` (одна точка правды) и переиспользуется во всех downstream-сервисах — добавление новых рендереров (например, отдельного PDF-сервиса) не требует переделки пайплайна.

## Обновление БД (миграции)

`init-db/*.sql` исполняются ТОЛЬКО при первой инициализации БД (когда volume `postgres_data` пустой). При обновлении уже работающей БД нужно вручную:

```bash
# Dev: проще сбросить БД целиком
docker compose down -v && docker compose up -d --build

# Prod: выполнить новые SQL вручную
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/05-folders.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/06-attachments.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/07-job-attachments.sql
```

## Контекст для LLM (доработки)

### Ключевые архитектурные решения

- **HTML/CSS-слайды**: LLM генерирует полноценный HTML/CSS для каждого слайда (1920×1080). Используется CSS-фреймворк (`slide-framework.css`) для единообразия. Конвертер рендерит HTML через Puppeteer и создаёт PDF + PPTX (скриншоты).

- **n8n как оркестратор**: Логика пайплайна реализована в n8n workflow, не в коде. Workflow хранится в `n8n-workflows/presentator-pipeline.json`. При обновлении — реимпорт через UI n8n или API n8n (не через прямое обновление SQL).

- **Секреты через webhook payload**: n8n v2+ ограничивает `$env`. API передаёт секреты в теле webhook как `_secrets`. Workflow читает их через `$json.body._secrets`.

- **Shared volume `/data`**: Загрузки → `/data/uploads/{job_id}/`, результаты → `/data/results/{job_id}/presentation.{pdf,pptx}`. Volume `shared_data` подключён к `api-service`, `n8n`, `converter-service`.

- **Iframe-превью**: `SlidePreview.vue` загружает CSS-фреймворк с `/converter/framework.css` и рендерит слайды в `<iframe srcdoc>` с масштабированием через `ResizeObserver`.

- **Системный промпт**: хранится в `presentator.settings` (`key='default_system_prompt'`). Если пуст — API отдаёт встроенный `DEFAULT_SYSTEM_PROMPT` из `api-service/src/routes/settings.js`. Пользователь может переопределить промпт в модалке создания задачи. К итоговому system-prompt n8n добавляет блок ATTACHMENT_RULES (правила работы с `{{attachment:<ref>}}`).

- **Хранилище вложений**: древовидное (`presentator.folders` — рекурсивная self-FK), плоское на диске (`/data/library/<user_id>/<id>_<safe_name>`). Связь с задачами — через `job_attachments` со snapshot-копией описания.

- **Плейсхолдеры `{{attachment:<ref>}}`**: единая точка правды — `api-service/src/utils/attachmentTokens.js` + симметричные хелперы во фронтенде и конвертере. Никогда не передаём base64 в webhook/LLM.

### Стек и версии

- Node.js 22 (Alpine для API, Bookworm + Chromium для converter)
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
- **LLM текстовая, не мультимодальная**: Изображения передаются через метаданные + плейсхолдеры `{{attachment:<ref>}}` (см. секцию «Хранилище вложений»). LLM не «видит» картинки, но размещает их в HTML по описаниям пользователя.
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
