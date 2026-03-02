import 'dotenv/config';
import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { PrismaClient, CommissionType, ExpenseCategory, UserRole } from '@prisma/client';
import { Telegraf, Markup } from 'telegraf';
import cron from 'node-cron';
import multer from 'multer';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z, ZodError } from 'zod';

const prisma = new PrismaClient();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_WEBAPP_URL = process.env.TELEGRAM_WEBAPP_URL || '';
const TG_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'parfumebot';
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);
const DEDUPE_WINDOW_MS = Number(process.env.DEDUPE_WINDOW_MS || 15000);

app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

type JwtPayload = {
  userId: number;
  telegramId: string;
  role: UserRole;
};

type AuthRequest = Request & { user?: JwtPayload };

class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const recentRequests = new Map<string, number>();

function validate<T>(schema: z.ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ApiError(422, 'VALIDATION_ERROR', 'Некорректные данные запроса', parsed.error.flatten()));
    }
    req.body = parsed.data;
    next();
  };
}

function dedupeRequest(req: AuthRequest, _res: Response, next: NextFunction) {
  const actor = req.user?.userId || req.ip || 'anonymous';
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const key = `${req.method}:${req.path}:${actor}:${bodyHash}`;
  const now = Date.now();
  const last = recentRequests.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) {
    return next(new ApiError(409, 'DUPLICATE_REQUEST', 'Повторная отправка той же операции заблокирована'));
  }
  recentRequests.set(key, now);
  next();
}

const authSchema = z.object({
  initData: z.string().min(1),
  role: z.nativeEnum(UserRole).optional(),
});

const pointSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(3),
  commissionType: z.nativeEnum(CommissionType),
  commissionValue: z.coerce.number().nonnegative(),
  bottleSalePrice: z.coerce.number().positive(),
  isActive: z.boolean().optional(),
});

const productSchema = z.object({
  aromaName: z.string().min(2),
  volumeMl: z.coerce.number().int().positive(),
  isActive: z.boolean().optional(),
});

const batchSchema = z.object({
  oilMl: z.coerce.number().positive(),
  baseMl: z.coerce.number().positive(),
  oilPrice: z.coerce.number().nonnegative(),
  basePrice: z.coerce.number().nonnegative(),
  bottlePrice: z.coerce.number().nonnegative(),
  packagingPrice: z.coerce.number().nonnegative(),
  otherCosts: z.coerce.number().nonnegative().optional(),
  yieldedBottles: z.coerce.number().int().positive(),
});

const supplySchema = z.object({
  pointId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  date: z.string().optional(),
  comment: z.string().max(500).optional(),
});

const saleSchema = z.object({
  pointId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
  quantitySold: z.coerce.number().int().positive(),
  date: z.string().optional(),
});

const collectionSchema = z.object({
  pointId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  date: z.string().optional(),
  period: z.string().min(3),
  comment: z.string().max(500).optional(),
});

const expenseSchema = z.object({
  category: z.nativeEnum(ExpenseCategory),
  amount: z.coerce.number().positive(),
  date: z.string().optional(),
  comment: z.string().max(500).optional(),
});

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) return Number(String(value));
  return 0;
}

function startOfMonth(input = new Date()) {
  return new Date(input.getFullYear(), input.getMonth(), 1);
}

function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next(new ApiError(401, 'UNAUTHORIZED', 'Токен не передан'));

  try {
    req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    next();
  } catch {
    return next(new ApiError(401, 'UNAUTHORIZED', 'Некорректный токен'));
  }
}

function allowRoles(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'UNAUTHORIZED', 'Пользователь не авторизован'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', 'Недостаточно прав'));
    next();
  };
}

async function logAction(req: AuthRequest, action: string, entity: string, entityId?: string, payload?: unknown) {
  await prisma.actionLog.create({
    data: {
      userId: req.user?.userId,
      action,
      entity,
      entityId,
      payload: payload as object | undefined,
    },
  });
}

function verifyTelegramInitData(initData: string): { id: string; first_name?: string; username?: string } | null {
  const botToken = TG_BOT_TOKEN;
  if (!botToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (calculatedHash !== hash) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  return JSON.parse(userRaw);
}

async function getCentralPoint() {
  const existing = await prisma.salesPoint.findFirst({ where: { isCentral: true } });
  if (existing) return existing;

  return prisma.salesPoint.create({
    data: {
      name: 'Центральный склад',
      address: 'Главный склад',
      commissionType: CommissionType.FIXED,
      commissionValue: 0,
      bottleSalePrice: 0,
      isCentral: true,
      isActive: true,
    },
  });
}

async function getLatestUnitCost() {
  const batch = await prisma.batchCost.findFirst({ orderBy: { createdAt: 'desc' } });
  return batch ? asNumber(batch.unitCost) : 0;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/auth/telegram', validate(authSchema), dedupeRequest, async (req, res, next) => {
  const { initData, role } = req.body as { initData: string; role?: UserRole };
  const bypassEnabled = process.env.TELEGRAM_AUTH_BYPASS === 'true';
  const verifiedUser = bypassEnabled && initData === 'dev'
    ? { id: '10000001', first_name: 'Dev Owner' }
    : verifyTelegramInitData(initData);

  if (!verifiedUser) {
    return next(new ApiError(401, 'TELEGRAM_AUTH_FAILED', 'Некорректные данные Telegram авторизации'));
  }

  const telegramId = String(verifiedUser.id);
  const name = verifiedUser.first_name || verifiedUser.username || `user_${telegramId}`;

  const user = await prisma.user.upsert({
    where: { telegramId },
    update: { name },
    create: {
      telegramId,
      name,
      role: role && Object.values(UserRole).includes(role) ? role : UserRole.EMPLOYEE,
    },
  });

  const token = jwt.sign({ userId: user.id, telegramId, role: user.role } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: '30d',
  });

  return res.json({ token, user });
});

app.get('/me', auth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  res.json(user);
});

app.get('/points', auth, async (_req, res) => {
  const points = await prisma.salesPoint.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(points);
});

app.post('/points', auth, allowRoles(UserRole.OWNER, UserRole.MANAGER), validate(pointSchema), dedupeRequest, async (req: AuthRequest, res) => {
  const point = await prisma.salesPoint.create({
    data: {
      name: req.body.name,
      address: req.body.address,
      commissionType: req.body.commissionType,
      commissionValue: req.body.commissionValue,
      bottleSalePrice: req.body.bottleSalePrice,
      isActive: req.body.isActive ?? true,
      isCentral: false,
    },
  });

  await logAction(req, 'CREATE', 'SalesPoint', String(point.id), req.body);
  res.status(201).json(point);
});

app.get('/points/:id/stats', auth, async (req, res, next) => {
  const pointId = Number(req.params.id);
  const point = await prisma.salesPoint.findUnique({ where: { id: pointId } });
  if (!point) return next(new ApiError(404, 'POINT_NOT_FOUND', 'Точка не найдена'));

  const sales = await prisma.sale.findMany({ where: { pointId } });
  const totalRevenue = sales.reduce((sum, s) => sum + asNumber(s.saleAmount), 0);
  const netProfit = sales.reduce((sum, s) => sum + asNumber(s.netProfit), 0);
  const grossProfit = sales.reduce((sum, s) => sum + asNumber(s.grossProfit), 0);
  const profitability = totalRevenue ? (netProfit / totalRevenue) * 100 : 0;
  const avgMargin = totalRevenue ? (grossProfit / totalRevenue) * 100 : 0;

  res.json({ point, totalRevenue, netProfit, grossProfit, profitability, avgMargin });
});

app.get('/products', auth, async (_req, res) => {
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { id: 'desc' } });
  res.json(products);
});

app.post('/products', auth, allowRoles(UserRole.OWNER, UserRole.MANAGER), validate(productSchema), dedupeRequest, async (req: AuthRequest, res) => {
  const product = await prisma.product.create({
    data: {
      aromaName: req.body.aromaName,
      volumeMl: Number(req.body.volumeMl),
      isActive: req.body.isActive ?? true,
    },
  });

  const central = await getCentralPoint();
  await prisma.inventory.upsert({
    where: { pointId_productId: { pointId: central.id, productId: product.id } },
    create: { pointId: central.id, productId: product.id, quantity: 0 },
    update: {},
  });

  await logAction(req, 'CREATE', 'Product', String(product.id), req.body);
  res.status(201).json(product);
});

app.get('/production/batches', auth, async (_req, res) => {
  const data = await prisma.batchCost.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(data);
});

app.post('/production/batches', auth, allowRoles(UserRole.OWNER, UserRole.MANAGER), validate(batchSchema), dedupeRequest, async (req: AuthRequest, res) => {
  const yieldedBottles = Number(req.body.yieldedBottles);
  const totalCost =
    Number(req.body.oilPrice) +
    Number(req.body.basePrice) +
    Number(req.body.bottlePrice) +
    Number(req.body.packagingPrice) +
    Number(req.body.otherCosts || 0);

  const unitCost = yieldedBottles > 0 ? totalCost / yieldedBottles : 0;

  const batch = await prisma.batchCost.create({
    data: {
      oilMl: req.body.oilMl,
      baseMl: req.body.baseMl,
      oilPrice: req.body.oilPrice,
      basePrice: req.body.basePrice,
      bottlePrice: req.body.bottlePrice,
      packagingPrice: req.body.packagingPrice,
      otherCosts: req.body.otherCosts || 0,
      yieldedBottles,
      unitCost,
    },
  });

  await logAction(req, 'CREATE', 'BatchCost', String(batch.id), req.body);
  res.status(201).json(batch);
});

app.get('/inventory', auth, async (_req, res) => {
  const data = await prisma.inventory.findMany({
    include: {
      point: true,
      product: true,
    },
    orderBy: { id: 'desc' },
  });

  const lowStock = data.filter((item) => item.quantity <= LOW_STOCK_THRESHOLD && !item.point.isCentral);
  res.json({ items: data, lowStock });
});

app.post('/supplies', auth, allowRoles(UserRole.OWNER, UserRole.MANAGER), validate(supplySchema), dedupeRequest, async (req: AuthRequest, res) => {
  const pointId = Number(req.body.pointId);
  const productId = Number(req.body.productId);
  const quantity = Number(req.body.quantity);

  const central = await getCentralPoint();

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.inventory.upsert({
      where: { pointId_productId: { pointId: central.id, productId } },
      create: { pointId: central.id, productId, quantity: 0 },
      update: {},
    });

    if (source.quantity < quantity) {
      throw new ApiError(400, 'INSUFFICIENT_CENTRAL_STOCK', 'Недостаточно товара на центральном складе');
    }

    await tx.inventory.update({
      where: { id: source.id },
      data: { quantity: source.quantity - quantity },
    });

    const target = await tx.inventory.upsert({
      where: { pointId_productId: { pointId, productId } },
      create: { pointId, productId, quantity },
      update: { quantity: { increment: quantity } },
    });

    const supply = await tx.supply.create({
      data: {
        pointId,
        productId,
        quantity,
        date: req.body.date ? new Date(req.body.date) : new Date(),
        comment: req.body.comment,
      },
    });

    return { target, supply };
  });

  await logAction(req, 'CREATE', 'Supply', String(result.supply.id), req.body);
  res.status(201).json(result);
});

app.get('/supplies', auth, async (_req, res) => {
  const data = await prisma.supply.findMany({
    include: { point: true, product: true },
    orderBy: { date: 'desc' },
  });
  res.json(data);
});

app.post('/sales', auth, validate(saleSchema), dedupeRequest, async (req: AuthRequest, res, next) => {
  const pointId = Number(req.body.pointId);
  const productId = Number(req.body.productId);
  const quantitySold = Number(req.body.quantitySold);
  const date = req.body.date ? new Date(req.body.date) : new Date();

  const point = await prisma.salesPoint.findUnique({ where: { id: pointId } });
  if (!point) return next(new ApiError(404, 'POINT_NOT_FOUND', 'Точка не найдена'));

  const unitCost = await getLatestUnitCost();
  const saleAmount = asNumber(point.bottleSalePrice) * quantitySold;
  const perUnitCommission =
    point.commissionType === CommissionType.PERCENT
      ? (asNumber(point.bottleSalePrice) * asNumber(point.commissionValue)) / 100
      : asNumber(point.commissionValue);
  const commission = perUnitCommission * quantitySold;
  const grossProfit = saleAmount - commission;
  const netProfit = grossProfit - unitCost * quantitySold;

  const sale = await prisma.$transaction(async (tx) => {
    const stock = await tx.inventory.findUnique({ where: { pointId_productId: { pointId, productId } } });
    if (!stock || stock.quantity < quantitySold) {
      throw new ApiError(400, 'INSUFFICIENT_POINT_STOCK', 'Недостаточно товара на точке');
    }

    await tx.inventory.update({
      where: { id: stock.id },
      data: { quantity: stock.quantity - quantitySold },
    });

    return tx.sale.create({
      data: {
        pointId,
        productId,
        userId: req.user?.userId,
        quantitySold,
        date,
        saleAmount,
        pointCommission: commission,
        grossProfit,
        netProfit,
      },
    });
  });

  await logAction(req, 'CREATE', 'Sale', String(sale.id), req.body);
  res.status(201).json(sale);
});

app.post('/sales/upload-excel', auth, dedupeRequest, upload.single('file'), async (req: AuthRequest, res, next) => {
  if (!req.file) return next(new ApiError(400, 'FILE_REQUIRED', 'Excel файл обязателен'));

  const workbook = new ExcelJS.Workbook();
  const fileBuffer: any = req.file.buffer;
  await workbook.xlsx.load(fileBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return next(new ApiError(400, 'SHEET_NOT_FOUND', 'Лист в файле не найден'));

  const created: number[] = [];

  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    const pointId = Number(row.getCell(1).value);
    const productId = Number(row.getCell(2).value);
    const quantitySold = Number(row.getCell(3).value);
    const dateRaw = row.getCell(4).value;

    if (!pointId || !productId || !quantitySold) continue;

    const point = await prisma.salesPoint.findUnique({ where: { id: pointId } });
    if (!point) continue;

    const unitCost = await getLatestUnitCost();
    const saleAmount = asNumber(point.bottleSalePrice) * quantitySold;
    const perUnitCommission =
      point.commissionType === CommissionType.PERCENT
        ? (asNumber(point.bottleSalePrice) * asNumber(point.commissionValue)) / 100
        : asNumber(point.commissionValue);

    const commission = perUnitCommission * quantitySold;
    const grossProfit = saleAmount - commission;
    const netProfit = grossProfit - unitCost * quantitySold;

    const stock = await prisma.inventory.findUnique({ where: { pointId_productId: { pointId, productId } } });
    if (!stock || stock.quantity < quantitySold) continue;

    await prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: stock.id },
        data: { quantity: stock.quantity - quantitySold },
      });

      const sale = await tx.sale.create({
        data: {
          pointId,
          productId,
          userId: req.user?.userId,
          quantitySold,
          date: dateRaw ? new Date(String(dateRaw)) : new Date(),
          saleAmount,
          pointCommission: commission,
          grossProfit,
          netProfit,
        },
      });
      created.push(sale.id);
    });
  }

  await logAction(req, 'IMPORT', 'Sale', undefined, { created: created.length });
  res.json({ imported: created.length, saleIds: created });
});

app.get('/sales', auth, async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : startOfMonth();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();

  const data = await prisma.sale.findMany({
    where: {
      date: {
        gte: from,
        lte: to,
      },
    },
    include: { point: true, product: true },
    orderBy: { date: 'desc' },
  });

  res.json(data);
});

app.post('/cash-collections', auth, validate(collectionSchema), dedupeRequest, async (req: AuthRequest, res) => {
  const item = await prisma.cashCollection.create({
    data: {
      pointId: Number(req.body.pointId),
      amount: req.body.amount,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      period: req.body.period,
      comment: req.body.comment,
    },
  });

  await logAction(req, 'CREATE', 'CashCollection', String(item.id), req.body);
  res.status(201).json(item);
});

app.get('/cash-collections', auth, async (_req, res) => {
  const data = await prisma.cashCollection.findMany({ include: { point: true }, orderBy: { date: 'desc' } });
  res.json(data);
});

app.get('/cash-collections/debts', auth, async (_req, res) => {
  const points = await prisma.salesPoint.findMany({ where: { isCentral: false } });
  const debts = await Promise.all(
    points.map(async (point) => {
      const sales = await prisma.sale.aggregate({ where: { pointId: point.id }, _sum: { saleAmount: true } });
      const collections = await prisma.cashCollection.aggregate({ where: { pointId: point.id }, _sum: { amount: true } });
      const inTurnover = asNumber(sales._sum.saleAmount) - asNumber(collections._sum.amount);
      return {
        pointId: point.id,
        pointName: point.name,
        totalSales: asNumber(sales._sum.saleAmount),
        collected: asNumber(collections._sum.amount),
        inTurnover,
      };
    }),
  );

  res.json(debts);
});

app.post('/expenses', auth, validate(expenseSchema), dedupeRequest, async (req: AuthRequest, res) => {
  const expense = await prisma.expense.create({
    data: {
      category: req.body.category as ExpenseCategory,
      amount: req.body.amount,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      comment: req.body.comment,
    },
  });

  await logAction(req, 'CREATE', 'Expense', String(expense.id), req.body);
  res.status(201).json(expense);
});

app.get('/expenses', auth, async (_req, res) => {
  const data = await prisma.expense.findMany({ orderBy: { date: 'desc' } });
  const total = data.reduce((acc, item) => acc + asNumber(item.amount), 0);
  res.json({ items: data, total });
});

app.get('/analytics/dashboard', auth, async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : startOfMonth();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();

  const sales = await prisma.sale.findMany({
    where: { date: { gte: from, lte: to } },
    include: { point: true, product: true },
  });

  const expenses = await prisma.expense.findMany({ where: { date: { gte: from, lte: to } } });
  const inventories = await prisma.inventory.findMany({ include: { point: true } });

  const revenue = sales.reduce((acc, s) => acc + asNumber(s.saleAmount), 0);
  const grossProfit = sales.reduce((acc, s) => acc + asNumber(s.grossProfit), 0);
  const salesNetProfit = sales.reduce((acc, s) => acc + asNumber(s.netProfit), 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + asNumber(e.amount), 0);
  const netProfit = salesNetProfit - totalExpenses;
  const moneyInPoints = sales.reduce((acc, s) => acc + asNumber(s.saleAmount) - asNumber(s.pointCommission), 0);
  const totalStock = inventories.reduce((acc, i) => acc + i.quantity, 0);

  const grouped = new Map<string, number>();
  for (const sale of sales) {
    const key = sale.date.toISOString().slice(0, 10);
    grouped.set(key, (grouped.get(key) || 0) + asNumber(sale.saleAmount));
  }

  const monthlySalesChart = Array.from(grouped.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    revenue,
    grossProfit,
    netProfit,
    totalStock,
    moneyInPoints,
    monthlySalesChart,
  });
});

app.get('/analytics/points', auth, async (_req, res) => {
  const points = await prisma.salesPoint.findMany({ where: { isCentral: false } });
  const data = await Promise.all(
    points.map(async (point) => {
      const sales = await prisma.sale.findMany({ where: { pointId: point.id } });
      const revenue = sales.reduce((acc, s) => acc + asNumber(s.saleAmount), 0);
      const net = sales.reduce((acc, s) => acc + asNumber(s.netProfit), 0);
      const roi = revenue ? (net / revenue) * 100 : 0;
      return { pointId: point.id, pointName: point.name, revenue, netProfit: net, roi };
    }),
  );

  const bestPoints = [...data].sort((a, b) => b.netProfit - a.netProfit).slice(0, 5);
  res.json({ data, bestPoints });
});

app.get('/analytics/products', auth, async (_req, res) => {
  const products = await prisma.product.findMany({ where: { isActive: true } });
  const data = await Promise.all(
    products.map(async (product) => {
      const sales = await prisma.sale.findMany({ where: { productId: product.id } });
      const revenue = sales.reduce((acc, s) => acc + asNumber(s.saleAmount), 0);
      const net = sales.reduce((acc, s) => acc + asNumber(s.netProfit), 0);
      return { productId: product.id, productName: product.aromaName, revenue, netProfit: net };
    }),
  );

  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((acc, row) => acc + row.revenue, 0);
  let cumulative = 0;
  const abc = sorted.map((row) => {
    cumulative += row.revenue;
    const share = total ? (cumulative / total) * 100 : 0;
    const group = share <= 80 ? 'A' : share <= 95 ? 'B' : 'C';
    return { ...row, group };
  });

  res.json({ data, topProducts: sorted.slice(0, 5), abc });
});

app.get('/analytics/margin-dynamics', auth, async (_req, res) => {
  const sales = await prisma.sale.findMany({ orderBy: { date: 'asc' } });
  const byMonth = new Map<string, { revenue: number; gross: number }>();

  for (const s of sales) {
    const key = `${s.date.getFullYear()}-${String(s.date.getMonth() + 1).padStart(2, '0')}`;
    const current = byMonth.get(key) || { revenue: 0, gross: 0 };
    current.revenue += asNumber(s.saleAmount);
    current.gross += asNumber(s.grossProfit);
    byMonth.set(key, current);
  }

  const data = Array.from(byMonth.entries()).map(([month, value]) => ({
    month,
    margin: value.revenue ? (value.gross / value.revenue) * 100 : 0,
  }));

  res.json(data);
});

app.get('/exports/excel', auth, async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sales Report');

  sheet.columns = [
    { header: 'Дата', key: 'date', width: 14 },
    { header: 'Точка', key: 'point', width: 24 },
    { header: 'Аромат', key: 'product', width: 24 },
    { header: 'Кол-во', key: 'qty', width: 10 },
    { header: 'Выручка', key: 'revenue', width: 14 },
    { header: 'Комиссия', key: 'commission', width: 14 },
    { header: 'Чистая прибыль', key: 'net', width: 18 },
  ];

  const sales = await prisma.sale.findMany({ include: { point: true, product: true }, orderBy: { date: 'desc' } });
  sales.forEach((sale) => {
    sheet.addRow({
      date: sale.date.toISOString().slice(0, 10),
      point: sale.point.name,
      product: sale.product.aromaName,
      qty: sale.quantitySold,
      revenue: asNumber(sale.saleAmount),
      commission: asNumber(sale.pointCommission),
      net: asNumber(sale.netProfit),
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/exports/pdf', auth, async (_req, res) => {
  const summary = await prisma.sale.aggregate({ _sum: { saleAmount: true, netProfit: true, grossProfit: true } });
  const expenses = await prisma.expense.aggregate({ _sum: { amount: true } });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  doc.fontSize(20).text('ParfumeBot — Финансовый отчёт');
  doc.moveDown();
  doc.fontSize(12).text(`Выручка: ${asNumber(summary._sum.saleAmount).toFixed(2)}`);
  doc.text(`Валовая прибыль: ${asNumber(summary._sum.grossProfit).toFixed(2)}`);
  doc.text(`Чистая прибыль (продажи): ${asNumber(summary._sum.netProfit).toFixed(2)}`);
  doc.text(`Расходы: ${asNumber(expenses._sum.amount).toFixed(2)}`);
  doc.text(`Итоговая чистая прибыль: ${(asNumber(summary._sum.netProfit) - asNumber(expenses._sum.amount)).toFixed(2)}`);
  doc.moveDown();
  doc.text(`Сформирован: ${new Date().toLocaleString('ru-RU')}`);

  doc.end();
});

async function sendNotification(message: string) {
  if (!bot) return;
  const owners = await prisma.user.findMany({ where: { role: UserRole.OWNER } });
  await Promise.allSettled(owners.map((owner) => bot.telegram.sendMessage(owner.telegramId, message)));
}

cron.schedule('0 9 * * *', async () => {
  const lowStock = await prisma.inventory.findMany({
    where: {
      quantity: { lte: LOW_STOCK_THRESHOLD },
      point: { isCentral: false },
    },
    include: { point: true, product: true },
  });

  if (lowStock.length > 0) {
    const text = lowStock
      .slice(0, 10)
      .map((item) => `${item.point.name}: ${item.product.aromaName} — ${item.quantity} шт.`)
      .join('\n');
    await sendNotification(`⚠️ Низкий остаток:\n${text}`);
  }

  const debts = await prisma.salesPoint.findMany({ where: { isCentral: false } });
  for (const point of debts) {
    const sales = await prisma.sale.aggregate({ where: { pointId: point.id }, _sum: { saleAmount: true } });
    const collections = await prisma.cashCollection.aggregate({ where: { pointId: point.id }, _sum: { amount: true } });
    const debt = asNumber(sales._sum.saleAmount) - asNumber(collections._sum.amount);
    if (debt > 0) {
      await sendNotification(`💸 Задолженность точки ${point.name}: ${debt.toFixed(2)}`);
    }
  }
});

let bot: Telegraf | null = null;

if (TG_BOT_TOKEN) {
  bot = new Telegraf(TG_BOT_TOKEN);

  bot.start(async (ctx) => {
    await ctx.reply(
      'Откройте MiniApp для учёта продаж и аналитики:',
      Markup.inlineKeyboard([Markup.button.webApp('Открыть ParfumeBot', TG_WEBAPP_URL)]),
    );
  });

  bot.command('app', async (ctx) => {
    await ctx.reply(`https://t.me/${TG_BOT_USERNAME}?startapp=1`);
  });

  bot.launch().catch((error) => {
    console.error('Bot launch error:', error);
  });
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error instanceof ZodError) {
    return res.status(422).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некорректные данные запроса',
        details: error.flatten(),
      },
    });
  }

  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: error.message || 'Внутренняя ошибка сервера',
    },
  });
});

async function bootstrap() {
  await getCentralPoint();
  app.listen(PORT, () => {
    console.log(`API running on :${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
