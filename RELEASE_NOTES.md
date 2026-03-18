# Release notes — Design prompt v2

Дата: 2026‑03‑18  
Ветка: `feature/design-prompt-v2` (основана на `feature/prompt-aggregator-llm-logs`)

## Что изменили и зачем

Мы расширили настройки дизайна на фронтенде и переработали сборку промта в n8n так, чтобы LLM получал **структурированный дизайн‑контекст** и меньше скатывался в “белый фон + чёрный текст”.

Ключевая идея: вместо передачи “сырых” `presentationSettings` в промт мы формируем блок **`DESIGN_BRIEF`** и добавляем его в `userMessage` в node **`Build LLM Prompt`**.

## Текущее состояние: как устроен промт

### 1) Структура входных данных дизайна

В `presentationSettings` (payload job) появились вложенные секции:

- `design`:
  - `palette`: 2–5 цветов, каждый с ролью (фон/акценты/бордеры/и т.п.)
  - `styleTags`: теги стиля (multi-select)
  - `customDesignPrompt`: свободный текст
- `textDesign`:
  - `styles`: 2–5 стилей текста с `applyTo` (заголовки/основной/списки/таблицы/и т.п.)

### 2) Как LLM получает контекст

В n8n `Build LLM Prompt`:
- нормализуем `presentationSettings` (учитываем legacy‑поля для обратной совместимости)
- строим строковый блок `DESIGN_BRIEF`:
  - `PresentationDesign` (палитра + теги + кастомный промпт)
  - `TextDesign` (текстовые стили)
  - `Rules` (маппинг ролей в CSS variables, требования к использованию палитры и дизайн‑компонентов)
  - `DesignDataJSON` (нормализованный JSON, reference only)

## Контекст для нового диалога с LLM (для следующих доработок workflow)

Скопируй этот блок и используй как стартовый контекст в новом чате (без истории):

```
Проект Presentator — генерация презентаций через LLM.

Архитектура:
- Frontend (Vue) создаёт job и отправляет prompt + presentationSettings + файлы.
- API Service (Express) сохраняет job и триггерит n8n webhook.
- n8n workflow:
  - Build LLM Prompt: собирает systemPrompt + userMessage + DESIGN_BRIEF и формирует запрос к LLM (chat/completions).
  - Parse LLM Response: ожидает JSON slide_data (theme + slides[]).
  - Converter Service рендерит HTML/CSS слайды в PDF/PPTX.

Формат LLM ответа (строго JSON):
{ "theme": { "css": "...", "fonts": ["..."] }, "slides": [{ "html": "...", "css": "...", "notes": "..." }] }

Фреймворк слайдов:
- контейнер .slide (1920×1080, padding 80px)
- CSS variables: --bg, --bg-alt, --primary, --accent, --text, --text-muted, --font-heading, --font-body и т.д.
- компоненты: .card, .card-bordered, .tag, .accent-line, .divider, .icon-circle, .quote, .code-block и т.п.

Дизайн-контекст сейчас приходит в userMessage в виде DESIGN_BRIEF (палитра 2–5 цветов с ролями, теги стиля, 2–5 текстовых стилей с applyTo). В Rules есть требования “anti-minimalism”: палитра должна быть заметной, на каждом слайде использовать акценты/компоненты.

Задача: предложить новую структуру workflow и/или улучшения prompt building так, чтобы дизайн был выразительным и предсказуемым, а LLM стабильно следовал ролям палитры и текстовым стилям.
```

## Где править

- UI настроек: `frontend/src/components/PresentationSettings.vue`
- Дефолты job: `frontend/src/views/CreateJobView.vue`
- Системный промпт (дефолт): `api-service/src/routes/settings.js`
- Workflow: `n8n-workflows/presentator-pipeline.json` (node `Build LLM Prompt`)

