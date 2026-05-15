# Presentator

Микросервисное веб-приложение для генерации презентаций (PDF / PPTX) по текстовому промпту через LLM. Слайды генерируются как HTML/CSS, рендерятся Puppeteer, конвертируются в PDF и PPTX.

С версии **pipeline v2** генерация декомпозирована на этапы **Планирование → Дизайн → Верстка → Рендер** с точками остановки между этапами и режимом доработки (Refinement). Старые задачи продолжают работать на однопроходном пайплайне (`pipeline_version=1`).

## Архитектура

```
┌────────────┐    ┌───────────────────────────────────────────────────────┐
│  Браузер   │───▶│  Nginx (gateway, :80)                                 │
└────────────┘    │   /           → Frontend (Vue 3 SPA)                  │
                  │   /api/*      → API Service (Express, :3001)          │
                  │   /n8n/*      → n8n (Workflow Engine, :5678)          │
                  │   /converter/ → Converter Service (:3002)             │
                  └───────────────────────────────────────────────────────┘
                        │           │           │            │
                        ▼           ▼           ▼            ▼
               ┌──────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────┐
               │ API Service  │ │    n8n     │ │   Frontend   │ │  Extractor   │
               │  (Express)   │ │  Switch by │ │  (Vue 3 +    │ │   Service    │
               │              │ │   stage    │ │   Vite)      │ │  (FastAPI)   │
               │  Auth JWT    │ │  4 branches│ │              │ │              │
               │  Jobs+stages │ │  (planning │ │  stepper UI  │ │  PDF/DOCX→   │
               │  Prompts API │ │  /design/  │ │  reviews     │ │  text+summary│
               │  File upload │ │   layout/  │ │  refine UI   │ │  PIL→ w×h    │
               │  Extractor   │ │  refine)   │ │              │ │              │
               │  trigger     │ │            │ │              │ │              │
               └──────┬───────┘ └─────┬──────┘ └──────────────┘ └──────┬───────┘
                      │               │                                │
                      ▼               ▼                                │
               ┌──────────────┐ ┌──────────────┐                       │
               │  PostgreSQL  │ │  Converter   │                       │
               │  (schemas:   │ │  Service     │                       │
               │   n8n,       │ │  (Puppeteer  │                       │
               │   presentator│ │  + pptxgenjs)│                       │
               │  )           │ └─────┬────────┘                       │
               └──────▲───────┘       │                                │
                      │               ▼                                │
                 shared_data     /data/results/                  shared_data
                   volume       ├── presentation.pdf                   │
                                └── presentation.pptx           /data/library/
```

### Сервисы

| Сервис | Технологии | Порт | Назначение |
|--------|-----------|------|------------|
| **nginx** | Nginx 1.25 | 80 (внешний) | Reverse proxy, единая точка входа |
| **api-service** | Node.js 22 + Express | 3001 | REST API: авторизация, задачи, этапы пайплайна, настройки промтов, хранилище, дизайн-пресеты, отдача файлов |
| **n8n** | n8n (latest) | 5678 | Оркестратор пайплайна: единый webhook + Switch по полю `stage`, 4 ветки (planning / design / layout / refine_layout) |
| **converter-service** | Node.js + Puppeteer + pptxgenjs | 3002 | HTML-слайды → PDF (Puppeteer) + PPTX (скриншоты → pptxgenjs) |
| **extractor-service** | Python 3.11 + FastAPI + pdfminer.six + python-docx + Pillow | 3003 (внутренний) | Извлечение текста из PDF/DOCX/TXT и метаданных изображений (w×h). Асинхронный воркер, дёргается api-service после загрузки вложения, пишет результат через internal API |
| **frontend** | Vue 3 + Vite + TailwindCSS | 80 (внутренний) | SPA: логин, создание задач (DesignBriefForm), степпер этапов, ревью промежуточных результатов, доработка |
| **postgres** | PostgreSQL 16 | 5432 | БД: схемы `n8n` и `presentator` |

### Поток данных (staged pipeline v2)

1. Пользователь вводит промпт, заполняет дизайн-бриф (тон / палитра / шрифты / layout / графика / референсы), выбирает вложения через **Frontend**.
2. **API Service** создаёт задачу (`pipeline_version=2`, `status: pending`) и **триггерит первый webhook** в n8n с полем `stage='planning'`.
3. **Этап 1 — Planning.** n8n собирает промт и зовёт LLM. LLM возвращает JSON со структурой слайдов (заголовки, блоки, спикерские заметки) **без дизайна**. n8n записывает результат в `jobs.planning_result` и переводит задачу в `awaiting_planning_review`.
4. **Frontend** показывает структуру в `PlanningReview`, пользователь может править тексты и нажимает «Подтвердить и продолжить». Это вызывает `POST /api/jobs/:id/stages/design/start`, который инкрементит `attempt` и триггерит webhook со `stage='design'`.
5. **Этап 2 — Design.** n8n получает структуру + дизайн-бриф пользователя, зовёт LLM. LLM возвращает JSON-ТЗ для верстальщика (палитра, шрифты, layout-классы, фон, декор по слайдам). Результат пишется в `jobs.design_brief`, задача переходит в `awaiting_design_review`.
6. **Frontend** показывает дизайн-ТЗ в `DesignReview` (палитра-чипсы, образцы шрифтов, layout-метки), пользователь подтверждает запуск верстки.
7. **Этап 3 — Layout.** n8n получает `planning_result` + `design_brief` + список вложений и зовёт LLM. LLM возвращает финальный `slide_data` (HTML/CSS) с плейсхолдерами `{{attachment:<ref>}}`.
8. **Этап 4 — Render.** n8n шлёт `slide_data` в Converter Service → PDF + PPTX. Задача переводится в `done`.
9. **(Опционально) Refinement.** Пользователь нажимает «Доработать» (всю презентацию или один слайд), указывает текст. `POST /api/jobs/:id/refine` создаёт новый attempt этапа `refine_layout`, n8n получает текущий `slide_data` + указание и пересобирает презентацию.

Все шаги пишутся в `presentator.job_pipeline_steps` (по строке на attempt). История доступна через `GET /api/jobs/:id/steps`.

### Извлечение текста из документов

После загрузки документа в `POST /api/attachments` api-service делает fire-and-forget вызов в **extractor-service**, который:
- Вытаскивает текст (pdfminer.six / python-docx / plain text decode).
- Готовит `content_summary` (первые 1500 символов; в будущем — LLM-summarization).
- Для изображений сохраняет ширину/высоту через Pillow.
- Возвращает результат через `PATCH /api/attachments/internal/:id`.

UI показывает статус извлечения бейджем в карточке вложения (`pending` / `done` / `failed`). При создании задачи `content_summary` подставляется в Stage 1 промт как «Summary», поэтому LLM видит контент документа без `base64`.

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

Альтернатива без UI (через CLI внутри контейнера n8n). Рекомендуется для воспроизводимости:

```bash
docker compose cp n8n-workflows/presentator-pipeline.json n8n:/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n update:workflow --id=pres002 --active=true
docker compose restart n8n
```

Важно: следите, чтобы **активным был ровно один** workflow на webhook, иначе один и тот же job может обрабатываться дважды:

```bash
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT id, name, active FROM n8n.workflow_entity WHERE active=true;"
```

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
│   ├── 01-schemas.sql                # Создание схем n8n и presentator
│   ├── 02-users-table.sql            # Таблицы users и jobs
│   ├── 03-settings-table.sql         # Таблица settings (key/value)
│   ├── 04-result-paths.sql           # Колонка result_paths JSONB в jobs
│   ├── 05-folders.sql                # Дерево папок хранилища (folders)
│   ├── 06-attachments.sql            # Библиотека вложений (attachments)
│   ├── 07-job-attachments.sql        # Связь jobs ↔ attachments + snapshot описания
│   ├── 08-attachment-extraction.sql  # extraction_status / extracted_at / extraction_error
│   ├── 09-pipeline-stages.sql        # pipeline_version, current_stage, planning_result, design_brief, design_input, job_pipeline_steps
│   ├── 10-design-presets.sql         # design_presets (сохранённые дизайн-брифы)
│   ├── 11-llm-call-logs.sql          # llm_call_logs (raw observability + token counts)
│   ├── 12-job-snapshots.sql          # job_snapshots (версии задач + откат)
│   └── 13-job-drafts.sql             # job_drafts + job_draft_versions (черновики формы)
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
│       │   ├── jobs.js          # CRUD задач, staged-pipeline эндпоинты, webhook trigger
│       │   ├── settings.js      # GET/PUT промтов (4 ключа: planning/design/layout/refine) + legacy /system-prompt
│       │   ├── folders.js       # CRUD дерева папок
│       │   ├── attachments.js   # CRUD библиотеки + триггер extractor + internal callback
│       │   ├── files.js         # GET /api/files/attachment/:id (приватная отдача)
│       │   └── designPresets.js # CRUD сохранённых дизайн-брифов
│       ├── services/
│       │   ├── pipeline.js              # startStage / completeStage — ядро staged-пайплайна (+ авто-snapshot + LLM log)
│       │   ├── pipeline.test.js
│       │   ├── pipelineStages.js
│       │   ├── staleJobSweeper.js
│       │   ├── staleJobSweeper.test.js
│       │   ├── attachmentPayload.js     # Pure: SQL-rows → {attachments, attachmentMap} с полем content
│       │   ├── attachmentPayload.test.js
│       │   ├── llmLogger.js              # Запись llm_call_logs (идемпотентно по step_id)
│       │   ├── llmLogger.test.js
│       │   ├── snapshots.js              # createSnapshot / listSnapshots / restoreSnapshot
│       │   ├── snapshots.test.js
│       │   ├── drafts.js                 # CRUD драфтов формы + история версий
│       │   ├── drafts.test.js
│       │   ├── metrics.js                # SQL-агрегаты для /api/metrics/*
│       │   └── metrics.test.js
│       ├── utils/
│       │   ├── attachmentTokens.js       # Подмена {{attachment:<ref>}} в HTML/CSS
│       │   ├── attachmentTokens.test.js
│       │   ├── documentsBlock.js         # Pure: attachments[] → <DOCUMENTS>…</DOCUMENTS> блок для LLM-промтов
│       │   ├── documentsBlock.test.js    # Canonical-источник алгоритма; inline-копия в n8n build-*-prompt
│       │   ├── idsParam.js               # Парсер ?ids=a,b,c для batch-lookup эндпоинтов (UUID-валидация)
│       │   ├── idsParam.test.js
│       │   ├── promptDefaults.js         # 4 дефолтных промта для этапов (+ правила работы с <DOCUMENTS>)
│       │   ├── promptDefaults.test.js
│       │   ├── tokenizer.js              # Локальный подсчёт токенов (cl100k_base)
│       │   └── tokenizer.test.js
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
│       │   ├── PromptsSettingsModal.vue # 4 таба: planning/design/layout/refine
│       │   ├── SystemPromptModal.vue    # Legacy, оставлен для совместимости
│       │   ├── SlidePromptsEditor.vue   # Промпты по отдельным слайдам
│       │   ├── PresentationSettings.vue # Legacy шрифты/цвета (для v1)
│       │   ├── VersionsPanel.vue        # Снимки задачи + откат (на /jobs/:id)
│       │   ├── DraftsPanel.vue          # Черновики формы + история версий (на /create)
│       │   ├── design/
│       │   │   └── DesignBriefForm.vue  # Многотабный редактор дизайн-брифа
│       │   ├── pipeline/
│       │   │   ├── PipelineStepper.vue  # Степпер: Planning → Design → Layout → Render
│       │   │   ├── PlanningReview.vue   # Ревью структуры (awaiting_planning_review)
│       │   │   ├── DesignReview.vue     # Ревью дизайн-ТЗ (awaiting_design_review)
│       │   │   └── RefinementPanel.vue  # «Доработать слайд / всю презентацию»
│       │   └── storage/
│       │       ├── FolderTree.vue       # Рекурсивный компонент дерева
│       │       ├── AttachmentGrid.vue   # Грид + бейджи extraction_status
│       │       └── StoragePicker.vue    # Модальный селектор вложений
│       ├── composables/
│       │   ├── usePromptAggregator.js          # Payload (с designBrief, pipelineVersion)
│       │   ├── usePromptAggregator.test.js
│       │   ├── useDesignBriefAggregator.js     # JSON-бриф + текстовый preview
│       │   ├── useDesignBriefAggregator.test.js
│       │   ├── useDraftAttachments.js          # Восстановление library-attachments из драфта (batch-fetch)
│       │   ├── useDraftAttachments.test.js
│       │   └── useStorage.js                   # CRUD-обёртки для хранилища
│       ├── utils/
│       │   ├── assetPaths.js            # rewriteUploadAssetPaths + rewriteAttachmentTokens
│       │   ├── assetPaths.test.js
│       │   ├── formatters.js            # fmtNum / fmtTimestamp / stageLabel / kindBadge
│       │   ├── formatters.test.js
│       │   ├── metricsChart.js          # Pure data-shaping для chart.js: byDay/byStage/sortSnapshots
│       │   ├── metricsChart.test.js
│       │   ├── slideScale.js            # Расчёт scale iframe-превью
│       │   └── slideScale.test.js
│       └── views/
│           ├── LoginView.vue
│           ├── DashboardView.vue
│           ├── CreateJobView.vue
│           ├── JobStatusView.vue
│           ├── StorageView.vue          # Древовидное хранилище вложений
│           └── MetricsView.vue          # Метрики и токены (графики chart.js)
│
├── n8n-workflows/
│   └── presentator-pipeline.json    # v2: Switch по stage + 4 ветки
│
├── extractor-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py                  # FastAPI: POST /extract, /health
│   │   ├── extract.py               # Pure: pdfminer / docx / txt / Pillow dispatch
│   │   └── config.py                # Settings.from_env()
│   └── tests/
│       ├── test_extract.py
│       └── test_main.py
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
| presentation_settings | JSONB | Legacy шрифты/цвета (используется для `pipeline_version=1`) |
| system_prompt | TEXT | Per-job override layout-промта (или NULL для дефолтного) |
| pipeline_version | INTEGER | `1` = старый однопроходный, `2` = staged (по умолчанию) |
| current_stage | VARCHAR(30) | Текущая стадия для UI: `planning` / `design` / `layout` / `refine_layout` |
| design_input | JSONB | Структурированный дизайн-бриф из формы (вход для Stage 2) |
| planning_result | JSONB | Выход Stage 1 (структура слайдов + контент) |
| design_brief | JSONB | Выход Stage 2 (палитра / шрифты / layout-инструкции) |
| status | VARCHAR(20) | `pending` / `processing_*` / `awaiting_*_review` / `done` / `error` |
| slide_data | JSONB | HTML/CSS слайды (выход Stage 3 / Refine) |
| result_path | TEXT | Путь к PDF (для обратной совместимости) |
| result_paths | JSONB | `{pdf: "...", pptx: "..."}` |
| llm_request | JSONB | Снимок последнего layout/refine запроса (legacy log viewer) |
| llm_response | JSONB | Снимок последнего layout/refine ответа |
| error_message | TEXT | Текст ошибки |
| created_at | TIMESTAMPTZ | Дата создания |
| updated_at | TIMESTAMPTZ | Дата обновления |

**job_pipeline_steps** — журнал выполнения этапов (по строке на attempt)

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| job_id | UUID (FK → jobs, ON DELETE CASCADE) | |
| stage | VARCHAR(30) | `planning` / `design` / `layout` / `refine_layout` / `render` |
| attempt | INTEGER | Номер попытки (увеличивается при повторных запусках/refinement) |
| status | VARCHAR(20) | `pending` / `running` / `done` / `error` |
| input | JSONB | Снимок входа (опционально) |
| output | JSONB | Результат этапа |
| llm_request | JSONB | Полный prompt к LLM |
| llm_response | JSONB | Полный ответ LLM |
| error_message | TEXT | |
| started_at / completed_at | TIMESTAMPTZ | |
| `UNIQUE (job_id, stage, attempt)` | | Идемпотентность для callback'ов n8n |

**settings**

| Колонка | Тип | Описание |
|---------|-----|----------|
| key | VARCHAR(100) PK | Ключ настройки |
| value | TEXT | Значение |

Ключи системных промтов (по одному на этап staged-пайплайна):
- `default_planning_prompt` — этап 1, структура и контент.
- `default_design_prompt` — этап 2, дизайн-ТЗ.
- `default_layout_prompt` — этап 3, финальная HTML/CSS-верстка.
- `default_refine_prompt` — режим доработки.

Если ключ пуст, API сидит дефолтное значение из `api-service/src/utils/promptDefaults.js`. Старый ключ `default_system_prompt` отмаплен на `default_layout_prompt` (для обратной совместимости с legacy эндпоинтом `/api/settings/system-prompt`).

**llm_call_logs** — сырое observability-хранилище всех LLM-вызовов (новое)

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| job_id | UUID (FK → jobs, ON DELETE CASCADE) | |
| step_id | UUID (FK → job_pipeline_steps, ON DELETE SET NULL) | Привязка к attempt этапа |
| user_id | UUID (FK → users) | Для запросов /api/metrics |
| stage | VARCHAR(30) | `planning` / `design` / `layout` / `refine_layout` |
| attempt | INTEGER | Номер попытки этапа |
| model | TEXT | Имя модели LLM |
| provider | TEXT | Base URL провайдера |
| system_prompt / user_message | TEXT | Сырые тексты для отладки |
| raw_request / raw_response | JSONB | Полный payload в/из LLM |
| prompt_tokens / completion_tokens | INTEGER | Подсчитано локально (gpt-tokenizer / cl100k_base) |
| total_tokens | INTEGER (STORED) | Сумма prompt + completion |
| tokens_source | VARCHAR(20) | `estimated` / `provider` / `mixed` |
| finish_reason | TEXT | `stop` / `length` / `abort` / ... |
| latency_ms | INTEGER | Измерено в Parse-нодах n8n |
| error_message | TEXT | |
| created_at | TIMESTAMPTZ | |
| `UNIQUE (step_id) WHERE step_id IS NOT NULL` | | Идемпотентность для n8n-ретраев |

**job_snapshots** — точечные снимки состояния задачи (для отката/версионирования)

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | |
| job_id | UUID (FK → jobs, ON DELETE CASCADE) | |
| version | INTEGER | Инкрементный per job, `UNIQUE (job_id, version)` |
| kind | VARCHAR(20) | `auto` (после успешного этапа) / `manual` (ручная) / `restore` (точка отката) |
| label | TEXT | Человекочитаемое описание (генерируется автоматически для auto) |
| stage / status / current_stage | | Состояние пайплайна на момент снимка |
| prompt / slide_count / slide_prompts / presentation_settings / system_prompt | | Полная копия user input |
| design_input / planning_result / design_brief / slide_data | JSONB | Полные снимки всех stage-outputs |
| result_paths | JSONB | |
| created_by_step_id | UUID | Привязка к `job_pipeline_steps` (для auto) |
| created_by_user_id | UUID | Кто создал снимок (для manual/restore) |
| created_at | TIMESTAMPTZ | |

**job_drafts** + **job_draft_versions** — черновики формы создания на `/create`

`job_drafts` — текущая (head) версия черновика пользователя; `job_draft_versions` — история всех правок. Каждый PUT инкрементит `head_version` и пишет новую строку в `job_draft_versions`. Откат к версии = копирование её содержимого в head + строка с `kind='restore'`. Файлы не входят в drafts (one-shot uploads существуют только в браузере); library-attachments — да.

**design_presets** — сохранённые пользователем дизайн-брифы

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID (PK) | gen_random_uuid() |
| user_id | UUID (FK → users, ON DELETE CASCADE) | |
| name | VARCHAR(120) | Название пресета (уникально в рамках пользователя) |
| brief_json | JSONB | Структурированный бриф из `DesignBriefForm` |
| created_at / updated_at | TIMESTAMPTZ | |

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
| extracted_text | TEXT | Сырой текст из документа (заполняется extractor-service) |
| content_summary | TEXT | Краткое резюме контента (1–3 абзаца), идёт в Stage 1 промт |
| extraction_status | VARCHAR(20) | `pending` / `processing` / `done` / `failed` / `skipped` |
| extracted_at | TIMESTAMPTZ | Когда extractor отработал |
| extraction_error | TEXT | Текст ошибки, если `failed` |
| width / height | INTEGER | Только для изображений (заполняется Pillow) |
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
| POST | /api/jobs | Создать задачу (multipart: prompt, slideCount, slidePrompts, presentationSettings, systemPrompt, designBrief, pipelineVersion, files, attachments) |
| GET | /api/jobs/:id | Детали задачи (slide_data, planning_result, design_brief, llm_request/response, attachments) |
| GET | /api/jobs/:id/steps | Все шаги пайплайна (журнал per-attempt) |
| POST | /api/jobs/:id/stages/:stage/start | Запустить этап staged-пайплайна (`design` / `layout` / `planning` / `refine_layout`). Body: `{planning_result?, design_brief?, refinePrompt?, slideIndex?}` |
| POST | /api/jobs/:id/refine | Доработка: `{prompt, slideIndex?}` → новый attempt этапа `refine_layout` |
| GET | /api/jobs/:id/download?format=pdf\|pptx | Скачать результат (по умолчанию pdf) |
| GET | /api/jobs/uploads/:jobId/* | Приватная отдача файлов задачи (Bearer или `?token=`) |
| GET | /api/settings/prompts | Все 4 системных промта одним блоком |
| GET | /api/settings/prompts/:key | Один промт (`default_planning_prompt` / `default_design_prompt` / `default_layout_prompt` / `default_refine_prompt`) |
| PUT | /api/settings/prompts/:key | Обновить промт |
| POST | /api/settings/prompts/:key/reset | Сбросить промт к дефолту |
| GET | /api/settings/system-prompt | **Deprecated**, мапит на `default_layout_prompt` |
| PUT | /api/settings/system-prompt | **Deprecated**, мапит на `default_layout_prompt` |
| GET | /api/folders | Дерево папок текущего пользователя |
| POST | /api/folders | Создать папку `{name, parentId?}` |
| PATCH | /api/folders/:id | Переименовать / переместить (с защитой от циклов) |
| DELETE | /api/folders/:id?force=true | Удалить (по умолчанию 409 если непуста) |
| GET | /api/attachments?folderId=&q=&kind= | Список вложений (включая `extraction_status`) |
| GET | /api/attachments/by-ids?ids=a,b,c | Batch-lookup по UUID-списку (используется при восстановлении драфта). UUID-валидация, cap 100, фильтр по `user_id`. |
| POST | /api/attachments | Загрузить вложение (триггерит extractor-service асинхронно) |
| PATCH | /api/attachments/:id | Обновить description / folderId / original_name |
| POST | /api/attachments/:id/reextract | Повторно прогнать через extractor (`extraction_status='pending'` + force) |
| DELETE | /api/attachments/:id?force=true | Удалить (по умолчанию 409 если используется в jobs) |
| GET | /api/files/attachment/:id | Приватная отдача вложения (Bearer или `?token=`) |
| GET | /api/design-presets | Список сохранённых дизайн-брифов пользователя |
| POST | /api/design-presets | Создать/обновить пресет `{name, brief}` (uniq by `(user_id, name)`) |
| PATCH | /api/design-presets/:id | Переименовать / обновить бриф |
| DELETE | /api/design-presets/:id | Удалить пресет |
| GET | /api/metrics/summary?days=N | Суммарные метрики (calls / tokens / latency / errors) |
| GET | /api/metrics/by-stage?days=N | Разбивка по этапам пайплайна |
| GET | /api/metrics/by-day?days=N | Дневные агрегаты для графика |
| GET | /api/metrics/by-model?days=N | Разбивка по моделям LLM |
| GET | /api/metrics/recent-calls?limit=N | Лента последних LLM-вызовов |
| GET | /api/metrics/calls/:id | Сырые `raw_request` / `raw_response` одного вызова |
| GET | /api/jobs/:id/snapshots | Список снимков задачи |
| GET | /api/jobs/:id/snapshots/:version | Один снимок (полный body) |
| POST | /api/jobs/:id/snapshots | Ручной снимок `{label?}` |
| POST | /api/jobs/:id/snapshots/:version/restore | Откатить задачу к версии |
| GET | /api/drafts | Список черновиков формы текущего пользователя |
| POST | /api/drafts | Создать черновик `{name, prompt?, design_input?, …}` |
| GET | /api/drafts/:id | Текущее (head) состояние черновика |
| PUT | /api/drafts/:id | Обновить черновик (бампит head_version, пишет новую версию) |
| DELETE | /api/drafts/:id | Удалить черновик и всю историю |
| GET | /api/drafts/:id/versions | История версий черновика |
| POST | /api/drafts/:id/versions/:version/restore | Откатить черновик к версии |

### Внутренние (X-Internal-Key) эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| PATCH | /api/jobs/internal/:id | Legacy: status / slideData / resultPath / resultPaths / llmRequest / llmResponse / errorMessage. Используется для converter-callback'ов и pipeline_version=1 |
| PATCH | /api/jobs/internal/:id/steps/:stage | Завершить этап staged-пайплайна `{output, llmRequest, llmResponse, errorMessage}` |
| GET | /api/attachments/internal/:id | Получить полные данные вложения (для extractor-service) |
| PATCH | /api/attachments/internal/:id | Записать результат extraction `{extractionStatus, extractedText?, contentSummary?, extractionError?, width?, height?}` |

## n8n Workflow (v2)

Файл: `n8n-workflows/presentator-pipeline.json`

Workflow устроен как **Switch по полю `body.stage`** (planning / design / layout / refine_layout) с одним общим webhook'ом. Каждая ветка изолирована и состоит из одинаковой последовательности из 4 нод:

```
Webhook → Switch by Stage ┬─► Build Planning Prompt → LLM Planning → Parse Planning → Save Planning Step
                          ├─► Build Design Prompt   → LLM Design   → Parse Design   → Save Design Step
                          ├─► Build Layout Prompt   → LLM Layout   → Parse Layout   → Save Layout Step  → Convert (layout)  → Mark Done (layout)
                          └─► Build Refine Prompt   → LLM Refine   → Parse Refine   → Save Refine Step  → Convert (refine)  → Mark Done (refine)
```

`Save *` ноды дёргают новый эндпоинт `PATCH /api/jobs/internal/:jobId/steps/:stage` с `{ output, llmRequest, llmResponse, errorMessage }`. Ветки `layout` и `refine_layout` дополнительно вызывают converter-service и закрывают задачу через legacy `PATCH /api/jobs/internal/:id { status: 'done', resultPaths }`.

Error-ветка: **Error Trigger** → **Extract Error Info** → **Update Status Error** — без изменений.

Секреты по-прежнему идут через `body._secrets` (`internalApiKey`, `llmApiKey`, `llmBaseUrl`, `llmModel`).

### Импорт обновлённого workflow

После каждого изменения `n8n-workflows/presentator-pipeline.json` workflow нужно реимпортировать:

1. `http://localhost/n8n/` → Workflows.
2. Открыть текущий workflow → Settings → Delete (или сохранить старую версию через export).
3. Workflows → Import from file → выбрать `n8n-workflows/presentator-pipeline.json`.
4. Активировать.

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
| `EXTRACTOR_BASE_URL` | URL extractor-service из api-service (default `http://extractor-service:3003`) |
| `API_BASE_URL` | URL api-service из extractor-service (default `http://api-service:3001`) |
| `EXTRACTOR_MAX_FILE_MB` | Лимит размера документа на извлечение (default `20`) |
| `EXTRACTOR_TEXT_LIMIT_CHARS` | Максимум символов сырого `extracted_text` (default `50000`) |
| `EXTRACTOR_SUMMARY_MAX_CHARS` | Максимум символов `content_summary` (default `1500`) |
| `PROCESSING_TIMEOUT_MINUTES` | Таймаут job в статусе `processing`, после которого API помечает задачу как `error` |

### Экономия токенов (важно)

Лимиты `max_tokens` задаются в `n8n-workflows/presentator-pipeline.json` (LLM Planning/Design/Layout/Refine).
Если вы упираетесь в лимиты, сначала уменьшайте число слайдов и `max_tokens`, и только потом усложняйте промты.

Для reasoning‑моделей используйте `chat_template_kwargs: { enable_thinking: false }` (workflow уже содержит это),
иначе модель может вернуть JSON в `reasoning_content` или оборвать ответ.

## Просмотр логов

```bash
docker compose logs -f              # Все сервисы
docker compose logs -f api-service   # API
docker compose logs -f n8n           # Оркестратор
docker compose logs -f converter-service  # Конвертер
```

Логи LLM-взаимодействий доступны в UI:
- страница задачи → раскрывающийся блок «LLM Request/Response» (последний layout/refine attempt);
- страница **«Метрики»** (`/metrics`) → лента всех LLM-вызовов с фильтрами + сырые `raw_request` / `raw_response` для каждого.

Визуальные логи workflow: http://localhost/n8n/ → Executions.

## Observability и контроль версий

Реализация в этой ветке расширила систему тремя независимыми, но связанными слоями:

### 1. Сырое хранилище LLM-вызовов (`presentator.llm_call_logs`)

Каждый успешный или ошибочный LLM-вызов в `pipeline.completeStage` пишется одной строкой в `llm_call_logs` (идемпотентно по `step_id` — n8n-ретраи не дублируют записи). В таблице хранятся:
- сырые `raw_request` / `raw_response` (JSONB),
- `system_prompt` / `user_message` (плоский текст для быстрого поиска),
- `prompt_tokens` / `completion_tokens` / `total_tokens` (подсчитаны локально через `gpt-tokenizer` — cl100k_base, не доверяем `usage` от gateway),
- `tokens_source` (`estimated` / `provider` / `mixed`),
- `model`, `provider`, `latency_ms`, `finish_reason`, `error_message`.

Доступ через `/api/metrics/*` (только владелец задачи). На странице `/metrics` — графики `chart.js`: токены по дням, по этапам, таблица по моделям, лента последних 50 вызовов.

> **Hotfix**: первый прогон показал, что `INSERT ... ON CONFLICT (step_id) DO UPDATE` без повтора предиката partial-индекса (`WHERE step_id IS NOT NULL`) отвергается Postgres'ом — это молча проглатывалось `try/catch` логгера, в итоге `llm_call_logs` оставалась пустой при заполненных snapshots. Поправлено в `services/llmLogger.js`; добавлен регрессионный assert в `llmLogger.test.js`. Подробности и шаги верификации — в `CHANGES.md` (раздел «Известные проблемы → 1) Verify»).

### 2. Версионирование задач (`presentator.job_snapshots`)

После каждого успешного этапа `pipeline.completeStage` создаёт **auto-snapshot** — полную копию `prompt` + `slide_count` + `slide_prompts` + `design_input` + `planning_result` + `design_brief` + `slide_data` + `status` + `current_stage`. Пользователь может:
- посмотреть полную историю на странице `/jobs/:id` (компонент `VersionsPanel`),
- создать **manual snapshot** с меткой (`POST /api/jobs/:id/snapshots`),
- откатить задачу к любой версии (`POST /api/jobs/:id/snapshots/:version/restore`). После отката пишется новый snapshot с `kind='restore'` — история остаётся линейной (audit-friendly).

### 3. Черновики формы создания (`presentator.job_drafts` + `job_draft_versions`)

На странице `/create` пользователь может сохранить состояние формы как именованный черновик и вернуться к нему позже. Каждое сохранение бампит `head_version` и пишет новую строку в `job_draft_versions` — то есть у каждого черновика своя история. Откат к версии работает так же, как и у задач: копирует содержимое в head + пишет `kind='restore'`.

Файлы (one-shot uploads) в черновиках **не сохраняются** — они живут только в браузере до submit. Library-attachments сохраняются по `attachmentId` + описание.

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

# Prod: выполнить новые SQL вручную (для уже инициализированной БД)
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/05-folders.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/06-attachments.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/07-job-attachments.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/08-attachment-extraction.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/09-pipeline-stages.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/10-design-presets.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/11-llm-call-logs.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/12-job-snapshots.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/13-job-drafts.sql
```

## Контекст для LLM (доработки)

### Передача attachments на все этапы (важно)

- API-сервис в `api-service/src/services/pipeline.js` → `loadJobAttachments` тащит из БД полную тройку (`extracted_text`, `content_summary`, `description_snapshot`) и через pure-helper `services/attachmentPayload.js` собирает массив, где у каждого attachment есть поле `content` (= первое непустое из `extracted_text` → `content_summary` → `description_snapshot`, обрезанное до 50k chars).
- Эти `attachments` уходят в **webhook payload каждого этапа** (planning / design / layout / refine_layout) — не только planning.
- В n8n каждая `build-*-prompt` нода через свою inline-копию `documentsBlock.js` собирает блок:
  ```
  <DOCUMENTS>
  [ref=att_xxx, kind=document, filename=agenda.pdf]
  …full extracted body up to per-stage cap…
  </DOCUMENTS>
  ```
  Пер-stage caps (`maxCharsPerDoc / maxTotalChars`): planning `8000 / 24000`, design `6000 / 18000`, layout `6000 / 18000`, refine `4000 / 12000`. Менять — в `documentsBlock.js` (canonical) **и** в inline-копиях в `n8n-workflows/presentator-pipeline.json`. Регрессионный тест — `documentsBlock.test.js`.
- Дефолтные промты в `api-service/src/utils/promptDefaults.js` имеют явные правила работы с `<DOCUMENTS>` и запреты на обобщение списков/дат/расписаний. Инварианты закреплены в `promptDefaults.test.js`.

### Ключевые архитектурные решения

- **Staged pipeline (v2)**: генерация разбита на Planning → Design → Layout → Render. Между этапами — точки остановки (`awaiting_planning_review`, `awaiting_design_review`), где пользователь подтверждает или правит промежуточный результат. Каждый этап логируется отдельной строкой в `job_pipeline_steps` (по строке на attempt → история refinement сохраняется). Старые задачи с `pipeline_version=1` продолжают работать на однопроходном workflow (n8n Switch falls through to legacy branch).

- **Per-stage prompts**: четыре независимых системных промта (`default_planning_prompt`, `default_design_prompt`, `default_layout_prompt`, `default_refine_prompt`). Дефолты — в `api-service/src/utils/promptDefaults.js`, переопределяются через `/api/settings/prompts/:key`. Стартовая логика staged-пайплайна — в `api-service/src/services/pipeline.js` (`startStage` / `completeStage`).

- **Design brief как структурированный объект**: фронтенд (`DesignBriefForm.vue` + `useDesignBriefAggregator.js`) собирает тон / палитру / шрифты / layout / графику / референсы в JSON и в текстовый preview. Объект пишется в `jobs.design_input` и подаётся в Stage 2. Пресеты сохраняются в `presentator.design_presets`.

- **Extractor as separate service**: PDF / DOCX / TXT извлекаются Python-сервисом `extractor-service` (FastAPI + pdfminer.six + python-docx + Pillow). api-service триггерит его fire-and-forget после `POST /api/attachments`; результат пишется в `attachments.extracted_text` / `content_summary`. Размер сырого текста ограничен (`EXTRACTOR_TEXT_LIMIT_CHARS`), summary — отдельным лимитом для контекста LLM.

- **HTML/CSS-слайды**: LLM генерирует полноценный HTML/CSS для каждого слайда (1920×1080). Используется CSS-фреймворк (`slide-framework.css`) для единообразия. Конвертер рендерит HTML через Puppeteer и создаёт PDF + PPTX (скриншоты).

- **n8n как оркестратор**: Логика пайплайна реализована в n8n workflow, не в коде. Workflow хранится в `n8n-workflows/presentator-pipeline.json` и устроен как Switch по полю `body.stage`. Каждый этап (planning / design / layout / refine_layout) — изолированный набор из 4 нод (Build Prompt → LLM → Parse → Save Step). При обновлении — реимпорт через UI n8n.

- **Секреты через webhook payload**: n8n v2+ ограничивает `$env`. API передаёт секреты в теле webhook как `_secrets`. Workflow читает их через `$json.body._secrets`.

- **Shared volume `/data`**: Загрузки → `/data/uploads/{job_id}/`, результаты → `/data/results/{job_id}/presentation.{pdf,pptx}`. Volume `shared_data` подключён к `api-service`, `n8n`, `converter-service`.

- **Iframe-превью**: `SlidePreview.vue` загружает CSS-фреймворк с `/converter/framework.css` и рендерит слайды в `<iframe srcdoc>` с масштабированием через `ResizeObserver`.

- **Системные промты (v2)**: 4 ключа в `presentator.settings`. Дефолты — в `api-service/src/utils/promptDefaults.js`, отдаются API при первом запросе и могут быть переопределены через `/api/settings/prompts/:key`. К промту этапа `layout` n8n добавляет блок ATTACHMENT_RULES (правила работы с `{{attachment:<ref>}}`). Per-job override (поле `jobs.system_prompt`) применяется только к `layout` для совместимости с legacy UI.

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

- **Качество финальной презентации — основная нерешённая проблема**: после прогона мая 2026 пользователь отметил, что дизайн «кривой и некрасивый», текст местами не читается (контраст/размер/наложение), изображения скомпонованы неправильно (пропорции, конфликт с текстом), содержание слабое. Технически пайплайн работает (данные доходят до LLM, метрики/снапшоты пишутся) — проблема в качестве промтов / модели / CSS-фреймворка / converter-сервиса. Подробности — в `CHANGES.md`, план фиксов составляется отдельно.
- **Нет регистрации**: Только seed-пользователь
- **JWT в localStorage**: Для production → httpOnly cookie
- **Нет rate limiting**
- **LLM текстовая, не мультимодальная**: Изображения передаются через метаданные + плейсхолдеры `{{attachment:<ref>}}` (см. секцию «Хранилище вложений»). LLM не «видит» картинки, но размещает их в HTML по описаниям пользователя.
- **Один воркер n8n**: Для масштабирования → n8n queue mode
- **PPTX = скриншоты**: Текст в PPTX не редактируемый (растровые изображения)
- **Время генерации**: 3 LLM-вызова в staged pipeline → суммарное время x3 vs. legacy. Состояние видно в UI через степпер; HTTP-таймауты у LLM-нод n8n подняты до 180–240с.
- **Refinement пока только для layout**: режим доработки на текущем этапе ре-генерирует только финальный HTML. Refinement планирования / дизайна планируется как следующий шаг.
- **Document summarization**: на первом этапе extractor подаёт `content_summary = первые 1500 символов`. С итерации quality/attachments пайплайн передаёт в LLM полный `extracted_text` (до 50k chars) через блок `<DOCUMENTS>` в user-message, поэтому `content_summary` теперь используется только как fallback. LLM-summarization — отдельный задел.

### Частые задачи при доработке

- **Изменить CSS-фреймворк слайдов**: `converter-service/src/slide-framework.css`
- **Изменить HTML-шаблон слайдов**: `converter-service/src/slide-template.html`
- **Изменить дефолтные промты**: `api-service/src/utils/promptDefaults.js`
- **Добавить новый этап в пайплайн**: новая ветка в Switch + новая нода Build/Parse/Save в `n8n-workflows/presentator-pipeline.json`; добавить значение в `STAGES` в `api-service/src/services/pipeline.js`; добавить step в `frontend/src/components/pipeline/PipelineStepper.vue`.
- **Изменить workflow n8n**: редактировать в UI n8n, экспортировать в `n8n-workflows/presentator-pipeline.json`
- **Добавить новую таблицу/колонку**: создать SQL-файл в `init-db/` (нумерация: `08-...sql`)
- **Добавить нового extractor**: расширить `extractor-service/app/extract.py` (новый формат → новый dispatch case + тест)
- **Пересобрать сервис**: `docker compose up -d --build <service-name>`

### Папка service-llm

Конфигурация SGR Deep Research Agent — внешний инструмент для подготовки контента. Не часть основного пайплайна. `config.yaml` в `.gitignore`.
