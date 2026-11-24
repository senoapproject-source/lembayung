import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { db } from '../db/database';
import type {
  AppSettings,
  AttendanceRecord,
  Expense,
  ExpenseCategory,
  Ingredient,
  MenuHppHistory,
  MenuItem,
  MonthlyTarget,
  CashierShift,
  Purchase,
  Recipe,
  SavedOrder,
  Transaction,
  User,
  WorkShiftSchedule,
} from '../types/models';

let cachedClient: SupabaseClient | null = null;
let cachedKey = '';
// Mutex agar background pull tidak pernah menimpa perubahan lokal yang sedang di-push ke Cloud
let activeCloudMutations = 0;

export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '1.4';
const OTA_VERSION_STORAGE_KEY = 'cuanin_installed_ota_version_v2';

export function markVersionInstalled(version: string): void {
  const clean = version.trim();
  if (!clean) return;
  localStorage.setItem(OTA_VERSION_STORAGE_KEY, clean);
}

export function getInstalledAppVersion(): string {
  const otaVer = localStorage.getItem(OTA_VERSION_STORAGE_KEY);
  if (otaVer && compareSemver(otaVer, APP_VERSION) >= 0) {
    return otaVer;
  }
  return APP_VERSION;
}

export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  bundleZipUrl?: string;
  releaseNotes: string;
  forceUpdate: boolean;
}

/**
 * Bandingkan dua string semver (misal '1.1.0' vs '1.0.0')
 * Return 1 jika a > b, -1 jika a < b, 0 jika sama
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Beritahu CapacitorUpdater bahwa bundle saat ini berhasil berjalan (mencegah rollback otomatis)
 */
export async function initOtaUpdater(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // ignore on web
  }
}

/**
 * Hitung SHA-256 hex di browser/WebView jika URL belum menyertakan parameter ?sha256=
 */
async function fetchAndCalcSha256(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Terapkan OTA Live Update langsung di dalam APK Android tanpa perlu ke Android Studio
 */
export async function applyOtaBundleUpdate(
  bundleZipUrl: string,
  targetVersion: string
): Promise<{ success: boolean; message: string }> {
  if (!Capacitor.isNativePlatform()) {
    // Jika dibuka di browser web, cukup reload halaman
    localStorage.setItem(OTA_VERSION_STORAGE_KEY, targetVersion);
    window.location.reload();
    return { success: true, message: 'Halaman web diperbarui.' };
  }

  try {
    const parsedUrl = new URL(bundleZipUrl);
    let checksum = parsedUrl.searchParams.get('sha256') || '';
    const cleanUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;

    if (!checksum) {
      checksum = await fetchAndCalcSha256(cleanUrl);
    }

    const bundle = await CapacitorUpdater.download({
      url: cleanUrl,
      version: targetVersion,
      checksum,
    });
    localStorage.setItem(OTA_VERSION_STORAGE_KEY, targetVersion);
    await CapacitorUpdater.set(bundle);
    return {
      success: true,
      message: `Update v${targetVersion} berhasil dipasang!`,
    };
  } catch (err) {
    return {
      success: false,
      message: 'Gagal mengunduh pembaruan. Pastikan koneksi internet stabil lalu coba lagi.',
    };
  }
}

/**
 * Cek apakah ada versi Cuanin yang lebih baru di tabel public.app_versions Supabase
 */
export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const settings = await db.settings.get('global');
    const client = getSupabaseClient(settings);
    const { data, error } = await client
      .from('app_versions')
      .select('*')
      .eq('id', 'android')
      .maybeSingle();

    if (error || !data) return null;

    const currentVer = getInstalledAppVersion();
    const latest = String(data.latest_version || currentVer).trim();
    const minReq = String(data.min_required_version || currentVer).trim();
    const hasUpdate = compareSemver(latest, currentVer) > 0;
    const belowMin = compareSemver(minReq, currentVer) > 0;

    return {
      hasUpdate,
      currentVersion: currentVer,
      latestVersion: latest,
      downloadUrl: String(data.download_url || '').trim(),
      bundleZipUrl: data.bundle_zip_url ? String(data.bundle_zip_url).trim() : undefined,
      releaseNotes: String(data.release_notes || 'Pembaruan fitur dan peningkatan performa.'),
      forceUpdate: Boolean(data.force_update) || belowMin,
    };
  } catch {
    return null;
  }
}

export interface AndroidDownloadInfo {
  downloadUrl: string;
  latestVersion: string;
}

/**
 * Ambil tautan unduhan aplikasi Android terbaru secara otomatis dari tabel app_versions
 * dengan fallback alias tetap (Lembayung-latest.apk / Lembayung-testing-latest.apk).
 */
export async function getLatestAndroidDownloadInfo(): Promise<AndroidDownloadInfo> {
  const env = getAppEnvironment();
  const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const aliasFile = env === 'production' ? 'Lembayung-latest.apk' : 'Lembayung-testing-latest.apk';
  const fallbackUrl = baseUrl
    ? `${baseUrl}/storage/v1/object/public/cuanin-updates/${aliasFile}`
    : '';
  const fallbackVersion = getInstalledAppVersion();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { downloadUrl: fallbackUrl, latestVersion: fallbackVersion };
  }

  try {
    const settings = await db.settings.get('global');
    const client = getSupabaseClient(settings);
    const { data, error } = await client
      .from('app_versions')
      .select('latest_version, download_url')
      .eq('id', 'android')
      .maybeSingle();

    if (error || !data) {
      return { downloadUrl: fallbackUrl, latestVersion: fallbackVersion };
    }

    const dbUrl = String(data.download_url || '').trim();
    const isApkUrl = dbUrl && !dbUrl.includes('.zip');
    return {
      downloadUrl: isApkUrl ? dbUrl : fallbackUrl,
      latestVersion: String(data.latest_version || fallbackVersion).trim(),
    };
  } catch {
    return { downloadUrl: fallbackUrl, latestVersion: fallbackVersion };
  }
}

const FALLBACK_SUPABASE_URL = '';
const FALLBACK_SUPABASE_ANON_KEY = '';

export function getAppEnvironment(): 'testing' | 'production' {
  const envMode = (import.meta.env.VITE_APP_ENV as string | undefined) || import.meta.env.MODE;
  return envMode === 'production' ? 'production' : 'testing';
}

export function getSupabaseConfig(settings?: AppSettings): {
  url: string;
  anonKey: string;
  outletId: string;
  env: 'testing' | 'production';
} {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const env = getAppEnvironment();

  const isPlaceholderUrl = !envUrl || envUrl.includes('GANTI_PROJECT_PROD_ANDA');
  const isPlaceholderKey = !envKey || envKey.includes('GANTI_DENGAN_PUBLISHABLE');

  // Prioritaskan URL & Key bawaan environment build (Production / Testing)
  // agar saat upgrade dari APK Testing ke APK Production tidak nyangkut ke URL Testing lama di IndexedDB!
  const url = (
    (!isPlaceholderUrl ? envUrl : settings?.supabaseUrl || FALLBACK_SUPABASE_URL)
  ).trim();
  const anonKey = (
    (!isPlaceholderKey ? envKey : settings?.supabaseAnonKey || FALLBACK_SUPABASE_ANON_KEY)
  ).trim();
  const outletId = (settings?.outletId || 'CUAN-8899').trim().toUpperCase();

  return { url, anonKey, outletId, env };
}

export function getSupabaseClient(settings?: AppSettings): SupabaseClient {
  const cfg = getSupabaseConfig(settings);
  const key = `${cfg.url}::${cfg.anonKey}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },
    });
    cachedKey = key;
  }
  return cachedClient;
}

/**
 * Upsert langsung 1 menu (+ riwayat HPP terbarunya) ke Supabase agar edit harga langsung tersimpan di Cloud
 */
export async function upsertMenuToSupabase(
  menu: MenuItem,
  latestHistory?: MenuHppHistory
): Promise<{ success: boolean; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Offline' };
  }
  activeCloudMutations += 1;
  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    const client = getSupabaseClient(settings);

    const { error: menuErr } = await client.from('menus').upsert(
      {
        outlet_id: cfg.outletId,
        id: menu.id,
        recipe_id: menu.recipeId || '',
        nama: menu.nama,
        kategori: menu.kategori,
        foto: menu.foto || null,
        harga_jual: menu.hargaJual,
        target_margin_persen: menu.targetMarginPersen ?? null,
        active: menu.active,
        updated_at: menu.updatedAt,
      },
      { onConflict: 'outlet_id,id' }
    );
    if (menuErr) return { success: false, error: menuErr.message };

    if (latestHistory) {
      await client.from('menu_hpp_history').upsert(
        {
          outlet_id: cfg.outletId,
          id: latestHistory.id,
          menu_id: latestHistory.menuId,
          hpp: latestHistory.hpp,
          berlaku_sejak: latestHistory.berlakuSejak,
        },
        { onConflict: 'outlet_id,id' }
      );
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan menu ke Cloud',
    };
  } finally {
    activeCloudMutations = Math.max(0, activeCloudMutations - 1);
  }
}

/**
 * Hapus 1 menu dari tabel public.menus di Supabase (beserta riwayat HPP-nya)
 */
export async function deleteMenuFromSupabase(
  menuId: string
): Promise<{ success: boolean; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Offline' };
  }
  activeCloudMutations += 1;
  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    const client = getSupabaseClient(settings);

    await client
      .from('menu_hpp_history')
      .delete()
      .eq('outlet_id', cfg.outletId)
      .eq('menu_id', menuId);

    const { error } = await client
      .from('menus')
      .delete()
      .eq('outlet_id', cfg.outletId)
      .eq('id', menuId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus menu di Cloud',
    };
  } finally {
    activeCloudMutations = Math.max(0, activeCloudMutations - 1);
  }
}

/**
 * Hapus 1 bahan baku dari Supabase agar sinkron di semua perangkat
 */
export async function deleteIngredientFromSupabase(
  ingredientId: string
): Promise<{ success: boolean; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Offline' };
  }
  activeCloudMutations += 1;
  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    const client = getSupabaseClient(settings);

    const { error } = await client
      .from('ingredients')
      .delete()
      .eq('outlet_id', cfg.outletId)
      .eq('id', ingredientId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus bahan baku di Cloud',
    };
  } finally {
    activeCloudMutations = Math.max(0, activeCloudMutations - 1);
  }
}

/**
 * Hapus satu user tertentu dari tabel public.users di Supabase (untuk outlet aktif)
 */
export async function deleteUserFromSupabase(
  userId: string
): Promise<{ success: boolean; outletId: string; error?: string }> {
  const settings = await db.settings.get('global');
  const cfg = getSupabaseConfig(settings);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, outletId: cfg.outletId, error: 'Offline' };
  }
  try {
    const client = getSupabaseClient(settings);
    const { error } = await client
      .from('users')
      .delete()
      .eq('outlet_id', cfg.outletId)
      .eq('id', userId);
    if (error) {
      return { success: false, outletId: cfg.outletId, error: error.message };
    }
    return { success: true, outletId: cfg.outletId };
  } catch (err) {
    return {
      success: false,
      outletId: cfg.outletId,
      error: err instanceof Error ? err.message : 'Gagal menghapus di Cloud',
    };
  }
}

/**
 * Push data lokal ke tabel relasional Supabase.
 * Catatan: `includeUsers` default `false` untuk background sync transaksi/menu/bahan
 * agar perangkat lain tidak pernah meng-upsert balik user yang baru saja dihapus oleh Owner!
 */
export async function pushAllLocalToSupabase(options?: {
  includeUsers?: boolean;
}): Promise<{
  success: boolean;
  count: number;
  message: string;
}> {
  const includeUsers = options?.includeUsers ?? true;
  if (!navigator.onLine) {
    return { success: false, count: 0, message: 'Perangkat sedang offline.' };
  }

  activeCloudMutations += 1;
  try {
    return await pushAllLocalToSupabaseInternal(includeUsers);
  } finally {
    activeCloudMutations = Math.max(0, activeCloudMutations - 1);
  }
}

async function pushAllLocalToSupabaseInternal(includeUsers: boolean): Promise<{
  success: boolean;
  count: number;
  message: string;
}> {

  const settings = await db.settings.get('global');
  const cfg = getSupabaseConfig(settings);
  const client = getSupabaseClient(settings);
  const outletId = cfg.outletId;
  const nowIso = new Date().toISOString();

  let totalSynced = 0;

  // 1. Tabel outlets
  if (settings) {
    const { error } = await client.from('outlets').upsert(
      {
        outlet_id: outletId,
        nama_usaha: settings.namaUsaha,
        nama_cabang: settings.namaCabang || 'Pusat',
        owner_email: settings.ownerEmail || null,
        parent_outlet_id: settings.parentOutletId || null,
        logo_usaha: settings.logoUsaha || null,
        alamat_usaha: settings.alamatUsaha,
        telepon_usaha: settings.teleponUsaha,
        struk_header: settings.strukHeader || null,
        struk_footer: settings.strukFooter || null,
        struk_base_url: settings.strukBaseUrl || null,
        struk_tampilkan_kasir: settings.strukTampilkanKasir ?? true,
        struk_tampilkan_catatan_item: settings.strukTampilkanCatatanItem ?? true,
        struk_tampilkan_wa_usaha: settings.strukTampilkanWaUsaha ?? true,
        default_margin_persen: settings.defaultMarginPersen,
        metode_harga_bahan: settings.metodeHargaBahan,
        jumlah_pembelian_n: settings.jumlahPembelianN,
        pembulatan_harga: settings.pembulatanHarga,
        ambang_mepet_bep_persen: settings.ambangMepetBepPersen,
        default_kasir_discount: settings.defaultKasirDiscount,
        default_kasir_record_expense: settings.defaultKasirRecordExpense,
        updated_at: nowIso,
      },
      { onConflict: 'outlet_id' }
    );
    if (error) {
      return {
        success: false,
        count: 0,
        message: `Supabase Error (tabel outlets): ${error.message}. Pastikan sudah menjalankan supabase_schema.sql terbaru (12 tabel) di SQL Editor Supabase!`,
      };
    }
    totalSynced += 1;
  }

  // Helper batch upsert
  const upsertTable = async (
    table: string,
    rows: Record<string, unknown>[],
    conflictCols = 'outlet_id,id'
  ) => {
    if (rows.length === 0) return;
    const { error } = await client.from(table).upsert(rows, { onConflict: conflictCols });
    if (error) throw new Error(`Gagal sinkron tabel ${table}: ${error.message}`);
    totalSynced += rows.length;
  };

  try {
    // 2. Proses penghapusan user & menu yang tertunda (jika dihapus saat offline)
    const pendingDeletes = await db.syncQueue.filter((q) => q.action === 'delete').toArray();
    for (const delItem of pendingDeletes) {
      const tbl = (delItem.payload as { table?: string } | undefined)?.table;
      if (tbl === 'users') {
        await client.from('users').delete().eq('outlet_id', outletId).eq('id', delItem.entityId);
      } else if (tbl === 'menus') {
        await client.from('menu_hpp_history').delete().eq('outlet_id', outletId).eq('menu_id', delItem.entityId);
        await client.from('menus').delete().eq('outlet_id', outletId).eq('id', delItem.entityId);
      } else if (tbl === 'ingredients') {
        await client.from('ingredients').delete().eq('outlet_id', outletId).eq('id', delItem.entityId);
      }
    }

    // 2b. Tabel users (hanya di-upsert jika diminta agar tidak menghidupkan kembali user yang dihapus di HP lain)
    if (includeUsers) {
      const users = await db.users.toArray();
      await upsertTable(
        'users',
        users.map((u) => ({
          outlet_id: outletId,
          id: u.id,
          nama: u.nama,
          username: u.username,
          email: u.email || null,
          email_verified: u.emailVerified ?? false,
          password_hash: u.passwordHash,
          pin: u.pin || null,
          role: u.role,
          can_discount: u.canDiscount,
          can_record_expense: u.canRecordExpense,
          active: u.active,
          created_at: u.createdAt,
          updated_at: u.updatedAt,
        }))
      );
    }

    // 3. Tabel expense_categories
    const cats = await db.expenseCategories.toArray();
    await upsertTable(
      'expense_categories',
      cats.map((c) => ({
        outlet_id: outletId,
        id: c.id,
        nama: c.nama,
        sudah_masuk_hpp: c.sudahMasukHpp,
        is_system: c.isSystem ?? false,
        updated_at: nowIso,
      }))
    );

    // 4. Tabel ingredients
    const ingredients = await db.ingredients.toArray();
    await upsertTable(
      'ingredients',
      ingredients.map((i) => ({
        outlet_id: outletId,
        id: i.id,
        nama: i.nama,
        satuan_dasar: i.satuanDasar,
        label_satuan_dasar: i.labelSatuanDasar,
        harga_aktif: i.hargaAktif,
        active: i.active,
        updated_at: i.updatedAt,
      }))
    );

    // 5. Tabel purchases
    const purchases = await db.purchases.toArray();
    await upsertTable(
      'purchases',
      purchases.map((p) => ({
        outlet_id: outletId,
        id: p.id,
        ingredient_id: p.ingredientId,
        tanggal: p.tanggal,
        jumlah_beli: p.jumlahBeli,
        satuan_beli: p.satuanBeli,
        total_harga: p.totalHarga,
        satuan_dasar_didapat: p.satuanDasarDidapat,
        harga_per_satuan_dasar: p.hargaPerSatuanDasar,
        penjual: p.penjual || null,
        pembuat_id: p.pembuatId,
        pembuat_nama: p.pembuatNama,
        dibatalkan: p.dibatalkan ?? false,
        created_at: p.createdAt,
      }))
    );

    // 6. Tabel recipes
    const recipes = await db.recipes.toArray();
    await upsertTable(
      'recipes',
      recipes.map((r) => ({
        outlet_id: outletId,
        id: r.id,
        nama: r.nama,
        jumlah_porsi_hasil: r.jumlahPorsiHasil,
        is_sub_recipe: r.isSubRecipe,
        items: r.items,
        biaya_lain: r.biayaLain,
        hpp_per_porsi: r.hppPerPorsi,
        has_missing_price: r.hasMissingPrice,
        updated_at: r.updatedAt,
      }))
    );

    // 7. Tabel menus
    const menus = await db.menus.toArray();
    await upsertTable(
      'menus',
      menus.map((m) => ({
        outlet_id: outletId,
        id: m.id,
        recipe_id: m.recipeId,
        nama: m.nama,
        kategori: m.kategori,
        foto: m.foto || null,
        harga_jual: m.hargaJual,
        target_margin_persen: m.targetMarginPersen ?? null,
        active: m.active,
        updated_at: m.updatedAt,
      }))
    );

    // 8. Tabel menu_hpp_history
    const histories = await db.menuHppHistory.toArray();
    await upsertTable(
      'menu_hpp_history',
      histories.map((h) => ({
        outlet_id: outletId,
        id: h.id,
        menu_id: h.menuId,
        hpp: h.hpp,
        berlaku_sejak: h.berlakuSejak,
      }))
    );

    // 9. Tabel transactions
    const txs = await db.transactions.toArray();
    await upsertTable(
      'transactions',
      txs.map((t) => ({
        outlet_id: outletId,
        id: t.id,
        nomor_struk: t.nomorStruk,
        waktu: t.waktu,
        kasir_id: t.kasirId,
        kasir_nama: t.kasirNama,
        nama_pelanggan: t.namaPelanggan || null,
        no_wa_pelanggan: t.noWaPelanggan || null,
        metode_bayar: t.metodeBayar,
        subtotal: t.subtotal,
        diskon_nominal: t.diskonNominal,
        diskon_label: t.diskonLabel || null,
        total: t.total,
        uang_diterima: t.uangDiterima,
        kembalian: t.kembalian,
        status: t.status,
        alasan_void: t.alasanVoid || null,
        void_by: t.voidBy || null,
        void_at: t.voidAt || null,
        items: t.items,
        updated_at: nowIso,
      }))
    );

    // 10. Tabel saved_orders
    const savedOrders = await db.savedOrders.toArray();
    await upsertTable(
      'saved_orders',
      savedOrders.map((s) => ({
        outlet_id: outletId,
        id: s.id,
        label_meja_pelanggan: s.labelMejaPelanggan,
        no_wa_pelanggan: s.noWaPelanggan || null,
        waktu_simpan: s.waktuSimpan,
        kasir_id: s.kasirId,
        kasir_nama: s.kasirNama,
        items: s.items,
      }))
    );

    // 11. Tabel expenses
    const expenses = await db.expenses.toArray();
    await upsertTable(
      'expenses',
      expenses.map((e) => ({
        outlet_id: outletId,
        id: e.id,
        tanggal: e.tanggal,
        category_id: e.categoryId,
        category_nama: e.categoryNama,
        nominal: e.nominal,
        keterangan: e.keterangan,
        lampiran_foto: e.lampiranFoto || null,
        biaya_tetap: e.biayaTetap,
        sumber: e.sumber,
        purchase_id: e.purchaseId || null,
        pembuat_id: e.pembuatId,
        pembuat_nama: e.pembuatNama,
        dibatalkan: e.dibatalkan ?? false,
        created_at: e.createdAt,
      }))
    );

    // 12. Tabel monthly_targets
    const targets = await db.monthlyTargets.toArray();
    await upsertTable(
      'monthly_targets',
      targets.map((tg) => ({
        outlet_id: outletId,
        bulan: tg.bulan,
        target_omzet: tg.targetOmzet,
        target_laba: tg.targetLaba,
        updated_at: nowIso,
      })),
      'outlet_id,bulan'
    );

    // 12b. Tabel cashier_shifts (graceful: jika tabel belum dibuat di SQL Editor, tidak gagalkan sync utama)
    const shifts = await db.cashierShifts.toArray();
    if (shifts.length > 0) {
      await client
        .from('cashier_shifts')
        .upsert(
          shifts.map((s) => ({
            outlet_id: outletId,
            id: s.id,
            kasir_id: s.kasirId,
            kasir_nama: s.kasirNama,
            waktu_buka: s.waktuBuka,
            waktu_tutup: s.waktuTutup || null,
            status: s.status,
            modal_awal: s.modalAwal,
            pendapatan_cash: s.pendapatanCash,
            pendapatan_qris: s.pendapatanQris,
            pendapatan_transfer: s.pendapatanTransfer,
            pengeluaran_kasir: s.pengeluaranKasir,
            expected_cash: s.expectedCash,
            uang_fisik_akhir: s.uangFisikAkhir ?? null,
            selisih: s.selisih ?? null,
            catatan: s.catatan || null,
            updated_at: nowIso,
          })),
          { onConflict: 'outlet_id,id' }
        )
        .then(({ error }) => {
          if (!error) totalSynced += shifts.length;
        });
    }

    // 14. Tabel attendances (absensi karyawan + foto selfie terkompresi — abaikan diam-diam jika tabel belum dibuat di DB)
    const attendances = await db.attendances.toArray();
    if (attendances.length > 0) {
      await client
        .from('attendances')
        .upsert(
          attendances.map((a) => ({
            outlet_id: outletId,
            id: a.id,
            user_id: a.userId,
            user_nama: a.userNama,
            user_role: a.userRole,
            tanggal: a.tanggal,
            shift_id: a.shiftId,
            shift_nama: a.shiftNama,
            scheduled_start: a.scheduledStart,
            scheduled_end: a.scheduledEnd,
            clock_in_at: a.clockInAt,
            clock_out_at: a.clockOutAt || null,
            photo_in: a.photoIn || null,
            photo_out: a.photoOut || null,
            late_minutes: a.lateMinutes ?? 0,
            work_minutes: a.workMinutes ?? null,
            status: a.status,
            corrected_by: a.correctedBy || null,
            corrected_at: a.correctedAt || null,
            correction_note: a.correctionNote || null,
            updated_at: a.updatedAt || nowIso,
          })),
          { onConflict: 'outlet_id,id' }
        )
        .then(({ error }) => {
          if (!error) totalSynced += attendances.length;
        });
    }

    // Simpan master jadwal shift kerja & PIN Otorisasi Kasir jika kolom tersedia di outlets
    const outletExtraPatch: Record<string, unknown> = {};
    if (settings?.workShifts && settings.workShifts.length > 0) {
      outletExtraPatch.work_shifts = settings.workShifts;
    }
    if (settings?.kasirAuthPin) {
      outletExtraPatch.kasir_auth_pin = settings.kasirAuthPin;
    }
    if (Object.keys(outletExtraPatch).length > 0) {
      await client
        .from('outlets')
        .update({ ...outletExtraPatch, updated_at: nowIso })
        .eq('outlet_id', outletId)
        .then(() => {});
    }
  } catch (err) {
    return {
      success: false,
      count: totalSynced,
      message: err instanceof Error ? err.message : 'Gagal mengunggah ke Supabase.',
    };
  }

  await db.transaction('rw', [db.transactions, db.expenses, db.attendances, db.syncQueue], async () => {
    await db.transactions.toCollection().modify({ syncStatus: 'synced' });
    await db.expenses.toCollection().modify({ syncStatus: 'synced' });
    await db.attendances.toCollection().modify({ syncStatus: 'synced' });
    await db.syncQueue.clear();
  });

  return {
    success: true,
    count: totalSynced,
    message: `Berhasil mengunggah ${totalSynced} baris data ke 12 tabel Supabase (Kode Toko: ${outletId}).`,
  };
}

/**
 * Pull data dari 12 tabel relasional Supabase ke database lokal IndexedDB
 */
export async function pullAllFromSupabase(overrideOutletId?: string): Promise<{
  success: boolean;
  count: number;
  message: string;
}> {
  if (!navigator.onLine) {
    return { success: false, count: 0, message: 'Perangkat sedang offline.' };
  }
  // Jangan menimpa data lokal ketika sedang ada mutasi/push ke Cloud atau masih ada antrean lokal yang belum naik
  if (!overrideOutletId) {
    if (activeCloudMutations > 0) {
      return { success: true, count: 0, message: 'Sinkronisasi lokal sedang berjalan.' };
    }
    const pendingLocal = await db.syncQueue.count();
    if (pendingLocal > 0) {
      return { success: true, count: 0, message: 'Menunggu antrean lokal selesai dikirim.' };
    }
  }

  const settings = await db.settings.get('global');
  const cfg = getSupabaseConfig(settings);
  const targetOutletId = (overrideOutletId || cfg.outletId).trim().toUpperCase();
  const client = getSupabaseClient(settings);

  // 1. Cek apakah outlet terdaftar di tabel outlets
  const { data: outletRow, error: outletErr } = await client
    .from('outlets')
    .select('*')
    .eq('outlet_id', targetOutletId)
    .maybeSingle();

  if (outletErr) {
    return {
      success: false,
      count: 0,
      message: `Supabase Error: ${outletErr.message}`,
    };
  }

  if (!outletRow) {
    return {
      success: false,
      count: 0,
      message: `Kode Toko "${targetOutletId}" tidak ditemukan di Cloud.`,
    };
  }

  // 2. Tarik seluruh 11 tabel lainnya secara paralel
  const [
    usersRes,
    catsRes,
    ingsRes,
    pursRes,
    recsRes,
    menusRes,
    histRes,
    txsRes,
    savedRes,
    expsRes,
    tgtsRes,
    shiftsRes,
    attendancesRes,
  ] = await Promise.all([
    client.from('users').select('*').eq('outlet_id', targetOutletId),
    client.from('expense_categories').select('*').eq('outlet_id', targetOutletId),
    client.from('ingredients').select('*').eq('outlet_id', targetOutletId),
    client.from('purchases').select('*').eq('outlet_id', targetOutletId),
    client.from('recipes').select('*').eq('outlet_id', targetOutletId),
    client.from('menus').select('*').eq('outlet_id', targetOutletId),
    client.from('menu_hpp_history').select('*').eq('outlet_id', targetOutletId),
    client.from('transactions').select('*').eq('outlet_id', targetOutletId),
    client.from('saved_orders').select('*').eq('outlet_id', targetOutletId),
    client.from('expenses').select('*').eq('outlet_id', targetOutletId),
    client.from('monthly_targets').select('*').eq('outlet_id', targetOutletId),
    client.from('cashier_shifts').select('*').eq('outlet_id', targetOutletId),
    client.from('attendances').select('*').eq('outlet_id', targetOutletId),
  ]);

  let totalPulled = 1;

  const mappedSettings: AppSettings = {
    id: 'global',
    namaUsaha: outletRow.nama_usaha,
    namaCabang: outletRow.nama_cabang || 'Pusat',
    ownerEmail: outletRow.owner_email || settings?.ownerEmail,
    parentOutletId: outletRow.parent_outlet_id || undefined,
    alamatUsaha: outletRow.alamat_usaha,
    teleponUsaha: outletRow.telepon_usaha,
    logoUsaha: outletRow.logo_usaha || settings?.logoUsaha,
    strukHeader: outletRow.struk_header || undefined,
    strukFooter: outletRow.struk_footer || undefined,
    strukBaseUrl: outletRow.struk_base_url || undefined,
    strukTampilkanKasir: outletRow.struk_tampilkan_kasir,
    strukTampilkanCatatanItem: outletRow.struk_tampilkan_catatan_item,
    strukTampilkanWaUsaha: outletRow.struk_tampilkan_wa_usaha,
    defaultMarginPersen: Number(outletRow.default_margin_persen),
    metodeHargaBahan: outletRow.metode_harga_bahan,
    jumlahPembelianN: Number(outletRow.jumlah_pembelian_n),
    pembulatanHarga: Number(outletRow.pembulatan_harga) as 500 | 1000,
    ambangMepetBepPersen: Number(outletRow.ambang_mepet_bep_persen),
    defaultKasirDiscount: outletRow.default_kasir_discount,
    defaultKasirRecordExpense: outletRow.default_kasir_record_expense,
    lastBackupAt: outletRow.updated_at,
    cloudSyncMode: 'supabase',
    outletId: targetOutletId,
    workShifts: Array.isArray(outletRow.work_shifts)
      ? (outletRow.work_shifts as WorkShiftSchedule[])
      : settings?.workShifts,
    kasirAuthPin: outletRow.kasir_auth_pin || settings?.kasirAuthPin,
  };

  const mappedUsers: User[] = (usersRes.data || []).map((u) => ({
    id: u.id,
    nama: u.nama,
    username: u.username,
    email: u.email || undefined,
    emailVerified: Boolean(u.email_verified),
    passwordHash: u.password_hash,
    pin: u.pin || undefined,
    role: u.role,
    canDiscount: u.can_discount,
    canRecordExpense: u.can_record_expense,
    active: u.active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }));

  const mappedCats: ExpenseCategory[] = (catsRes.data || []).map((c) => ({
    id: c.id,
    nama: c.nama,
    sudahMasukHpp: c.sudah_masuk_hpp,
    isSystem: c.is_system,
  }));

  const mappedIngs: Ingredient[] = (ingsRes.data || []).map((i) => ({
    id: i.id,
    nama: i.nama,
    satuanDasar: i.satuan_dasar,
    labelSatuanDasar: i.label_satuan_dasar,
    hargaAktif: Number(i.harga_aktif),
    active: i.active,
    updatedAt: i.updated_at,
  }));

  const mappedPurchases: Purchase[] = (pursRes.data || []).map((p) => ({
    id: p.id,
    ingredientId: p.ingredient_id,
    tanggal: p.tanggal,
    jumlahBeli: Number(p.jumlah_beli),
    satuanBeli: p.satuan_beli,
    totalHarga: Number(p.total_harga),
    satuanDasarDidapat: Number(p.satuan_dasar_didapat),
    hargaPerSatuanDasar: Number(p.harga_per_satuan_dasar),
    penjual: p.penjual || undefined,
    pembuatId: p.pembuat_id,
    pembuatNama: p.pembuat_nama,
    dibatalkan: p.dibatalkan,
    createdAt: p.created_at,
  }));

  const mappedRecipes: Recipe[] = (recsRes.data || []).map((r) => ({
    id: r.id,
    nama: r.nama,
    jumlahPorsiHasil: Number(r.jumlah_porsi_hasil),
    isSubRecipe: r.is_sub_recipe,
    items: r.items || [],
    biayaLain: r.biaya_lain || [],
    hppPerPorsi: Number(r.hpp_per_porsi),
    hasMissingPrice: r.has_missing_price,
    updatedAt: r.updated_at,
  }));

  const mappedHistories: MenuHppHistory[] = (histRes.data || []).map((h) => ({
    id: h.id,
    menuId: h.menu_id,
    hpp: Number(h.hpp),
    berlakuSejak: h.berlaku_sejak,
  }));

  // Cari HPP terbaru dari menu_hpp_history untuk memulihkan hppManual menu tanpa resep
  const latestHppByMenuId = new Map<string, number>();
  for (const h of [...mappedHistories].sort((a, b) => a.berlakuSejak.localeCompare(b.berlakuSejak))) {
    latestHppByMenuId.set(h.menuId, h.hpp);
  }

  const mappedMenus: MenuItem[] = (menusRes.data || []).map((m) => {
    const recipeId = m.recipe_id || '';
    const histHpp = latestHppByMenuId.get(m.id);
    const hppManual =
      !recipeId
        ? m.hpp_manual !== undefined && m.hpp_manual !== null
          ? Number(m.hpp_manual)
          : histHpp !== undefined && histHpp > 0
          ? histHpp
          : undefined
        : undefined;
    return {
      id: m.id,
      recipeId,
      hppManual,
      nama: m.nama,
      kategori: m.kategori,
      foto: m.foto || undefined,
      hargaJual: Number(m.harga_jual),
      targetMarginPersen: m.target_margin_persen !== null ? Number(m.target_margin_persen) : undefined,
      active: m.active,
      updatedAt: m.updated_at,
    };
  });

  const mappedTxs: Transaction[] = (txsRes.data || []).map((t) => ({
    id: t.id,
    nomorStruk: t.nomor_struk,
    waktu: t.waktu,
    kasirId: t.kasir_id,
    kasirNama: t.kasir_nama,
    namaPelanggan: t.nama_pelanggan || undefined,
    noWaPelanggan: t.no_wa_pelanggan || undefined,
    metodeBayar: t.metode_bayar,
    subtotal: Number(t.subtotal),
    diskonNominal: Number(t.diskon_nominal),
    diskonLabel: t.diskon_label || undefined,
    total: Number(t.total),
    uangDiterima: Number(t.uang_diterima),
    kembalian: Number(t.kembalian),
    status: t.status,
    alasanVoid: t.alasan_void || undefined,
    voidBy: t.void_by || undefined,
    voidAt: t.void_at || undefined,
    items: t.items || [],
    syncStatus: 'synced',
  }));

  const mappedSaved: SavedOrder[] = (savedRes.data || []).map((s) => ({
    id: s.id,
    labelMejaPelanggan: s.label_meja_pelanggan,
    noWaPelanggan: s.no_wa_pelanggan || undefined,
    waktuSimpan: s.waktu_simpan,
    kasirId: s.kasir_id,
    kasirNama: s.kasir_nama,
    items: s.items || [],
  }));

  const mappedExpenses: Expense[] = (expsRes.data || []).map((e) => ({
    id: e.id,
    tanggal: e.tanggal,
    categoryId: e.category_id,
    categoryNama: e.category_nama,
    nominal: Number(e.nominal),
    keterangan: e.keterangan,
    lampiranFoto: e.lampiran_foto || undefined,
    biayaTetap: e.biaya_tetap,
    sumber: e.sumber,
    purchaseId: e.purchase_id || undefined,
    pembuatId: e.pembuat_id,
    pembuatNama: e.pembuat_nama,
    dibatalkan: e.dibatalkan,
    createdAt: e.created_at,
    syncStatus: 'synced',
  }));

  const mappedTargets: MonthlyTarget[] = (tgtsRes.data || []).map((tg) => ({
    bulan: tg.bulan,
    targetOmzet: Number(tg.target_omzet),
    targetLaba: Number(tg.target_laba),
  }));

  const mappedShifts: CashierShift[] =
    shiftsRes && !shiftsRes.error && Array.isArray(shiftsRes.data)
      ? shiftsRes.data.map((s) => ({
          id: s.id,
          kasirId: s.kasir_id,
          kasirNama: s.kasir_nama,
          waktuBuka: s.waktu_buka,
          waktuTutup: s.waktu_tutup || undefined,
          status: s.status === 'closed' ? 'closed' : 'open',
          modalAwal: Number(s.modal_awal) || 0,
          pendapatanCash: Number(s.pendapatan_cash) || 0,
          pendapatanQris: Number(s.pendapatan_qris) || 0,
          pendapatanTransfer: Number(s.pendapatan_transfer) || 0,
          pengeluaranKasir: Number(s.pengeluaran_kasir) || 0,
          expectedCash: Number(s.expected_cash) || 0,
          uangFisikAkhir: s.uang_fisik_akhir !== null && s.uang_fisik_akhir !== undefined ? Number(s.uang_fisik_akhir) : undefined,
          selisih: s.selisih !== null && s.selisih !== undefined ? Number(s.selisih) : undefined,
          catatan: s.catatan || undefined,
        }))
      : [];

  const mappedAttendances: AttendanceRecord[] =
    attendancesRes && !attendancesRes.error && Array.isArray(attendancesRes.data)
      ? attendancesRes.data.map((a) => ({
          id: a.id,
          userId: a.user_id,
          userNama: a.user_nama,
          userRole: a.user_role || 'kasir',
          tanggal: a.tanggal,
          shiftId: a.shift_id,
          shiftNama: a.shift_nama,
          scheduledStart: a.scheduled_start,
          scheduledEnd: a.scheduled_end,
          clockInAt: a.clock_in_at,
          clockOutAt: a.clock_out_at || undefined,
          photoIn: a.photo_in || undefined,
          photoOut: a.photo_out || undefined,
          lateMinutes: Number(a.late_minutes) || 0,
          workMinutes:
            a.work_minutes !== null && a.work_minutes !== undefined
              ? Number(a.work_minutes)
              : undefined,
          status: a.status || 'hadir',
          correctedBy: a.corrected_by || undefined,
          correctedAt: a.corrected_at || undefined,
          correctionNote: a.correction_note || undefined,
          syncStatus: 'synced',
          updatedAt: a.updated_at || a.clock_in_at,
        }))
      : [];

  totalPulled +=
    mappedUsers.length +
    mappedCats.length +
    mappedIngs.length +
    mappedPurchases.length +
    mappedRecipes.length +
    mappedMenus.length +
    mappedHistories.length +
    mappedTxs.length +
    mappedSaved.length +
    mappedExpenses.length +
    mappedTargets.length +
    mappedAttendances.length;

  // Ambil snapshot lokal sebelum menimpa DB agar perubahan baru dari device lain (penjualan/void/pengeluaran/pembelian/menu/user)
  // 100% tetap memicu notifikasi perangkat meskipun WebSocket Realtime sempat terputus di Android!
  const shouldDiffNotify = !overrideOutletId && Boolean(settings?.outletId);
  let prevTxMap = new Map<string, Transaction>();
  let prevExpMap = new Map<string, Expense>();
  let prevMenuMap = new Map<string, MenuItem>();
  let prevUserMap = new Map<string, User>();

  if (shouldDiffNotify) {
    const [pTx, pExp, pMenu, pUser] = await Promise.all([
      db.transactions.toArray(),
      db.expenses.toArray(),
      db.menus.toArray(),
      db.users.toArray(),
    ]);
    prevTxMap = new Map(pTx.map((x) => [x.id, x]));
    prevExpMap = new Map(pExp.map((x) => [x.id, x]));
    prevMenuMap = new Map(pMenu.map((x) => [x.id, x]));
    prevUserMap = new Map(pUser.map((x) => [x.id, x]));
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
      db.cashierShifts,
      db.attendances,
    ],
    async () => {
      if (overrideOutletId) {
        await Promise.all([
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
          db.cashierShifts.clear(),
          db.attendances.clear(),
        ]);
      }

      await db.settings.put(mappedSettings);
      if (mappedUsers.length) {
        // Sinkronkan daftar users secara penuh agar user yang dihapus Owner di Cloud juga hilang di perangkat lain
        await db.users.clear();
        await db.users.bulkPut(mappedUsers);
      }
      if (mappedCats.length) await db.expenseCategories.bulkPut(mappedCats);
      await db.ingredients.clear();
      if (mappedIngs.length) await db.ingredients.bulkPut(mappedIngs);
      if (mappedPurchases.length) await db.purchases.bulkPut(mappedPurchases);
      if (mappedRecipes.length) await db.recipes.bulkPut(mappedRecipes);
      // Sinkronkan daftar menus secara penuh agar menu yang dihapus di HP/Tab lain juga ikut terhapus
      await db.menus.clear();
      if (mappedMenus.length) await db.menus.bulkPut(mappedMenus);
      if (mappedHistories.length) await db.menuHppHistory.bulkPut(mappedHistories);
      if (mappedTxs.length) await db.transactions.bulkPut(mappedTxs);
      if (mappedSaved.length) await db.savedOrders.bulkPut(mappedSaved);
      if (mappedExpenses.length) await db.expenses.bulkPut(mappedExpenses);
      if (mappedTargets.length) await db.monthlyTargets.bulkPut(mappedTargets);
      if (mappedShifts.length) await db.cashierShifts.bulkPut(mappedShifts);
      if (mappedAttendances.length) await db.attendances.bulkPut(mappedAttendances);
    }
  );

  // Kirim notifikasi perangkat jika ada transaksi/void/pengeluaran/pembelian/menu/user BARU dari HP/Tab lain
  // (Fallback 100% pasti masuk walau WebSocket Realtime sempat terputus di Android, dan anti-dobel via dedupKey!)
  if (shouldDiffNotify) {
    const isFresh = (iso?: string) => {
      if (!iso) return false;
      const t = Date.parse(iso);
      return !Number.isNaN(t) && Math.abs(Date.now() - t) <= 300_000; // maks 5 menit terakhir
    };
    const pendingNotifs: Array<{ title: string; body: string; dedupKey: string }> = [];
    const fmtRp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

    for (const tx of mappedTxs) {
      const prev = prevTxMap.get(tx.id);
      if (!prev && tx.status !== 'void' && isFresh(tx.waktu)) {
        pendingNotifs.push({
          title: `Penjualan Baru ${tx.nomorStruk} (${tx.metodeBayar})`,
          body: `${fmtRp(tx.total)} · Kasir: ${tx.kasirNama}${tx.namaPelanggan ? ` · ${tx.namaPelanggan}` : ''}`,
          dedupKey: `tx-new-${tx.id}`,
        });
      } else if (prev && prev.status !== 'void' && tx.status === 'void') {
        pendingNotifs.push({
          title: `Transaksi Dibatalkan (Void) ${tx.nomorStruk}`,
          body: `${fmtRp(tx.total)} · Alasan: ${tx.alasanVoid || '-'}`,
          dedupKey: `tx-void-${tx.id}`,
        });
      }
    }

    for (const exp of mappedExpenses) {
      if (exp.sumber === 'pembelian') continue;
      const prev = prevExpMap.get(exp.id);
      if (!prev && !exp.dibatalkan && isFresh(exp.createdAt)) {
        pendingNotifs.push({
          title: `Pengeluaran: ${exp.categoryNama}`,
          body: `${fmtRp(exp.nominal)} · ${exp.keterangan} (${exp.pembuatNama})`,
          dedupKey: `exp-new-${exp.id}`,
        });
      } else if (prev && !prev.dibatalkan && exp.dibatalkan) {
        pendingNotifs.push({
          title: `Pengeluaran Dibatalkan`,
          body: `${exp.categoryNama} · ${fmtRp(exp.nominal)} (${exp.keterangan})`,
          dedupKey: `exp-void-${exp.id}`,
        });
      }
    }

    for (const m of mappedMenus) {
      const prev = prevMenuMap.get(m.id);
      const changed = !prev || prev.hargaJual !== m.hargaJual || prev.nama !== m.nama || prev.kategori !== m.kategori;
      if (changed && isFresh(m.updatedAt)) {
        pendingNotifs.push({
          title: prev ? `Menu Diperbarui: ${m.nama}` : `Menu Baru: ${m.nama}`,
          body: `Harga jual ${fmtRp(m.hargaJual)} · ${m.kategori}`,
          dedupKey: `menu-${m.id}-${m.updatedAt}`,
        });
      }
    }

    for (const u of mappedUsers) {
      if (!prevUserMap.has(u.id) && isFresh(u.createdAt)) {
        pendingNotifs.push({
          title: `Pengguna Baru: ${u.nama}`,
          body: `Akun ${u.username} (${u.role}) ditambahkan`,
          dedupKey: `user-add-${u.id}`,
        });
      }
    }

    if (pendingNotifs.length > 0) {
      import('./notificationService')
        .then(({ sendDeviceNotification }) => {
          for (const n of pendingNotifs) {
            sendDeviceNotification(n);
          }
        })
        .catch(() => {});
    }
  }

  return {
    success: true,
    count: totalPulled,
    message: `Berhasil menarik ${totalPulled} baris data dari 12 tabel Supabase (Kode Toko: ${targetOutletId}).`,
  };
}

/**
 * Sinkronisasi dua arah yang aman untuk multi-perangkat (HP & Tablet):
 * - Jika ada perubahan lokal tertunda di syncQueue -> push dulu baru pull.
 * - Jika tidak ada antrean lokal -> pull dulu dari Cloud (agar data yang dihapus di perangkat lain ikut terhapus, bukan malah ter-upload ulang!).
 * - Jika Kode Toko belum ada di Cloud sama sekali -> push data lokal sebagai inisialisasi.
 */
export async function syncWithCloud(): Promise<{ success: boolean; message: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, message: 'Perangkat sedang offline.' };
  }

  const queue = await db.syncQueue.toArray();
  if (queue.length > 0) {
    const hasUserChange = queue.some((q) => Boolean((q.payload as { isUser?: boolean } | null)?.isUser));
    const pushRes = await pushAllLocalToSupabase({ includeUsers: hasUserChange });
    if (!pushRes.success) return pushRes;
    const pullRes = await pullAllFromSupabase();
    return { success: true, message: pullRes.success ? pullRes.message : pushRes.message };
  }

  const pullRes = await pullAllFromSupabase();
  if (pullRes.success) {
    return { success: true, message: pullRes.message };
  }

  // Jika outlet belum terdaftar di Cloud (toko baru), unggah data lokal
  if (pullRes.message.includes('tidak ditemukan di Cloud')) {
    const pushRes = await pushAllLocalToSupabase();
    return { success: pushRes.success, message: pushRes.message };
  }

  return { success: false, message: pullRes.message };
}

/**
 * Proses antrean SyncQueue otomatis saat ada transaksi/perubahan baru
 */
export async function processSyncQueue(): Promise<{ synced: number; remaining: number }> {
  if (!navigator.onLine) {
    const remaining = await db.syncQueue.count();
    return { synced: 0, remaining };
  }

  const settings = await db.settings.get('global');
  const queue = await db.syncQueue.orderBy('createdAt').toArray();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  if (settings?.cloudSyncMode === 'supabase') {
    const hasUserChange = queue.some((q) => Boolean((q.payload as { isUser?: boolean } | null)?.isUser));
    const res = await pushAllLocalToSupabase({ includeUsers: hasUserChange });
    if (res.success) {
      return { synced: queue.length, remaining: 0 };
    }
    return { synced: 0, remaining: queue.length };
  }

  const syncedTxIds = queue.filter((q) => q.entity === 'transaction').map((q) => q.entityId);
  const syncedExpIds = queue.filter((q) => q.entity === 'expense').map((q) => q.entityId);

  await db.transaction('rw', [db.transactions, db.expenses, db.syncQueue], async () => {
    for (const id of syncedTxIds) {
      await db.transactions.update(id, { syncStatus: 'synced' });
    }
    for (const id of syncedExpIds) {
      await db.expenses.update(id, { syncStatus: 'synced' });
    }
    await db.syncQueue.bulkDelete(queue.map((q) => q.id));
  });

  return { synced: queue.length, remaining: 0 };
}
