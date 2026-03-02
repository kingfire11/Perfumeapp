# ParfumeBot — Telegram MiniApp для учёта продаж масляных духов

Готовый проект для малого бизнеса: учёт точек, поставок, продаж, расходов и финансовая аналитика в Telegram MiniApp.

## Стек

- Backend: Node.js + Express + Prisma + PostgreSQL + JWT + Telegraf
- Frontend: React + Vite + TailwindCSS + Recharts
- Интеграции: Telegram Bot API + Telegram WebApp SDK
- Deploy: Railway

## Что реализовано

- Telegram auth (`/auth/telegram`) + JWT + роли (`OWNER`, `MANAGER`, `EMPLOYEE`)
- Сущности: пользователи, точки, продукты, партии/себестоимость, остатки, поставки, продажи, инкассации, расходы, логи
- Единый формат ошибок API: `ok=false` + `error.{code,message,details}`
- Валидация входящих данных через `zod` на mutation endpoint'ах
- Защита от дублей одинаковых POST-запросов в окне `DEDUPE_WINDOW_MS`
- Комиссия точки: процент или фиксированная
- Авторасчёты:
  - `unitCost = (oil + base + bottle + packaging + other) / yieldedBottles`
  - `grossProfit = saleAmount - pointCommission`
  - `netProfit = grossProfit - unitCost * quantitySold`
- Аналитика: дашборд, прибыль по точкам/ароматам, ABC-анализ, ROI, динамика маржи
- Уведомления (cron): низкий остаток + задолженность точек
- Экспорт: PDF (`/exports/pdf`) и Excel (`/exports/excel`)
- Excel импорт продаж: `/sales/upload-excel` (form-data `file`)

## Структура

- `backend` — API, Telegram bot, расчёты, Prisma
- `miniapp` — мобильный интерфейс MiniApp
- `docs/schema.sql` — SQL схема
- `docs/deploy-railway.md` — инструкция деплоя

## Локальный запуск

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Backend по умолчанию: `http://localhost:3000`

### 2) MiniApp

```bash
cd miniapp
cp .env.example .env
npm install
npm run dev
```

Frontend по умолчанию: `http://localhost:5173`

## Важно для локальной разработки

Для теста вне Telegram включён dev-bypass:

- `backend/.env` → `TELEGRAM_AUTH_BYPASS=true`
- Frontend отправляет `initData='dev'`, если Telegram WebApp недоступен

В production обязательно:

- `TELEGRAM_AUTH_BYPASS=false`
- Использовать только валидный `initData` от Telegram

## Надёжность форм и запросов

- Frontend валидирует все операционные формы до отправки (числа, даты, обязательные поля)
- Backend валидирует тело запросов через `zod`
- Повторная отправка одинакового POST (например двойной клик) блокируется с кодом `DUPLICATE_REQUEST`

## Основные API endpoints

- Auth: `POST /auth/telegram`, `GET /me`
- Точки: `GET /points`, `POST /points`, `GET /points/:id/stats`
- Продукты: `GET /products`, `POST /products`
- Производство: `GET /production/batches`, `POST /production/batches`
- Склад: `GET /inventory`
- Поставки: `GET /supplies`, `POST /supplies`
- Продажи: `GET /sales`, `POST /sales`, `POST /sales/upload-excel`
- Инкассации: `GET /cash-collections`, `POST /cash-collections`, `GET /cash-collections/debts`
- Расходы: `GET /expenses`, `POST /expenses`
- Аналитика: `GET /analytics/dashboard`, `GET /analytics/points`, `GET /analytics/products`, `GET /analytics/margin-dynamics`
- Экспорт: `GET /exports/excel`, `GET /exports/pdf`

## Масштабирование

Текущая архитектура рассчитана на:

- до 100 точек
- до 10 000 продаж/месяц
- несколько пользователей с ролями

Для дальнейшего роста рекомендуются:

- индексы по `point_id`, `product_id`, `date`
- кэширование агрегатов (Redis)
- вынос cron-задач в отдельный worker
