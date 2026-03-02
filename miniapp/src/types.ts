export type UserRole = 'OWNER' | 'MANAGER' | 'EMPLOYEE'

export type CommissionType = 'PERCENT' | 'FIXED'

export type ExpenseCategory =
  | 'OIL'
  | 'BASE'
  | 'BOTTLE'
  | 'PACKAGING'
  | 'MARKETING'
  | 'RENT'
  | 'OTHER'

export interface User {
  id: number
  telegramId: string
  name: string
  role: UserRole
}

export interface Point {
  id: number
  name: string
  address: string
  commissionType: CommissionType
  commissionValue: number
  bottleSalePrice: number
  isActive: boolean
  isCentral: boolean
}

export interface Product {
  id: number
  aromaName: string
  volumeMl: number
}

export interface DashboardData {
  revenue: number
  grossProfit: number
  netProfit: number
  totalStock: number
  moneyInPoints: number
  monthlySalesChart: { date: string; value: number }[]
}

export interface AnalyticsPoint {
  pointId: number
  pointName: string
  revenue: number
  netProfit: number
  roi: number
}

export interface AnalyticsProduct {
  productId: number
  productName: string
  revenue: number
  netProfit: number
  group?: string
}

export interface BatchCost {
  id: number
  oilMl: number
  baseMl: number
  oilPrice: number
  basePrice: number
  bottlePrice: number
  packagingPrice: number
  otherCosts: number
  yieldedBottles: number
  unitCost: number
  createdAt: string
}

export interface Supply {
  id: number
  pointId: number
  productId: number
  quantity: number
  date: string
  comment?: string
  point: { name: string }
  product: { aromaName: string }
}

export interface CashCollection {
  id: number
  pointId: number
  amount: number
  date: string
  period: string
  comment?: string
  point: { name: string }
}

export interface CashDebt {
  pointId: number
  pointName: string
  totalSales: number
  collected: number
  inTurnover: number
}

export interface Expense {
  id: number
  category: ExpenseCategory
  amount: number
  date: string
  comment?: string
}

export interface SaleRecord {
  id: number
  pointId: number
  productId: number
  quantitySold: number
  date: string
  saleAmount: number
  pointCommission: number
  grossProfit: number
  netProfit: number
  point: { name: string }
  product: { aromaName: string }
}
