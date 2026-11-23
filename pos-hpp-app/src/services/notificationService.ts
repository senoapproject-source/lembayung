import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { db } from '../db/database';
import { formatRupiah } from '../lib/calculations';
import { getSupabaseClient, pullAllFromSupabase } from './syncService';

export const NOTIF_ENABLED_KEY = 'cuanin_notifications_enabled';
const SEEN_KEYS_STORAGE_KEY = 'cuanin_seen_notif_keys_v1';
const CHANNEL_ID = 'cuanin_transactions_channel';

let notifCounter = 100;
let activeRealtimeChannel: RealtimeChannel | null = null;

function loadSeenNotifKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEYS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.slice(-250)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenNotifKeys(set: Set<string>): void {
  try {
    const arr = Array.from(set).slice(-250);
    localStorage.setItem(SEEN_KEYS_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // ignore storage quota errors
  }
}

const recentlyNotifiedIds = loadSeenNotifKeys();

function isRecentTimestamp(iso?: string, maxAgeMs = 120_000): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return Math.abs(Date.now() - ts) <= maxAgeMs;
}

export function isNotificationsEnabled(): boolean {
  const val = localStorage.getItem(NOTIF_ENABLED_KEY);
  return val !== 'false'; // Default aktif (true)
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(NOTIF_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * Minta izin notifikasi ke Android / Browser & buat Notification Channel (Android 8+)
 */
export async function initDeviceNotifications(): Promise<boolean> {
  if (!isNotificationsEnabled()) return false;

  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        if (req.display !== 'granted') return false;
      }

      // Buat channel khusus transaksi agar muncul pop-up & bunyi di Android 8+
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'Notifikasi Transaksi Lembayung',
        description: 'Pemberitahuan setiap kali ada penjualan, pembelian bahan, pengeluaran, atau void',
        importance: 5, // High (heads-up notification + sound)
        visibility: 1, // Public
        sound: 'default',
        vibration: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  // Fallback untuk Browser Web
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const res = await Notification.requestPermission();
      return res === 'granted';
    }
  }
  return false;
}

/**
 * Tampilkan notifikasi langsung ke bar notifikasi HP / Tab (atau Browser)
 */
export async function sendDeviceNotification(params: {
  title: string;
  body: string;
  dedupKey?: string;
  broadcastFcm?: boolean;
}): Promise<void> {
  // Jika ini aksi lokal yang ingin disiarkan ke perangkat lain (mis. HP Owner saat aplikasi ditutup),
  // tembak Firebase Cloud Messaging (FCM) di background
  if (params.broadcastFcm) {
    import('./pushNotificationService')
      .then(({ triggerOutletFcmPush }) =>
        triggerOutletFcmPush({ title: params.title, body: params.body })
      )
      .catch(() => {});
  }

  if (!isNotificationsEnabled()) return;

  // Cegah duplikat notifikasi secara persisten (tidak muncul ulang saat bulk-sync / restart)
  if (params.dedupKey) {
    if (recentlyNotifiedIds.has(params.dedupKey)) return;
    recentlyNotifiedIds.add(params.dedupKey);
    saveSeenNotifKeys(recentlyNotifiedIds);
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return;

      notifCounter = (notifCounter + 1) % 2147483000;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifCounter,
            title: params.title,
            body: params.body,
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_lembayung',
            largeIcon: 'ic_lembayung_logo',
            iconColor: '#1F7A5A',
            schedule: { at: new Date(Date.now() + 150) },
          },
        ],
      });
    } catch {
      // ignore
    }
    return;
  }

  // Fallback Web Notification
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(params.title, {
        body: params.body,
        icon: '/cuanin-icon-1024.png',
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Dengarkan Supabase Realtime untuk Kode Toko saat ini.
 * Jika ada transaksi penjualan, void, pembelian bahan, pengeluaran, atau perubahan menu/user
 * dari HP/Tab lain, tampilkan notifikasi HANYA jika datanya benar-benar baru/berubah (anti-spam!).
 */
export async function startRealtimeTransactionNotifications(): Promise<void> {
  stopRealtimeTransactionNotifications();

  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const settings = await db.settings.get('global');
  const outletId = (settings?.outletId || 'CUAN-8899').trim().toUpperCase();
  const client = getSupabaseClient(settings);

  activeRealtimeChannel = client
    .channel(`cuanin-notif-${outletId}`)
    // 1. Transaksi Penjualan Baru & Void
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'transactions',
        filter: `outlet_id=eq.${outletId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, any>;
        if (!row?.id) return;
        sendDeviceNotification({
          title: `Penjualan Baru ${row.nomor_struk || ''} (${row.metode_bayar || 'Cash'})`,
          body: `${formatRupiah(Number(row.total) || 0)} · Kasir: ${row.kasir_nama || '-'}${
            row.nama_pelanggan ? ` · ${row.nama_pelanggan}` : ''
          }`,
          dedupKey: `tx-new-${row.id}`,
        });
        pullAllFromSupabase().catch(() => {});
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'transactions',
        filter: `outlet_id=eq.${outletId}`,
      },
      async (payload) => {
        const row = payload.new as Record<string, any>;
        if (row?.id && row?.status === 'void') {
          const localTx = await db.transactions.get(row.id);
          if (!localTx || localTx.status !== 'void') {
            sendDeviceNotification({
              title: `Transaksi Dibatalkan (Void) ${row.nomor_struk || ''}`,
              body: `${formatRupiah(Number(row.total) || 0)} · Alasan: ${row.alasan_void || '-'}`,
              dedupKey: `tx-void-${row.id}`,
            });
          }
          pullAllFromSupabase().catch(() => {});
        }
      }
    )
    // 2. Pengeluaran Manual Baru & Pembatalan Pengeluaran
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'expenses',
        filter: `outlet_id=eq.${outletId}`,
      },
      (payload) => {
        const row = payload.new as Record<string, any>;
        if (!row?.id) return;
        // Cegah notif dobel jika pengeluaran ini otomatis dari pembelian bahan baku
        if (row.sumber !== 'pembelian_bahan') {
          sendDeviceNotification({
            title: `Pengeluaran: ${row.category_nama || 'Lain-lain'}`,
            body: `${formatRupiah(Number(row.nominal) || 0)} · ${row.keterangan || '-'} (${row.pembuat_nama || '-'})`,
            dedupKey: `exp-new-${row.id}`,
          });
        }
        pullAllFromSupabase().catch(() => {});
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'expenses',
        filter: `outlet_id=eq.${outletId}`,
      },
      async (payload) => {
        const row = payload.new as Record<string, any>;
        if (!row?.id) return;
        if (row.dibatalkan && row.sumber !== 'pembelian_bahan') {
          const localExp = await db.expenses.get(row.id);
          if (!localExp || !localExp.dibatalkan) {
            sendDeviceNotification({
              title: `Pengeluaran Dibatalkan`,
              body: `${row.category_nama || 'Pengeluaran'} · ${formatRupiah(Number(row.nominal) || 0)} (${row.keterangan || '-'})`,
              dedupKey: `exp-void-${row.id}`,
            });
          }
        }
        pullAllFromSupabase().catch(() => {});
      }
    )
    // 3. Pembelian Bahan Baku Baru & Pembatalan Pembelian (cukup sinkron diam-diam, tanpa notif agar tidak spam)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'purchases',
        filter: `outlet_id=eq.${outletId}`,
      },
      () => {
        pullAllFromSupabase().catch(() => {});
      }
    )
    // 4. Sinkronisasi & Notifikasi Anti-Spam untuk Menu, Resep, Bahan, dan Pengguna
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'menus',
        filter: `outlet_id=eq.${outletId}`,
      },
      async (payload) => {
        const row = payload.new as Record<string, any>;
        if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && row?.id) {
          // Hanya tampilkan notif jika menu benar-benar baru / berubah harga/nama (bukan efek upsert rutin saat sync!)
          const localMenu = await db.menus.get(row.id);
          const newHarga = Number(row.harga_jual) || 0;
          const actuallyChanged =
            !localMenu ||
            localMenu.hargaJual !== newHarga ||
            localMenu.nama !== row.nama ||
            localMenu.kategori !== row.kategori;

          if (actuallyChanged && isRecentTimestamp(row.updated_at)) {
            sendDeviceNotification({
              title: localMenu ? `Menu Diperbarui: ${row.nama || 'Menu'}` : `Menu Baru: ${row.nama || 'Menu'}`,
              body: `Harga jual ${formatRupiah(newHarga)} · ${row.kategori || '-'}`,
              dedupKey: `menu-${row.id}-${row.updated_at || ''}`,
            });
          }
        } else if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as Record<string, any> | null;
          if (oldRow?.id) {
            const localMenu = await db.menus.get(oldRow.id);
            if (localMenu) {
              sendDeviceNotification({
                title: `Menu Dihapus: ${localMenu.nama}`,
                body: `Menu ${localMenu.nama} telah dihapus oleh Owner`,
                dedupKey: `menu-del-${oldRow.id}`,
              });
            }
          }
        }
        pullAllFromSupabase().catch(() => {});
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'recipes',
        filter: `outlet_id=eq.${outletId}`,
      },
      () => {
        pullAllFromSupabase().catch(() => {});
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'ingredients',
        filter: `outlet_id=eq.${outletId}`,
      },
      () => {
        pullAllFromSupabase().catch(() => {});
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'users',
      },
      (payload) => {
        const newRow = payload.new as Record<string, any> | null;
        const oldRow = payload.old as Record<string, any> | null;
        if (payload.eventType === 'INSERT' && newRow?.outlet_id === outletId && newRow?.id) {
          sendDeviceNotification({
            title: `Pengguna Baru: ${newRow.nama || 'Kasir'}`,
            body: `Akun ${newRow.username || '-'} (${newRow.role || 'kasir'}) ditambahkan`,
            dedupKey: `user-add-${newRow.id}`,
          });
        } else if (payload.eventType === 'DELETE' && oldRow?.id) {
          if (!oldRow.outlet_id || oldRow.outlet_id === outletId) {
            sendDeviceNotification({
              title: `Pengguna Dihapus`,
              body: `Satu akun pengguna telah dihapus oleh Owner`,
              dedupKey: `user-del-${oldRow.id}`,
            });
          }
        }
        pullAllFromSupabase().catch(() => {});
      }
    )
    // 5. Notifikasi instan saat ada rilis update versi baru di app_versions (OTA maupun APK manual)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'app_versions',
      },
      (payload) => {
        const row = payload.new as Record<string, any>;
        if (!row?.latest_version) return;
        const isManualApk = !row.bundle_zip_url;
        sendDeviceNotification({
          title: `Pembaruan Lembayung v${row.latest_version} Tersedia`,
          body: isManualApk
            ? 'Versi terbaru Lembayung sudah tersedia. Ketuk untuk mengunduh pembaruan.'
            : `${row.release_notes || 'Pembaruan fitur dan perbaikan terbaru siap dipasang.'}`,
          dedupKey: `app-update-${row.latest_version}`,
        });
      }
    )
    .subscribe();
}

export function stopRealtimeTransactionNotifications(): void {
  if (activeRealtimeChannel) {
    activeRealtimeChannel.unsubscribe();
    activeRealtimeChannel = null;
  }
}
