# Handoff: следующий этап (обнуление контекста)

Цель этого файла — чтобы новый чат мог **быстро восстановить контекст** и продолжить работу без «раскопок».

---

## Где мы сейчас (после итерации observability + версионирование)

Система end-to-end работает на staged-пайплайне v2 (Planning → Design → Layout → Render) с точками остановки на ревью. Поверх этого в текущей итерации добавлены три независимых слоя.

> **Hotfix (после первого пользовательского прогона)**: фикс одной строки в `services/llmLogger.js` — INSERT теперь корректно использует partial unique index. До фикса каждая запись падала с `there is no unique or exclusion constraint matching the ON CONFLICT specification`, что молча проглатывалось `try/catch` и оставляло `llm_call_logs` пустой → страница `/metrics` оставалась пустой даже после успешных генераций. После hotfix новые генерации заполняют таблицу, см. п.1 «Известные проблемы» ниже про verify-шаг.

### 1. Сырое хранилище LLM-вызовов и подсчёт токенов

- Новая таблица `presentator.llm_call_logs` (init-db/11-llm-call-logs.sql) хранит каждый LLM-вызов одной строкой: `raw_request`, `raw_response`, `system_prompt`, `user_message`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `tokens_source`, `model`, `provider`, `latency_ms`, `finish_reason`, `error_message`.
- Подсчёт токенов локальный (cl100k_base через `gpt-tokenizer`) — не доверяем `usage` от gateway, который у нас отдаёт 0 для некоторых моделей. Реализация: `api-service/src/utils/tokenizer.js` (+ tests). Если провайдер всё-таки возвращает достоверный `usage` — выбирается через `mergeUsage` (`provider` / `estimated` / `mixed`).
- Запись из `pipeline.completeStage` идёт через `services/llmLogger.js`, идемпотентно по `step_id` (UPSERT ON CONFLICT) — n8n-ретраи не дублируют записи.
- n8n workflow расширен: Build-* ноды теперь пишут `requestStartedAt = Date.now()`; Parse-* ноды добавляют `model`, `provider`, `latencyMs` в выход; Save-* ноды передают эти поля в callback `PATCH /api/jobs/internal/:id/steps/:stage`.

### 2. Страница метрик `/metrics`

- REST: `GET /api/metrics/{summary,by-stage,by-day,by-model,recent-calls,calls/:id}` с фильтром `?days=N` (clamped 1..365). Реализация: `services/metrics.js` + `routes/metrics.js`.
- UI: `frontend/src/views/MetricsView.vue` — карточки summary, гистограмма «Токены по дням» (stacked: prompt / completion), пирог «Токены по этапам», таблицы по этапам/моделям, лента последних 50 вызовов. Чарты: `chart.js` + `vue-chartjs`.
- Меню навигации (`App.vue`) дополнено пунктом «Метрики».

### 3. Версионирование задач и черновики формы создания

- **`presentator.job_snapshots`** (init-db/12-job-snapshots.sql): полные снимки задачи на момент окончания каждого этапа. Auto-snapshot пишется в `pipeline.completeStage` после успешного этапа, manual — через `POST /api/jobs/:id/snapshots`. Откат: `POST /api/jobs/:id/snapshots/:version/restore` (история линейная, после отката пишется snapshot с `kind='restore'`). Реализация: `services/snapshots.js` (с unit-tests на pure-helpers и fake-`query`).
- **`presentator.job_drafts` + `job_draft_versions`** (init-db/13-job-drafts.sql): черновики формы `/create` со своей версионной историей. CRUD через `services/drafts.js` + `routes/drafts.js`. Файлы (one-shot uploads) в драфты не входят; library-attachments сохраняются по `attachmentId`.
- UI: `components/VersionsPanel.vue` встроена в `JobStatusView` (для задач). `components/DraftsPanel.vue` встроена в `CreateJobView` (для формы).

### Полные тесты

- Backend: 86 unit-tests (node --test). Покрытие: tokenizer, llmLogger, snapshots, drafts, metrics + старые тесты pipeline / staleJobSweeper / промтов / utils.
- Frontend: 24 vitest unit-tests.

---

## Известные проблемы (на следующую итерацию)

### 1) Verify: метрики после hotfix

Симптом до фикса: страница `/metrics` отображается, но пуста, хотя задачи генерируются. Причина — `INSERT ... ON CONFLICT (step_id) DO UPDATE` без повтора предиката `WHERE step_id IS NOT NULL` отбрасывался Postgres'ом (partial unique index требует exact-match предиката). Все ошибки были не-фатальными → таблица `llm_call_logs` оставалась пустой, snapshots при этом писались, поэтому регрессия была не очевидной до тестового прогона.

Что сделано: исправлен SQL в `services/llmLogger.js`, добавлена регрессионная проверка в `llmLogger.test.js`, что в `INSERT` присутствует `ON CONFLICT (step_id) WHERE step_id IS NOT NULL`.

Что осталось проверить в новой итерации:
- После повторной генерации (3 слайда, пайплайн v2 целиком до `done`) убедиться, что в БД:
  ```sql
  SELECT stage, model, total_tokens, latency_ms, length(raw_response::text)
    FROM presentator.llm_call_logs
   ORDER BY created_at DESC LIMIT 10;
  ```
  есть как минимум 3 строки (planning / design / layout), у каждой `total_tokens > 0`, `raw_response` не NULL.
- В UI на `/metrics` карточки и графики заполнились.
- В таблице «Последние вызовы» по клику открывается detail с `raw_request` / `raw_response`.

### 2) Вложения: расследовать прохождение `content_summary` и file-данных через все этапы

Симптом (репорт пользователя): в загруженном файле было **расписание мероприятия + имена**. В итоге **имена попали в презентацию, расписание LLM придумала** — то есть данные физически были, но использовались выборочно.

Гипотезы (по убыванию вероятности):
1. **`content_summary` обрезается на 1500 символов** в `extractor-service` (`extractor-service/src/services/processor.py`, см. `summary = text[:1500]`). Имена могут оказаться в первых 1500 символах, а расписание — дальше. **Проверить**: достать `presentator.attachments.content_summary` для конкретного job и сравнить с исходным файлом.
2. **`content_summary` подставляется только в Stage 1 (Planning) промт.** На этапах Design / Layout / Refine attachment-текст может вообще не передаваться, либо передаётся в усечённой форме (например только title + ref). **Проверить**: в `n8n-workflows/presentator-pipeline.json` ноды `build-design-prompt` / `build-layout-prompt` — что именно они кладут из `attachments` в `user` сообщение LLM. Сравнить с `build-planning-prompt`.
3. **На Layout-этапе attachment-плейсхолдеры `{{attachment:<ref>}}` работают только для картинок**, текст из документов туда не передаётся целиком. Если расписание было в `.pdf`/`.docx`, оно должно было прийти ещё в Planning как `content_summary` — но если шаблон планнинга не указывает «обязательно сохранить структурированные данные», LLM может его сжимать в обобщения вида «была программа мероприятия».

План диагностики (теперь с рабочим логированием):
- (a) Воспроизвести с тем же файлом-расписанием.
- (b) В `/metrics` открыть `raw_request` для planning-этапа → найти, попал ли туда расписание (текстовый поиск по дате/ключевому слову из файла).
- (c) То же для design / layout — посмотреть, передаются ли они вообще.
- (d) В зависимости от результата либо увеличить лимит `content_summary`, либо в `build-*-prompt` нодах добавить полный текст из `attachments[*].content_summary` на всех этапах, либо в Planning-промт добавить инструкцию «сохрани все списки, даты, расписания без обобщений».

### 3) Качество генерации: пересмотреть системные промты на всех этапах

Симптом (репорт пользователя): «презентация выглядит слабо, как будто старая плохая модель». Модель при этом в `OPENROUTER_MODEL` современная — значит, проблема в промтах, а не в gateway.

Объекты ревью (точки правды для промтов):
- **Planning prompt** — `api-service/src/utils/promptDefaults.js` → `DEFAULT_PROMPT_TEMPLATES.planning_system` + пользовательский шаблон через `/api/prompts` (если задан).
- **Design prompt** — там же, `design_system`.
- **Layout prompt** — там же, `layout_system`.
- **Refine prompt** — там же, `refine_system` (плюс уточнения в n8n-ноде `build-refine-prompt`).

Что нужно сделать:
1. Прочитать каждый системный промт глазами и оценить по чек-листу: чёткая роль / контекст / inputs-schema / output-schema (JSON) / явные DO/DON'T / 1-2 негативных примера / запрет на «воду» и общие фразы / требование использовать **все** предоставленные данные (см. п.2).
2. Скорректировать в `promptDefaults.js` (TDD: `promptDefaults.test.js` обновить snapshot-проверки).
3. Прогнать end-to-end и сравнить с предыдущим запуском по тем же входным данным (теперь это просто — есть `llm_call_logs` + snapshots).
4. По итогам зафиксировать «эталонные» промты как defaults; пользователю остаётся override через `/api/prompts`.

### 4) library-attachments не восстанавливаются из черновика (остаётся)

Симптом: при загрузке драфта `applyDraft()` сбрасывает `libraryAttachments` (нет повторного fetch full-rows из библиотеки).

Решение: либо хранить полные row-данные в `attachments`-payload черновика (увеличивает размер), либо делать batch-фетч по `attachmentId[]`. Пока ручной шаг: «перевыбрать вложения».

### 5) Frontend: нет тестов для VersionsPanel / DraftsPanel / MetricsView (остаётся)

Логика преимущественно отображает API-ответы; имеет смысл добавить unit-тесты на pure-helpers (форматирование дат / агрегация byDay).

---

## Обязательные команды для продолжения работы

### 1) Запуск стека

```bash
docker compose up -d --build
docker compose ps
```

### 2) Применение новых SQL миграций (для уже запущенной БД)

```bash
# 11-13 — новые миграции этой итерации
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/11-llm-call-logs.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/12-job-snapshots.sql
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < init-db/13-job-drafts.sql
```

Dev-вариант — полностью пересоздать БД:

```bash
docker compose down -v && docker compose up -d --build
```

### 3) Реимпорт n8n workflow

Workflow был отредактирован (Build-* / Parse-* / Save-* ноды + refine-prompt + soft-check echo). Реимпорт обязателен:

```bash
docker compose cp n8n-workflows/presentator-pipeline.json n8n:/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n update:workflow --id=pres002 --active=true
docker compose restart n8n
```

Проверка, что **активен только один** workflow на webhook:

```bash
docker compose exec -T postgres psql -U presentator -d presentator -c \
  "SELECT id, name, active FROM n8n.workflow_entity WHERE active=true;"
```

### 4) Прогон тестов

```bash
cd api-service && node --test "src/**/*.test.js"   # 86 tests
cd converter-service && node --test "src/**/*.test.js"
cd frontend && npx vitest run                       # 24 tests
```

---

## Быстрый smoke-тест пайплайна (ручной)

1) Создать job (pipeline v2) с 3 слайдами и любым промтом.
2) Дождаться `awaiting_planning_review`, убедиться что `planning_result` осмысленный.
3) В `/metrics` появилась одна запись `planning`.
4) Подтвердить design, дождаться `awaiting_design_review`. На `/jobs/:id` в «История версий» появилось 2 snapshot.
5) Запустить layout, дождаться `done` и скачать pdf/pptx. В `/metrics` 3 записи (planning/design/layout) с токенами.
6) Создать snapshot вручную («Сохранить версию» в VersionsPanel) — появилась запись `kind=manual`.
7) Запустить refinement с явной инструкцией («сделай все заголовки красными»). Посмотреть `raw_response` для шага `refine_layout` в `/metrics` → таблица «Последние вызовы» → клик «открыть». Если LLM реально вернул изменения, проверить, что в БД они применились; иначе на основе данных править prompt/parser.
8) Откатить задачу к v2 (manual snapshot) — задача вернулась в предыдущее состояние.

---

## Ключевые файлы (точки правды)

### Pipeline
- **Staged pipeline guard + webhook trigger**: `api-service/src/services/pipeline.js`
- **Transition rules**: `api-service/src/services/pipelineStages.js`
- **Sweeper**: `api-service/src/services/staleJobSweeper.js`
- **Default prompts**: `api-service/src/utils/promptDefaults.js`
- **Workflow orchestration**: `n8n-workflows/presentator-pipeline.json`

### Observability и версионирование (новое в этой итерации)
- **Local tokenizer**: `api-service/src/utils/tokenizer.js` (+ tests)
- **LLM call logger**: `api-service/src/services/llmLogger.js` (+ tests)
- **Snapshots**: `api-service/src/services/snapshots.js` (+ tests) → `routes/snapshots.js`
- **Drafts**: `api-service/src/services/drafts.js` (+ tests) → `routes/drafts.js`
- **Metrics**: `api-service/src/services/metrics.js` (+ tests) → `routes/metrics.js`
- **Migrations**: `init-db/11-llm-call-logs.sql`, `12-job-snapshots.sql`, `13-job-drafts.sql`

### Frontend
- **Metrics dashboard**: `frontend/src/views/MetricsView.vue` (chart.js + vue-chartjs)
- **Job versions panel**: `frontend/src/components/VersionsPanel.vue` (на `JobStatusView`)
- **Drafts panel**: `frontend/src/components/DraftsPanel.vue` (на `CreateJobView`)
- **Router/menu**: `frontend/src/router.js`, `frontend/src/App.vue`
