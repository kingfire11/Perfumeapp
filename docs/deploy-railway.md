# Deploy на Railway

## Структура

Два сервиса в одном Railway-проекте:
- **backend** — Express API + Prisma + PostgreSQL
- **miniapp** — Vite/React Static SPA

---

## 1) Backend

1. Зайдите на [railway.app](https://railway.app), создайте новый проект → `Add Service → GitHub Repo`.
2. Укажите **Root Directory**: `backend`
3. Файл `backend/railway.json` уже задаёт build/start команды автоматически.
4. Добавьте **PostgreSQL** сервис: `Add Service → Database → PostgreSQL`.  
   `DATABASE_URL` подтянется автоматически через Railway variables.
5. Укажите переменные окружения (Settings → Variables):

| Переменная              | Пример значения                          |
|-------------------------|------------------------------------------|
| `DATABASE_URL`          | *(автоматически от PostgreSQL плагина)*  |
| `JWT_SECRET`            | `any-long-random-string`                 |
| `TELEGRAM_BOT_TOKEN`    | `123456:ABC-DEF...`                      |
| `TELEGRAM_BOT_USERNAME` | `parfumebot`                             |
| `TELEGRAM_WEBAPP_URL`   | `https://your-miniapp.up.railway.app`    |
| `TELEGRAM_AUTH_BYPASS`  | `false`                                  |
| `LOW_STOCK_THRESHOLD`   | `5`                                      |
| `DEDUPE_WINDOW_MS`      | `15000`                                  |

---

## 2) MiniApp

1. В том же проекте: `Add Service → GitHub Repo`, **Root Directory**: `miniapp`
2. Файл `miniapp/railway.json` уже задаёт build/start команды автоматически.
3. Укажите переменные окружения:

| Переменная     | Значение                               |
|----------------|----------------------------------------|
| `VITE_API_URL` | `https://your-backend.up.railway.app`  |

> **Важно**: `VITE_API_URL` нужно задать **до** запуска сборки — Vite вшивает его в бандл при build.

---

## 3) Telegram Bot

1. В `@BotFather` → `Edit Bot → Edit Menu Button → Web App URL` → вставьте URL MiniApp Railway.
2. Убедитесь, что `TELEGRAM_WEBAPP_URL` в переменных backend совпадает с URL MiniApp.

---

## 4) Проверка после деплоя

Railway автоматически выполнит `prisma db push` при старте — схема создастся сама.

```
GET https://your-backend.up.railway.app/
→ { "ok": true }
```

---

## 5) Резервные копии БД

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%F).sql
```

Рекомендуется хранить в S3 / Google Drive.
