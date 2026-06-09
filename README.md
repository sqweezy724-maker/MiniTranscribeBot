# AudioMind — Audio Transcribe + LLM Analysis Service

Это сервис, который принимает аудиофайл от авторизованного пользователя, делает транскрипцию через внешний API и затем отправляет текст в LLM для анализа.

На выходе возвращается структурированный JSON с:

- кратким резюме
- темами
- тональностью
- action items

---

## Демо

Видео-обзор: (https://youtu.be/MCEFkBdhIhI)

Пример использования:

```bash
# регистрация
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'

# логин
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'

# загрузка аудио
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer <TOKEN>" \
  -F "audio=@./sample.mp3"

# получение результата
curl http://localhost:3000/jobs/<JOB_ID> \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Как запустить

Требования:

- Node.js 18+
- npm 9+
- ffmpeg

Проверка:

```bash
ffprobe -version
```

Установка:

```bash
git clone <REPO_URL>
cd audio-saas
npm install
cp .env.example .env
```

---

`.env` пример:

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key"
TRANSCRIPTION_PROVIDER=groq
TRANSCRIPTION_API_KEY=...
LLM_PROVIDER=openrouter
LLM_API_KEY=...
PORT=3000
```

---

Запуск:

```bash
npx prisma db push
npm run dev
# → http://localhost:3000
```

---

## API

```
POST /auth/register
POST /auth/login
```

```json
{ "email": "string", "password": "string" }
```

Ответ:

```json
{ "token": "jwt" }
```

---

```
POST   /jobs
GET    /jobs/:id
GET    /jobs
POST   /jobs/:id/retry
GET    /me/usage
```

---

LLM ответ:

```json
{
  "summary": "2–4 предложения",
  "topics": ["topic1"],
  "sentiment": "positive",
  "action_items": []
}
```

---

## Лимиты

- 30 минут аудио на пользователя
- проверка через ffprobe до обработки
- лимит считается по завершённым job'ам — спам загрузок не обходит ограничение
- при превышении — ошибка `LIMIT_EXCEEDED`

---

## Ошибки

```json
{ "error": "LIMIT_EXCEEDED", "message": "You have 3.0 minutes left." }
```

Все ошибки возвращаются в одном формате: `{ "error": "КОД", "message": "..." }`

| Код | HTTP | Описание |
|---|---|---|
| `LIMIT_EXCEEDED` | 400 | Превышен лимит 30 минут |
| `FILE_INVALID` | 400 | Неверный формат или повреждённый файл |
| `FILE_MISSING` | 410 | Файл удалён с диска (при retry) |
| `UNAUTHORIZED` | 401 | Нет или неверный токен |
| `FORBIDDEN` | 403 | Чужой job |
| `NOT_FOUND` | 404 | Job не существует |
| `INVALID_STATE` | 400 | Нельзя повторить не упавший job |

---

## Тесты

```bash
npm test
```

Все 68 тестов запускаются **без интернета и без API-ключей** — внешние вызовы замокированы.

Покрытие:

- happy path
- ошибки транскрипции
- невалидный JSON от LLM
- лимиты
- изоляция пользователей
- структура отчёта

---

## Провайдеры

**Groq Whisper** (`whisper-large-v3-turbo`):

- быстрый (~2–5 сек на минуту аудио)
- бесплатный tier
- совместим с OpenAI API

**OpenRouter** (`meta-llama/llama-3.3-70b-instruct`):

- много моделей, один ключ
- есть бесплатные модели
- JSON mode — гарантирует валидный JSON

У обоих провайдеров: таймаут 30 сек и 1 автоматический retry при сбое.

---

## Архитектура

```
src/
  routes/
  services/
  providers/
  utils/
  middleware/
```

Pipeline:

```
upload → ffprobe → transcription → LLM → save → response
```

---

## Как я работал с AI

Использовал ChatGPT / Claude / Cursor для:

- генерации каркаса проекта
- интеграции API
- написания тестов

Сам:

- логика pipeline
- лимиты и безопасность
- финальная архитектура

**Ошибка AI:**
Retry логика сначала была небезопасной — при спаме загрузок несколько запросов одновременно проходили проверку лимита, потому что читали устаревший счётчик. Переписал: лимит теперь считается агрегацией по реально завершённым job'ам из БД, а retry вынесен в централизованный `withRetry`.

---

## Что бы улучшил за 4 часа

- WebSocket прогресс (вместо polling)
- очередь задач (BullMQ) — job не теряется при рестарте сервера
- Docker Compose
- UI улучшения
- кеширование LLM для одинаковых транскриптов
