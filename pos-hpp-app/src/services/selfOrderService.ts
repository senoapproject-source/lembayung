import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database';
import { getSupabaseClient, getSupabaseConfig, getWebBackofficeUrl } from './syncService';
import {
  evaluateStoreOpenStatus,
  unpackStoreHoursFromWorkShifts,
} from './branchService';
import type { MenuItem, SavedOrder, SavedOrderItem } from '../types/models';

export type SelfOrderMode = 'dine_in' | 'pickup' | 'delivery';
export type SelfOrderStage =
  | 'draft_group'
  | 'menunggu_konfirmasi'
  | 'diproses'
  | 'diantar'
  | 'selesai';

export interface SelfOrderMeta {
  isSelfOrder: true;
  mode: SelfOrderMode;
  stage: SelfOrderStage;
  customerName: string;
  customerWa?: string;
  tableNumber?: string;
  pickupTime?: string;
  deliveryAddress?: string;
  deliveryLandmark?: string;
  mapsUrl?: string;
  isGroupOrder?: boolean;
  groupCode?: string;
  hostName?: string;
}

export interface SelfOrderCartItem extends SavedOrderItem {
  participantName?: string;
  participantWa?: string;
  selfOrderMeta?: SelfOrderMeta;
}

export interface PublicStoreCatalog {
  outletId: string;
  namaUsaha: string;
  namaCabang: string;
  alamatUsaha: string;
  teleponUsaha: string;
  logoUsaha?: string;
  isStoreOpen: boolean;
  activeCashierName?: string;
  menus: MenuItem[];
}

export function buildSelfOrderUrl(
  outletId: string,
  opts?: {
    meja?: string;
    group?: string;
    track?: string;
    customBaseUrl?: string;
  }
): string {
  const base = (opts?.customBaseUrl || getWebBackofficeUrl()).replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('order', outletId.trim().toUpperCase());
  if (opts?.meja?.trim()) params.set('meja', opts.meja.trim());
  if (opts?.group?.trim()) params.set('group', opts.group.trim());
  if (opts?.track?.trim()) params.set('track', opts.track.trim());
  return `${base}/?${params.toString()}`;
}

export function extractSelfOrderMeta(order: SavedOrder): SelfOrderMeta | null {
  const firstItem = (order.items?.[0] as SelfOrderCartItem | undefined)?.selfOrderMeta;
  if (firstItem && firstItem.isSelfOrder) {
    return firstItem;
  }
  if (order.kasirId === 'SELF_ORDER' || order.kasirId === 'SELF_ORDER_GROUP_DRAFT') {
    return {
      isSelfOrder: true,
      mode: 'dine_in',
      stage: order.kasirId === 'SELF_ORDER_GROUP_DRAFT' ? 'draft_group' : 'menunggu_konfirmasi',
      customerName: order.labelMejaPelanggan,
      customerWa: order.noWaPelanggan,
    };
  }
  return null;
}

export function formatStageLabel(stage: SelfOrderStage, mode?: SelfOrderMode): string {
  switch (stage) {
    case 'draft_group':
      return 'Mengumpulkan Pesanan Bareng';
    case 'menunggu_konfirmasi':
      return 'Menunggu Konfirmasi Kasir';
    case 'diproses':
      return 'Sedang Disiapkan / Dimasak';
    case 'diantar':
      return mode === 'delivery'
        ? 'Sedang Diantar ke Lokasi'
        : mode === 'pickup'
        ? 'Siap Diambil di Toko'
        : 'Siap Disajikan';
    case 'selesai':
      return 'Selesai & Lunas';
  }
}

export function formatModeLabel(mode: SelfOrderMode): string {
  if (mode === 'delivery') return '🛵 Pesan Antar';
  if (mode === 'pickup') return '🛍️ Ambil Sendiri';
  return '🍽️ Makan di Tempat';
}

export function buildOrderDisplayLabel(meta: SelfOrderMeta): string {
  const groupTag = meta.isGroupOrder ? '👥 Bareng · ' : '📱 ';
  if (meta.mode === 'delivery') {
    return `${groupTag}Antar · ${meta.customerName}`;
  }
  if (meta.mode === 'pickup') {
    const timeTag = meta.pickupTime ? ` (${meta.pickupTime})` : '';
    return `${groupTag}Ambil${timeTag} · ${meta.customerName}`;
  }
  const tbl = meta.tableNumber ? `${meta.tableNumber} · ` : '';
  return `${groupTag}${tbl}${meta.customerName}`;
}

/**
 * Ambil katalog menu publik & status buka/tutup toko untuk halaman Self-Order pelanggan
 */
export async function fetchPublicStoreCatalog(outletId: string): Promise<{
  success: boolean;
  catalog?: PublicStoreCatalog;
  error?: string;
}> {
  const cleanOid = outletId.trim().toUpperCase();
  if (!cleanOid) return { success: false, error: 'Kode toko tidak valid.' };

  try {
    const client = getSupabaseClient();
    const [outletRes, menusRes, shiftRes] = await Promise.all([
      client.from('outlets').select('*').eq('outlet_id', cleanOid).maybeSingle(),
      client
        .from('menus')
        .select('id, recipe_id, nama, kategori, foto, harga_jual, active, updated_at')
        .eq('outlet_id', cleanOid)
        .eq('active', true)
        .order('nama', { ascending: true }),
      client
        .from('cashier_shifts')
        .select('id, kasir_nama, waktu_buka')
        .eq('outlet_id', cleanOid)
        .eq('status', 'open')
        .limit(1),
    ]);

    if (outletRes.error || !outletRes.data) {
      return { success: false, error: `Toko dengan kode "${cleanOid}" tidak ditemukan.` };
    }

    const row = outletRes.data as Record<string, any>;
    const openShifts = (shiftRes.data as Array<{ kasir_nama?: string; waktu_buka?: string }> | null) || [];
    const hoursCfg = unpackStoreHoursFromWorkShifts(row.work_shifts);
    const evalOpen = evaluateStoreOpenStatus({
      hasOpenShift: openShifts.length > 0,
      activeCashierName: openShifts[0]?.kasir_nama,
      shiftOpenedAt: openShifts[0]?.waktu_buka,
      hoursConfig: hoursCfg,
    });
    const menus: MenuItem[] = ((menusRes.data as Array<Record<string, any>>) || []).map((m) => ({
      id: m.id,
      recipeId: m.recipe_id || '',
      nama: m.nama,
      kategori: m.kategori || 'Menu',
      foto: m.foto || undefined,
      hargaJual: Number(m.harga_jual || 0),
      active: Boolean(m.active),
      updatedAt: m.updated_at || new Date().toISOString(),
    }));

    return {
      success: true,
      catalog: {
        outletId: cleanOid,
        namaUsaha: row.nama_usaha || 'Lembayung',
        namaCabang: row.nama_cabang || 'Pusat',
        alamatUsaha: row.alamat_usaha || '-',
        teleponUsaha: row.telepon_usaha || '',
        logoUsaha: row.logo_usaha || undefined,
        isStoreOpen: evalOpen.isStoreOpen,
        activeCashierName: openShifts[0]?.kasir_nama || evalOpen.statusDetail,
        menus,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal memuat katalog toko.',
    };
  }
}

/**
 * Ambil data pesanan Self-Order / Group Order tertentu dari Supabase saved_orders
 */
export async function fetchPublicSelfOrder(
  outletId: string,
  orderId: string
): Promise<SavedOrder | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('saved_orders')
      .select('*')
      .eq('outlet_id', outletId.trim().toUpperCase())
      .eq('id', orderId.trim())
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Record<string, any>;
    return {
      id: r.id,
      labelMejaPelanggan: r.label_meja_pelanggan,
      noWaPelanggan: r.no_wa_pelanggan || undefined,
      waktuSimpan: r.waktu_simpan,
      kasirId: r.kasir_id,
      kasirNama: r.kasir_nama,
      items: Array.isArray(r.items) ? r.items : [],
    };
  } catch {
    return null;
  }
}

/**
 * Buat kamar Pesan Bareng (Group Order Draft) baru oleh Host
 */
export async function createGroupOrderRoom(params: {
  outletId: string;
  hostName: string;
  hostWa: string;
  mode: SelfOrderMode;
  tableNumber?: string;
  pickupTime?: string;
  deliveryAddress?: string;
  deliveryLandmark?: string;
  mapsUrl?: string;
  initialItems: Array<{ menu: MenuItem; jumlah: number; catatan?: string }>;
}): Promise<{ success: boolean; orderId?: string; groupCode?: string; error?: string }> {
  try {
    const client = getSupabaseClient();
    const cleanOid = params.outletId.trim().toUpperCase();
    const code = `GRP-${Math.floor(1000 + Math.random() * 9000)}`;
    const orderId = `so-${code.toLowerCase()}-${Date.now().toString(36)}`;
    const nowIso = new Date().toISOString();

    const meta: SelfOrderMeta = {
      isSelfOrder: true,
      mode: params.mode,
      stage: 'draft_group',
      customerName: params.hostName.trim(),
      customerWa: params.hostWa.trim() || undefined,
      tableNumber: params.tableNumber?.trim() || undefined,
      pickupTime: params.pickupTime?.trim() || undefined,
      deliveryAddress: params.deliveryAddress?.trim() || undefined,
      deliveryLandmark: params.deliveryLandmark?.trim() || undefined,
      mapsUrl: params.mapsUrl?.trim() || undefined,
      isGroupOrder: true,
      groupCode: code,
      hostName: params.hostName.trim(),
    };

    const items: SelfOrderCartItem[] =
      params.initialItems.length > 0
        ? params.initialItems.map((it, idx) => ({
            id: uuidv4(),
            menuId: it.menu.id,
            menuNama: it.menu.nama,
            hargaJual: it.menu.hargaJual,
            jumlah: it.jumlah,
            catatan: it.catatan?.trim() || undefined,
            participantName: params.hostName.trim(),
            participantWa: params.hostWa.trim() || undefined,
            ...(idx === 0 ? { selfOrderMeta: meta } : {}),
          }))
        : [
            {
              id: uuidv4(),
              menuId: '__GROUP_HOLDER__',
              menuNama: 'Menunggu Pilihan Menu',
              hargaJual: 0,
              jumlah: 0,
              participantName: params.hostName.trim(),
              participantWa: params.hostWa.trim() || undefined,
              selfOrderMeta: meta,
            },
          ];

    const { error } = await client.from('saved_orders').upsert(
      {
        outlet_id: cleanOid,
        id: orderId,
        label_meja_pelanggan: buildOrderDisplayLabel(meta),
        no_wa_pelanggan: params.hostWa.trim() || null,
        waktu_simpan: nowIso,
        kasir_id: 'SELF_ORDER_GROUP_DRAFT',
        kasir_nama: `Pesan Bareng (${code})`,
        items,
      },
      { onConflict: 'outlet_id,id' }
    );

    if (error) return { success: false, error: error.message };
    return { success: true, orderId, groupCode: code };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal membuat kamar Pesan Bareng.',
    };
  }
}

/**
 * Tambahkan / perbarui pilihan menu milik 1 teman (participant) ke dalam kamar Pesan Bareng
 */
export async function upsertGroupParticipantItems(params: {
  outletId: string;
  orderId: string;
  participantName: string;
  participantWa?: string;
  items: Array<{ menu: MenuItem; jumlah: number; catatan?: string }>;
}): Promise<{ success: boolean; updatedOrder?: SavedOrder; error?: string }> {
  try {
    const cleanOid = params.outletId.trim().toUpperCase();
    const existing = await fetchPublicSelfOrder(cleanOid, params.orderId);
    if (!existing) {
      return { success: false, error: 'Kamar Pesan Bareng tidak ditemukan atau sudah ditutup.' };
    }
    const meta = extractSelfOrderMeta(existing);
    if (!meta || meta.stage !== 'draft_group') {
      return { success: false, error: 'Pesanan Bareng ini sudah dikirim ke kasir dan dikunci.' };
    }

    const cleanName = params.participantName.trim();
    const cleanWa = (params.participantWa || '').trim() || undefined;
    const otherItems = (existing.items as SelfOrderCartItem[]).filter(
      (it) =>
        it.menuId !== '__GROUP_HOLDER__' &&
        (it.participantName || '').trim().toLowerCase() !== cleanName.toLowerCase()
    );

    const myNewItems: SelfOrderCartItem[] = params.items.map((it) => ({
      id: uuidv4(),
      menuId: it.menu.id,
      menuNama: it.menu.nama,
      hargaJual: it.menu.hargaJual,
      jumlah: it.jumlah,
      catatan: it.catatan?.trim() || undefined,
      participantName: cleanName,
      participantWa: cleanWa,
    }));

    const combined: SelfOrderCartItem[] = [...otherItems, ...myNewItems];
    if (combined.length === 0) {
      combined.push({
        id: uuidv4(),
        menuId: '__GROUP_HOLDER__',
        menuNama: 'Menunggu Pilihan Menu',
        hargaJual: 0,
        jumlah: 0,
        participantName: meta.hostName || cleanName,
        selfOrderMeta: meta,
      });
    } else {
      combined[0] = { ...combined[0], selfOrderMeta: meta };
    }

    const client = getSupabaseClient();
    const nowIso = new Date().toISOString();
    const { error } = await client.from('saved_orders').upsert(
      {
        outlet_id: cleanOid,
        id: existing.id,
        label_meja_pelanggan: existing.labelMejaPelanggan,
        no_wa_pelanggan: existing.noWaPelanggan || null,
        waktu_simpan: nowIso,
        kasir_id: 'SELF_ORDER_GROUP_DRAFT',
        kasir_nama: existing.kasirNama,
        items: combined,
      },
      { onConflict: 'outlet_id,id' }
    );
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      updatedOrder: {
        ...existing,
        waktuSimpan: nowIso,
        items: combined,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan pilihan menu.',
    };
  }
}

/**
 * Hapus seluruh pilihan menu milik 1 peserta dari kamar Pesan Bareng
 */
export async function removeGroupParticipantItems(params: {
  outletId: string;
  orderId: string;
  participantName: string;
}): Promise<{ success: boolean; updatedOrder?: SavedOrder; error?: string }> {
  return upsertGroupParticipantItems({
    outletId: params.outletId,
    orderId: params.orderId,
    participantName: params.participantName,
    items: [],
  });
}

/**
 * Kirim pesanan Self-Order (mandiri maupun finalisasi Pesan Bareng) ke Kasir Toko
 */
export async function submitSelfOrderToCashier(params: {
  outletId: string;
  existingGroupOrderId?: string;
  meta: Omit<SelfOrderMeta, 'isSelfOrder' | 'stage'>;
  items: Array<{
    menuId: string;
    menuNama: string;
    hargaJual: number;
    jumlah: number;
    catatan?: string;
    participantName?: string;
    participantWa?: string;
  }>;
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const realItems = params.items.filter((i) => i.menuId !== '__GROUP_HOLDER__' && i.jumlah > 0);
  if (realItems.length === 0) {
    return { success: false, error: 'Pilih minimal 1 menu sebelum mengirim pesanan.' };
  }

  try {
    const cleanOid = params.outletId.trim().toUpperCase();
    const orderId = params.existingGroupOrderId || `so-${Date.now().toString(36)}-${Math.floor(100 + Math.random() * 900)}`;
    const nowIso = new Date().toISOString();

    const fullMeta: SelfOrderMeta = {
      ...params.meta,
      isSelfOrder: true,
      stage: 'menunggu_konfirmasi',
    };

    const participantSet = new Set(
      realItems.map((i) => (i.participantName || fullMeta.customerName).trim().toLowerCase())
    );
    const label =
      fullMeta.isGroupOrder && participantSet.size > 1
        ? `${buildOrderDisplayLabel(fullMeta)} (${participantSet.size} org)`
        : buildOrderDisplayLabel(fullMeta);

    const formattedItems: SelfOrderCartItem[] = realItems.map((it, idx) => {
      const pName = (it.participantName || '').trim();
      const rawNote = (it.catatan || '').trim();
      // Sertakan nama pemesan di catatan item jika Pesan Bareng agar kasir & dapur tahu milik siapa
      const effectiveNote =
        fullMeta.isGroupOrder && pName
          ? rawNote.startsWith(`[${pName}]`)
            ? rawNote
            : rawNote
            ? `[${pName}] ${rawNote}`
            : `[${pName}]`
          : rawNote || undefined;

      return {
        id: uuidv4(),
        menuId: it.menuId,
        menuNama: it.menuNama,
        hargaJual: it.hargaJual,
        jumlah: it.jumlah,
        catatan: effectiveNote,
        participantName: pName || fullMeta.customerName,
        participantWa: (it.participantWa || '').trim() || (pName === fullMeta.customerName ? fullMeta.customerWa : undefined),
        ...(idx === 0 ? { selfOrderMeta: fullMeta } : {}),
      };
    });

    const client = getSupabaseClient();
    const { error } = await client.from('saved_orders').upsert(
      {
        outlet_id: cleanOid,
        id: orderId,
        label_meja_pelanggan: label,
        no_wa_pelanggan: fullMeta.customerWa || null,
        waktu_simpan: nowIso,
        kasir_id: 'SELF_ORDER',
        kasir_nama: `${formatModeLabel(fullMeta.mode)} · ${formatStageLabel('menunggu_konfirmasi', fullMeta.mode)}`,
        items: formattedItems,
      },
      { onConflict: 'outlet_id,id' }
    );

    if (error) return { success: false, error: error.message };

    // Kirim push notification FCM ke perangkat kasir & Owner toko
    const totalRp = formattedItems.reduce((s, i) => s + i.hargaJual * i.jumlah, 0);
    const totalQty = formattedItems.reduce((s, i) => s + i.jumlah, 0);
    client.functions
      .invoke('cuanin-auth-email', {
        body: {
          action: 'send_fcm_push',
          outletId: cleanOid,
          title: `📱 Pesanan Baru: ${label}`,
          body: `${totalQty} item · Rp${totalRp.toLocaleString('id-ID')} (${formatModeLabel(fullMeta.mode)})`,
        },
      })
      .catch(() => {});

    return { success: true, orderId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim pesanan ke toko.',
    };
  }
}

/**
 * Update status progres Self-Order dari layar Kasir (misal: Diproses / Sedang Diantar)
 */
export async function updateSelfOrderStageByCashier(
  order: SavedOrder,
  nextStage: SelfOrderStage
): Promise<{ success: boolean; error?: string }> {
  const meta = extractSelfOrderMeta(order);
  if (!meta) return { success: false, error: 'Bukan pesanan Self-Order.' };

  const updatedMeta: SelfOrderMeta = {
    ...meta,
    stage: nextStage,
  };
  const updatedItems: SelfOrderCartItem[] = (order.items as SelfOrderCartItem[]).map((it, idx) =>
    idx === 0 ? { ...it, selfOrderMeta: updatedMeta } : it
  );
  const updatedKasirNama = `${formatModeLabel(updatedMeta.mode)} · ${formatStageLabel(nextStage, updatedMeta.mode)}`;

  await db.savedOrders.update(order.id, {
    kasirNama: updatedKasirNama,
    items: updatedItems,
  });

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const settings = await db.settings.get('global');
      const cfg = getSupabaseConfig(settings);
      const client = getSupabaseClient(settings);
      await client
        .from('saved_orders')
        .update({
          kasir_nama: updatedKasirNama,
          items: updatedItems,
        })
        .eq('outlet_id', cfg.outletId)
        .eq('id', order.id);
    } catch {
      // ignore offline
    }
  }
  return { success: true };
}
