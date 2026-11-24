import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { generateKasirAuthPin, generateOutletCode } from '../db/actions';
import { getSupabaseClient, pullAllFromSupabase } from './syncService';
import { sendNewBranchEmail } from './authEmailService';
import type { AppSettings, BranchInfo, User } from '../types/models';

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

  for (const row of (outletRows as Array<Record<string, any>> | null) || []) {
    const oid = String(row.outlet_id || '').trim().toUpperCase();
    const rowOwnerEmail = String(row.owner_email || '').trim().toLowerCase();
    if (matchedOutletIds.has(oid) || (ownerEmail && rowOwnerEmail === ownerEmail)) {
      branches.push({
        outletId: oid,
        namaUsaha: row.nama_usaha || 'Lembayung',
        namaCabang: row.nama_cabang || 'Pusat',
        alamatUsaha: row.alamat_usaha || '-',
        teleponUsaha: row.telepon_usaha || '',
        ownerEmail: row.owner_email || ownerEmail || undefined,
        parentOutletId: row.parent_outlet_id || undefined,
        logoUsaha: row.logo_usaha || undefined,
        updatedAt: row.updated_at || new Date().toISOString(),
      });
    }
  }

  return branches.sort((a, b) => {
    if (!a.parentOutletId && b.parentOutletId) return -1;
    if (a.parentOutletId && !b.parentOutletId) return 1;
    return a.namaCabang.localeCompare(b.namaCabang);
  });
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

    // 3. Salin akun Owner ke tabel users cabang baru (dengan id baru atau sama agar login tetap mulus)
    const { error: userErr } = await client.from('users').upsert(
      {
        outlet_id: newOutletId,
        id: params.owner.id,
        nama: params.owner.nama,
        username: params.owner.username,
        email: ownerEmail || null,
        email_verified: params.owner.emailVerified ?? true,
        password_hash: params.owner.passwordHash,
        pin: params.owner.pin || null,
        role: 'owner',
        can_discount: true,
        can_record_expense: true,
        active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
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
