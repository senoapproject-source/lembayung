import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CuaninLogo } from '../components/CuaninLogo';
import { formatRupiah } from '../lib/calculations';
import { getAppEnvironment } from '../services/syncService';
import {
  adminBroadcastPush,
  adminDeleteOutlet,
  adminManageTeam,
  adminToggleOutletActive,
  adminUpdateAppVersion,
  clearAdminSession,
  fetchAdminDashboardOverview,
  type AdminDashboardData,
  type AdminMerchantRow,
  type AdminRole,
  type AdminSession,
} from './adminService';
import {
  Bell,
  Building2,
  CheckCircle2,
  Database,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Smartphone,
  Store,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

interface AdminDashboardPageProps {
  session: AdminSession;
  onLogout: () => void;
}

type AdminTab = 'overview' | 'merchants' | 'broadcast' | 'versions' | 'admins';

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  ops_support: 'Ops & Support',
  finance: 'Finance',
};

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({ session, onLogout }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Merchant filters & actions
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'pusat' | 'cabang'>('all');
  const [busyOutletId, setBusyOutletId] = useState('');
  const [deletingOutlet, setDeletingOutlet] = useState<AdminMerchantRow | null>(null);
  const [delAdminPassword, setDelAdminPassword] = useState('');
  const [delErr, setDelErr] = useState('');
  const [delLoading, setDelLoading] = useState(false);

  // Broadcast push
  const [pushTarget, setPushTarget] = useState('ALL');
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushSending, setPushSending] = useState(false);

  // App Version editor
  const [verMinReq, setVerMinReq] = useState('');
  const [verNotes, setVerNotes] = useState('');
  const [verApkUrl, setVerApkUrl] = useState('');
  const [verSaving, setVerSaving] = useState(false);

  // Add Admin modal
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdmNama, setNewAdmNama] = useState('');
  const [newAdmEmail, setNewAdmEmail] = useState('');
  const [newAdmPass, setNewAdmPass] = useState('');
  const [newAdmRole, setNewAdmRole] = useState<AdminRole>('ops_support');
  const [newAdmSaving, setNewAdmSaving] = useState(false);
  const [newAdmErr, setNewAdmErr] = useState('');

  const isSuperAdmin = session.admin.role === 'super_admin';
  const canOperate = session.admin.role === 'super_admin' || session.admin.role === 'ops_support';
  const env = getAppEnvironment();

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminDashboardOverview(session.token);
      if (!res.success) {
        if ((res.error || '').toLowerCase().includes('sesi')) {
          clearAdminSession();
          onLogout();
          return;
        }
        setError(res.error || 'Gagal memuat data dashboard.');
        return;
      }
      setData(res);
      if (res.appVersion) {
        setVerMinReq(res.appVersion.min_required_version || '');
        setVerNotes(res.appVersion.release_notes || '');
        setVerApkUrl(res.appVersion.apk_download_url || '');
      }
    } finally {
      setLoading(false);
    }
  }, [session.token, onLogout]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredMerchants = useMemo(() => {
    const list = data?.merchants || [];
    const q = search.trim().toLowerCase();
    return list
      .filter((m) => {
        if (statusFilter === 'active' && !m.isActive) return false;
        if (statusFilter === 'inactive' && m.isActive) return false;
        if (statusFilter === 'pusat' && !m.isPusat) return false;
        if (statusFilter === 'cabang' && m.isPusat) return false;
        if (!q) return true;
        return (
          m.outletId.toLowerCase().includes(q) ||
          m.namaUsaha.toLowerCase().includes(q) ||
          m.namaCabang.toLowerCase().includes(q) ||
          m.ownerEmail.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.omzet - a.omzet);
  }, [data?.merchants, search, statusFilter]);

  const handleToggleOutlet = async (m: AdminMerchantRow) => {
    const nextActive = !m.isActive;
    if (
      !nextActive &&
      !confirm(`Non-aktifkan outlet "${m.namaUsaha} - ${m.namaCabang}" (${m.outletId})? Operasional kasir & Self-Order akan langsung dihentikan.`)
    ) {
      return;
    }
    setBusyOutletId(m.outletId);
    try {
      const res = await adminToggleOutletActive(session.token, m.outletId, nextActive);
      if (!res.success) {
        alert(res.error || 'Gagal mengubah status outlet.');
        return;
      }
      notify(`Outlet ${m.outletId} berhasil ${nextActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
      await loadData();
    } finally {
      setBusyOutletId('');
    }
  };

  const handleConfirmDeleteOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingOutlet) return;
    setDelErr('');
    setDelLoading(true);
    try {
      const res = await adminDeleteOutlet(session.token, deletingOutlet.outletId, delAdminPassword);
      if (!res.success) {
        setDelErr(res.error || 'Gagal menghapus outlet.');
        return;
      }
      notify(`Outlet ${deletingOutlet.outletId} berhasil dihapus permanen.`);
      setDeletingOutlet(null);
      setDelAdminPassword('');
      await loadData();
    } finally {
      setDelLoading(false);
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushTitle.trim() || !pushBody.trim()) return;
    setPushSending(true);
    try {
      const res = await adminBroadcastPush({
        adminToken: session.token,
        targetOutletId: pushTarget,
        title: pushTitle.trim(),
        body: pushBody.trim(),
      });
      if (!res.success) {
        alert(res.error || 'Gagal mengirim broadcast push.');
        return;
      }
      notify(`Broadcast terkirim ke ${res.sentCount ?? 0} perangkat aktif!`);
      setPushTitle('');
      setPushBody('');
    } finally {
      setPushSending(false);
    }
  };

  const handleSaveVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerSaving(true);
    try {
      const res = await adminUpdateAppVersion({
        adminToken: session.token,
        minRequiredVersion: verMinReq,
        releaseNotes: verNotes,
        apkDownloadUrl: verApkUrl,
      });
      if (!res.success) {
        alert(res.error || 'Gagal menyimpan konfigurasi versi.');
        return;
      }
      notify('Konfigurasi versi aplikasi berhasil diperbarui.');
      await loadData();
    } finally {
      setVerSaving(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewAdmErr('');
    setNewAdmSaving(true);
    try {
      const res = await adminManageTeam({
        adminToken: session.token,
        op: 'create',
        nama: newAdmNama.trim(),
        email: newAdmEmail.trim().toLowerCase(),
        password: newAdmPass,
        role: newAdmRole,
        portalUrl: `${window.location.origin}/?admin=1`,
      });
      if (!res.success) {
        setNewAdmErr(res.error || 'Gagal menambah admin.');
        return;
      }
      notify(`Akun admin ${newAdmEmail} berhasil dibuat & kredensial dikirim via email.`);
      setShowAddAdmin(false);
      setNewAdmNama('');
      setNewAdmEmail('');
      setNewAdmPass('');
      await loadData();
    } finally {
      setNewAdmSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex flex-col md:flex-row">
      {/* Sidebar Admin */}
      <aside className="w-full md:w-[248px] bg-[#0f172a] text-white flex flex-col justify-between shrink-0">
        <div className="p-4 flex flex-col gap-5">
          <div className="flex items-center gap-2.5">
            <CuaninLogo size={34} />
            <div className="min-w-0">
              <div className="font-bold text-sm flex items-center gap-1.5">
                <span className="truncate">Lembayung Admin</span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                    env === 'production'
                      ? 'bg-[#1F7A5A] text-white'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                  }`}
                >
                  {env === 'production' ? 'PROD' : 'TEST'}
                </span>
              </div>
              <div className="text-[11px] text-[#94a3b8] truncate">Platform Console</div>
            </div>
          </div>

          <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto pb-1 md:pb-0">
            {(
              [
                { id: 'overview', label: 'Ringkasan Platform', icon: <LayoutDashboard size={16} /> },
                { id: 'merchants', label: 'Merchant & Cabang', icon: <Store size={16} /> },
                { id: 'broadcast', label: 'Broadcast Push', icon: <Bell size={16} /> },
                { id: 'versions', label: 'Versi OTA & APK', icon: <Smartphone size={16} /> },
                { id: 'admins', label: 'Tim Administrator', icon: <Shield size={16} /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                  activeTab === item.id
                    ? 'bg-[#1F7A5A] text-white'
                    : 'text-[#cbd5e1] hover:bg-white/10'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-bold truncate">{session.admin.nama}</div>
            <div className="text-[10px] text-[#34d399] font-semibold">
              {ROLE_LABEL[session.admin.role]}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAdminSession();
              onLogout();
            }}
            title="Keluar Console Admin"
            className="p-2 rounded-lg text-red-300 hover:bg-red-500/20 transition shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col gap-5 max-w-[1400px] w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#0f172a]">
              {activeTab === 'overview' && 'Ringkasan Platform Lembayung'}
              {activeTab === 'merchants' && 'Manajemen Merchant & Cabang'}
              {activeTab === 'broadcast' && 'Broadcast Push Notification (FCM)'}
              {activeTab === 'versions' && 'Kontrol Versi Aplikasi (OTA & APK)'}
              {activeTab === 'admins' && 'Tim Administrator (Multi-Admin)'}
            </h1>
            <p className="text-xs text-[#64748b]">
              Environment aktif: <strong className="uppercase">{env}</strong> · Terhubung langsung ke Supabase Cloud
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={loadData}
            className="h-9 px-3.5 rounded-xl bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Muat Ulang
          </button>
        </div>

        {toast && (
          <div className="bg-[#e4f1ea] border border-[#c5dfd1] text-[#14532d] text-xs font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2">
            <CheckCircle2 size={15} /> {toast}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-4 py-2.5 rounded-xl">
            {error}
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && data && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <KpiCard
                icon={<Building2 size={18} className="text-[#1F7A5A]" />}
                label="Total Merchant / Outlet"
                value={`${data.summary.totalMerchants} Usaha`}
                sub={`${data.summary.totalOutlets} outlet (${data.summary.openOutlets} buka)`}
              />
              <KpiCard
                icon={<TrendingUp size={18} className="text-emerald-600" />}
                label="Omzet Agregat Platform"
                value={formatRupiah(data.summary.totalOmzet)}
                sub={`${data.summary.totalTransactions.toLocaleString('id-ID')} transaksi selesai`}
              />
              <KpiCard
                icon={<Users size={18} className="text-indigo-600" />}
                label="Total Pengguna & Menu"
                value={`${data.summary.totalUsers} Akun`}
                sub={`${data.summary.totalMenus} menu · ${data.summary.totalExpenses} pengeluaran`}
              />
              <KpiCard
                icon={<Smartphone size={18} className="text-amber-600" />}
                label="Perangkat & Versi Aktif"
                value={`${data.summary.totalDevices} HP/Tab`}
                sub={`OTA v${data.appVersion?.latest_version || '-'}`}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Merchant */}
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-4 flex flex-col gap-3">
                <div className="font-bold text-sm flex items-center gap-2">
                  <Store size={16} className="text-[#1F7A5A]" /> Top Outlet Berdasarkan Omzet
                </div>
                {data.merchants.length === 0 ? (
                  <div className="text-xs text-[#64748b] py-6 text-center">Belum ada merchant terdaftar.</div>
                ) : (
                  <div className="flex flex-col divide-y divide-[#f1f5f9]">
                    {[...data.merchants]
                      .sort((a, b) => b.omzet - a.omzet)
                      .slice(0, 8)
                      .map((m) => (
                        <div key={m.outletId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <div className="font-semibold text-[#0f172a] truncate">
                              {m.namaUsaha} · <span className="text-[#64748b]">{m.namaCabang}</span>
                            </div>
                            <div className="text-[11px] font-mono text-[#1F7A5A]">
                              {m.outletId} · {m.txCount} transaksi
                            </div>
                          </div>
                          <div className="font-bold text-[#1F7A5A] shrink-0">{formatRupiah(m.omzet)}</div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Transaksi Terbaru Lintas Merchant */}
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-4 flex flex-col gap-3">
                <div className="font-bold text-sm flex items-center gap-2">
                  <Database size={16} className="text-indigo-600" /> Transaksi Terbaru Lintas Merchant
                </div>
                {data.recentTransactions.length === 0 ? (
                  <div className="text-xs text-[#64748b] py-6 text-center">Belum ada transaksi tercatat.</div>
                ) : (
                  <div className="flex flex-col divide-y divide-[#f1f5f9] max-h-[340px] overflow-y-auto">
                    {data.recentTransactions.map((t) => (
                      <div key={`${t.outlet_id}-${t.id}`} className="py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            <span className="font-mono text-[#1F7A5A]">{t.outlet_id}</span> · {t.nomor_struk}
                          </div>
                          <div className="text-[11px] text-[#64748b] truncate">
                            {t.kasir_nama} · {t.metode_bayar} · {new Date(t.waktu).toLocaleString('id-ID')}
                          </div>
                        </div>
                        <div className={`font-bold shrink-0 ${t.status === 'void' ? 'line-through text-red-500' : 'text-[#0f172a]'}`}>
                          {formatRupiah(Number(t.total || 0))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MERCHANTS & CABANG */}
        {activeTab === 'merchants' && data && (
          <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-[#f1f5f9] flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-[360px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari kode LM-A..., nama usaha, atau email owner..."
                  className="w-full h-9 pl-8 pr-3 rounded-xl border border-[#cbd5e1] text-xs"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(
                  [
                    { k: 'all', l: 'Semua' },
                    { k: 'active', l: 'Aktif' },
                    { k: 'inactive', l: 'Non-Aktif' },
                    { k: 'pusat', l: 'Pusat' },
                    { k: 'cabang', l: 'Cabang' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.k}
                    type="button"
                    onClick={() => setStatusFilter(f.k)}
                    className={`h-8 px-3 rounded-lg text-xs font-semibold border ${
                      statusFilter === f.k
                        ? 'bg-[#0f172a] border-[#0f172a] text-white'
                        : 'bg-white border-[#cbd5e1] text-[#475569]'
                    }`}
                  >
                    {f.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f8fafc] text-[#475569] border-b border-[#e2e8f0]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Usaha &amp; Cabang</th>
                    <th className="py-3 px-3 font-semibold">ID Outlet</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    <th className="py-3 px-3 font-semibold">Owner</th>
                    <th className="py-3 px-3 font-semibold text-right">Menu / HP</th>
                    <th className="py-3 px-3 font-semibold text-right">Omzet (Tx)</th>
                    {canOperate && <th className="py-3 px-4 font-semibold text-right">Aksi Admin</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {filteredMerchants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-[#64748b]">
                        Tidak ada outlet yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    filteredMerchants.map((m) => (
                      <tr key={m.outletId} className="hover:bg-[#f8fafc]">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[#0f172a]">{m.namaUsaha}</div>
                          <div className="text-[11px] text-[#64748b] flex items-center gap-1.5">
                            <span>{m.namaCabang}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${m.isPusat ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {m.isPusat ? 'Pusat' : 'Cabang'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-[#1F7A5A] whitespace-nowrap">
                          {m.outletId}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          {!m.isActive ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[11px]">
                              Non-Aktif
                            </span>
                          ) : m.isStoreOpen ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[11px]">
                              ● Buka
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold text-[11px]">
                              Aktif (Tutup)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-[#475569]">{m.ownerEmail}</td>
                        <td className="py-3 px-3 text-right whitespace-nowrap text-[#475569]">
                          {m.menuCount} menu · {m.deviceCount} HP
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="font-bold text-[#0f172a]">{formatRupiah(m.omzet)}</div>
                          <div className="text-[10px] text-[#64748b]">{m.txCount} tx</div>
                        </td>
                        {canOperate && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busyOutletId === m.outletId}
                                onClick={() => handleToggleOutlet(m)}
                                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold ${
                                  m.isActive
                                    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                    : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {m.isActive ? 'Non-Aktifkan' : 'Aktifkan'}
                              </button>
                              {isSuperAdmin && (
                                <button
                                  type="button"
                                  disabled={m.isActive}
                                  onClick={() => {
                                    setDeletingOutlet(m);
                                    setDelAdminPassword('');
                                    setDelErr('');
                                  }}
                                  title={m.isActive ? 'Non-aktifkan dulu sebelum menghapus' : 'Hapus permanen'}
                                  className="h-7 px-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Trash2 size={12} /> Hapus
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: BROADCAST PUSH */}
        {activeTab === 'broadcast' && data && (
          <form onSubmit={handleSendBroadcast} className="bg-white border border-[#e2e8f0] rounded-2xl p-5 max-w-[600px] flex flex-col gap-4">
            <div>
              <div className="font-bold text-sm text-[#0f172a]">Kirim Pengumuman Push Notification (Android FCM)</div>
              <div className="text-xs text-[#64748b]">
                Notifikasi akan tetap masuk ke bar notifikasi HP kasir/Owner meskipun aplikasi sedang ditutup.
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">Target Penerima</label>
              <select
                value={pushTarget}
                onChange={(e) => setPushTarget(e.target.value)}
                className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-xs font-semibold"
              >
                <option value="ALL">Seluruh Perangkat Aktif ({data.summary.totalDevices} HP/Tab di semua merchant)</option>
                {data.merchants.map((m) => (
                  <option key={m.outletId} value={m.outletId}>
                    {m.namaUsaha} — {m.namaCabang} ({m.outletId}) · {m.deviceCount} HP
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">Judul Notifikasi *</label>
              <input
                type="text"
                value={pushTitle}
                onChange={(e) => setPushTitle(e.target.value)}
                placeholder="Contoh: Pembaruan Sistem Lembayung"
                className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">Isi Pesan *</label>
              <textarea
                rows={3}
                value={pushBody}
                onChange={(e) => setPushBody(e.target.value)}
                placeholder="Tulis pesan pengumuman singkat yang jelas..."
                className="w-full rounded-xl border border-[#cbd5e1] p-3 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={!canOperate || pushSending}
              className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send size={15} />
              {pushSending ? 'Mengirim...' : 'Kirim Broadcast Sekarang'}
            </button>
          </form>
        )}

        {/* TAB 4: VERSIONS */}
        {activeTab === 'versions' && data && (
          <form onSubmit={handleSaveVersion} className="bg-white border border-[#e2e8f0] rounded-2xl p-5 max-w-[640px] flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[#f1f5f9] pb-3">
              <div>
                <div className="text-xs text-[#64748b]">Versi OTA Aktif Saat Ini</div>
                <div className="text-2xl font-bold font-mono text-[#1F7A5A]">
                  v{data.appVersion?.latest_version || '-'}
                </div>
              </div>
              <div className="text-right text-[11px] text-[#64748b]">
                Terakhir diperbarui:
                <div className="font-semibold text-[#0f172a]">
                  {data.appVersion?.updated_at ? new Date(data.appVersion.updated_at).toLocaleString('id-ID') : '-'}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">Min Required Version</label>
              <input
                type="text"
                value={verMinReq}
                onChange={(e) => setVerMinReq(e.target.value)}
                disabled={!isSuperAdmin}
                className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm font-mono disabled:bg-[#f8fafc]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">Catatan Rilis (Release Notes)</label>
              <textarea
                rows={3}
                value={verNotes}
                onChange={(e) => setVerNotes(e.target.value)}
                disabled={!isSuperAdmin}
                className="w-full rounded-xl border border-[#cbd5e1] p-3 text-sm disabled:bg-[#f8fafc]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">URL Download APK Terbaru</label>
              <input
                type="url"
                value={verApkUrl}
                onChange={(e) => setVerApkUrl(e.target.value)}
                disabled={!isSuperAdmin}
                className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-xs font-mono disabled:bg-[#f8fafc]"
              />
            </div>
            {isSuperAdmin && (
              <button
                type="submit"
                disabled={verSaving}
                className="h-10 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-xs px-5 w-fit disabled:opacity-50"
              >
                {verSaving ? 'Menyimpan...' : 'Simpan Pengaturan Versi'}
              </button>
            )}
          </form>
        )}

        {/* TAB 5: MULTI-ADMIN TEAM */}
        {activeTab === 'admins' && data && (
          <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-[#f1f5f9] flex items-center justify-between gap-2">
              <div>
                <div className="font-bold text-sm">Daftar Administrator Platform ({data.admins.length})</div>
                <div className="text-xs text-[#64748b]">
                  Kelola tim Super Admin, Ops &amp; Support, dan Finance untuk mengelola banyak model usaha.
                </div>
              </div>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddAdmin(true);
                    setNewAdmErr('');
                  }}
                  className="h-9 px-3.5 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus size={14} /> Tambah Admin
                </button>
              )}
            </div>
            <div className="divide-y divide-[#f1f5f9]">
              {data.admins.map((a) => (
                <div key={a.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-[#0f172a] flex items-center gap-2">
                      <span>{a.nama}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                        {ROLE_LABEL[a.role]}
                      </span>
                      {a.active === false && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                          Non-Aktif
                        </span>
                      )}
                    </div>
                    <div className="text-[#64748b] mt-0.5">
                      {a.email} · Login terakhir: {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('id-ID') : 'Belum pernah'}
                    </div>
                  </div>
                  {isSuperAdmin && a.id !== session.admin.id && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await adminManageTeam({
                            adminToken: session.token,
                            op: 'toggle_active',
                            targetAdminId: a.id,
                            active: a.active === false,
                          });
                          if (!res.success) alert(res.error);
                          else await loadData();
                        }}
                        className="h-8 px-2.5 rounded-lg border border-[#cbd5e1] text-[11px] font-semibold hover:bg-[#f1f5f9]"
                      >
                        {a.active === false ? 'Aktifkan' : 'Non-Aktifkan'}
                      </button>
                      <button
                        type="button"
                        disabled={a.active !== false}
                        onClick={async () => {
                          if (!confirm(`Hapus akun admin "${a.nama}"?`)) return;
                          const res = await adminManageTeam({
                            adminToken: session.token,
                            op: 'delete',
                            targetAdminId: a.id,
                          });
                          if (!res.success) alert(res.error);
                          else await loadData();
                        }}
                        className="h-8 px-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[11px] font-semibold disabled:opacity-40"
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal Hapus Outlet Permanen */}
      {deletingOutlet && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleConfirmDeleteOutlet} className="bg-white w-full max-w-[420px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="font-bold text-base text-red-700 flex items-center gap-2">
                <Trash2 size={18} /> Hapus Outlet Permanen
              </div>
              <button type="button" onClick={() => setDeletingOutlet(null)}>
                <X size={18} className="text-[#64748b]" />
              </button>
            </div>
            <div className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">
              Outlet <strong>{deletingOutlet.namaUsaha} — {deletingOutlet.namaCabang}</strong> (<span className="font-mono font-bold">{deletingOutlet.outletId}</span>) beserta seluruh datanya akan dihapus permanen.
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Kata Sandi Super Admin untuk Konfirmasi *
              </label>
              <input
                type="password"
                value={delAdminPassword}
                onChange={(e) => setDelAdminPassword(e.target.value)}
                placeholder="Masukkan kata sandi login Anda"
                className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm"
                required
              />
            </div>
            {delErr && <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-xl">{delErr}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeletingOutlet(null)} className="h-9 px-4 rounded-xl border border-[#cbd5e1] text-xs font-semibold">
                Batal
              </button>
              <button type="submit" disabled={delLoading} className="h-9 px-4 rounded-xl bg-red-700 text-white text-xs font-semibold disabled:opacity-50">
                {delLoading ? 'Menghapus...' : 'Hapus Permanen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Tambah Admin */}
      {showAddAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateAdmin} className="bg-white w-full max-w-[420px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="font-bold text-base flex items-center gap-2">
                <UserPlus size={18} className="text-[#1F7A5A]" /> Tambah Administrator Baru
              </div>
              <button type="button" onClick={() => setShowAddAdmin(false)}>
                <X size={18} className="text-[#64748b]" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Nama Lengkap *</label>
              <input type="text" value={newAdmNama} onChange={(e) => setNewAdmNama(e.target.value)} className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Email *</label>
              <input type="email" value={newAdmEmail} onChange={(e) => setNewAdmEmail(e.target.value)} className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Kata Sandi Sementara (min. 8 karakter) *</label>
              <input type="text" value={newAdmPass} onChange={(e) => setNewAdmPass(e.target.value)} className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm font-mono" required />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Role Akses *</label>
              <select value={newAdmRole} onChange={(e) => setNewAdmRole(e.target.value as AdminRole)} className="w-full h-10 rounded-xl border border-[#cbd5e1] px-3 text-sm">
                <option value="super_admin">Super Admin (Akses Penuh)</option>
                <option value="ops_support">Ops &amp; Support (Kelola Status &amp; Broadcast)</option>
                <option value="finance">Finance (Laporan &amp; Monitoring Read-Only)</option>
              </select>
            </div>
            {newAdmErr && <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-xl">{newAdmErr}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddAdmin(false)} className="h-9 px-4 rounded-xl border border-[#cbd5e1] text-xs font-semibold">
                Batal
              </button>
              <button type="submit" disabled={newAdmSaving} className="h-9 px-4 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold disabled:opacity-50">
                {newAdmSaving ? 'Menyimpan...' : 'Buat & Kirim Email'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const KpiCard: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string }> = ({
  icon,
  label,
  value,
  sub,
}) => (
  <div className="bg-white border border-[#e2e8f0] rounded-2xl p-4 flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-[#64748b]">{label}</span>
      {icon}
    </div>
    <div className="text-lg sm:text-xl font-bold text-[#0f172a] truncate">{value}</div>
    <div className="text-[11px] text-[#64748b] truncate">{sub}</div>
  </div>
);
