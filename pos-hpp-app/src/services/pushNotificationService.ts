import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { db } from '../db/database';
import { getSupabaseClient, getSupabaseConfig } from './syncService';
import { sendDeviceNotification } from './notificationService';
import type { User } from '../types/models';

const FCM_TOKEN_KEY = 'cuanin_fcm_push_token_v1';
let listenersBound = false;
let currentPushUser: User | null = null;

export function getSavedFcmToken(): string {
  try {
    return localStorage.getItem(FCM_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function saveTokenToSupabase(token: string, user: User | null): Promise<void> {
  if (!token || !user) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    if (!cfg.outletId) return;
    const client = getSupabaseClient(settings);
    // Pastikan 1 perangkat (token) hanya terdaftar pada 1 outlet aktif (hapus sisa outlet lama jika pindah toko)
    await client
      .from('device_push_tokens')
      .delete()
      .eq('token', token)
      .neq('outlet_id', cfg.outletId);

    await client.from('device_push_tokens').upsert(
      {
        outlet_id: cfg.outletId,
        token,
        user_id: user.id,
        role: user.role,
        platform: Capacitor.getPlatform(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'outlet_id,token' }
    );
  } catch {
    // Abaikan jika tabel belum dibuat di Supabase
  }
}

/**
 * Hapus token perangkat dari Supabase saat pengguna keluar penuh (Ganti Akun Lain / Logout)
 * agar perangkat tidak lagi menerima notifikasi dari outlet sebelumnya.
 */
export async function unregisterFcmPushToken(): Promise<void> {
  const token = getSavedFcmToken();
  if (!token) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const settings = await db.settings.get('global');
    const client = getSupabaseClient(settings);
    await client.from('device_push_tokens').delete().eq('token', token);
  } catch {
    // ignore
  }
}

/**
 * Daftarkan perangkat Android ke Firebase Cloud Messaging (FCM)
 * agar notifikasi tetap masuk walaupun aplikasi Lembayung ditutup total.
 */
export async function registerFcmPushForUser(user: User): Promise<void> {
  currentPushUser = user;
  if (!Capacitor.isNativePlatform()) return;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    if (!listenersBound) {
      listenersBound = true;

      await PushNotifications.addListener('registration', async (tokenObj) => {
        const token = tokenObj.value?.trim();
        if (!token) return;
        try {
          localStorage.setItem(FCM_TOKEN_KEY, token);
        } catch {
          // ignore
        }
        await saveTokenToSupabase(token, currentPushUser);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        // Saat aplikasi sedang terbuka di foreground, tampilkan lewat LocalNotification
        if (notification.title || notification.body) {
          sendDeviceNotification({
            title: notification.title || 'Lembayung',
            body: notification.body || '',
            dedupKey: notification.id ? `fcm-${notification.id}` : undefined,
          });
        }
      });
    }

    await PushNotifications.register();

    // Jika token sudah pernah disimpan sebelumnya, pastikan langsung tersinkron dengan user/outlet aktif
    const existing = getSavedFcmToken();
    if (existing) {
      await saveTokenToSupabase(existing, user);
    }
  } catch {
    // Jangan ganggu jalannya aplikasi jika FCM belum dikonfigurasi
  }
}

/**
 * Kirim Push Notification FCM ke perangkat lain pada outlet yang sama
 * (melalui Supabase Edge Function cuanin-auth-email -> Firebase HTTP v1).
 */
export async function triggerOutletFcmPush(params: {
  title: string;
  body: string;
  targetRoles?: Array<'owner' | 'kasir'>;
}): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const settings = await db.settings.get('global');
    const cfg = getSupabaseConfig(settings);
    if (!cfg.outletId) return;
    const client = getSupabaseClient(settings);
    const excludeToken = getSavedFcmToken();

    await client.functions.invoke('cuanin-auth-email', {
      body: {
        action: 'send_fcm_push',
        outletId: cfg.outletId,
        title: params.title,
        body: params.body,
        excludeToken: excludeToken || undefined,
        targetRoles: params.targetRoles,
      },
    });
  } catch {
    // Non-blocking background push
  }
}
