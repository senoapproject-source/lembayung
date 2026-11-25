import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { addAuditLog, generateKasirAuthPin, generateOutletCode } from '../db/actions';
import { DEFAULT_WORK_SHIFTS } from './attendanceService';
import { getSupabaseClient, pullAllFromSupabase } from './syncService';
import { sendNewBranchEmail } from './authEmailService';
import type { AppSettings, BranchInfo, CashierShift, User, WorkShiftSchedule } from '../types/models';

export interface StoreHoursConfig {
  autoStoreHoursEnabled: boolean;
  storeOpenTime: string;
  storeCloseTime: string;
  storeManualOverride: 'auto' | 'force_open' | 'force_closed';
}

export function unpackStoreHoursFromWorkShifts(rawWorkShifts: unknown): StoreHoursConfig {
  const arr = Array.isArray(rawWorkShifts) ? rawWorkShifts : [];
  const first = (arr[0] as Record<string, any> | undefined)?.storeHoursConfig as
    | Partial<StoreHoursConfig>
    | undefined;
  return {
    autoStoreHoursEnabled: Boolean(first?.autoStoreHoursEnabled),
    storeOpenTime: String(first?.storeOpenTime || '08:00'),
    storeCloseTime: String(first?.storeCloseTime || '22:00'),
    storeManualOverride:
      first?.storeManualOverride === 'force_open' || first?.storeManualOverride === 'force_closed'
        ? first.storeManualOverride
        : 'auto',
  };
}

export function packWorkShiftsWithStoreHours(
  workShifts: WorkShiftSchedule[] | undefined,
  cfg: Partial<StoreHoursConfig>
): WorkShiftSchedule[] {
  const base =
    Array.isArray(workShifts) && workShifts.length > 0
      ? workShifts.map((s) => ({ ...s }))
      : DEFAULT_WORK_SHIFTS.map((s) => ({ ...s }));
  const prev = unpackStoreHoursFromWorkShifts(base);
  const merged: StoreHoursConfig = {
    autoStoreHoursEnabled: cfg.autoStoreHoursEnabled ?? prev.autoStoreHoursEnabled,
    storeOpenTime: cfg.storeOpenTime || prev.storeOpenTime || '08:00',
    storeCloseTime: cfg.storeCloseTime || prev.storeCloseTime || '22:00',
    storeManualOverride: cfg.storeManualOverride || prev.storeManualOverride || 'auto',
  };
  (base[0] as unknown as Record<string, unknown>).storeHoursConfig = merged;
  return base;
}

export function isWithinStoreScheduleWindow(openTime = '08:00', closeTime = '22:00', now = new Date()): boolean {
  const [oh, om] = openTime.split(':').map((n) => parseInt(n, 10) || 0);
  const [ch, cm] = closeTime.split(':').map((n) => parseInt(n, 10) || 0);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  const curMin = now.getHours() * 60 + now.getMinutes();

  if (openMin === closeMin) return true;
  if (openMin < closeMin) {
    return curMin >= openMin && curMin < closeMin;
  }
  // Melewati tengah malam (mis. 14:00 s.d. 02:00)
  return curMin >= openMin || curMin < closeMin;
}

export function evaluateStoreOpenStatus(params: {
  hasOpenShift: boolean;
  activeCashierName?: string;
  shiftOpenedAt?: string;
  hoursConfig?: Partial<StoreHoursConfig>;
}): { isStoreOpen: boolean; statusDetail: string } {
  const cfg = params.hoursConfig;
  const openTime = cfg?.storeOpenTime || '08:00';
  const closeTime = cfg?.storeCloseTime || '22:00';

  if (params.hasOpenShift) {
    return {
      isStoreOpen: true,
      statusDetail: params.activeCashierName || 'Kasir Aktif',
    };
  }
  if (cfg?.storeManualOverride === 'force_closed') {
    return {
      isStoreOpen: false,
      statusDetail: cfg.autoStoreHoursEnabled
        ? `Ditutup Manual (Jadwal ${openTime}–${closeTime})`
        : 'Ditutup oleh Owner',
    };
  }
  if (cfg?.storeManualOverride === 'force_open') {
    return {
      isStoreOpen: true,
      statusDetail: 'Dibuka oleh Owner',
    };
  }
  if (cfg?.autoStoreHoursEnabled) {
    const inside = isWithinStoreScheduleWindow(openTime, closeTime);
    return {
      isStoreOpen: inside,
      statusDetail: inside
        ? `Buka Otomatis (${openTime}–${closeTime})`
        : `Tutup Otomatis (Buka ${openTime}–${closeTime})`,
    };
  }
  return {
    isStoreOpen: false,
    statusDetail: 'Tutup',
  };
}

export interface BranchPerformanceRow {
  outletId: string;
  namaUsaha: string;
  namaCabang: string;
  omzet: number;
  hppTerjual: number;
  labaKotor: number;
  biayaOperasional: number;
  labaBersih: number;
  totalPengeluaran: number;
  jumlahTransaksi: number;
  voidCount: number;
  cashTotal: number;
  qrisTotal: number;
  transferTotal: number;
  shiftClosedCount: number;
  totalSelisihKas: number;
}

/**
 * Ambil semua cabang (outlets) milik Owner berdasarkan email atau username Owner.
 */
export async function fetchOwnerBranches(owner: User): Promise<BranchInfo[]> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const localSettings = await db.settings.get('global');
    if (!localSettings?.outletId) return [];
    const openShift = await db.cashierShifts.where('status').equals('open').first();
    const evalStatus = evaluateStoreOpenStatus({
      hasOpenShift: Boolean(openShift),
      activeCashierName: openShift?.kasirNama,
      shiftOpenedAt: openShift?.waktuBuka,
      hoursConfig: {
        autoStoreHoursEnabled: localSettings.autoStoreHoursEnabled,
        storeOpenTime: localSettings.storeOpenTime,
        storeCloseTime: localSettings.storeCloseTime,
        storeManualOverride: localSettings.storeManualOverride,
      },
    });
    return [
      {
        outletId: localSettings.outletId,
        namaUsaha: localSettings.namaUsaha,
        namaCabang: localSettings.namaCabang || 'Pusat',
        alamatUsaha: localSettings.alamatUsaha,
        teleponUsaha: localSettings.teleponUsaha,
        ownerEmail: localSettings.ownerEmail || owner.email,
        parentOutletId: localSettings.parentOutletId,
        logoUsaha: localSettings.logoUsaha,
        kasirAuthPin: localSettings.kasirAuthPin,
        isStoreOpen: evalStatus.isStoreOpen,
        activeCashierName: openShift?.kasirNama || evalStatus.statusDetail,
        shiftOpenedAt: openShift?.waktuBuka,
        storeHoursLabel: evalStatus.statusDetail,
        updatedAt: localSettings.lastBackupAt,
      },
    ];
  }

  const settings = await db.settings.get('global');
  const client = getSupabaseClient(settings);
  const ownerEmail = (owner.email || settings?.ownerEmail || '').trim().toLowerCase();
  const ownerUsername = (owner.username || '').trim().toLowerCase();

  // 1. Cari outlet_id di tabel users di mana user ini terdaftar sebagai owner
  const { data: userRows } = await client
    .from('users')
    .select('outlet_id, username, email, role')
    .eq('role', 'owner');

  const matchedOutletIds = new Set<string>();
  if (settings?.outletId) matchedOutletIds.add(settings.outletId.trim().toUpperCase());

  for (const r of (userRows as Array<{ outlet_id: string; username: string; email?: string | null }> | null) || []) {
    const rEmail = (r.email || '').trim().toLowerCase();
    const rUser = (r.username || '').trim().toLowerCase();
    if (
      (ownerEmail && (rEmail === ownerEmail || rUser === ownerEmail)) ||
      (ownerUsername && rUser === ownerUsername)
    ) {
      matchedOutletIds.add(String(r.outlet_id).trim().toUpperCase());
    }
  }

  // 2. Cari juga di tabel outlets berdasarkan owner_email
  const { data: outletRows } = await client.from('outlets').select('*');
  const branches: BranchInfo[] = [];
  const hoursMap = new Map<string, StoreHoursConfig>();

  for (const row of (outletRows as Array<Record<string, any>> | null) || []) {
    const oid = String(row.outlet_id || '').trim().toUpperCase();
    const rowOwnerEmail = String(row.owner_email || '').trim().toLowerCase();
    if (matchedOutletIds.has(oid) || (ownerEmail && rowOwnerEmail === ownerEmail)) {
      hoursMap.set(oid, unpackStoreHoursFromWorkShifts(row.work_shifts));
      branches.push({
        outletId: oid,
        namaUsaha: row.nama_usaha || 'Lembayung',
        namaCabang: row.nama_cabang || 'Pusat',
        alamatUsaha: row.alamat_usaha || '-',
        teleponUsaha: row.telepon_usaha || '',
        ownerEmail: row.owner_email || ownerEmail || undefined,
        parentOutletId: row.parent_outlet_id || undefined,
        logoUsaha: row.logo_usaha || undefined,
        kasirAuthPin: row.kasir_auth_pin || undefined,
        updatedAt: row.updated_at || new Date().toISOString(),
      });
    }
  }

  // 3. Cek status buka/tutup toko (shift kasir aktif ATAU jadwal otomatis / override Owner) di seluruh cabang
  if (branches.length > 0) {
    const branchIds = branches.map((b) => b.outletId);
    const { data: openShifts } = await client
      .from('cashier_shifts')
      .select('outlet_id, kasir_nama, waktu_buka')
      .eq('status', 'open')
      .in('outlet_id', branchIds);

    const openShiftMap = new Map<string, { kasirNama: string; waktuBuka: string }>();
    for (const sh of (openShifts as Array<{ outlet_id: string; kasir_nama?: string; waktu_buka?: string }> | null) || []) {
      const oid = String(sh.outlet_id || '').trim().toUpperCase();
      if (!oid) continue;
      const prev = openShiftMap.get(oid);
      if (!prev || (sh.waktu_buka || '') > prev.waktuBuka) {
        openShiftMap.set(oid, {
          kasirNama: sh.kasir_nama || 'Kasir',
          waktuBuka: sh.waktu_buka || '',
        });
      }
    }
    for (const b of branches) {
      const openInfo = openShiftMap.get(b.outletId);
      const hCfg = hoursMap.get(b.outletId);
      const evalStatus = evaluateStoreOpenStatus({
        hasOpenShift: Boolean(openInfo),
        activeCashierName: openInfo?.kasirNama,
        shiftOpenedAt: openInfo?.waktuBuka,
        hoursConfig: hCfg,
      });
      b.isStoreOpen = evalStatus.isStoreOpen;
      b.activeCashierName = openInfo?.kasirNama || evalStatus.statusDetail;
      b.shiftOpenedAt = openInfo?.waktuBuka;
      b.storeHoursLabel = evalStatus.statusDetail;
    }
  }

  return branches.sort((a, b) => {
    if (!a.parentOutletId && b.parentOutletId) return -1;
    if (a.parentOutletId && !b.parentOutletId) return 1;
    return a.namaCabang.localeCompare(b.namaCabang);
  });
}

/**
 * Perbarui informasi profil cabang (Nama Cabang, Alamat, No. HP/WA) langsung dari Manajemen Cabang.
 */
export async function updateBranchProfile(params: {
  outletId: string;
  namaCabang: string;
  alamatUsaha: string;
  teleponUsaha?: string;
}): Promise<{ success: boolean; updatedAt?: string; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Mengubah info cabang memerlukan koneksi internet.' };
  }
  try {
    const localSettings = await db.settings.get('global');
    const client = getSupabaseClient(localSettings);
    const cleanOid = params.outletId.trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const { error } = await client
      .from('outlets')
      .update({
        nama_cabang: params.namaCabang.trim() || 'Pusat',
        alamat_usaha: params.alamatUsaha.trim() || '-',
        telepon_usaha: (params.teleponUsaha || '').trim(),
        updated_at: nowIso,
      })
      .eq('outlet_id', cleanOid);

    if (error) return { success: false, error: error.message };

    if (localSettings && (localSettings.outletId || '').trim().toUpperCase() === cleanOid) {
      await db.settings.update('global', {
        namaCabang: params.namaCabang.trim() || 'Pusat',
        alamatUsaha: params.alamatUsaha.trim() || '-',
        teleponUsaha: (params.teleponUsaha || '').trim(),
        lastBackupAt: nowIso,
      });
    }
    return { success: true, updatedAt: nowIso };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui info cabang.',
    };
  }
}

/**
 * Reset PIN Otorisasi Mode Kasir (6 angka acak) untuk cabang tertentu langsung dari Manajemen Cabang.
 */
export async function resetBranchKasirAuthPin(
  outletId: string,
  excludePins: string[] = []
): Promise<{ success: boolean; newPin?: string; updatedAt?: string; error?: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Reset PIN Otorisasi cabang memerlukan koneksi internet.' };
  }
  try {
    const localSettings = await db.settings.get('global');
    const client = getSupabaseClient(localSettings);
    const cleanOid = outletId.trim().toUpperCase();
    const newPin = generateKasirAuthPin(excludePins);
    const nowIso = new Date().toISOString();

    const { error } = await client
      .from('outlets')
      .update({
        kasir_auth_pin: newPin,
        updated_at: nowIso,
      })
      .eq('outlet_id', cleanOid);

    if (error) return { success: false, error: error.message };

    if (localSettings && (localSettings.outletId || '').trim().toUpperCase() === cleanOid) {
      await db.settings.update('global', {
        kasirAuthPin: newPin,
        lastBackupAt: nowIso,
      });
    }
    return { success: true, newPin, updatedAt: nowIso };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal mereset PIN Otorisasi cabang.',
    };
  }
}

/**
 * Buka atau Tutup Toko langsung 1-klik oleh Owner TANPA perlu memasukkan modal uang laci.
 */
export async function toggleStoreOpenByOwner(params: {
  outletId?: string;
  targetOpen: boolean;
  owner: User;
}): Promise<{ success: boolean; isStoreOpen: boolean; statusDetail: string; error?: string }> {
  const localSettings = await db.settings.get('global');
  const activeOid = (localSettings?.outletId || '').trim().toUpperCase();
  const targetOid = (params.outletId || activeOid).trim().toUpperCase();
  const isCurrentOutlet = targetOid === activeOid;
  const nowIso = new Date().toISOString();
  const nextOverride: 'force_open' | 'force_closed' = params.targetOpen
    ? 'force_open'
    : 'force_closed';

  try {
    // 1. Jika cabang yang di-toggle adalah cabang aktif di perangkat ini, perbarui lokal Dexie langsung (support offline!)
    if (isCurrentOutlet && localSettings) {
      const packedShifts = packWorkShiftsWithStoreHours(localSettings.workShifts, {
        autoStoreHoursEnabled: localSettings.autoStoreHoursEnabled,
        storeOpenTime: localSettings.storeOpenTime,
        storeCloseTime: localSettings.storeCloseTime,
        storeManualOverride: nextOverride,
      });
      await db.settings.update('global', {
        storeManualOverride: nextOverride,
        workShifts: packedShifts,
        lastBackupAt: nowIso,
      });

      const localOpenShifts = await db.cashierShifts.where('status').equals('open').toArray();
      if (params.targetOpen && localOpenShifts.length === 0) {
        const ownerShift: CashierShift = {
          id: uuidv4(),
          kasirId: params.owner.id,
          kasirNama: `${params.owner.nama} (Owner)`,
          waktuBuka: nowIso,
          status: 'open',
          modalAwal: 0,
          pendapatanCash: 0,
          pendapatanQris: 0,
          pendapatanTransfer: 0,
          pengeluaranKasir: 0,
          expectedCash: 0,
          catatan: 'Dibuka langsung oleh Owner (tanpa modal laci)',
        };
        await db.cashierShifts.add(ownerShift);
      } else if (!params.targetOpen && localOpenShifts.length > 0) {
        for (const sh of localOpenShifts) {
          await db.cashierShifts.update(sh.id, {
            status: 'closed',
            waktuTutup: nowIso,
            uangFisikAkhir: sh.expectedCash,
            selisih: 0,
            catatan: 'Ditutup langsung oleh Owner',
          });
        }
      }

      await addAuditLog(
        params.owner,
        params.targetOpen ? 'BUKA_TOKO_OWNER' : 'TUTUP_TOKO_OWNER',
        localSettings.namaCabang || targetOid,
        params.targetOpen
          ? 'Toko dibuka langsung oleh Owner (tanpa input modal)'
          : 'Toko ditutup langsung oleh Owner'
      );
    }

    // 2. Sinkronkan ke Supabase Cloud jika online (berlaku untuk cabang aktif maupun cabang lain di tabel Daftar Cabang)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const client = getSupabaseClient(localSettings);
      const { data: row } = await client
        .from('outlets')
        .select('work_shifts')
        .eq('outlet_id', targetOid)
        .maybeSingle();

      const existingShifts = Array.isArray((row as { work_shifts?: unknown } | null)?.work_shifts)
        ? ((row as { work_shifts: WorkShiftSchedule[] }).work_shifts)
        : localSettings?.workShifts;
      const packed = packWorkShiftsWithStoreHours(existingShifts, {
        storeManualOverride: nextOverride,
      });

      await client
        .from('outlets')
        .update({ work_shifts: packed, updated_at: nowIso })
        .eq('outlet_id', targetOid);

      if (params.targetOpen) {
        const { data: openCloudShifts } = await client
          .from('cashier_shifts')
          .select('id')
          .eq('outlet_id', targetOid)
          .eq('status', 'open');
        if (!openCloudShifts || openCloudShifts.length === 0) {
          await client.from('cashier_shifts').insert({
            outlet_id: targetOid,
            id: uuidv4(),
            kasir_id: params.owner.id,
            kasir_nama: `${params.owner.nama} (Owner)`,
            waktu_buka: nowIso,
            status: 'open',
            modal_awal: 0,
            pendapatan_cash: 0,
            pendapatan_qris: 0,
            pendapatan_transfer: 0,
            pengeluaran_kasir: 0,
            expected_cash: 0,
            catatan: 'Dibuka langsung oleh Owner',
            updated_at: nowIso,
          });
        }
      } else {
        await client
          .from('cashier_shifts')
          .update({
            status: 'closed',
            waktu_tutup: nowIso,
            catatan: 'Ditutup langsung oleh Owner',
            updated_at: nowIso,
          })
          .eq('outlet_id', targetOid)
          .eq('status', 'open');
      }
    }

    return {
      success: true,
      isStoreOpen: params.targetOpen,
      statusDetail: params.targetOpen ? `${params.owner.nama} (Owner)` : 'Ditutup oleh Owner',
    };
  } catch (err) {
    return {
      success: false,
      isStoreOpen: !params.targetOpen,
      statusDetail: '',
      error: err instanceof Error ? err.message : 'Gagal mengubah status buka/tutup toko.',
    };
  }
}

/**
 * Buat Cabang Baru di Cloud (khusus Owner) dengan opsi salin Bahan, Resep HPP, & Menu dari cabang lain.
 */
export async function createNewBranch(params: {
  owner: User;
  currentSettings: AppSettings;
  namaUsaha: string;
  namaCabang: string;
  alamatUsaha: string;
  teleponUsaha?: string;
  copyCatalogFromOutletId?: string;
}): Promise<{
  success: boolean;
  branch?: BranchInfo;
  kasirAuthPin?: string;
  emailSent?: boolean;
  error?: string;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Membuat cabang baru memerlukan koneksi internet.' };
  }

  try {
    const client = getSupabaseClient(params.currentSettings);
    const nowIso = new Date().toISOString();
    const newOutletId = generateOutletCode(`${params.namaUsaha} ${params.namaCabang}`);
    const newKasirAuthPin = generateKasirAuthPin(
      params.owner.pin ? [params.owner.pin.trim()] : []
    );
    const ownerEmail = (
      params.owner.email ||
      params.currentSettings.ownerEmail ||
      (params.owner.username.includes('@') ? params.owner.username : '')
    )
      .trim()
      .toLowerCase();
    const parentOutletId =
      params.currentSettings.parentOutletId || params.currentSettings.outletId || newOutletId;

    // 1. Insert baris outlet cabang baru
    const { error: outletErr } = await client.from('outlets').upsert(
      {
        outlet_id: newOutletId,
        nama_usaha: params.namaUsaha.trim(),
        nama_cabang: params.namaCabang.trim() || 'Cabang Baru',
        owner_email: ownerEmail || null,
        parent_outlet_id: parentOutletId,
        logo_usaha: params.currentSettings.logoUsaha || null,
        alamat_usaha: params.alamatUsaha.trim() || '-',
        telepon_usaha: (params.teleponUsaha || params.currentSettings.teleponUsaha || '').trim(),
        struk_header: params.currentSettings.strukHeader || null,
        struk_footer:
          params.currentSettings.strukFooter ||
          `Terima kasih sudah berbelanja di ${params.namaUsaha.trim()}!`,
        struk_base_url: params.currentSettings.strukBaseUrl || null,
        struk_tampilkan_kasir: params.currentSettings.strukTampilkanKasir ?? true,
        struk_tampilkan_catatan_item: params.currentSettings.strukTampilkanCatatanItem ?? true,
        struk_tampilkan_wa_usaha: params.currentSettings.strukTampilkanWaUsaha ?? true,
        default_margin_persen: params.currentSettings.defaultMarginPersen ?? 40,
        metode_harga_bahan: params.currentSettings.metodeHargaBahan ?? 'weighted_avg',
        jumlah_pembelian_n: params.currentSettings.jumlahPembelianN ?? 5,
        pembulatan_harga: params.currentSettings.pembulatanHarga ?? 500,
        ambang_mepet_bep_persen: params.currentSettings.ambangMepetBepPersen ?? 10,
        default_kasir_discount: params.currentSettings.defaultKasirDiscount ?? false,
        default_kasir_record_expense: params.currentSettings.defaultKasirRecordExpense ?? true,
        kasir_auth_pin: newKasirAuthPin,
        updated_at: nowIso,
      },
      { onConflict: 'outlet_id' }
    );
    if (outletErr) return { success: false, error: outletErr.message };

    // 2. Pastikan cabang induk juga tercatat owner_email-nya
    if (ownerEmail && params.currentSettings.outletId) {
      await client
        .from('outlets')
        .update({ owner_email: ownerEmail })
        .eq('outlet_id', params.currentSettings.outletId);
    }

    // 3. Salin seluruh tim (Owner, Manager, & Kasir — 1 Tim Lintas Cabang) ke tabel users cabang baru
    const localTeam = await db.users.toArray();
    const teamToCopy: User[] =
      localTeam.length > 0 && localTeam.some((u) => u.id === params.owner.id)
        ? localTeam
        : [params.owner, ...localTeam];
    const { error: userErr } = await client.from('users').upsert(
      teamToCopy.map((member) => ({
        outlet_id: newOutletId,
        id: member.id,
        nama: member.nama,
        username: member.username,
        email: member.id === params.owner.id ? ownerEmail || member.email || null : member.email || null,
        no_hp: member.noHp || null,
        email_verified: member.emailVerified ?? (member.role === 'owner'),
        password_hash: member.passwordHash || '',
        pin: member.pin || null,
        role: member.role,
        can_discount: member.canDiscount,
        can_record_expense: member.canRecordExpense,
        active: member.active,
        created_at: member.createdAt || nowIso,
        updated_at: member.updatedAt || nowIso,
      })),
      { onConflict: 'outlet_id,id' }
    );
    if (userErr) return { success: false, error: userErr.message };

    // 4. Kategori pengeluaran standar cabang baru
    const defaultCats = [
      { id: 'cat-bahan', nama: 'Bahan Baku', sudah_masuk_hpp: true, is_system: true },
      { id: 'cat-sewa', nama: 'Sewa', sudah_masuk_hpp: false, is_system: false },
      { id: 'cat-gas', nama: 'Gas/Listrik', sudah_masuk_hpp: false, is_system: false },
      { id: 'cat-gaji', nama: 'Gaji', sudah_masuk_hpp: false, is_system: false },
      { id: 'cat-kemasan', nama: 'Kemasan', sudah_masuk_hpp: false, is_system: false },
      { id: 'cat-lain', nama: 'Lain-lain', sudah_masuk_hpp: false, is_system: false },
    ].map((c) => ({ ...c, outlet_id: newOutletId, updated_at: nowIso }));
    await client.from('expense_categories').upsert(defaultCats, { onConflict: 'outlet_id,id' });

    // 5. Opsi salin Bahan Baku, Resep HPP, dan Katalog Menu dari cabang sumber
    if (params.copyCatalogFromOutletId) {
      const srcId = params.copyCatalogFromOutletId.trim().toUpperCase();
      const [ingsRes, recsRes, menusRes, histRes] = await Promise.all([
        client.from('ingredients').select('*').eq('outlet_id', srcId),
        client.from('recipes').select('*').eq('outlet_id', srcId),
        client.from('menus').select('*').eq('outlet_id', srcId),
        client.from('menu_hpp_history').select('*').eq('outlet_id', srcId),
      ]);

      if (ingsRes.data && ingsRes.data.length > 0) {
        await client.from('ingredients').upsert(
          ingsRes.data.map((r: Record<string, any>) => ({ ...r, outlet_id: newOutletId, updated_at: nowIso })),
          { onConflict: 'outlet_id,id' }
        );
      }
      if (recsRes.data && recsRes.data.length > 0) {
        await client.from('recipes').upsert(
          recsRes.data.map((r: Record<string, any>) => ({ ...r, outlet_id: newOutletId, updated_at: nowIso })),
          { onConflict: 'outlet_id,id' }
        );
      }
      if (menusRes.data && menusRes.data.length > 0) {
        await client.from('menus').upsert(
          menusRes.data.map((r: Record<string, any>) => ({ ...r, outlet_id: newOutletId, updated_at: nowIso })),
          { onConflict: 'outlet_id,id' }
        );
      }
      if (histRes.data && histRes.data.length > 0) {
        await client.from('menu_hpp_history').upsert(
          histRes.data.map((r: Record<string, any>) => ({
            ...r,
            id: uuidv4(),
            outlet_id: newOutletId,
            berlaku_sejak: nowIso,
          })),
          { onConflict: 'outlet_id,id' }
        );
      }
    }

    // 6. Kirim email ke Owner berisi ID Outlet cabang baru & PIN Otorisasi Mode Kasir
    let emailSent = false;
    if (ownerEmail) {
      const mailRes = await sendNewBranchEmail({
        email: ownerEmail,
        namaOwner: params.owner.nama,
        namaUsaha: params.namaUsaha.trim(),
        namaCabang: params.namaCabang.trim() || 'Cabang Baru',
        alamatCabang: params.alamatUsaha.trim() || '-',
        outletId: newOutletId,
        kasirAuthPin: newKasirAuthPin,
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    return {
      success: true,
      kasirAuthPin: newKasirAuthPin,
      emailSent,
      branch: {
        outletId: newOutletId,
        namaUsaha: params.namaUsaha.trim(),
        namaCabang: params.namaCabang.trim() || 'Cabang Baru',
        alamatUsaha: params.alamatUsaha.trim() || '-',
        teleponUsaha: (params.teleponUsaha || params.currentSettings.teleponUsaha || '').trim(),
        ownerEmail: ownerEmail || undefined,
        parentOutletId,
        logoUsaha: params.currentSettings.logoUsaha,
        kasirAuthPin: newKasirAuthPin,
        updatedAt: nowIso,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal membuat cabang baru.',
    };
  }
}

/**
 * Pindah cabang aktif pada sesi Owner (menarik data cabang tujuan ke IndexedDB lokal)
 */
export async function switchActiveBranch(
  outletId: string
): Promise<{ success: boolean; message: string }> {
  return pullAllFromSupabase(outletId);
}

/**
 * Hitung agregat performa gabungan di seluruh cabang untuk tampilan "Semua Cabang (Gabungan)"
 */
export async function fetchAllBranchesPerformance(
  branches: BranchInfo[],
  dateFrom: string,
  dateTo: string
): Promise<BranchPerformanceRow[]> {
  if (branches.length === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return [];
  }

  const settings = await db.settings.get('global');
  const client = getSupabaseClient(settings);
  const outletIds = branches.map((b) => b.outletId);

  const [txRes, expRes, catRes, shiftRes] = await Promise.all([
    client
      .from('transactions')
      .select('outlet_id, waktu, total, metode_bayar, status, items')
      .in('outlet_id', outletIds),
    client
      .from('expenses')
      .select('outlet_id, tanggal, category_id, nominal, dibatalkan')
      .in('outlet_id', outletIds),
    client
      .from('expense_categories')
      .select('outlet_id, id, sudah_masuk_hpp')
      .in('outlet_id', outletIds),
    client
      .from('cashier_shifts')
      .select('outlet_id, waktu_buka, status, selisih')
      .in('outlet_id', outletIds),
  ]);

  const hppCatKeys = new Set(
    ((catRes.data as Array<{ outlet_id: string; id: string; sudah_masuk_hpp: boolean }> | null) || [])
      .filter((c) => c.sudah_masuk_hpp)
      .map((c) => `${c.outlet_id}::${c.id}`)
  );

  const map = new Map<string, BranchPerformanceRow>();
  for (const b of branches) {
    map.set(b.outletId, {
      outletId: b.outletId,
      namaUsaha: b.namaUsaha,
      namaCabang: b.namaCabang,
      omzet: 0,
      hppTerjual: 0,
      labaKotor: 0,
      biayaOperasional: 0,
      labaBersih: 0,
      totalPengeluaran: 0,
      jumlahTransaksi: 0,
      voidCount: 0,
      cashTotal: 0,
      qrisTotal: 0,
      transferTotal: 0,
      shiftClosedCount: 0,
      totalSelisihKas: 0,
    });
  }

  for (const tx of (txRes.data as Array<Record<string, any>> | null) || []) {
    const row = map.get(tx.outlet_id);
    if (!row) continue;
    const d = String(tx.waktu || '').slice(0, 10);
    if (d < dateFrom || d > dateTo) continue;
    if (tx.status === 'void') {
      row.voidCount += 1;
      continue;
    }
    row.jumlahTransaksi += 1;
    const total = Number(tx.total || 0);
    row.omzet += total;
    if (tx.metode_bayar === 'Cash') row.cashTotal += total;
    else if (tx.metode_bayar === 'QRIS') row.qrisTotal += total;
    else if (tx.metode_bayar === 'Transfer') row.transferTotal += total;
    for (const it of Array.isArray(tx.items) ? tx.items : []) {
      row.hppTerjual += Number(it.snapshotHpp || 0) * Number(it.jumlah || 0);
    }
  }

  for (const exp of (expRes.data as Array<Record<string, any>> | null) || []) {
    const row = map.get(exp.outlet_id);
    if (!row || exp.dibatalkan) continue;
    const d = String(exp.tanggal || '').slice(0, 10);
    if (d < dateFrom || d > dateTo) continue;
    const nom = Number(exp.nominal || 0);
    row.totalPengeluaran += nom;
    if (!hppCatKeys.has(`${exp.outlet_id}::${exp.category_id}`)) {
      row.biayaOperasional += nom;
    }
  }

  for (const sh of (shiftRes.data as Array<Record<string, any>> | null) || []) {
    const row = map.get(sh.outlet_id);
    if (!row || sh.status !== 'closed') continue;
    const d = String(sh.waktu_buka || '').slice(0, 10);
    if (d < dateFrom || d > dateTo) continue;
    row.shiftClosedCount += 1;
    row.totalSelisihKas += Number(sh.selisih || 0);
  }

  for (const row of map.values()) {
    row.labaKotor = row.omzet - row.hppTerjual;
    row.labaBersih = row.labaKotor - row.biayaOperasional;
  }

  return Array.from(map.values()).sort((a, b) => b.omzet - a.omzet);
}
