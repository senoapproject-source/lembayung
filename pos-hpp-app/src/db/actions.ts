import { v4 as uuidv4 } from 'uuid';
import { db, hashPassword } from './database';
import { seedInitialDataIfEmpty } from './seed';
import {
  calcActiveIngredientPrice,
  calcPurchaseUnitPrice,
  calcRecipeHpp,
  formatRupiah,
} from '../lib/calculations';
import {
  deleteMenuFromSupabase,
  pushAllLocalToSupabase,
  upsertMenuToSupabase,
} from '../services/syncService';
import { sendDeviceNotification } from '../services/notificationService';
import { sendShiftCloseEmailToOwner } from '../services/authEmailService';
import type {
  Purchase,
  Recipe,
  MenuItem,
  MenuHppHistory,
  Transaction,
  SavedOrder,
  Expense,
  User,
  CashierShift,
  AppSettings,
  PaymentMethod,
} from '../types/models';

export async function addAuditLog(
  user: User,
  aksi: string,
  objek: string,
  detail: string
): Promise<void> {
  await db.auditLogs.add({
    id: uuidv4(),
    userId: user.id,
    userNama: user.nama,
    waktu: new Date().toISOString(),
    aksi,
    objek,
    detail,
  });
}

export async function enqueueSync(
  entity: 'transaction' | 'purchase' | 'expense' | 'master' | 'attendance',
  entityId: string,
  action: 'upsert' | 'void' | 'delete',
  payload: unknown
): Promise<void> {
  await db.syncQueue.add({
    id: uuidv4(),
    entity,
    entityId,
    action,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
  });

  // Jika sedang online, langsung kirim ke Supabase di background tanpa perlu klik manual
  // Hanya ikut upsert tabel users jika memang ada perubahan user (mencegah user terhapus hidup lagi dari HP/Tab lain)
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    const isUserChange = Boolean((payload as { isUser?: boolean } | null)?.isUser);
    pushAllLocalToSupabase({ includeUsers: isUserChange }).catch(() => { });
  }
}

/**
 * FR-BHN-08 & FR-HPP-07:
 * Hitung ulang semua harga aktif bahan, HPP seluruh resep (termasuk sub-resep),
 * dan catat riwayat HPP menu jika HPP berubah.
 */
export async function recalculateAllPricingAndHpp(): Promise<void> {
  const settings = await db.settings.get('global');
  const method = settings?.metodeHargaBahan ?? 'weighted_avg';
  const nCount = settings?.jumlahPembelianN ?? 5;

  const ingredients = await db.ingredients.toArray();
  const purchases = await db.purchases.toArray();
  const recipes = await db.recipes.toArray();
  const menus = await db.menus.toArray();

  const nowIso = new Date().toISOString();

  // 1. Update active price of each ingredient
  for (const ing of ingredients) {
    const ingPurchases = purchases.filter((p) => p.ingredientId === ing.id);
    const newPrice = calcActiveIngredientPrice(ingPurchases, method, nCount);
    if (Math.abs(newPrice - ing.hargaAktif) > 0.001) {
      ing.hargaAktif = newPrice;
      ing.updatedAt = nowIso;
    }
  }

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));
  const recMap = new Map(recipes.map((r) => [r.id, r]));

  // 2. Recalculate every recipe HPP
  const oldHppByRecipe = new Map(recipes.map((r) => [r.id, r.hppPerPorsi]));
  for (const rec of recipes) {
    const breakdown = calcRecipeHpp(rec, ingMap, recMap);
    rec.hppPerPorsi = Math.round(breakdown.hppPerPorsi);
    rec.hasMissingPrice = breakdown.hasMissingPrice;
    rec.updatedAt = nowIso;
  }

  // 3. Record MenuHppHistory if recipe HPP changed
  const newHistories: MenuHppHistory[] = [];
  for (const menu of menus) {
    const rec = recMap.get(menu.recipeId);
    if (!rec) continue;
    const oldHpp = oldHppByRecipe.get(menu.recipeId);
    if (oldHpp !== rec.hppPerPorsi) {
      newHistories.push({
        id: uuidv4(),
        menuId: menu.id,
        hpp: rec.hppPerPorsi,
        berlakuSejak: nowIso,
      });
    }
  }

  await db.transaction(
    'rw',
    [db.ingredients, db.recipes, db.menuHppHistory],
    async () => {
      await db.ingredients.bulkPut(ingredients);
      await db.recipes.bulkPut(recipes);
      if (newHistories.length > 0) {
        await db.menuHppHistory.bulkPut(newHistories);
      }
    }
  );
}

/**
 * FR-BHN-02, FR-BHN-07, FR-BHN-08:
 * Simpan pembelian bahan -> otomatis buat pengeluaran kategori Bahan Baku -> update harga bahan & HPP resep.
 */
export async function recordPurchase(
  input: {
    ingredientId: string;
    tanggal: string;
    jumlahBeli: number;
    satuanBeli: string;
    totalHarga: number;
    satuanDasarDidapat: number;
    penjual?: string;
  },
  user: User
): Promise<Purchase> {
  const ing = await db.ingredients.get(input.ingredientId);
  if (!ing) throw new Error('Bahan baku tidak ditemukan');

  const nowIso = new Date().toISOString();
  const purchaseId = uuidv4();
  const hargaPerSatuanDasar = calcPurchaseUnitPrice(
    input.totalHarga,
    input.satuanDasarDidapat
  );

  const purchase: Purchase = {
    id: purchaseId,
    ingredientId: input.ingredientId,
    tanggal: input.tanggal,
    jumlahBeli: input.jumlahBeli,
    satuanBeli: input.satuanBeli,
    totalHarga: input.totalHarga,
    satuanDasarDidapat: input.satuanDasarDidapat,
    hargaPerSatuanDasar,
    penjual: input.penjual?.trim() || undefined,
    pembuatId: user.id,
    pembuatNama: user.nama,
    createdAt: nowIso,
  };

  // FR-BHN-07: Otomatis membuat catatan pengeluaran kategori Bahan Baku
  const expense: Expense = {
    id: `exp-pur-${purchaseId}`,
    tanggal: input.tanggal,
    categoryId: 'cat-bahan',
    categoryNama: 'Bahan Baku',
    nominal: input.totalHarga,
    keterangan: `${ing.nama} (${input.jumlahBeli} ${input.satuanBeli} → ${input.satuanDasarDidapat} ${ing.labelSatuanDasar})${input.penjual ? ` · ${input.penjual}` : ''}`,
    biayaTetap: false,
    sumber: 'pembelian',
    purchaseId,
    pembuatId: user.id,
    pembuatNama: user.nama,
    createdAt: nowIso,
    syncStatus: 'pending',
  };

  await db.transaction('rw', [db.purchases, db.expenses], async () => {
    await db.purchases.add(purchase);
    await db.expenses.add(expense);
  });

  await recalculateAllPricingAndHpp();
  await addAuditLog(
    user,
    'TAMBAH_PEMBELIAN',
    `Bahan: ${ing.nama}`,
    `${input.jumlahBeli} ${input.satuanBeli} (${input.satuanDasarDidapat} ${ing.labelSatuanDasar}) · Rp${input.totalHarga}`
  );
  await enqueueSync('purchase', purchaseId, 'upsert', { purchase, expense });

  return purchase;
}

/**
 * FR-BHN-09: Batalkan pembelian -> otomatis batalkan pengeluaran terkait -> hitung ulang harga & HPP
 */
export async function cancelPurchase(purchaseId: string, user: User): Promise<void> {
  const purchase = await db.purchases.get(purchaseId);
  if (!purchase) return;

  await db.transaction('rw', [db.purchases, db.expenses], async () => {
    await db.purchases.update(purchaseId, { dibatalkan: true });
    const linked = await db.expenses.where('purchaseId').equals(purchaseId).first();
    if (linked) {
      await db.expenses.update(linked.id, { dibatalkan: true });
    }
  });

  await recalculateAllPricingAndHpp();
  await addAuditLog(
    user,
    'BATAL_PEMBELIAN',
    `Pembelian ${purchaseId}`,
    `Total Rp${purchase.totalHarga} dibatalkan`
  );
  await enqueueSync('purchase', purchaseId, 'void', { purchaseId });
}

/**
 * Simpan / Update Resep & hitung ulang HPP seluruh resep & menu
 */
export async function saveRecipe(recipe: Recipe, user: User): Promise<void> {
  await db.recipes.put(recipe);
  await recalculateAllPricingAndHpp();
  await addAuditLog(user, 'SIMPAN_RESEP', recipe.nama, `Porsi: ${recipe.jumlahPorsiHasil}`);
  await enqueueSync('master', recipe.id, 'upsert', recipe);
}

/**
 * Simpan Menu (mendukung menu dari resep maupun menu tanpa resep dengan HPP manual opsional)
 */
export async function saveMenu(menu: MenuItem, user: User): Promise<void> {
  const recipe = menu.recipeId ? await db.recipes.get(menu.recipeId) : undefined;
  const effectiveHpp = recipe ? recipe.hppPerPorsi : Math.max(0, Math.round(menu.hppManual ?? 0));

  const normalizedMenu: MenuItem = {
    ...menu,
    recipeId: recipe ? recipe.id : '',
    hppManual: recipe ? undefined : menu.hppManual !== undefined ? effectiveHpp : undefined,
    updatedAt: new Date().toISOString(),
  };

  await db.menus.put(normalizedMenu);

  // Pastikan riwayat HPP selalu mencatat nilai HPP terbaru (termasuk untuk menu HPP manual agar ikut tersinkron ke Cloud)
  const histories = await db.menuHppHistory.where('menuId').equals(normalizedMenu.id).toArray();
  const latestHist = histories.sort((a, b) => b.berlakuSejak.localeCompare(a.berlakuSejak))[0];
  let createdHist: MenuHppHistory | undefined;
  if (!latestHist || latestHist.hpp !== effectiveHpp) {
    createdHist = {
      id: uuidv4(),
      menuId: normalizedMenu.id,
      hpp: effectiveHpp,
      berlakuSejak: new Date().toISOString(),
    };
    await db.menuHppHistory.add(createdHist);
  }

  await addAuditLog(
    user,
    'SIMPAN_MENU',
    normalizedMenu.nama,
    `Harga jual: Rp${normalizedMenu.hargaJual}${recipe ? '' : effectiveHpp > 0 ? ` · HPP manual: Rp${effectiveHpp}` : ' · Tanpa resep'}`
  );
  sendDeviceNotification({
    title: `Menu Disimpan: ${normalizedMenu.nama}`,
    body: `Harga jual ${formatRupiah(normalizedMenu.hargaJual)} · ${normalizedMenu.kategori} (oleh ${user.nama})`,
    dedupKey: `menu-${normalizedMenu.id}-${normalizedMenu.updatedAt}`,
  });

  // Langsung upsert ke Supabase secara sinkron (await) agar edit harga tidak tertimpa background pull
  const cloudRes = await upsertMenuToSupabase(normalizedMenu, createdHist ?? latestHist);
  if (!cloudRes.success) {
    await enqueueSync('master', normalizedMenu.id, 'upsert', normalizedMenu);
  }
}

/**
 * Hapus Menu (riwayat transaksi lama tetap aman karena menyimpan snapshot nama & HPP)
 */
export async function deleteMenu(menuId: string, user: User): Promise<void> {
  const existing = await db.menus.get(menuId);
  if (!existing) return;

  await db.transaction('rw', [db.menus, db.menuHppHistory], async () => {
    await db.menus.delete(menuId);
    await db.menuHppHistory.where('menuId').equals(menuId).delete();
  });

  await addAuditLog(user, 'HAPUS_MENU', existing.nama, `Harga jual terakhir: Rp${existing.hargaJual}`);
  sendDeviceNotification({
    title: `Menu Dihapus: ${existing.nama}`,
    body: `Menu ${existing.nama} dihapus oleh ${user.nama}`,
    dedupKey: `menu-del-${menuId}`,
  });

  const cloudRes = await deleteMenuFromSupabase(menuId);
  if (!cloudRes.success) {
    await enqueueSync('master', menuId, 'delete', { table: 'menus', id: menuId });
  }
}

/**
 * FR-POS-01..05 & Offline-First:
 * Buat transaksi kasir dengan UUID unik perangkat dan snapshot HPP saat transaksi.
 */
export async function createPosTransaction(
  params: {
    items: Array<{
      menu: MenuItem;
      jumlah: number;
      catatan?: string;
    }>;
    metodeBayar: PaymentMethod;
    diskonNominal: number;
    diskonLabel?: string;
    uangDiterima: number;
    namaPelanggan?: string;
    noWaPelanggan?: string;
    savedOrderIdToDelete?: string;
  },
  user: User
): Promise<Transaction> {
  const recipes = await db.recipes.toArray();
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));

  const txCount = await db.transactions.count();
  const nomorStruk = `#${String(txCount + 140).padStart(4, '0')}`;

  const txItems = params.items.map((it) => {
    const rec = it.menu.recipeId ? recipeMap.get(it.menu.recipeId) : undefined;
    const snapshotHpp = rec ? rec.hppPerPorsi : (it.menu.hppManual ?? 0);
    return {
      id: uuidv4(),
      menuId: it.menu.id,
      menuNama: it.menu.nama,
      jumlah: it.jumlah,
      hargaJual: it.menu.hargaJual,
      snapshotHpp,
      catatan: it.catatan?.trim() || undefined,
    };
  });

  const subtotal = txItems.reduce((s, i) => s + i.hargaJual * i.jumlah, 0);
  const total = Math.max(0, subtotal - params.diskonNominal);
  const uangDiterima = params.metodeBayar === 'Cash' ? params.uangDiterima : total;
  const kembalian = Math.max(0, uangDiterima - total);

  const tx: Transaction = {
    id: uuidv4(),
    nomorStruk,
    waktu: new Date().toISOString(),
    kasirId: user.id,
    kasirNama: user.nama,
    namaPelanggan: params.namaPelanggan?.trim() || undefined,
    noWaPelanggan: params.noWaPelanggan?.trim() || undefined,
    metodeBayar: params.metodeBayar,
    subtotal,
    diskonNominal: params.diskonNominal,
    diskonLabel: params.diskonLabel,
    total,
    uangDiterima,
    kembalian,
    status: 'selesai',
    items: txItems,
    syncStatus: navigator.onLine ? 'synced' : 'pending',
  };

  await db.transaction('rw', [db.transactions, db.savedOrders], async () => {
    await db.transactions.add(tx);
    if (params.savedOrderIdToDelete) {
      await db.savedOrders.delete(params.savedOrderIdToDelete);
    }
  });
  await addAuditLog(user, 'TRANSAKSI_BARU', nomorStruk, `Total Rp${total} (${params.metodeBayar})`);
  sendDeviceNotification({
    title: `Penjualan Berhasil ${nomorStruk} (${params.metodeBayar})`,
    body: `${formatRupiah(total)} · Kasir: ${user.nama}${tx.namaPelanggan ? ` · ${tx.namaPelanggan}` : ''
      }`,
    dedupKey: `tx-new-${tx.id}`,
    broadcastFcm: true,
  });
  await enqueueSync('transaction', tx.id, 'upsert', tx);

  return tx;
}

/**
 * Simpan Orderan Sementara (Open Bill / Hold Order) sebelum dibayar
 */
export async function saveHoldOrder(
  params: {
    id?: string;
    labelMejaPelanggan: string;
    noWaPelanggan?: string;
    items: Array<{
      menu: MenuItem;
      jumlah: number;
      catatan?: string;
    }>;
  },
  user: User
): Promise<SavedOrder> {
  const orderId = params.id || uuidv4();
  const saved: SavedOrder = {
    id: orderId,
    labelMejaPelanggan: params.labelMejaPelanggan.trim() || 'Pesanan Tanpa Nama',
    noWaPelanggan: params.noWaPelanggan?.trim() || undefined,
    waktuSimpan: new Date().toISOString(),
    kasirId: user.id,
    kasirNama: user.nama,
    items: params.items.map((it) => ({
      id: uuidv4(),
      menuId: it.menu.id,
      menuNama: it.menu.nama,
      hargaJual: it.menu.hargaJual,
      jumlah: it.jumlah,
      catatan: it.catatan?.trim() || undefined,
    })),
  };

  await db.savedOrders.put(saved);
  await addAuditLog(
    user,
    'SIMPAN_ORDER',
    saved.labelMejaPelanggan,
    `${saved.items.reduce((s, i) => s + i.jumlah, 0)} item disimpan`
  );
  sendDeviceNotification({
    title: `Pesanan Disimpan: ${saved.labelMejaPelanggan}`,
    body: `${saved.items.reduce((s, i) => s + i.jumlah, 0)} item · Kasir: ${user.nama}`,
    dedupKey: `hold-${saved.id}-${saved.waktuSimpan}`,
  });
  await enqueueSync('master', saved.id, 'upsert', saved);
  return saved;
}

export async function deleteHoldOrder(orderId: string): Promise<void> {
  await db.savedOrders.delete(orderId);
  await enqueueSync('master', orderId, 'delete', { orderId });
}

/**
 * FR-POS-06: Void transaksi (Hanya Owner, wajib alasan)
 */
export async function voidTransaction(
  txId: string,
  alasan: string,
  actor: User
): Promise<void> {
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new Error('Hanya Owner atau Manager yang dapat membatalkan transaksi');
  }
  if (!alasan.trim()) throw new Error('Alasan pembatalan wajib diisi');

  const tx = await db.transactions.get(txId);
  if (!tx) throw new Error('Transaksi tidak ditemukan');

  await db.transactions.update(txId, {
    status: 'void',
    alasanVoid: alasan.trim(),
    voidBy: actor.nama,
    voidAt: new Date().toISOString(),
    syncStatus: navigator.onLine ? 'synced' : 'pending',
  });

  await addAuditLog(actor, 'VOID_TRANSAKSI', tx.nomorStruk, `Alasan: ${alasan.trim()}`);
  sendDeviceNotification({
    title: `Transaksi Dibatalkan (Void) ${tx.nomorStruk}`,
    body: `${formatRupiah(tx.total)} · Alasan: ${alasan.trim()}`,
    dedupKey: `tx-void-${txId}`,
    broadcastFcm: true,
  });
  await enqueueSync('transaction', txId, 'void', { txId, alasan: alasan.trim() });
}

/**
 * Update pengaturan global & langsung hitung ulang HPP jika metode harga berubah
 */
export async function updateSettings(
  patch: Partial<AppSettings>,
  user: User
): Promise<void> {
  const current = (await db.settings.get('global')) ?? {
    id: 'global' as const,
    namaUsaha: 'Lembayung',
    namaCabang: 'Pusat',
    alamatUsaha: '-',
    teleponUsaha: '',
    strukFooter: 'Terima kasih!',
    strukTampilkanKasir: true,
    strukTampilkanCatatanItem: true,
    strukTampilkanWaUsaha: true,
    defaultMarginPersen: 50,
    metodeHargaBahan: 'last' as const,
    jumlahPembelianN: 5,
    pembulatanHarga: 500 as const,
    ambangMepetBepPersen: 10,
    defaultKasirDiscount: false,
    defaultKasirRecordExpense: true,
    cloudSyncMode: 'supabase' as const,
    outletId: '',
    lastBackupAt: '',
  };
  const updated: AppSettings = { ...current, ...patch };
  await db.settings.put(updated);

  if (
    patch.metodeHargaBahan !== undefined ||
    patch.jumlahPembelianN !== undefined
  ) {
    await recalculateAllPricingAndHpp();
  }

  await addAuditLog(user, 'UBAH_PENGATURAN', 'Pengaturan Global', Object.keys(patch).join(', '));
  await enqueueSync('master', 'global', 'upsert', updated);
}

/**
 * Ekspor seluruh database lokal sebagai JSON backup (FR-SET-03)
 */
export async function exportAllDataJson(): Promise<string> {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'POS & Kalkulator HPP v1.0',
    settings: await db.settings.toArray(),
    users: await db.users.toArray(),
    ingredients: await db.ingredients.toArray(),
    purchases: await db.purchases.toArray(),
    recipes: await db.recipes.toArray(),
    menus: await db.menus.toArray(),
    menuHppHistory: await db.menuHppHistory.toArray(),
    expenseCategories: await db.expenseCategories.toArray(),
    expenses: await db.expenses.toArray(),
    transactions: await db.transactions.toArray(),
    savedOrders: await db.savedOrders.toArray(),
    monthlyTargets: await db.monthlyTargets.toArray(),
    auditLogs: await db.auditLogs.toArray(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Restore / Impor Backup JSON ke database lokal
 */
export async function importAllDataJson(rawJson: string): Promise<void> {
  const data = JSON.parse(rawJson);
  if (!data || typeof data !== 'object' || !Array.isArray(data.settings)) {
    throw new Error('Format file backup tidak valid.');
  }

  await db.transaction(
    'rw',
    [
      db.settings,
      db.users,
      db.expenseCategories,
      db.ingredients,
      db.purchases,
      db.recipes,
      db.menus,
      db.menuHppHistory,
      db.expenses,
      db.transactions,
      db.savedOrders,
      db.monthlyTargets,
      db.auditLogs,
      db.syncQueue,
    ],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.users.clear(),
        db.expenseCategories.clear(),
        db.ingredients.clear(),
        db.purchases.clear(),
        db.recipes.clear(),
        db.menus.clear(),
        db.menuHppHistory.clear(),
        db.expenses.clear(),
        db.transactions.clear(),
        db.savedOrders.clear(),
        db.monthlyTargets.clear(),
        db.auditLogs.clear(),
        db.syncQueue.clear(),
      ]);

      if (data.settings?.length) await db.settings.bulkPut(data.settings);
      if (data.users?.length) await db.users.bulkPut(data.users);
      if (data.expenseCategories?.length) await db.expenseCategories.bulkPut(data.expenseCategories);
      if (data.ingredients?.length) await db.ingredients.bulkPut(data.ingredients);
      if (data.purchases?.length) await db.purchases.bulkPut(data.purchases);
      if (data.recipes?.length) await db.recipes.bulkPut(data.recipes);
      if (data.menus?.length) await db.menus.bulkPut(data.menus);
      if (data.menuHppHistory?.length) await db.menuHppHistory.bulkPut(data.menuHppHistory);
      if (data.expenses?.length) await db.expenses.bulkPut(data.expenses);
      if (data.transactions?.length) await db.transactions.bulkPut(data.transactions);
      if (data.savedOrders?.length) await db.savedOrders.bulkPut(data.savedOrders);
      if (data.monthlyTargets?.length) await db.monthlyTargets.bulkPut(data.monthlyTargets);
      if (data.auditLogs?.length) await db.auditLogs.bulkPut(data.auditLogs);
    }
  );
}

/**
 * Bersihkan seluruh data operasional (transaksi, bahan, resep, menu, pengeluaran)
 * namun mempertahankan akun Owner & kategori bawaan.
 */
export async function resetOperationalData(owner: User): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.ingredients,
      db.purchases,
      db.recipes,
      db.menus,
      db.menuHppHistory,
      db.expenses,
      db.transactions,
      db.savedOrders,
      db.monthlyTargets,
      db.auditLogs,
      db.syncQueue,
    ],
    async () => {
      await Promise.all([
        db.ingredients.clear(),
        db.purchases.clear(),
        db.recipes.clear(),
        db.menus.clear(),
        db.menuHppHistory.clear(),
        db.expenses.clear(),
        db.transactions.clear(),
        db.savedOrders.clear(),
        db.monthlyTargets.clear(),
        db.auditLogs.clear(),
        db.syncQueue.clear(),
      ]);
    }
  );

  await addAuditLog(owner, 'RESET_DATA', 'Database Lokal', 'Seluruh data operasional dibersihkan untuk mulai dari kosong');
}

export function generateOutletCode(namaUsaha: string): string {
  const clean = namaUsaha
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, 'X');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${clean}-${rand}`;
}

/**
 * Generate PIN Otorisasi Mode Kasir 6 angka acak yang tidak bentrok dengan PIN yang dikecualikan
 * (mis. PIN pribadi Owner) dan menghindari pola angka terlalu mudah ditebak.
 */
export function generateKasirAuthPin(excludePins: string[] = []): string {
  const excluded = new Set(excludePins.map((p) => p.trim()).filter(Boolean));
  const weakPatterns = new Set([
    '000000', '111111', '222222', '333333', '444444',
    '555555', '666666', '777777', '888888', '999999',
    '123456', '654321', '012345', '543210',
  ]);
  for (let i = 0; i < 300; i++) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    if (!excluded.has(candidate) && !weakPatterns.has(candidate)) {
      return candidate;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Registrasi Usaha Baru (Onboarding Owner Multi-Merchant).
 * Menghapus data demo sebelumnya, membuat Kode Toko (outletId) unik & PIN Otorisasi Mode Kasir,
 * menyimpan profil usaha & akun Owner baru, dan otomatis menyinkronkan ke Cloud Supabase.
 */
export async function registerNewBusiness(input: {
  namaUsaha: string;
  alamatUsaha: string;
  namaOwner: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  password: string;
  pin?: string;
  includeSampleData: boolean;
  customOutletId?: string;
  customKasirAuthPin?: string;
}): Promise<{ owner: User; outletId: string; kasirAuthPin: string }> {
  const nowIso = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  const outletId =
    input.customOutletId?.trim().toUpperCase() ||
    generateOutletCode(input.namaUsaha);
  const kasirAuthPin =
    input.customKasirAuthPin?.trim() ||
    generateKasirAuthPin(input.pin ? [input.pin.trim()] : []);

  // Bersihkan seluruh database lama
  await db.transaction(
    'rw',
    [
      db.settings,
      db.users,
      db.expenseCategories,
      db.ingredients,
      db.purchases,
      db.recipes,
      db.menus,
      db.menuHppHistory,
      db.expenses,
      db.transactions,
      db.savedOrders,
      db.monthlyTargets,
      db.auditLogs,
      db.syncQueue,
    ],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.users.clear(),
        db.expenseCategories.clear(),
        db.ingredients.clear(),
        db.purchases.clear(),
        db.recipes.clear(),
        db.menus.clear(),
        db.menuHppHistory.clear(),
        db.expenses.clear(),
        db.transactions.clear(),
        db.savedOrders.clear(),
        db.monthlyTargets.clear(),
        db.auditLogs.clear(),
        db.syncQueue.clear(),
      ]);
    }
  );

  if (input.includeSampleData) {
    await seedInitialDataIfEmpty();
    // Ganti profil usaha & akun owner utama dengan input user
    const currentSettings = await db.settings.get('global');
    if (currentSettings) {
      await db.settings.put({
        ...currentSettings,
        namaUsaha: input.namaUsaha.trim(),
        namaCabang: 'Pusat',
        ownerEmail: input.email?.trim().toLowerCase() || undefined,
        alamatUsaha: input.alamatUsaha.trim() || '-',
        kasirAuthPin,
        cloudSyncMode: 'supabase',
        outletId,
      });
    }
    const newOwner: User = {
      id: 'usr-owner-1',
      nama: input.namaOwner.trim(),
      username: input.username.trim(),
      email: input.email?.trim().toLowerCase() || undefined,
      emailVerified: input.emailVerified ?? false,
      passwordHash,
      pin: input.pin?.trim() || undefined,
      role: 'owner',
      canDiscount: true,
      canRecordExpense: true,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await db.users.put(newOwner);
    if (navigator.onLine) {
      await pushAllLocalToSupabase({ includeUsers: true }).catch(() => { });
    }
    return { owner: newOwner, outletId, kasirAuthPin };
  }

  // Mulai dari kosong (hanya settings, kategori bawaan, dan akun Owner baru)
  const newOwner: User = {
    id: uuidv4(),
    nama: input.namaOwner.trim(),
    username: input.username.trim(),
    email: input.email?.trim().toLowerCase() || undefined,
    emailVerified: input.emailVerified ?? false,
    passwordHash,
    pin: input.pin?.trim() || undefined,
    role: 'owner',
    canDiscount: true,
    canRecordExpense: true,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await db.transaction('rw', [db.settings, db.users, db.expenseCategories], async () => {
    await db.settings.put({
      id: 'global',
      namaUsaha: input.namaUsaha.trim(),
      namaCabang: 'Pusat',
      ownerEmail: input.email?.trim().toLowerCase() || undefined,
      alamatUsaha: input.alamatUsaha.trim() || '-',
      teleponUsaha: '',
      strukHeader: '',
      strukFooter: `Terima kasih sudah berbelanja di ${input.namaUsaha.trim()}!`,
      strukTampilkanKasir: true,
      strukTampilkanCatatanItem: true,
      strukTampilkanWaUsaha: true,
      defaultMarginPersen: 40,
      metodeHargaBahan: 'weighted_avg',
      jumlahPembelianN: 5,
      pembulatanHarga: 500,
      ambangMepetBepPersen: 10,
      defaultKasirDiscount: false,
      defaultKasirRecordExpense: true,
      kasirAuthPin,
      lastBackupAt: nowIso,
      cloudSyncMode: 'supabase',
      outletId,
    });
    await db.users.add(newOwner);
    await db.expenseCategories.bulkPut([
      { id: 'cat-bahan', nama: 'Bahan Baku', sudahMasukHpp: true, isSystem: true },
      { id: 'cat-sewa', nama: 'Sewa', sudahMasukHpp: false },
      { id: 'cat-gas', nama: 'Gas/Listrik', sudahMasukHpp: false },
      { id: 'cat-gaji', nama: 'Gaji', sudahMasukHpp: false },
      { id: 'cat-kemasan', nama: 'Kemasan', sudahMasukHpp: false },
      { id: 'cat-lain', nama: 'Lain-lain', sudahMasukHpp: false },
    ]);
  });

  if (navigator.onLine) {
    await pushAllLocalToSupabase({ includeUsers: true }).catch(() => { });
  }

  return { owner: newOwner, outletId, kasirAuthPin };
}

/**
 * Buka Kasir (Open Shift): catat modal awal laci kasir sebelum transaksi dimulai
 */
export async function openCashierShift(modalAwal: number, user: User): Promise<CashierShift> {
  const nowIso = new Date().toISOString();
  const shift: CashierShift = {
    id: uuidv4(),
    kasirId: user.id,
    kasirNama: user.nama,
    waktuBuka: nowIso,
    status: 'open',
    modalAwal: Math.max(0, Math.round(modalAwal)),
    pendapatanCash: 0,
    pendapatanQris: 0,
    pendapatanTransfer: 0,
    pengeluaranKasir: 0,
    expectedCash: Math.max(0, Math.round(modalAwal)),
  };

  await db.cashierShifts.add(shift);
  await addAuditLog(user, 'BUKA_KASIR', user.nama, `Modal awal: Rp${shift.modalAwal}`);
  sendDeviceNotification({
    title: `Buka Kasir: ${user.nama}`,
    body: `Modal awal laci ${formatRupiah(shift.modalAwal)}`,
    dedupKey: `shift-open-${shift.id}`,
    broadcastFcm: true,
  });
  await enqueueSync('master', shift.id, 'upsert', shift);
  return shift;
}

/**
 * Tutup Kasir (Close Shift): hitung total pendapatan cash, pengeluaran kasir, expected cash & selisih fisik
 */
export async function closeCashierShift(
  shiftId: string,
  uangFisikAkhir: number,
  catatan: string | undefined,
  user: User
): Promise<CashierShift | null> {
  const shift = await db.cashierShifts.get(shiftId);
  if (!shift) return null;

  const nowIso = new Date().toISOString();
  const [allTxs, allExps] = await Promise.all([
    db.transactions.toArray(),
    db.expenses.toArray(),
  ]);

  let pendapatanCash = 0;
  let pendapatanQris = 0;
  let pendapatanTransfer = 0;
  for (const tx of allTxs) {
    if (tx.status === 'void') continue;
    if (tx.kasirId !== shift.kasirId) continue;
    if (tx.waktu < shift.waktuBuka || tx.waktu > nowIso) continue;
    if (tx.metodeBayar === 'Cash') pendapatanCash += tx.total;
    else if (tx.metodeBayar === 'QRIS') pendapatanQris += tx.total;
    else if (tx.metodeBayar === 'Transfer') pendapatanTransfer += tx.total;
  }

  let pengeluaranKasir = 0;
  for (const exp of allExps) {
    if (exp.dibatalkan || exp.sumber !== 'manual') continue;
    if (exp.pembuatId !== shift.kasirId) continue;
    if (exp.createdAt < shift.waktuBuka || exp.createdAt > nowIso) continue;
    pengeluaranKasir += exp.nominal;
  }

  const expectedCash = shift.modalAwal + pendapatanCash - pengeluaranKasir;
  const fisik = Math.max(0, Math.round(uangFisikAkhir));
  const selisih = fisik - expectedCash;

  const closedShift: CashierShift = {
    ...shift,
    waktuTutup: nowIso,
    status: 'closed',
    pendapatanCash,
    pendapatanQris,
    pendapatanTransfer,
    pengeluaranKasir,
    expectedCash,
    uangFisikAkhir: fisik,
    selisih,
    catatan,
  };

  await db.cashierShifts.put(closedShift);
  await addAuditLog(
    user,
    'TUTUP_KASIR',
    shift.kasirNama,
    `Fisik: Rp${fisik} · Expected: Rp${expectedCash} · Selisih: Rp${selisih}`
  );
  sendDeviceNotification({
    title: `Tutup Kasir: ${shift.kasirNama}`,
    body: `Fisik ${formatRupiah(fisik)} · Cash ${formatRupiah(pendapatanCash)} · Selisih ${selisih === 0 ? 'Pas (Rp0)' : `${selisih > 0 ? '+' : ''}${formatRupiah(selisih)}`
      }`,
    dedupKey: `shift-close-${shift.id}`,
    broadcastFcm: true,
  });
  await enqueueSync('master', shift.id, 'upsert', closedShift);
  // Kirim email otomatis rekap Tutup Kasir ke Owner di background (tidak menghambat proses tutup kasir)
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    sendShiftCloseEmailToOwner(closedShift).catch(() => { });
  }
  return closedShift;
}
