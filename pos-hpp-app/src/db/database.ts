import Dexie, { type EntityTable } from 'dexie';
import type {
  User,
  Ingredient,
  Purchase,
  Recipe,
  MenuItem,
  MenuHppHistory,
  Transaction,
  SavedOrder,
  ExpenseCategory,
  Expense,
  MonthlyTarget,
  CashierShift,
  AttendanceRecord,
  AppSettings,
  AuditLog,
  SyncQueueItem,
} from '../types/models';

export class PosHppDatabase extends Dexie {
  users!: EntityTable<User, 'id'>;
  ingredients!: EntityTable<Ingredient, 'id'>;
  purchases!: EntityTable<Purchase, 'id'>;
  recipes!: EntityTable<Recipe, 'id'>;
  menus!: EntityTable<MenuItem, 'id'>;
  menuHppHistory!: EntityTable<MenuHppHistory, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  savedOrders!: EntityTable<SavedOrder, 'id'>;
  expenseCategories!: EntityTable<ExpenseCategory, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  monthlyTargets!: EntityTable<MonthlyTarget, 'bulan'>;
  cashierShifts!: EntityTable<CashierShift, 'id'>;
  attendances!: EntityTable<AttendanceRecord, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;
  auditLogs!: EntityTable<AuditLog, 'id'>;
  syncQueue!: EntityTable<SyncQueueItem, 'id'>;

  constructor() {
    super('PosHppOfflineDB');
    this.version(2).stores({
      users: 'id, username, role, active',
      ingredients: 'id, nama, active',
      purchases: 'id, ingredientId, tanggal, dibatalkan',
      recipes: 'id, nama, isSubRecipe',
      menus: 'id, recipeId, kategori, active',
      menuHppHistory: 'id, menuId, berlakuSejak',
      transactions: 'id, nomorStruk, waktu, kasirId, status, syncStatus',
      savedOrders: 'id, waktuSimpan, kasirId',
      expenseCategories: 'id, nama, sudahMasukHpp',
      expenses: 'id, tanggal, categoryId, sumber, purchaseId, dibatalkan, syncStatus',
      monthlyTargets: 'bulan',
      settings: 'id',
      auditLogs: 'id, userId, waktu, objek',
      syncQueue: 'id, entity, entityId, createdAt',
    });
    this.version(3).stores({
      users: 'id, username, role, active',
      ingredients: 'id, nama, active',
      purchases: 'id, ingredientId, tanggal, dibatalkan',
      recipes: 'id, nama, isSubRecipe',
      menus: 'id, recipeId, kategori, active',
      menuHppHistory: 'id, menuId, berlakuSejak',
      transactions: 'id, nomorStruk, waktu, kasirId, status, syncStatus',
      savedOrders: 'id, waktuSimpan, kasirId',
      expenseCategories: 'id, nama, sudahMasukHpp',
      expenses: 'id, tanggal, categoryId, sumber, purchaseId, dibatalkan, syncStatus',
      monthlyTargets: 'bulan',
      cashierShifts: 'id, kasirId, status, waktuBuka, waktuTutup',
      settings: 'id',
      auditLogs: 'id, userId, waktu, objek',
      syncQueue: 'id, entity, entityId, createdAt',
    });
    this.version(4).stores({
      users: 'id, username, email, role, active',
      ingredients: 'id, nama, active',
      purchases: 'id, ingredientId, tanggal, dibatalkan',
      recipes: 'id, nama, isSubRecipe',
      menus: 'id, recipeId, kategori, active',
      menuHppHistory: 'id, menuId, berlakuSejak',
      transactions: 'id, nomorStruk, waktu, kasirId, status, syncStatus',
      savedOrders: 'id, waktuSimpan, kasirId',
      expenseCategories: 'id, nama, sudahMasukHpp',
      expenses: 'id, tanggal, categoryId, sumber, purchaseId, dibatalkan, syncStatus',
      monthlyTargets: 'bulan',
      cashierShifts: 'id, kasirId, status, waktuBuka, waktuTutup',
      settings: 'id',
      auditLogs: 'id, userId, waktu, objek',
      syncQueue: 'id, entity, entityId, createdAt',
    });
    this.version(5).stores({
      users: 'id, username, email, role, active',
      ingredients: 'id, nama, active',
      purchases: 'id, ingredientId, tanggal, dibatalkan',
      recipes: 'id, nama, isSubRecipe',
      menus: 'id, recipeId, kategori, active',
      menuHppHistory: 'id, menuId, berlakuSejak',
      transactions: 'id, nomorStruk, waktu, kasirId, status, syncStatus',
      savedOrders: 'id, waktuSimpan, kasirId',
      expenseCategories: 'id, nama, sudahMasukHpp',
      expenses: 'id, tanggal, categoryId, sumber, purchaseId, dibatalkan, syncStatus',
      monthlyTargets: 'bulan',
      cashierShifts: 'id, kasirId, status, waktuBuka, waktuTutup',
      attendances: 'id, userId, tanggal, status, clockInAt, clockOutAt, syncStatus',
      settings: 'id',
      auditLogs: 'id, userId, waktu, objek',
      syncQueue: 'id, entity, entityId, createdAt',
    });
  }
}

export const db = new PosHppDatabase();

/**
 * Simple browser-compatible SHA-256 hashing for local auth (FR-AUTH)
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(plain);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback deterministic hash for non-secure context
  let h = 0;
  for (let i = 0; i < plain.length; i++) {
    h = (Math.imul(31, h) + plain.charCodeAt(i)) | 0;
  }
  return `fb_${Math.abs(h).toString(16)}`;
}
