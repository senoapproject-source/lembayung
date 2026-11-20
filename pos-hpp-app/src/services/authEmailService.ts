import { db } from '../db/database';
import { getSupabaseClient, getSupabaseConfig } from './syncService';
import type { CashierShift } from '../types/models';

export interface AuthEmailResponse {
  success: boolean;
  verified?: boolean;
  welcomeEmailSent?: boolean;
  maskedEmail?: string;
  outletId?: string;
  userId?: string;
  message?: string;
  error?: string;
}

async function invokeAuthEmailFunction(
  body: Record<string, unknown>
): Promise<AuthEmailResponse> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: false,
      error: 'Perangkat sedang offline. Fitur email & verifikasi membutuhkan koneksi internet.',
    };
  }

  try {
    const settings = await db.settings.get('global');
    const client = getSupabaseClient(settings);
    const { data, error } = await client.functions.invoke('cuanin-auth-email', {
      body,
    });

    if (error) {
      // Coba ekstrak pesan error dari body response Edge Function jika ada
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        try {
          const errJson = (await context.json()) as { error?: string };
          if (errJson?.error) {
            return { success: false, error: errJson.error };
          }
        } catch {
          // ignore
        }
      }
      return {
        success: false,
        error: 'Layanan email sedang tidak dapat dijangkau. Silakan coba beberapa saat lagi.',
      };
    }

    const res = (data || {}) as AuthEmailResponse;
    if (!res.success) {
      return { success: false, error: res.error || 'Permintaan gagal diproses.' };
    }
    return res;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal menghubungi server email.',
    };
  }
}

export function sendRegisterOtpEmail(params: {
  email: string;
  username: string;
  namaUsaha: string;
  namaOwner: string;
}) {
  return invokeAuthEmailFunction({ action: 'send_register_otp', ...params });
}

export function verifyRegisterOtpEmail(params: {
  email: string;
  username: string;
  otp: string;
  namaOwner?: string;
  namaUsaha?: string;
  outletId?: string;
}) {
  return invokeAuthEmailFunction({ action: 'verify_register_otp', ...params });
}

export function sendWelcomeOutletEmail(params: {
  email: string;
  namaOwner: string;
  namaUsaha: string;
  username: string;
  outletId: string;
}) {
  return invokeAuthEmailFunction({ action: 'send_welcome_outlet', ...params });
}

export function requestOwnerForgotPassword(identifier: string) {
  return invokeAuthEmailFunction({
    action: 'forgot_password_request',
    identifier: identifier.trim(),
  });
}

export function confirmOwnerForgotPassword(params: {
  identifier: string;
  otp: string;
  newPasswordHash: string;
}) {
  return invokeAuthEmailFunction({
    action: 'forgot_password_confirm',
    identifier: params.identifier.trim(),
    otp: params.otp.trim(),
    newPasswordHash: params.newPasswordHash,
  });
}

export function requestOwnerForgotUsername(email: string) {
  return invokeAuthEmailFunction({
    action: 'forgot_username',
    email: email.trim().toLowerCase(),
  });
}

export function requestOwnerForgotOutletId(identifier: string) {
  return invokeAuthEmailFunction({
    action: 'forgot_outlet_id',
    identifier: identifier.trim(),
  });
}

export async function sendShiftCloseEmailToOwner(shift: CashierShift): Promise<AuthEmailResponse> {
  const settings = await db.settings.get('global');
  const cfg = getSupabaseConfig(settings);
  if (!cfg.outletId) return { success: false, error: 'Outlet ID belum tersedia.' };
  return invokeAuthEmailFunction({
    action: 'send_shift_close_email',
    outletId: cfg.outletId,
    shift,
  });
}

export async function sendPeriodicSummaryEmailToOwner(
  period: 'daily' | 'monthly',
  dateStr?: string
): Promise<AuthEmailResponse> {
  const settings = await db.settings.get('global');
  const cfg = getSupabaseConfig(settings);
  if (!cfg.outletId) return { success: false, error: 'Outlet ID belum tersedia.' };
  return invokeAuthEmailFunction({
    action: 'send_periodic_summary',
    period,
    outletId: cfg.outletId,
    dateStr,
  });
}

/**
 * Cari outlet_id di Cloud berdasarkan username atau email Owner
 * agar Owner bisa login dari perangkat baru tanpa harus mengetik Kode Toko manual.
 */
export async function lookupOwnerOutletIdInCloud(identifier: string): Promise<string | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  const clean = identifier.trim().toLowerCase();
  if (!clean) return null;
  try {
    const settings = await db.settings.get('global');
    const client = getSupabaseClient(settings);
    const { data, error } = await client
      .from('users')
      .select('outlet_id, username, email, role')
      .eq('role', 'owner');
    if (error || !Array.isArray(data)) return null;
    const found = data.find(
      (r: { username?: string; email?: string | null }) =>
        (r.username || '').trim().toLowerCase() === clean ||
        (r.email || '').trim().toLowerCase() === clean
    );
    return found?.outlet_id ? String(found.outlet_id).trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
