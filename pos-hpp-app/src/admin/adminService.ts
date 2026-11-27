import { getSupabaseClient } from '../services/syncService';

export type AdminRole = 'super_admin' | 'ops_support' | 'finance';

export interface AdminProfile {
  id: string;
  nama: string;
  email: string;
  role: AdminRole;
  active?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AdminSession {
  token: string;
  admin: AdminProfile;
}

export interface AdminMerchantRow {
  outletId: string;
  namaUsaha: string;
  namaCabang: string;
  parentOutletId: string | null;
  isPusat: boolean;
  ownerEmail: string;
  alamatUsaha: string;
  teleponUsaha: string;
  isActive: boolean;
  isStoreOpen: boolean;
  menuCount: number;
  userCount: number;
  deviceCount: number;
  txCount: number;
  omzet: number;
  lastTxAt: string | null;
  updatedAt: string | null;
}

export interface AdminDashboardData {
  summary: {
    totalMerchants: number;
    totalOutlets: number;
    activeOutlets: number;
    openOutlets: number;
    totalUsers: number;
    totalMenus: number;
    totalDevices: number;
    totalTransactions: number;
    totalOmzet: number;
    totalExpenses: number;
  };
  merchants: AdminMerchantRow[];
  recentTransactions: Array<{
    outlet_id: string;
    id: string;
    nomor_struk: string;
    waktu: string;
    total: number;
    status: string;
    metode_bayar: string;
    kasir_nama: string;
  }>;
  appVersion: {
    id: string;
    latest_version: string;
    min_required_version: string;
    release_notes?: string;
    bundle_zip_url?: string;
    apk_download_url?: string;
    updated_at?: string;
  } | null;
  admins: AdminProfile[];
}

const ADMIN_SESSION_KEY = 'lembayung_platform_admin_session_v1';

export function loadAdminSession(): AdminSession | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    return parsed?.token && parsed?.admin?.email ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearAdminSession(): void {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // ignore
  }
}

async function callAdminEdge<T = Record<string, unknown>>(
  body: Record<string, unknown>
): Promise<T & { success: boolean; error?: string; message?: string }> {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke('cuanin-auth-email', { body });
  if (error) {
    return { success: false, error: error.message } as T & { success: false; error: string };
  }
  return (data || { success: false, error: 'Respons kosong dari server.' }) as T & {
    success: boolean;
    error?: string;
    message?: string;
  };
}

export async function checkAdminBootstrapStatus() {
  return callAdminEdge<{ needsBootstrap: boolean; adminCount: number }>({
    action: 'admin_bootstrap_status',
  });
}

export async function sendAdminBootstrapOtp(nama: string, email: string) {
  return callAdminEdge({
    action: 'admin_bootstrap_send_otp',
    nama,
    email,
  });
}

export async function confirmAdminBootstrap(params: {
  nama: string;
  email: string;
  password: string;
  otp: string;
}) {
  return callAdminEdge<{ token?: string; admin?: AdminProfile }>({
    action: 'admin_bootstrap_confirm',
    ...params,
  });
}

export async function loginPlatformAdmin(email: string, password: string) {
  return callAdminEdge<{ token?: string; admin?: AdminProfile }>({
    action: 'admin_login',
    email,
    password,
  });
}

export async function fetchAdminDashboardOverview(adminToken: string) {
  return callAdminEdge<AdminDashboardData>({
    action: 'admin_dashboard_overview',
    adminToken,
  });
}

export async function adminToggleOutletActive(
  adminToken: string,
  outletId: string,
  active: boolean
) {
  return callAdminEdge({
    action: 'admin_toggle_outlet_active',
    adminToken,
    outletId,
    active,
  });
}

export async function adminDeleteOutlet(
  adminToken: string,
  outletId: string,
  adminPassword: string
) {
  return callAdminEdge({
    action: 'admin_delete_outlet',
    adminToken,
    outletId,
    adminPassword,
  });
}

export async function adminBroadcastPush(params: {
  adminToken: string;
  targetOutletId: string;
  title: string;
  body: string;
}) {
  return callAdminEdge<{ sentCount?: number; totalTargets?: number }>({
    action: 'admin_broadcast_push',
    ...params,
  });
}

export async function adminUpdateAppVersion(params: {
  adminToken: string;
  minRequiredVersion?: string;
  releaseNotes?: string;
  apkDownloadUrl?: string;
}) {
  return callAdminEdge({
    action: 'admin_update_app_version',
    ...params,
  });
}

export async function adminManageTeam(params: {
  adminToken: string;
  op: 'create' | 'toggle_active' | 'delete';
  nama?: string;
  email?: string;
  password?: string;
  role?: AdminRole;
  targetAdminId?: string;
  active?: boolean;
  portalUrl?: string;
}) {
  return callAdminEdge({
    action: 'admin_manage_admins',
    ...params,
  });
}
