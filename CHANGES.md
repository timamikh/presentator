# Handoff: следующий этап (обнуление контекста)

Цель этого файла — чтобы новый чат мог **быстро восстановить контекст** и продолжить работу без «раскопок».

---

## Где мы сейчас (после итерации стабилизации pipeline v2)

Система в целом работает end‑to‑end:

- **Pipeline v2 (staged)**: Planning → Design → Layout → Render, с остановками на ревью:
  - `awaiting_planning_review`
  - `awaiting_design_review`
- **История попыток** и вход/выход каждого этапа пишутся в `presentator.job_pipeline_steps`.
- **Extractor-service** реализован: документы (`kind=document`) извлекаются асинхронно, `content_summary` попадает в LLM‑контекст; для изображений фиксируются `width/height`.
- **Плейсхолдеры изображений** `{{attachment:<ref>}}` работают сквозняком (API ↔ frontend ↔ converter), без base64.

### Что было сломано и исправлено

1) **Переход стадий** (409 `Stage design not allowed...`)
- Исправлено: guard переходов теперь основан на `jobs.status` (источник истины), а не на `current_stage` (UI‑подсветка).
- Разрешён retry после `status='error'` для `design` и `layout` (без ручного вмешательства в БД).

2) **Зависания в `processing_*`**
- Sweeper покрывает все `processing_*` статусы и переводит `job_pipeline_steps.status='running'` в `error` с понятным сообщением.
- Логика sweeper вынесена в отдельный модуль (unit‑tests).

3) **БД: `jobs.status VARCHAR(20)`**
- Для свежей инициализации БД `init-db/09-pipeline-stages.sql` расширяет `jobs.status` до `VARCHAR(40)` до установки нового CHECK.

4) **Reasoning / невалидный JSON от LLM**
- В workflow добавлены:
  - `response_format: { type: 'json_object' }`
  - `chat_template_kwargs.enable_thinking=false` (и дублирование через `extra_body`, чтобы переживать разные gateway‑реализации)
  - robust JSON‑extractor (balanced brackets) без эвристики «искать скобку возле slides» (ломало design, где `theme` идёт первым).
- Ошибки `finish_reason=length/abort` диагностируются явно.

---

## Известные проблемы (на следующую итерацию)

### 1) Refinement не меняет результат

Симптом: пользователь проходит все этапы, запускает «Доработать», но итог не меняется.

Гипотезы:
- stage `refine_layout` корректно стартует, но LLM‑ответ не применяется/не проходит валидацию;
- refine‑prompt недостаточно строгий (нет проверки «изменения действительно внесены»);
- UI/бек не передают `refinePrompt`/`slideIndex` как ожидается.

На следующем этапе: воспроизвести, собрать `job_pipeline_steps` по `refine_layout`, добавить минимальный e2e‑smoke тест refinement.

---

## Обязательные команды для продолжения работы

### 1) Запуск стека

```bash
docker compose up -d --build
docker compose ps
```

### 2) Реимпорт n8n workflow (CLI, без UI)

Важно: после каждого изменения `n8n-workflows/presentator-pipeline.json`.

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

### 3) Прогон тестов

```bash
cd api-service && node --test "src/**/*.test.js"
cd converter-service && node --test "src/**/*.test.js"
cd frontend && npx vitest run
```

---

## Быстрый smoke-тест пайплайна (ручной)

1) Создать job (pipeline v2) с 3 слайдами и любым промптом.
2) Дождаться `awaiting_planning_review`, убедиться что `planning_result` осмысленный.
3) Запустить design, дождаться `awaiting_design_review`, убедиться что `design_brief.theme + slides[]` заполнены.
4) Запустить layout, дождаться `done` и скачать pdf/pptx.

---

## Ключевые файлы (точки правды)

- **Staged pipeline guard + webhook trigger**: `api-service/src/services/pipeline.js`
- **Transition rules**: `api-service/src/services/pipelineStages.js`
- **Sweeper**: `api-service/src/services/staleJobSweeper.js`
- **Default prompts**: `api-service/src/utils/promptDefaults.js`
- **Workflow orchestration**: `n8n-workflows/presentator-pipeline.json`
