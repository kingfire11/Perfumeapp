import { type ReactNode, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import clsx from 'clsx'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartNoAxesCombined,
  CirclePlus,
  HandCoins,
  House,
  Layers,
  MapPin,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react'
import {
  createBatch,
  createCollection,
  createExpense,
  createPoint,
  createProduct,
  createSale,
  createSupply,
  getBatches,
  getCollections,
  getDashboard,
  getDebts,
  getExpenses,
  getInventory,
  getMarginDynamics,
  getMe,
  getPointAnalytics,
  getPoints,
  getProductAnalytics,
  getProducts,
  getSales,
  getSupplies,
  initTokenFromStorage,
  telegramAuth,
} from './api'
import type {
  BatchCost,
  CashCollection,
  CashDebt,
  DashboardData,
  Expense,
  ExpenseCategory,
  Point,
  Product,
  SaleRecord,
  Supply,
  User,
} from './types'

type Tab = 'dashboard' | 'points' | 'sales' | 'inventory' | 'analytics'
type OpsTab = 'sales' | 'production' | 'supplies' | 'collections' | 'expenses'
type QuickAction = 'sale' | 'expense' | 'product'

const EXPENSE_LABELS: Record<string, string> = {
  OIL: 'Масло',
  BASE: 'База',
  BOTTLE: 'Тара',
  PACKAGING: 'Упаковка',
  MARKETING: 'Реклама',
  RENT: 'Аренда',
  OTHER: 'Прочее',
}

type InventoryRow = {
  id: number
  quantity: number
  point: { name: string; isCentral: boolean }
  product: { aromaName: string }
}

const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'dashboard', label: 'Главная', icon: <House size={18} /> },
  { key: 'points', label: 'Точки', icon: <MapPin size={18} /> },
  { key: 'sales', label: 'Операции', icon: <HandCoins size={18} /> },
  { key: 'inventory', label: 'Склад', icon: <Layers size={18} /> },
  { key: 'analytics', label: 'Аналитика', icon: <ChartNoAxesCombined size={18} /> },
]

const operationTabs: { key: OpsTab; label: string }[] = [
  { key: 'sales', label: 'Продажи' },
  { key: 'production', label: 'Производство' },
  { key: 'supplies', label: 'Поставки' },
  { key: 'collections', label: 'Инкассации' },
  { key: 'expenses', label: 'Расходы' },
]

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function getString(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim()
}

function getNumber(formData: FormData, key: string) {
  return Number(formData.get(key) || 0)
}

function ensure(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [opsTab, setOpsTab] = useState<OpsTab>('sales')
  const [quick, setQuick] = useState<QuickAction | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const [user, setUser] = useState<User | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)

  const [inventory, setInventory] = useState<{ items: InventoryRow[]; lowStock: InventoryRow[] } | null>(null)
  const [pointAnalytics, setPointAnalytics] = useState<{ data: Array<{ pointId: number; pointName: string; revenue: number; netProfit: number; roi: number }>; bestPoints: Array<{ pointId: number; pointName: string; revenue: number; netProfit: number; roi: number }> } | null>(null)
  const [productAnalytics, setProductAnalytics] = useState<{ abc: Array<{ productId: number; productName: string; group?: string }> } | null>(null)
  const [marginDynamics, setMarginDynamics] = useState<Array<{ month: string; margin: number }>>([])

  const [batches, setBatches] = useState<BatchCost[]>([])
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [collections, setCollections] = useState<CashCollection[]>([])
  const [debts, setDebts] = useState<CashDebt[]>([])
  const [expensesData, setExpensesData] = useState<{ items: Expense[]; total: number }>({ items: [], total: 0 })
  const [salesRows, setSalesRows] = useState<SaleRecord[]>([])

  const [opsQuery, setOpsQuery] = useState('')
  const [opsPointId, setOpsPointId] = useState<number | ''>('')
  const [opsProductId, setOpsProductId] = useState<number | ''>('')

  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'))
  const [to, setTo] = useState(dayjs().format('YYYY-MM-DD'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwnerOrManager = useMemo(
    () => user?.role === 'OWNER' || user?.role === 'MANAGER',
    [user?.role],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  async function runAction(action: () => Promise<void>) {
    setError(null)
    setLoading(true)
    try {
      await action()
    } catch (e) {
      console.error(e)
      setError('Не удалось выполнить действие')
    } finally {
      setLoading(false)
    }
  }

  async function bootstrap() {
    await runAction(async () => {
      initTokenFromStorage()
      const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string; ready?: () => void } } }).Telegram?.WebApp
      tg?.ready?.()

      if (!localStorage.getItem('parfumebot_token')) {
        await telegramAuth(tg?.initData || 'dev')
      }

      const currentUser = await getMe()
      setUser(currentUser)
      await fetchAll()
    })
  }

  async function fetchAll() {
    const [
      dash,
      pointRows,
      productRows,
      stock,
      pAnalytics,
      prodAnalytics,
      margins,
      batchRows,
      supplyRows,
      collectionRows,
      debtRows,
      expenseRows,
      salesList,
    ] = await Promise.all([
      getDashboard(from, to),
      getPoints(),
      getProducts(),
      getInventory(),
      getPointAnalytics(),
      getProductAnalytics(),
      getMarginDynamics(),
      getBatches(),
      getSupplies(),
      getCollections(),
      getDebts(),
      getExpenses(),
      getSales(from, to),
    ])

    setDashboard(dash)
    setPoints(pointRows.filter((point) => !point.isCentral))
    setProducts(productRows)
    setInventory(stock)
    setPointAnalytics(pAnalytics)
    setProductAnalytics(prodAnalytics)
    setMarginDynamics(margins)
    setBatches(batchRows)
    setSupplies(supplyRows)
    setCollections(collectionRows)
    setDebts(debtRows)
    setExpensesData(expenseRows)
    setSalesRows(salesList)
  }

  const inPeriod = (dateString: string) => {
    const date = dayjs(dateString)
    return (date.isAfter(dayjs(from).subtract(1, 'day')) && date.isBefore(dayjs(to).add(1, 'day')))
  }

  const query = opsQuery.trim().toLowerCase()

  const filteredSales = useMemo(
    () => salesRows.filter((row) => {
      const queryOk = !query || `${row.point.name} ${row.product.aromaName}`.toLowerCase().includes(query)
      const pointOk = !opsPointId || row.pointId === opsPointId
      const productOk = !opsProductId || row.productId === opsProductId
      return queryOk && pointOk && productOk && inPeriod(row.date)
    }),
    [salesRows, query, opsPointId, opsProductId, from, to],
  )

  const filteredBatches = useMemo(
    () => batches.filter((row) => {
      const queryOk = !query || `${row.id} ${row.unitCost}`.toLowerCase().includes(query)
      return queryOk && inPeriod(row.createdAt)
    }),
    [batches, query, from, to],
  )

  const filteredSupplies = useMemo(
    () => supplies.filter((row) => {
      const queryOk = !query || `${row.point.name} ${row.product.aromaName} ${row.comment || ''}`.toLowerCase().includes(query)
      const pointOk = !opsPointId || row.pointId === opsPointId
      const productOk = !opsProductId || row.productId === opsProductId
      return queryOk && pointOk && productOk && inPeriod(row.date)
    }),
    [supplies, query, opsPointId, opsProductId, from, to],
  )

  const filteredCollections = useMemo(
    () => collections.filter((row) => {
      const queryOk = !query || `${row.point.name} ${row.period} ${row.comment || ''}`.toLowerCase().includes(query)
      const pointOk = !opsPointId || row.pointId === opsPointId
      return queryOk && pointOk && inPeriod(row.date)
    }),
    [collections, query, opsPointId, from, to],
  )

  const filteredDebts = useMemo(
    () => debts.filter((row) => {
      const queryOk = !query || row.pointName.toLowerCase().includes(query)
      const pointOk = !opsPointId || row.pointId === opsPointId
      return queryOk && pointOk
    }),
    [debts, query, opsPointId],
  )

  const filteredExpenses = useMemo(
    () => expensesData.items.filter((row) => {
      const queryOk = !query || `${row.category} ${row.comment || ''}`.toLowerCase().includes(query)
      return queryOk && inPeriod(row.date)
    }),
    [expensesData.items, query, from, to],
  )

  const filteredBestPoints = useMemo(
    () => (pointAnalytics?.bestPoints || []).filter((row) => {
      const queryOk = !query || row.pointName.toLowerCase().includes(query)
      const pointOk = !opsPointId || row.pointId === opsPointId
      return queryOk && pointOk
    }),
    [pointAnalytics?.bestPoints, query, opsPointId],
  )

  useEffect(() => {
    void bootstrap()
  }, [])

  async function handleRefresh() {
    await runAction(async () => {
      await fetchAll()
    })
  }

  async function onCreatePoint(formData: FormData) {
    await runAction(async () => {
      const name = getString(formData, 'name')
      const address = getString(formData, 'address')
      const commissionValue = getNumber(formData, 'commissionValue')
      const bottleSalePrice = getNumber(formData, 'bottleSalePrice')

      ensure(name.length >= 2, 'Название точки должно быть не короче 2 символов')
      ensure(address.length >= 3, 'Адрес должен быть не короче 3 символов')
      ensure(commissionValue >= 0, 'Комиссия не может быть отрицательной')
      ensure(bottleSalePrice > 0, 'Цена продажи должна быть больше 0')

      await createPoint({
        name,
        address,
        commissionType: String(formData.get('commissionType')) as 'PERCENT' | 'FIXED',
        commissionValue,
        bottleSalePrice,
      })
      await fetchAll()
    })
  }

  async function onQuickSubmit(formData: FormData) {
    await runAction(async () => {
      if (quick === 'sale') {
        const pointId = getNumber(formData, 'pointId')
        const productId = getNumber(formData, 'productId')
        const quantitySold = getNumber(formData, 'quantitySold')
        const date = getString(formData, 'date')

        ensure(pointId > 0, 'Выберите точку')
        ensure(productId > 0, 'Выберите аромат')
        ensure(Number.isInteger(quantitySold) && quantitySold > 0, 'Количество должно быть целым числом больше 0')
        ensure(dayjs(date).isValid(), 'Укажите корректную дату продажи')

        await createSale({
          pointId,
          productId,
          quantitySold,
          date,
        })
      }

      if (quick === 'expense') {
        const amount = getNumber(formData, 'amount')
        const date = getString(formData, 'date')

        ensure(amount > 0, 'Сумма расхода должна быть больше 0')
        ensure(dayjs(date).isValid(), 'Укажите корректную дату расхода')

        await createExpense({
          category: getString(formData, 'category'),
          amount,
          date,
          comment: getString(formData, 'comment'),
        })
      }

      if (quick === 'product') {
        const aromaName = getString(formData, 'aromaName')
        const volumeMl = getNumber(formData, 'volumeMl')

        ensure(aromaName.length >= 2, 'Название аромата должно быть не короче 2 символов')
        ensure(Number.isInteger(volumeMl) && volumeMl > 0, 'Объём должен быть целым числом больше 0')

        await createProduct({
          aromaName,
          volumeMl,
        })
      }

      setQuick(null)
      await fetchAll()
    })
  }

  if (loading && !dashboard) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)]">
        <div className="spinner" />
        <p className="text-sm text-[var(--muted)]">Загрузка данных…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{background:'var(--accent-light)'}}>
              <Sparkles size={15} color="var(--accent)" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold leading-tight tracking-tight">ParfumeBot</h1>
              {user && <p className="text-[11px] text-[var(--muted)]">{user.role === 'OWNER' ? 'Владелец' : user.role === 'MANAGER' ? 'Менеджер' : 'Продавец'}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-2 text-[var(--muted)]"
              title="Обновить данные"
            >
              <ChartNoAxesCombined size={15} />
            </button>
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-2 text-[var(--muted)]"
            >
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="field">
            <label>С</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </div>
          <div className="field">
            <label>По</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </div>
        </div>
      </header>

      <main className="px-4 pb-28 pt-4">
        {error && (
          <div className="toast-error mb-3 flex items-start gap-2">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{error}</span>
            <button className="btn-ghost ml-auto shrink-0 !p-0 text-[var(--red)]" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {tab === 'dashboard' && dashboard && (
          <section className="space-y-3">
            <p className="text-[11px] uppercase font-semibold tracking-widest text-[var(--muted)] px-0.5">
              {dayjs(from).format('DD MMM')} — {dayjs(to).format('DD MMM YYYY')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                title="Выручка"
                value={money.format(dashboard.revenue)}
                suffix="₽"
                color="var(--green)"
                bg="var(--green-bg)"
              />
              <StatCard
                title="Чистая прибыль"
                value={money.format(dashboard.netProfit)}
                suffix="₽"
                color="var(--blue)"
                bg="var(--blue-bg)"
              />
              <StatCard
                title="Остаток товара"
                value={String(dashboard.totalStock)}
                suffix="шт."
                color="var(--accent)"
                bg="var(--accent-light)"
              />
              <StatCard
                title="Деньги в точках"
                value={money.format(dashboard.moneyInPoints)}
                suffix="₽"
                color="var(--yellow)"
                bg="var(--yellow-bg)"
              />
            </div>
            <div className="card">
              <p className="section-title mb-3">📈 Продажи за период</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.monthlySalesChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" hide />
                    <YAxis hide />
                    <Tooltip />
                    <Line dataKey="value" type="monotone" stroke="var(--accent)" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            {(pointAnalytics?.bestPoints || []).length > 0 && (
              <div className="card">
                <p className="section-title mb-3">🏆 Топ точек</p>
                <div className="space-y-2">
                  {(pointAnalytics?.bestPoints || []).slice(0, 3).map((pt, idx) => (
                    <div key={pt.pointId} className="row-item">
                      <span className="text-[var(--muted)] text-sm w-5 text-center font-bold">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">{pt.pointName}</p>
                        <p className="text-xs text-[var(--muted)]">ЧП {money.format(pt.netProfit)} ₽ · ROI {pt.roi.toFixed(1)}%</p>
                      </div>
                      <span className="text-sm font-semibold" style={{color:'var(--green)'}}>{money.format(pt.revenue)} ₽</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'points' && (
          <section className="space-y-3">
            {isOwnerOrManager && (
              <form
                className="card grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await onCreatePoint(new FormData(e.currentTarget))
                  e.currentTarget.reset()
                }}
              >
                <p className="section-title">➕ Новая точка</p>
                <div className="field">
                  <label>Название точки</label>
                  <input required name="name" placeholder="Напр., ТЦ Галерея" className="input" />
                </div>
                <div className="field">
                  <label>Адрес</label>
                  <input required name="address" placeholder="ул. Пушкина, 10" className="input" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field">
                    <label>Тип комиссии</label>
                    <select name="commissionType" className="input">
                      <option value="PERCENT">Процент (%)</option>
                      <option value="FIXED">Фиксированная</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Значение</label>
                    <input required name="commissionValue" type="number" step="0.01" placeholder="0" className="input" />
                  </div>
                </div>
                <div className="field">
                  <label>Цена флакона (₽)</label>
                  <input required name="bottleSalePrice" type="number" step="0.01" placeholder="500" className="input" />
                </div>
                <button className="btn w-full">Создать точку</button>
              </form>
            )}

            {points.length === 0 && (
              <div className="card text-center py-8 text-[var(--muted)] text-sm">Нет активных точек</div>
            )}

            {points.map((point) => {
              const row = pointAnalytics?.data.find((item) => item.pointId === point.id)
              const margin = row?.revenue ? (((row.netProfit || 0) / row.revenue) * 100).toFixed(1) : '0'
              return (
                <div key={point.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-[15px] leading-tight">{point.name}</h3>
                      <p className="text-xs text-[var(--muted)] mt-0.5">{point.address}</p>
                    </div>
                    <span className="badge badge-neutral shrink-0">
                      {point.commissionType === 'PERCENT' ? `${point.commissionValue}%` : `${money.format(point.commissionValue)} ₽`}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-xl p-2 text-center" style={{background:'var(--green-bg)'}}>
                      <p className="text-[11px] text-[var(--muted)]">Выручка</p>
                      <p className="text-sm font-bold" style={{color:'var(--green)'}}>{money.format(row?.revenue || 0)} ₽</p>
                    </div>
                    <div className="rounded-xl p-2 text-center" style={{background:'var(--blue-bg)'}}>
                      <p className="text-[11px] text-[var(--muted)]">ROI</p>
                      <p className="text-sm font-bold" style={{color:'var(--blue)'}}>{(row?.roi || 0).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-xl p-2 text-center" style={{background:'var(--accent-light)'}}>
                      <p className="text-[11px] text-[var(--muted)]">Маржа</p>
                      <p className="text-sm font-bold" style={{color:'var(--accent)'}}>{margin}%</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {tab === 'sales' && (
          <section className="space-y-3">
            {/* ── Sub-tabs ── */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mb-1">
              {operationTabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOpsTab(item.key)}
                  className={clsx('pill-tab', opsTab === item.key ? 'pill-tab-active' : 'pill-tab-inactive')}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* ── Filters ── */}
            <div className="card grid gap-2">
              <input
                value={opsQuery}
                onChange={(e) => setOpsQuery(e.target.value)}
                className="input"
                placeholder="🔍  Поиск по точке, аромату, комментарию"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={opsPointId}
                  onChange={(e) => setOpsPointId(e.target.value ? Number(e.target.value) : '')}
                  className="input"
                >
                  <option value="">Все точки</option>
                  {points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                </select>
                <select
                  value={opsProductId}
                  onChange={(e) => setOpsProductId(e.target.value ? Number(e.target.value) : '')}
                  className="input"
                >
                  <option value="">Все ароматы</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.aromaName}</option>)}
                </select>
              </div>
            </div>

            {opsTab === 'sales' && (
              <>
                <div className="card text-sm">
                  <p className="font-medium">Ввод продаж и импорт Excel</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Для импорта используйте endpoint /sales/upload-excel (form-data: file). Быстрое добавление — через кнопку “+”.
                  </p>
                </div>
                <div className="card h-56">
                  <p className="mb-3 text-sm font-medium">ТОП точек по прибыли</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={filteredBestPoints}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="pointName" hide />
                      <YAxis hide />
                      <Tooltip />
                      <Bar dataKey="netProfit" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="card">
                  <h3 className="text-sm font-semibold">Продажи за период (фильтрованные)</h3>
                  <div className="mt-2 space-y-2 text-sm">
                    {filteredSales.slice(0, 20).map((sale) => (
                      <div key={sale.id} className="rounded-xl bg-[var(--soft)] p-2">
                        <div className="flex justify-between">
                          <span>{sale.point.name} · {sale.product.aromaName}</span>
                          <span className="font-semibold">{sale.quantitySold} шт.</span>
                        </div>
                        <p className="text-xs text-[var(--muted)]">
                          {dayjs(sale.date).format('DD.MM.YYYY')} · Выручка {money.format(sale.saleAmount)} · ЧП {money.format(sale.netProfit)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {opsTab === 'production' && (
              <>
                {isOwnerOrManager ? (
                  <form
                    className="card grid gap-3"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const formData = new FormData(e.currentTarget)
                      await runAction(async () => {
                        const yieldedBottles = getNumber(formData, 'yieldedBottles')
                        ensure(Number.isInteger(yieldedBottles) && yieldedBottles > 0, 'Количество флаконов должно быть целым числом больше 0')
                        await createBatch({
                          oilMl: getNumber(formData, 'oilMl'),
                          baseMl: getNumber(formData, 'baseMl'),
                          oilPrice: getNumber(formData, 'oilPrice'),
                          basePrice: getNumber(formData, 'basePrice'),
                          bottlePrice: getNumber(formData, 'bottlePrice'),
                          packagingPrice: getNumber(formData, 'packagingPrice'),
                          otherCosts: getNumber(formData, 'otherCosts'),
                          yieldedBottles,
                        })
                        await fetchAll()
                      })
                      e.currentTarget.reset()
                    }}
                  >
                    <p className="section-title">🧪 Новая партия</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="field"><label>Масло (мл)</label><input required name="oilMl" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>База (мл)</label><input required name="baseMl" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Цена масла (₽)</label><input required name="oilPrice" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Цена базы (₽)</label><input required name="basePrice" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Флакон (₽)</label><input required name="bottlePrice" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Упаковка (₽)</label><input required name="packagingPrice" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Прочие затраты</label><input name="otherCosts" type="number" step="0.01" className="input" placeholder="0" /></div>
                      <div className="field"><label>Получено флаконов</label><input required name="yieldedBottles" type="number" className="input" placeholder="0" /></div>
                    </div>
                    <button className="btn w-full">Сохранить партию</button>
                  </form>
                ) : (
                  <div className="card text-sm text-[var(--muted)] text-center py-4">Недостаточно прав для добавления партии</div>
                )}
                <div className="card">
                  <p className="section-title mb-3">Партии
                    <span className="ml-2 badge badge-neutral">{filteredBatches.length}</span>
                  </p>
                  <div className="space-y-2">
                    {filteredBatches.slice(0, 12).map((batch) => (
                      <div key={batch.id} className="row-item">
                        <div className="flex-1">
                          <p className="text-sm font-medium">{dayjs(batch.createdAt).format('DD.MM.YYYY')}</p>
                          <p className="text-xs text-[var(--muted)]">{batch.yieldedBottles} флаконов</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-[var(--muted)]">Себестоимость</p>
                          <p className="font-bold text-sm">{money.format(batch.unitCost)} ₽/шт.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {opsTab === 'supplies' && (
              <>
                {isOwnerOrManager ? (
                  <form
                    className="card grid gap-3"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const formData = new FormData(e.currentTarget)
                      await runAction(async () => {
                        const pointId = getNumber(formData, 'pointId')
                        const productId = getNumber(formData, 'productId')
                        const quantity = getNumber(formData, 'quantity')
                        const date = getString(formData, 'date')
                        ensure(pointId > 0, 'Выберите точку')
                        ensure(productId > 0, 'Выберите аромат')
                        ensure(Number.isInteger(quantity) && quantity > 0, 'Количество должно быть целым числом больше 0')
                        ensure(dayjs(date).isValid(), 'Укажите корректную дату поставки')
                        await createSupply({ pointId, productId, quantity, date, comment: getString(formData, 'comment') })
                        await fetchAll()
                      })
                      e.currentTarget.reset()
                    }}
                  >
                    <p className="section-title">📦 Новая поставка</p>
                    <div className="field">
                      <label>Точка</label>
                      <select name="pointId" className="input" required>
                        <option value="">Выберите точку</option>
                        {points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Аромат</label>
                      <select name="productId" className="input" required>
                        <option value="">Выберите аромат</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.aromaName}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="field"><label>Количество (шт.)</label><input required name="quantity" type="number" className="input" placeholder="0" /></div>
                      <div className="field"><label>Дата</label><input required name="date" type="date" className="input" defaultValue={dayjs().format('YYYY-MM-DD')} /></div>
                    </div>
                    <div className="field"><label>Комментарий</label><input name="comment" className="input" placeholder="Необязательно" /></div>
                    <button className="btn w-full">Отправить на точку</button>
                  </form>
                ) : (
                  <div className="card text-sm text-[var(--muted)] text-center py-4">Недостаточно прав для создания поставки</div>
                )}
                <div className="card">
                  <p className="section-title mb-3">История поставок
                    <span className="ml-2 badge badge-neutral">{filteredSupplies.length}</span>
                  </p>
                  <div className="space-y-2">
                    {filteredSupplies.slice(0, 14).map((supply) => (
                      <div key={supply.id} className="row-item">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{supply.point.name} → {supply.product.aromaName}</p>
                          <p className="text-xs text-[var(--muted)]">{dayjs(supply.date).format('DD.MM.YYYY')}{supply.comment ? ` · ${supply.comment}` : ''}</p>
                        </div>
                        <span className="font-bold text-sm shrink-0">{supply.quantity} шт.</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {opsTab === 'collections' && (
              <>
                <form
                  className="card grid gap-3"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const formData = new FormData(e.currentTarget)
                    await runAction(async () => {
                      const pointId = getNumber(formData, 'pointId')
                      const amount = getNumber(formData, 'amount')
                      const period = getString(formData, 'period')
                      const date = getString(formData, 'date')
                      ensure(pointId > 0, 'Выберите точку')
                      ensure(amount > 0, 'Сумма должна быть больше 0')
                      ensure(period.length >= 3, 'Укажите период инкассации')
                      ensure(dayjs(date).isValid(), 'Укажите корректную дату инкассации')
                      await createCollection({ pointId, amount, period, date, comment: getString(formData, 'comment') })
                      await fetchAll()
                    })
                    e.currentTarget.reset()
                  }}
                >
                  <p className="section-title">💰 Новая инкассация</p>
                  <div className="field">
                    <label>Точка</label>
                    <select name="pointId" className="input" required>
                      <option value="">Выберите точку</option>
                      {points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="field"><label>Сумма (₽)</label><input required name="amount" type="number" step="0.01" className="input" placeholder="0" /></div>
                    <div className="field"><label>Дата</label><input required name="date" type="date" className="input" defaultValue={dayjs().format('YYYY-MM-DD')} /></div>
                  </div>
                  <div className="field"><label>Период</label><input required name="period" className="input" placeholder="Напр., 01.02–28.02" /></div>
                  <div className="field"><label>Комментарий</label><input name="comment" className="input" placeholder="Необязательно" /></div>
                  <button className="btn w-full">Зафиксировать инкассацию</button>
                </form>

                {filteredDebts.length > 0 && (
                  <div className="card">
                    <p className="section-title mb-3">💼 В обороте / задолженность</p>
                    <div className="space-y-2">
                      {filteredDebts.map((debt) => (
                        <div key={debt.pointId} className="row-item">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{debt.pointName}</p>
                            <p className="text-xs text-[var(--muted)]">Продано {money.format(debt.totalSales)} · Изъято {money.format(debt.collected)} ₽</p>
                          </div>
                          <span className="font-bold text-sm shrink-0" style={{color: debt.inTurnover > 0 ? 'var(--yellow)' : 'var(--muted)'}}>
                            {money.format(debt.inTurnover)} ₽
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="card">
                  <p className="section-title mb-3">История инкассаций
                    <span className="ml-2 badge badge-neutral">{filteredCollections.length}</span>
                  </p>
                  <div className="space-y-2">
                    {filteredCollections.slice(0, 12).map((item) => (
                      <div key={item.id} className="row-item">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.point.name}</p>
                          <p className="text-xs text-[var(--muted)]">{dayjs(item.date).format('DD.MM.YYYY')} · {item.period}</p>
                        </div>
                        <span className="font-bold text-sm shrink-0" style={{color:'var(--green)'}}>{money.format(item.amount)} ₽</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {opsTab === 'expenses' && (
              <>
                <form
                  className="card grid gap-3"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const formData = new FormData(e.currentTarget)
                    await runAction(async () => {
                      const amount = getNumber(formData, 'amount')
                      const date = getString(formData, 'date')
                      ensure(amount > 0, 'Сумма расхода должна быть больше 0')
                      ensure(dayjs(date).isValid(), 'Укажите корректную дату расхода')
                      await createExpense({ category: getString(formData, 'category') as ExpenseCategory, amount, date, comment: getString(formData, 'comment') })
                      await fetchAll()
                    })
                    e.currentTarget.reset()
                  }}
                >
                  <p className="section-title">🧾 Новый расход</p>
                  <div className="field">
                    <label>Категория</label>
                    <select name="category" className="input" required>
                      <option value="OIL">Масло</option>
                      <option value="BASE">База</option>
                      <option value="BOTTLE">Тара</option>
                      <option value="PACKAGING">Упаковка</option>
                      <option value="MARKETING">Реклама</option>
                      <option value="RENT">Аренда</option>
                      <option value="OTHER">Прочее</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="field"><label>Сумма (₽)</label><input required name="amount" type="number" step="0.01" className="input" placeholder="0" /></div>
                    <div className="field"><label>Дата</label><input required name="date" type="date" className="input" defaultValue={dayjs().format('YYYY-MM-DD')} /></div>
                  </div>
                  <div className="field"><label>Комментарий</label><input name="comment" className="input" placeholder="Необязательно" /></div>
                  <button className="btn w-full">Сохранить расход</button>
                </form>
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <p className="section-title">Затраты за период</p>
                    <span className="font-bold" style={{color:'var(--red)'}}>{money.format(expensesData.total)} ₽</span>
                  </div>
                  <div className="space-y-2">
                    {filteredExpenses.slice(0, 15).map((expense) => (
                      <div key={expense.id} className="row-item">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{EXPENSE_LABELS[expense.category] ?? expense.category}</p>
                          <p className="text-xs text-[var(--muted)]">{dayjs(expense.date).format('DD.MM.YYYY')}{expense.comment ? ` · ${expense.comment}` : ''}</p>
                        </div>
                        <span className="font-bold text-sm shrink-0" style={{color:'var(--red)'}}>{money.format(expense.amount)} ₽</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {tab === 'inventory' && (
          <section className="space-y-3">
            {(inventory?.lowStock?.length ?? 0) > 0 && (
              <div className="card" style={{background:'var(--red-bg)', border:'1px solid color-mix(in srgb, var(--red) 20%, transparent)'}}>
                <p className="section-title mb-3" style={{color:'var(--red)'}}>⚠️ Низкий остаток</p>
                <div className="space-y-2">
                  {inventory!.lowStock.map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{background:'color-mix(in srgb, var(--red-bg) 70%, white)'}}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{row.point.name}</p>
                        <p className="text-xs" style={{color:'var(--muted)'}}>{row.product.aromaName}</p>
                      </div>
                      <span className="font-bold text-sm shrink-0" style={{color:'var(--red)'}}>{row.quantity} шт.</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(inventory?.lowStock?.length ?? 0) === 0 && (
              <div className="card flex items-center gap-3 py-3" style={{background:'var(--green-bg)', border:'1px solid color-mix(in srgb, var(--green) 20%, transparent)'}}>
                <span style={{color:'var(--green)'}}>✅</span>
                <p className="text-sm font-medium" style={{color:'var(--green)'}}>Все остатки в норме</p>
              </div>
            )}
            <div className="card">
              <p className="section-title mb-3">Склад — все позиции
                <span className="ml-2 badge badge-neutral">{inventory?.items.length ?? 0}</span>
              </p>
              <div className="space-y-2">
                {inventory?.items.slice(0, 30).map((row) => (
                  <div key={row.id} className="row-item">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{row.point.name}</p>
                      <p className="text-xs text-[var(--muted)] truncate">{row.product.aromaName}</p>
                    </div>
                    <span className={clsx('font-bold text-sm shrink-0', row.quantity <= 3 ? 'text-[var(--red)]' : '')}>{row.quantity} шт.</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === 'analytics' && (
          <section className="space-y-3">
            <div className="card">
              <p className="section-title mb-3">📉 Динамика маржи</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={marginDynamics}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="month" tick={{fontSize:10, fill:'var(--muted)'}} tickLine={false} axisLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: number | undefined) => [v != null ? `${v.toFixed(1)}%` : '—', 'Маржа']} />
                    <Line dataKey="margin" type="monotone" stroke="var(--accent)" strokeWidth={2.5} dot={{r:3, fill:'var(--accent)'}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <p className="section-title mb-3">🅰 ABC-анализ ароматов</p>
              <div className="space-y-2">
                {productAnalytics?.abc.slice(0, 10).map((item) => (
                  <div key={item.productId} className="row-item">
                    <p className="flex-1 text-sm font-medium truncate">{item.productName}</p>
                    <span className={clsx('badge', item.group === 'A' ? 'badge-a' : item.group === 'B' ? 'badge-b' : 'badge-c')}>
                      {item.group}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {(pointAnalytics?.data || []).length > 0 && (
              <div className="card">
                <p className="section-title mb-3">📊 Сравнение точек</p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pointAnalytics?.data || []} barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="pointName" tick={{fontSize:10, fill:'var(--muted)'}} tickLine={false} axisLine={false} />
                      <YAxis hide />
                      <Tooltip />
                      <Bar dataKey="revenue" name="Выручка" fill="var(--green)" radius={[5,5,0,0]} />
                      <Bar dataKey="netProfit" name="ЧП" fill="var(--accent)" radius={[5,5,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <button
        className="fixed bottom-24 right-4 z-30 rounded-full p-4 text-white"
        style={{background:'var(--accent)', boxShadow:'var(--shadow-fab)'}}
        onClick={() => setQuick('sale')}
        title="Быстрое добавление"
      >
        <CirclePlus size={22} />
      </button>

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur px-2 pb-safe pt-1.5">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map((item) => (
            <li key={item.key}>
              <button
                onClick={() => setTab(item.key)}
                className={clsx(
                  'flex w-full flex-col items-center gap-0.5 rounded-2xl px-1 py-2 transition-all',
                  tab === item.key
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted)]',
                )}
              >
                <span className={clsx(
                  'flex h-7 w-12 items-center justify-center rounded-2xl transition-all',
                  tab === item.key ? 'bg-[var(--accent-light)]' : ''
                )}>
                  {item.icon}
                </span>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {quick && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end"
          style={{background:'rgba(0,0,0,.35)', backdropFilter:'blur(4px)'}}
          onClick={() => setQuick(null)}
        >
          <form
            className="mx-auto w-full max-w-md rounded-t-3xl p-5 pb-8"
            style={{background:'var(--card)', boxShadow:'0 -8px 40px rgba(0,0,0,.15)'}}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              await onQuickSubmit(new FormData(e.currentTarget))
              e.currentTarget.reset()
            }}
          >
            {/* Handle */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{background:'var(--line)'}} />

            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold text-[16px]">
                <Sparkles size={16} color="var(--accent)" /> Быстрое добавление
              </h3>
              <button type="button" className="btn-ghost !p-1.5" onClick={() => setQuick(null)}>✕</button>
            </div>

            {/* Type selector */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(['sale', 'expense', 'product'] as QuickAction[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setQuick(type)}
                  className={clsx(
                    'rounded-2xl border-2 py-3 text-xs font-semibold transition-all',
                    quick === type
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                      : 'border-[var(--line)] bg-[var(--soft)] text-[var(--muted)]'
                  )}
                >
                  {type === 'sale' ? '🛒 Продажа' : type === 'expense' ? '🧾 Расход' : '🌸 Продукт'}
                </button>
              ))}
            </div>

            {quick === 'sale' && (
              <div className="grid gap-3">
                <div className="field">
                  <label>Точка</label>
                  <select name="pointId" className="input" required>
                    <option value="">Выберите точку</option>
                    {points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Аромат</label>
                  <select name="productId" className="input" required>
                    <option value="">Выберите аромат</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.aromaName}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field"><label>Количество</label><input required name="quantitySold" type="number" className="input" placeholder="0" /></div>
                  <div className="field"><label>Дата</label><input required name="date" type="date" className="input" defaultValue={dayjs().format('YYYY-MM-DD')} /></div>
                </div>
              </div>
            )}

            {quick === 'expense' && (
              <div className="grid gap-3">
                <div className="field">
                  <label>Категория</label>
                  <select name="category" className="input" required>
                    <option value="OIL">Масло</option>
                    <option value="BASE">База</option>
                    <option value="BOTTLE">Тара</option>
                    <option value="PACKAGING">Упаковка</option>
                    <option value="MARKETING">Реклама</option>
                    <option value="RENT">Аренда</option>
                    <option value="OTHER">Прочее</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field"><label>Сумма (₽)</label><input required name="amount" type="number" step="0.01" className="input" placeholder="0" /></div>
                  <div className="field"><label>Дата</label><input required name="date" type="date" className="input" defaultValue={dayjs().format('YYYY-MM-DD')} /></div>
                </div>
                <div className="field"><label>Комментарий</label><input name="comment" className="input" placeholder="Необязательно" /></div>
              </div>
            )}

            {quick === 'product' && (
              <div className="grid gap-3">
                <div className="field"><label>Название аромата</label><input required name="aromaName" className="input" placeholder="Напр., Tom Ford Black Orchid" /></div>
                <div className="field"><label>Объём (мл)</label><input required name="volumeMl" type="number" className="input" placeholder="50" /></div>
              </div>
            )}

            <button className="btn mt-5 w-full py-3 text-[15px]">Сохранить</button>
          </form>
        </div>
      )}
    </div>
  )
}

function StatCard({ title, value, suffix, color, bg }: { title: string; value: string; suffix?: string; color?: string; bg?: string }) {
  return (
    <div className="stat-card flex flex-col gap-1" style={{background: bg ?? 'var(--card)', border:`1px solid color-mix(in srgb, ${color ?? 'var(--line)'} 20%, transparent)`}}>
      <p className="text-[11px] font-medium uppercase tracking-wider" style={{color:'var(--muted)'}}>{title}</p>
      <p className="text-[22px] font-bold leading-none tracking-tight" style={{color: color ?? 'var(--text)'}}>{value}</p>
      {suffix && <p className="text-[11px] font-medium" style={{color:'var(--muted)'}}>{suffix}</p>}
    </div>
  )
}

export default App
