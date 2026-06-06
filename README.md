AudioMind — Audio Transcribe + LLM Analysis Service

Это сервис, который принимает аудиофайл от авторизованного пользователя, делает транскрипцию через внешний API и затем отправляет текст в LLM для анализа.

На выходе возвращается структурированный JSON с:
- кратким резюме
- темами
- тональностью
- action items

---

Демо

Видео-обзор (до 2 минут):
[ВСТАВЬ ССЫЛКУ НА ВИДЕО]

Пример использования:

# регистрация
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}'

# логин
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}'

# загрузка аудио
curl -X POST http://localhost:3000/jobs \
  -H "Authorization: Bearer <TOKEN>" \
  -F "audio=@./sample.mp3"

# получение результата
curl http://localhost:3000/jobs/<JOB_ID> \
  -H "Authorization: Bearer <TOKEN>"

---

Как запустить

Требования:
- Node.js 18+
- npm 9+
- ffmpeg

Проверка:
ffprobe -version

Установка:

git clone <REPO_URL>
cd audio-saas
npm install
cp .env.example .env

---

.env пример:

DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-key"

TRANSCRIPTION_PROVIDER=groq
TRANSCRIPTION_API_KEY=...

LLM_PROVIDER=openrouter
LLM_API_KEY=...

PORT=3000

---

Запуск:

npx prisma db push
npm run dev

http://localhost:3000

---

API

POST /auth/register
POST /auth/login

{
  "email": "string",
  "password": "string"
}

Ответ:
{
  "token": "jwt"
}

---

POST /jobs
GET /jobs/:id
GET /jobs
POST /jobs/:id/retry
GET /me/usage

---

LLM ответ:

{
  "summary": "2–4 предложения",
  "topics": ["topic1"],
  "sentiment": "positive",
  "action_items": []
}

---

Лимиты

- 30 минут аудио на пользователя
- проверка через ffprobe до обработки
- при превышении — ошибка LIMIT_EXCEEDED

---

Ошибки

{
  "error": "LIMIT_EXCEEDED",
  "message": "You have 3 minutes left"
}

---

Тесты

npm test

Покрытие:
- happy path
- ошибки транскрипции
- невалидный JSON LLM
- лимиты
- изоляция пользователей
- структура отчёта

---

Провайдеры

Groq Whisper:
- быстрый
- бесплатный tier
- совместим с OpenAI API

OpenRouter:
- много моделей
- есть бесплатные
- JSON mode

---

Архитектура

src/
  routes/
  services/
  providers/
  utils/
  middleware/

Pipeline:
upload → ffprobe → transcription → LLM → save → response

---

Как я работал с AI

Использовал ChatGPT / Claude / Cursor для:
- генерации каркаса проекта
- интеграции API
- написания тестов

Сам:
- логика pipeline
- лимиты и безопасность
- финальная архитектура

Ошибка AI:
Retry логика сначала была небезопасной (дубли запросов),
переписал через централизованный withRetry.

---

Что бы улучшил за 4 часа

- WebSocket прогресс
- очередь задач (BullMQ)
- Docker Compose
- UI улучшения
- кеширование LLM