import axios from 'axios'
import type {
  AnalyticsPoint,
  AnalyticsProduct,
  BatchCost,
  CashCollection,
  CashDebt,
  DashboardData,
  Expense,
  Point,
  Product,
  SaleRecord,
  Supply,
  User,
} from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const TOKEN_KEY = 'parfumebot_token'

export const api = axios.create({
  baseURL: API_URL,
})

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    localStorage.removeItem(TOKEN_KEY)
    delete api.defaults.headers.common.Authorization
  }
}

export function initTokenFromStorage() {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) setToken(token)
  return token
}

export async function telegramAuth(initData: string) {
  const { data } = await api.post<{ token: string; user: User }>('/auth/telegram', { initData })
  setToken(data.token)
  return data.user
}

export async function getMe() {
  const { data } = await api.get<User>('/me')
  return data
}

export async function getDashboard(from: string, to: string) {
  const { data } = await api.get<DashboardData>('/analytics/dashboard', { params: { from, to } })
  return data
}

export async function getPoints() {
  const { data } = await api.get<Point[]>('/points')
  return data
}

export async function createPoint(payload: Partial<Point>) {
  const { data } = await api.post<Point>('/points', payload)
  return data
}

export async function getProducts() {
  const { data } = await api.get<Product[]>('/products')
  return data
}

export async function createProduct(payload: Partial<Product>) {
  const { data } = await api.post<Product>('/products', payload)
  return data
}

export async function createSale(payload: {
  pointId: number
  productId: number
  quantitySold: number
  date?: string
}) {
  const { data } = await api.post('/sales', payload)
  return data
}

export async function createExpense(payload: {
  category: string
  amount: number
  date?: string
  comment?: string
}) {
  const { data } = await api.post('/expenses', payload)
  return data
}

export async function getInventory() {
  const { data } = await api.get('/inventory')
  return data
}

export async function getPointAnalytics() {
  const { data } = await api.get<{ data: AnalyticsPoint[]; bestPoints: AnalyticsPoint[] }>('/analytics/points')
  return data
}

export async function getProductAnalytics() {
  const { data } = await api.get<{ data: AnalyticsProduct[]; topProducts: AnalyticsProduct[]; abc: AnalyticsProduct[] }>('/analytics/products')
  return data
}

export async function getMarginDynamics() {
  const { data } = await api.get<{ month: string; margin: number }[]>('/analytics/margin-dynamics')
  return data
}

export async function getSales(from?: string, to?: string) {
  const { data } = await api.get<SaleRecord[]>('/sales', { params: { from, to } })
  return data
}

export async function getBatches() {
  const { data } = await api.get<BatchCost[]>('/production/batches')
  return data
}

export async function createBatch(payload: {
  oilMl: number
  baseMl: number
  oilPrice: number
  basePrice: number
  bottlePrice: number
  packagingPrice: number
  otherCosts: number
  yieldedBottles: number
}) {
  const { data } = await api.post<BatchCost>('/production/batches', payload)
  return data
}

export async function getSupplies() {
  const { data } = await api.get<Supply[]>('/supplies')
  return data
}

export async function createSupply(payload: {
  pointId: number
  productId: number
  quantity: number
  date: string
  comment?: string
}) {
  const { data } = await api.post('/supplies', payload)
  return data
}

export async function getCollections() {
  const { data } = await api.get<CashCollection[]>('/cash-collections')
  return data
}

export async function createCollection(payload: {
  pointId: number
  amount: number
  date: string
  period: string
  comment?: string
}) {
  const { data } = await api.post('/cash-collections', payload)
  return data
}

export async function getDebts() {
  const { data } = await api.get<CashDebt[]>('/cash-collections/debts')
  return data
}

export async function getExpenses() {
  const { data } = await api.get<{ items: Expense[]; total: number }>('/expenses')
  return data
}
