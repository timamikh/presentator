# Handoff: следующий этап (обнуление контекста)

Цель этого файла — чтобы новый чат мог **быстро восстановить контекст** и продолжить работу без «раскопок».

---

## Где мы сейчас (после итерации quality / attachments / drafts)

Система end-to-end работает на staged-пайплайне v2 (Planning → Design → Layout → Render). В этой итерации закрыты все 5 пунктов прошлого бэклога: контент документов теперь корректно доходит до LLM на всех этапах, дефолтные промты переписаны под жёсткие правила работы с этим контентом, чёрновики формы восстанавливают library-attachments, добавлены unit-тесты на pure-helpers фронтенда.

> **Статус по итогам пользовательского прогона**: технически пайплайн работает (генерация проходит до конца, attachments доходят до всех этапов, метрики пишутся, snapshots создаются). НО **пользователь недоволен качеством финальной презентации**: и по содержанию, и по дизайну. Конкретные симптомы:
> - **дизайн «кривой и некрасивый»** (общее впечатление);
> - в местах текст **не читается** (контраст/мелкий шрифт/наложение на фон);
> - **изображения скомпонованы неправильно** (плохие пропорции, неудачное место, конфликт с текстом);
> - **содержание слабое** — несмотря на то, что `<DOCUMENTS>` теперь доходит до LLM на всех этапах.
>
> План диагностики и план фиксов на следующую итерацию будут составлены пользователем в новом чате. Эта итерация решила задачу «данные доходят до LLM», но **не решила задачу «LLM делает из них красивую и читаемую презентацию»**.

### 1. Передача attachments на все этапы (был корневой баг)

Симптом, который мы расследовали: пользователь загружал PDF с **расписанием и списком имён**. Имена попадали в презентацию, расписание LLM **выдумывала**. Диагностика по коду показала, что данные физически терялись минимум в трёх местах:

- `extractor-service` обрезал `content_summary` до 1500 символов.
- n8n `build-planning-prompt` дополнительно обрезал `summary` до **420 символов** (`trim(a.summary, 420)`).
- n8n `build-design-prompt` / `build-layout-prompt` / `build-refine-prompt` **не передавали** `summary` в `user-message` вообще — только `description`.

Что сделано:

- **`api-service/src/services/attachmentPayload.js`** (новый, + tests) — pure-helper `buildAttachmentPayloadFromRows` строит payload-объекты с полями `content` (= `extracted_text` → `content_summary` → `description_snapshot`, в порядке приоритета), `summary`, `description`. Капы: 50k chars per attachment.
- **`api-service/src/services/pipeline.js`** — `loadJobAttachments` теперь тащит `a.extracted_text` и использует helper. На все этапы в `webhookPayload.attachments[*]` уходит полный `content`.
- **`api-service/src/utils/documentsBlock.js`** (новый, + tests) — pure-функции `buildDocumentsBlock(attachments, options)` и `buildAttachmentList(...)`. Это **canonical-источник** алгоритма; n8n-ноды содержат inline-копию того же кода (n8n не может импортировать модули). Если меняешь алгоритм — обновляй обе копии, регресс на это есть в `documentsBlock.test.js`.
- **`n8n-workflows/presentator-pipeline.json`** — все 4 build-`*`-prompt ноды переписаны. Каждый этап получает блок `<DOCUMENTS>` с per-stage cap:
  - planning: `maxCharsPerDoc=8000`, `maxTotalChars=24000` (главный этап для контента — самый большой бюджет);
  - design: `6000 / 18000` (контекст для выбора layout-классов, не для рерайта);
  - layout: `6000 / 18000` (cross-reference имён/чисел);
  - refine: `4000 / 12000` (используется только если пользователь явно просит «вернуть данные из файла»).

### 2. Промты переписаны (вариант B из плана)

Все 4 дефолтных промта в `api-service/src/utils/promptDefaults.js`:

- упоминают блок `<DOCUMENTS>` и описывают, как с ним работать;
- содержат явные DO / DON'T: «не выдумывай», «не обобщай списки/даты/расписания», «копируй таблицы и пункты программы дословно»;
- держат `planning_result` как source of truth для контента на layout-этапе (важно: layout не должен переписывать контент, только верстать).

Каждое правило закреплено инвариантным тестом в `promptDefaults.test.js` (новые тесты: `every default prompt explains how to use the <DOCUMENTS> block`, `planning prompt forbids summarizing structured data away`, `layout prompt must base content strictly on planning_result, not invent`, `every prompt forbids hallucinated facts when documents are provided` и др.). При следующем редактировании промтов эти тесты — guardrail.

### 3. library-attachments в драфтах восстанавливаются

- Новый endpoint **`GET /api/attachments/by-ids?ids=a,b,c`** (batch-lookup по UUID-списку, лимит 100). Парсер `parseIdsParam` живёт в `api-service/src/utils/idsParam.js` (+ tests).
- На фронтенде новый pure-helper **`frontend/src/composables/useDraftAttachments.js`** с двумя функциями: `extractDraftAttachmentIds(draftAttachments)` и `mergeDraftAttachments(rows, draftAttachments)`.
- `CreateJobView.vue → applyDraft()` теперь async: вытаскивает id из черновика, запрашивает `/attachments/by-ids`, мерджит с per-draft описаниями. Attachment'ы, которые были удалены из библиотеки между save и restore, просто пропускаются.

### 4. Фронтенд-тесты на pure-helpers

Логика была размазана по SFC. Вынес её в отдельные модули + покрыл тестами:

- **`frontend/src/utils/formatters.js`** (+ tests): `fmtNum`, `fmtTimestamp`, `STAGE_LABELS` / `stageLabel`, `KIND_BADGE` / `kindBadge`. Frozen-объекты, чтобы случайная мутация в шаблонах не прошла.
- **`frontend/src/utils/metricsChart.js`** (+ tests): `buildByDayChartData`, `buildByStageChartData`, `sortSnapshotsByVersionDesc`, `STAGE_COLORS`.

`MetricsView.vue`, `VersionsPanel.vue`, `DraftsPanel.vue` подключены к этим helper'ам; дубли удалены.

### Полные тесты (статус сейчас)

- **Backend**: 113 unit-tests (`node --test "src/**/*.test.js"`). +27 к прошлой итерации.
- **Converter**: 6 unit-tests.
- **Frontend**: 55 vitest-tests. +31 к прошлой итерации.

---

## Известные проблемы (наблюдения после прогона, без плана решений)

План на следующую итерацию пользователь расписывает в новом чате. Здесь только фиксируем симптомы:

1. **Качество презентации — основная боль.** Несмотря на то, что данные из `<DOCUMENTS>` теперь доходят до LLM на всех этапах, итоговая презентация выглядит «как будто старая плохая модель»: непривлекательный дизайн, проблемы с читаемостью текста (контраст, размер, наложение), плохая компоновка изображений (пропорции, конфликт с текстом). Это не сетевой баг и не баг канала передачи — это вопрос качества промтов / модели / CSS-фреймворка / converter-сервиса.
2. **Runtime-прогон через `docker compose` подтвердил**, что технически данные доходят: `<DOCUMENTS>` присутствует в `raw_request` planning/design/layout (можно посмотреть на `/metrics`), `llm_call_logs` заполняются, snapshots создаются, refine отрабатывает. Все правки этой итерации работают как задумано.
3. **Бюджет токенов**: при больших документах `<DOCUMENTS>`-блок на planning может занять до 24000 chars (~ 6k токенов) + JSON.stringify входов. Если упрётся в `max_tokens` — в `raw_response` появится `finish_reason=length`. Лимит правится в `n8n-workflows/presentator-pipeline.json` (ноды `llm-planning` / `llm-design` / `llm-layout` / `llm-refine`); сейчас 2000/3500/6000/3000 соответственно.
4. **SFC-тесты на render-логику отсутствуют** (есть только pure-helpers). Не критично — рендер тонкий.

---

## Обязательные команды для продолжения работы

### 1) Запуск стека

```bash
docker compose up -d --build
docker compose ps
```

### 2) Применение SQL миграций (для уже запущенной БД)

В этой итерации новых init-db/`*.sql` файлов **нет**. Изменения только в коде сервисов + n8n workflow + extracted_text забирается из существующей колонки `attachments.extracted_text`.

Если стек ставится с нуля — миграции 11-13 из прошлой итерации идут штатно.

### 3) Реимпорт n8n workflow (ОБЯЗАТЕЛЬНО)

Все 4 build-`*`-prompt ноды переписаны:

```bash
docker compose cp n8n-workflows/presentator-pipeline.json n8n:/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n import:workflow --input=/tmp/presentator-pipeline.json
docker compose exec -T n8n n8n update:workflow --id=pres002 --active=true
docker compose restart n8n
```

Проверить, что активен ровно один workflow:

```bash
docker compose exec -T postgres psql -U presentator -d presentator -c \
  "SELECT id, name, active FROM n8n.workflow_entity WHERE active=true;"
```

### 4) Прогон тестов

```bash
cd api-service && node --test "src/**/*.test.js"   # 113 tests
cd converter-service && node --test "src/**/*.test.js"  # 6 tests
cd frontend && npx vitest run                       # 55 tests
```

---

## Smoke-тест итерации — что подтверждено / не подтверждено

После runtime-прогона пользователем:

- ✅ Pipeline проходит до конца (planning → design → layout → render → done).
- ✅ `<DOCUMENTS>` блок виден в `raw_request` для всех этапов (через `/metrics` → последний вызов → клик «открыть»).
- ✅ `llm_call_logs` заполняется, метрики `/metrics` показывают вызовы.
- ✅ Snapshots создаются после каждого этапа, ручной snapshot / restore работают.
- ✅ Refine применяется к слайдам и не «эхает» вход.
- ✅ Черновики формы `/create` корректно восстанавливают library-attachments (через `applyDraft()` → `GET /api/attachments/by-ids`).
- ❌ **Качество финальной презентации НЕ принято пользователем**: дизайн «кривой и некрасивый», текст местами не читается, изображения скомпонованы неправильно. План фиксов будет составлен в новом чате.

---

## Ключевые файлы (точки правды)

### Pipeline
- **Staged pipeline guard + webhook trigger**: `api-service/src/services/pipeline.js`
- **Attachment payload builder** (новое): `api-service/src/services/attachmentPayload.js` (+ tests)
- **`<DOCUMENTS>` block builder** (новое): `api-service/src/utils/documentsBlock.js` (+ tests) — canonical-источник алгоритма, копия inline в n8n
- **Transition rules**: `api-service/src/services/pipelineStages.js`
- **Sweeper**: `api-service/src/services/staleJobSweeper.js`
- **Default prompts**: `api-service/src/utils/promptDefaults.js` (+ tests с инвариантами `<DOCUMENTS>` / no-hallucinations / no-summarization)
- **Workflow orchestration**: `n8n-workflows/presentator-pipeline.json` — все 4 build-`*`-prompt ноды переписаны под `<DOCUMENTS>`

### Observability и версионирование (прошлая итерация, без изменений)
- **Local tokenizer**: `api-service/src/utils/tokenizer.js` (+ tests)
- **LLM call logger**: `api-service/src/services/llmLogger.js` (+ tests, регрессия на `ON CONFLICT … WHERE step_id IS NOT NULL`)
- **Snapshots**: `api-service/src/services/snapshots.js` (+ tests) → `routes/snapshots.js`
- **Drafts**: `api-service/src/services/drafts.js` (+ tests) → `routes/drafts.js`
- **Metrics**: `api-service/src/services/metrics.js` (+ tests) → `routes/metrics.js`

### Drafts attachments fix
- **Backend batch-lookup**: `GET /api/attachments/by-ids` в `api-service/src/routes/attachments.js` + `api-service/src/utils/idsParam.js` (+ tests)
- **Frontend re-hydration**: `frontend/src/composables/useDraftAttachments.js` (+ tests)
- **Wiring**: `frontend/src/views/CreateJobView.vue` → `applyDraft()`

### Frontend formatting helpers (новое)
- `frontend/src/utils/formatters.js` (+ tests): `fmtNum`, `fmtTimestamp`, `stageLabel`, `kindBadge`, `STAGE_LABELS`, `KIND_BADGE`
- `frontend/src/utils/metricsChart.js` (+ tests): `buildByDayChartData`, `buildByStageChartData`, `sortSnapshotsByVersionDesc`, `STAGE_COLORS`
- Подключено в: `MetricsView.vue`, `VersionsPanel.vue`, `DraftsPanel.vue` (дубли удалены)
