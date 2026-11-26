import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  getAppEnvironment,
  getLatestAndroidDownloadInfo,
  syncWithCloud,
} from '../services/syncService';
import { fetchOwnerBranches, switchActiveBranch } from '../services/branchService';
import { sendPeriodicSummaryEmailToOwner } from '../services/authEmailService';
import { LembayungLogo } from '../components/CuaninLogo';
import { ReceiptRpIcon } from '../components/ReceiptRpIcon';
import { WebOverviewPage } from './WebOverviewPage';
import { WebSalesHistoryPage } from './WebSalesHistoryPage';
import { WebBranchesTeamPage } from './WebBranchesTeamPage';
import { WebAllBranchesModuleView, type AllBranchesModule } from './WebAllBranchesModuleView';
import { RecipesMenuPage } from '../pages/RecipesMenuPage';
import { IngredientsPage } from '../pages/IngredientsPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { TargetBepPage } from '../pages/TargetBepPage';
import { AttendanceReportPage } from '../pages/AttendanceReportPage';
import { SettingsPage } from '../pages/SettingsPage';
import type { BranchInfo, User } from '../types/models';
import {
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  Clock,
  Download,
  LogOut,
  Mail,
  Moon,
  Package,
  Settings,
  Sun,
  Target,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';

export type WebTab =
  | 'overview'
  | 'sales'
  | 'expenses'
  | 'recipes'
  | 'ingredients'
  | 'target'
  | 'attendance'
  | 'team'
  | 'branches'
  | 'settings';

interface WebDashboardShellProps {
  user: User;
  isOnline: boolean;
  isAutoSyncing: boolean;
  pendingSyncCount: number;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
}

function getDatePreset(preset: 'today' | '7days' | 'this_month' | 'last_month'): {
  from: string;
  to: string;
} {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = fmt(now);

  if (preset === 'today') return { from: today, to: today };
  if (preset === '7days') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { from: fmt(start), to: today };
  }
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(start), to: fmt(end) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: fmt(start), to: today };
}

export const WebDashboardShell: React.FC<WebDashboardShellProps> = ({
  user,
  isOnline,
  isAutoSyncing,
  pendingSyncCount,
  darkMode,
  onToggleDarkMode,
  onLogout,
}) => {
  const settings = useLiveQuery(() => db.settings.get('global'));
  const isOwner = user.role === 'owner';

  const [activeTab, setActiveTab] = useState<WebTab>('overview');
  const [branchSubTab, setBranchSubTab] = useState<'branches' | 'settings'>('branches');
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedBranchKey, setSelectedBranchKey] = useState<string>(''); // '' = current active branch, 'ALL' = gabungan semua cabang
  const [switchingBranch, setSwitchingBranch] = useState(false);

  const initialDates = getDatePreset('this_month');
  const [dateFrom, setDateFrom] = useState(initialDates.from);
  const [dateTo, setDateTo] = useState(initialDates.to);
  const [presetKey, setPresetKey] = useState<'today' | '7days' | 'this_month' | 'last_month' | 'custom'>('this_month');

  const [emailSending, setEmailSending] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [androidDownloadUrl, setAndroidDownloadUrl] = useState('');

  useEffect(() => {
    getLatestAndroidDownloadInfo()
      .then((res) => setAndroidDownloadUrl(res.downloadUrl))
      .catch(() => {});
  }, []);

  const activeOutletId = (settings?.outletId || '').trim().toUpperCase();

  useEffect(() => {
    if (!isOwner) return;
    fetchOwnerBranches(user)
      .then((list) => setBranches(list))
      .catch(() => {});
  }, [isOwner, user.id, activeOutletId]);

  const handleBranchSwitch = async (targetKey: string, nextTab?: WebTab) => {
    if (targetKey === 'ALL') {
      setSelectedBranchKey('ALL');
      if (nextTab) setActiveTab(nextTab);
      return;
    }
    setSelectedBranchKey(targetKey);
    if (nextTab) setActiveTab(nextTab);
    if (targetKey && targetKey !== activeOutletId) {
      setSwitchingBranch(true);
      try {
        const res = await switchActiveBranch(targetKey);
        if (!res.success) {
          setToastMsg(res.message);
          setTimeout(() => setToastMsg(''), 3500);
        }
      } finally {
        setSwitchingBranch(false);
      }
    }
  };

  const applyPreset = (p: 'today' | '7days' | 'this_month' | 'last_month') => {
    const r = getDatePreset(p);
    setPresetKey(p);
    setDateFrom(r.from);
    setDateTo(r.to);
  };

  const handleSendEmailReport = async () => {
    setEmailSending(true);
    try {
      if (navigator.onLine) await syncWithCloud().catch(() => {});
      const isSingleDay = dateFrom === dateTo;
      const res = await sendPeriodicSummaryEmailToOwner(
        isSingleDay ? 'daily' : 'monthly',
        isSingleDay ? dateFrom : dateFrom.slice(0, 7)
      );
      setToastMsg(res.success ? res.message || 'Laporan dikirim ke email Owner.' : res.error || 'Gagal mengirim email.');
      setTimeout(() => setToastMsg(''), 4000);
    } finally {
      setEmailSending(false);
    }
  };

  const pageTitles: Record<WebTab, { title: string; subtitle: string }> = {
    overview: {
      title: selectedBranchKey === 'ALL' ? 'Ringkasan Semua Cabang' : 'Ringkasan Dashboard',
      subtitle: 'Pantau penjualan, HPP, laba bersih, dan aktivitas shift kasir secara real-time',
    },
    sales: {
      title: 'Penjualan & Riwayat Transaksi',
      subtitle: 'Detail transaksi lengkap, struk digital website, ekspor CSV, dan pembatalan (void)',
    },
    expenses: {
      title: 'Pemasukan & Pengeluaran',
      subtitle: 'Kelola biaya operasional non-HPP dan pantau pengeluaran kas kecil kasir',
    },
    recipes: {
      title: 'Katalog Menu & Kalkulator Resep HPP',
      subtitle: 'Atur komposisi resep, margin profit ideal, dan harga jual yang langsung sinkron ke kasir',
    },
    ingredients: {
      title: 'Bahan Baku & Pembelian',
      subtitle: 'Kelola daftar bahan, satuan dasar, dan riwayat harga beli supplier',
    },
    target: {
      title: 'Target Bulanan & Analisis BEP',
      subtitle: 'Hitung titik impas (Break-Even Point) dan progres target laba bulanan',
    },
    attendance: {
      title: 'Absensi Tim & Jadwal Shift',
      subtitle: 'Pantau kehadiran real-time, foto selfie masuk/pulang, koreksi lupa pulang, dan ekspor CSV',
    },
    team: {
      title: isOwner ? 'Tim & Karyawan' : 'Tim Kasir',
      subtitle: isOwner
        ? '1 daftar tim lintas cabang (Pusat & semua Cabang) — tambah karyawan, atur jabatan/akses, & nonaktifkan akun'
        : 'Kelola akun Kasir yang aktif di usaha Anda',
    },
    branches: {
      title: 'Cabang & Pengaturan Outlet',
      subtitle: 'Pantau status buka/tutup cabang, ID Outlet, PIN Otorisasi, profil struk, dan pengaturan outlet',
    },
    settings: {
      title: 'Cabang & Pengaturan Outlet',
      subtitle: 'Pantau status buka/tutup cabang, ID Outlet, PIN Otorisasi, profil struk, dan pengaturan outlet',
    },
  };

  const isAllBranchesMode = isOwner && selectedBranchKey === 'ALL';

  return (
    <div className="min-h-screen w-full bg-[#f6f5f0] flex text-[#1f1e1d]">
      {/* Sidebar Navigasi Website (Fixed Left 256px) — TANPA MENU KASIR */}
      <aside className="w-[256px] bg-white border-r border-[#e2e0d8] flex flex-col justify-between shrink-0 sticky top-0 h-screen select-none">
        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          {/* Brand */}
          <div className="flex items-center gap-2.5 px-1">
            <LembayungLogo size={36} />
            <div className="min-w-0">
              <div className="font-bold text-sm text-[#1f1e1d] flex items-center gap-1.5">
                <span>Lembayung</span>
                {getAppEnvironment() === 'testing' && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fbeed9] text-[#7a4300]">
                    TEST
                  </span>
                )}
              </div>
              <div className="text-[11px] font-medium text-[#1F7A5A]">
                Web Backoffice
              </div>
            </div>
          </div>

          {/* Branch Switcher */}
          <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-2.5 flex flex-col gap-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68]">
              {isOwner ? 'Cabang Aktif' : 'Cabang Tugas'}
            </div>
            {isOwner && branches.length > 0 ? (
              <select
                value={selectedBranchKey || activeOutletId}
                disabled={switchingBranch}
                onChange={(e) => handleBranchSwitch(e.target.value)}
                className="w-full h-8 rounded-lg border border-[#d6d3c8] bg-white px-2 text-xs font-semibold text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
              >
                {branches.length > 1 && (
                  <option value="ALL">🌐 Semua Cabang ({branches.length})</option>
                )}
                {branches.map((b) => (
                  <option key={b.outletId} value={b.outletId}>
                    🏪 {b.namaCabang} ({b.outletId})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs font-bold text-[#1f1e1d] truncate">
                {settings?.namaUsaha || 'Lembayung'}{' '}
                <span className="text-[#1F7A5A]">({settings?.namaCabang || 'Pusat'})</span>
              </div>
            )}
            {activeOutletId && !isAllBranchesMode && (
              <div className="text-[10px] font-mono text-[#6b6a68]">ID: {activeOutletId}</div>
            )}
          </div>

          {/* Menu Navigasi Website */}
          <nav className="flex flex-col gap-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68] px-3 mb-0.5">
              Analitik &amp; Keuangan
            </div>
            <WebNavItem
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon={<BarChart3 size={16} />}
              label="Ringkasan Dashboard"
            />
            <WebNavItem
              active={activeTab === 'sales'}
              onClick={() => setActiveTab('sales')}
              icon={<ReceiptRpIcon size={16} />}
              label="Penjualan & Riwayat"
            />
            <WebNavItem
              active={activeTab === 'expenses'}
              onClick={() => setActiveTab('expenses')}
              icon={<Wallet size={16} />}
              label="Pemasukan & Pengeluaran"
            />
            <WebNavItem
              active={activeTab === 'target'}
              onClick={() => setActiveTab('target')}
              icon={<Target size={16} />}
              label="Target & BEP"
            />

            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68] px-3 mt-3 mb-0.5">
              Produk &amp; HPP
            </div>
            <WebNavItem
              active={activeTab === 'recipes'}
              onClick={() => setActiveTab('recipes')}
              icon={<BookOpen size={16} />}
              label="Menu & Kalkulator HPP"
            />
            <WebNavItem
              active={activeTab === 'ingredients'}
              onClick={() => setActiveTab('ingredients')}
              icon={<Package size={16} />}
              label="Bahan Baku & Pembelian"
            />

            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68] px-3 mt-3 mb-0.5">
              Manajemen
            </div>
            <WebNavItem
              active={activeTab === 'attendance'}
              onClick={() => setActiveTab('attendance')}
              icon={<Clock size={16} />}
              label="Absensi Tim"
            />
            <WebNavItem
              active={activeTab === 'team'}
              onClick={() => setActiveTab('team')}
              icon={<Users size={16} />}
              label={isOwner ? 'Tim & Karyawan' : 'Tim Kasir'}
            />
            {isOwner && (
              <WebNavItem
                active={activeTab === 'branches' || activeTab === 'settings'}
                onClick={() => {
                  setActiveTab('branches');
                  setBranchSubTab('branches');
                }}
                icon={<Building2 size={16} />}
                label="Cabang & Pengaturan"
              />
            )}
          </nav>
        </div>

        {/* Footer Sidebar: Unduh Aplikasi Android + User Info & Logout */}
        <div className="p-3.5 border-t border-[#e2e0d8] bg-[#faf9f5] flex flex-col gap-2">
          {androidDownloadUrl && (
            <a
              href={androidDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-9 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#e4f1ea] hover:border-[#1F7A5A]/40 text-[#1f1e1d] text-xs font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <Download size={14} className="text-[#1F7A5A]" />
              Unduh Aplikasi Android
            </a>
          )}
          <div className="flex items-center justify-between bg-white border border-[#e2e0d8] rounded-xl p-2.5 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center font-bold text-xs shrink-0">
                {user.nama.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-xs text-[#1f1e1d] truncate">{user.nama}</div>
                <div className="text-[10px] font-semibold text-[#1F7A5A]">
                  {isOwner ? 'Owner' : 'Manager'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={onToggleDarkMode}
                title={darkMode ? 'Mode Terang' : 'Mode Gelap'}
                className="p-1.5 rounded-lg text-[#4a4947] hover:bg-[#ece9e0]"
              >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <button
                type="button"
                onClick={onLogout}
                title="Keluar dari Dashboard"
                className="p-1.5 rounded-lg text-[#9b1c12] hover:bg-[#fbe4e1]"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Widescreen) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Website */}
        <header className="bg-white border-b border-[#e2e0d8] px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
          <div>
            <h1 className="text-lg font-bold text-[#1f1e1d] leading-tight">
              {pageTitles[activeTab].title}
            </h1>
            <p className="text-xs text-[#6b6a68]">{pageTitles[activeTab].subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Global Date Range Filter pada halaman Overview, Sales, serta Expenses/Attendance di mode Semua Cabang */}
            {(activeTab === 'overview' ||
              activeTab === 'sales' ||
              (isAllBranchesMode && (activeTab === 'expenses' || activeTab === 'attendance'))) && (
              <div className="flex items-center gap-1.5 bg-[#faf9f5] border border-[#e2e0d8] rounded-xl px-2.5 py-1.5 text-xs">
                <Calendar size={14} className="text-[#1F7A5A]" />
                {(['today', '7days', 'this_month', 'last_month'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={`px-2 py-1 rounded-lg transition ${
                      presetKey === p
                        ? 'bg-[#1F7A5A] text-white font-semibold'
                        : 'text-[#4a4947] hover:bg-[#ece9e0]'
                    }`}
                  >
                    {p === 'today'
                      ? 'Hari Ini'
                      : p === '7days'
                      ? '7 Hari'
                      : p === 'this_month'
                      ? 'Bulan Ini'
                      : 'Bulan Lalu'}
                  </button>
                ))}
                <span className="text-[#d6d3c8] mx-1">|</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPresetKey('custom');
                    setDateFrom(e.target.value);
                  }}
                  className="bg-white border border-[#d6d3c8] rounded-lg px-2 py-0.5 text-[11px]"
                />
                <span className="text-[#6b6a68]">–</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPresetKey('custom');
                    setDateTo(e.target.value);
                  }}
                  className="bg-white border border-[#d6d3c8] rounded-lg px-2 py-0.5 text-[11px]"
                />
              </div>
            )}

            {isOwner && activeTab === 'overview' && (
              <button
                type="button"
                disabled={emailSending}
                onClick={handleSendEmailReport}
                className="h-9 px-3 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Mail size={14} /> {emailSending ? 'Mengirim...' : 'Kirim Email'}
              </button>
            )}

            {/* Status Cloud Sync */}
            <div
              title={isOnline ? 'Terhubung real-time ke Cloud' : `Offline (${pendingSyncCount} antrean)`}
              className={`h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 ${
                isOnline
                  ? 'border-[#c5dfd1] bg-[#e4f1ea]/60 text-[#16a34a]'
                  : 'border-[#f5c2bc] bg-[#fbe4e1]/60 text-[#dc2626]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isOnline
                    ? `bg-[#16a34a] ${isAutoSyncing ? 'animate-pulse' : ''}`
                    : 'bg-[#dc2626]'
                }`}
              />
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span>{isOnline ? 'Sinkron' : 'Offline'}</span>
            </div>
          </div>
        </header>

        {toastMsg && (
          <div className="mx-6 mt-4 text-xs font-medium bg-[#e4f1ea] text-[#14532d] border border-[#c5dfd1] px-4 py-2.5 rounded-xl">
            {toastMsg}
          </div>
        )}

        {switchingBranch ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#6b6a68]">
            Memuat data cabang...
          </div>
        ) : (
          <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
            {activeTab === 'overview' && (
              <WebOverviewPage
                dateFrom={dateFrom}
                dateTo={dateTo}
                isAllBranches={isAllBranchesMode}
                branches={branches}
                onSelectBranch={handleBranchSwitch}
                onNavigate={(t) => setActiveTab(t)}
              />
            )}
            {activeTab === 'sales' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="sales"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <WebSalesHistoryPage user={user} dateFrom={dateFrom} dateTo={dateTo} />
              ))}
            {activeTab === 'expenses' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="expenses"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                  <ExpensesPage user={user} />
                </div>
              ))}
            {activeTab === 'recipes' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="recipes"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                  <RecipesMenuPage user={user} />
                </div>
              ))}
            {activeTab === 'ingredients' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="ingredients"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                  <IngredientsPage user={user} />
                </div>
              ))}
            {activeTab === 'target' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="target"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                  <TargetBepPage />
                </div>
              ))}
            {activeTab === 'attendance' &&
              (isAllBranchesMode ? (
                <WebAllBranchesModuleView
                  module="attendance"
                  branches={branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onOpenBranchModule={(oid, mod: AllBranchesModule) => handleBranchSwitch(oid, mod)}
                />
              ) : (
                <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                  <AttendanceReportPage user={user} />
                </div>
              ))}
            {activeTab === 'team' && (
              <WebBranchesTeamPage
                user={user}
                settings={settings}
                branches={branches}
                activeOutletId={activeOutletId}
                section="team"
                onBranchCreated={(b) => {
                  setBranches((prev) => [...prev, b]);
                  setToastMsg(`Cabang "${b.namaCabang}" (${b.outletId}) berhasil dibuat!`);
                  setTimeout(() => setToastMsg(''), 4000);
                }}
                onBranchUpdated={(updated) => {
                  setBranches((prev) =>
                    prev.map((b) => (b.outletId === updated.outletId ? { ...b, ...updated } : b))
                  );
                }}
                onSelectBranch={handleBranchSwitch}
              />
            )}
            {(activeTab === 'branches' || activeTab === 'settings') && isOwner && (
              <div className="flex flex-col gap-4">
                <div className="inline-flex bg-white border border-[#e2e0d8] rounded-xl p-1 gap-1 w-fit">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('branches');
                      setBranchSubTab('branches');
                    }}
                    className={`h-9 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                      branchSubTab === 'branches' && activeTab === 'branches'
                        ? 'bg-[#1F7A5A] text-white'
                        : 'text-[#4a4947] hover:bg-[#faf9f5]'
                    }`}
                  >
                    <Building2 size={14} /> Daftar Cabang ({branches.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('branches');
                      setBranchSubTab('settings');
                    }}
                    className={`h-9 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${
                      branchSubTab === 'settings' || activeTab === 'settings'
                        ? 'bg-[#1F7A5A] text-white'
                        : 'text-[#4a4947] hover:bg-[#faf9f5]'
                    }`}
                  >
                    <Settings size={14} /> Pengaturan Outlet
                    {!isAllBranchesMode && settings?.namaCabang ? ` (${settings.namaCabang})` : ''}
                  </button>
                </div>

                {branchSubTab === 'branches' && activeTab === 'branches' ? (
                  <WebBranchesTeamPage
                    user={user}
                    settings={settings}
                    branches={branches}
                    activeOutletId={activeOutletId}
                    section="branches"
                    onBranchCreated={(b) => {
                      setBranches((prev) => [...prev, b]);
                      setToastMsg(`Cabang "${b.namaCabang}" (${b.outletId}) berhasil dibuat!`);
                      setTimeout(() => setToastMsg(''), 4000);
                    }}
                    onBranchUpdated={(updated) => {
                      setBranches((prev) =>
                        prev.map((b) => (b.outletId === updated.outletId ? { ...b, ...updated } : b))
                      );
                    }}
                    onBranchDeleted={async (deletedOid) => {
                      const remaining = branches.filter((b) => b.outletId !== deletedOid);
                      setBranches(remaining);
                      setToastMsg(`Cabang (${deletedOid}) berhasil dihapus permanen.`);
                      if (activeOutletId === deletedOid && remaining.length > 0) {
                        const pusat =
                          remaining.find((b) => !b.parentOutletId || b.parentOutletId === b.outletId) ||
                          remaining[0];
                        await handleBranchSwitch(pusat.outletId);
                      }
                    }}
                    onOpenBranchSettings={async (oid) => {
                      await handleBranchSwitch(oid, 'branches');
                      setBranchSubTab('settings');
                    }}
                    onSelectBranch={handleBranchSwitch}
                  />
                ) : isAllBranchesMode ? (
                  <WebAllBranchesModuleView
                    module="settings"
                    branches={branches}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onOpenBranchModule={async (oid) => {
                      await handleBranchSwitch(oid, 'branches');
                      setBranchSubTab('settings');
                    }}
                  />
                ) : (
                  <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
                    <SettingsPage
                      user={user}
                      darkMode={darkMode}
                      onToggleDarkMode={onToggleDarkMode}
                      onBack={() => setBranchSubTab('branches')}
                      onLogout={onLogout}
                    />
                  </div>
                )}
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
};

interface WebNavItemProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const WebNavItem: React.FC<WebNavItemProps> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-left transition ${
      active
        ? 'bg-[#e4f1ea] text-[#1F7A5A] font-semibold'
        : 'text-[#4a4947] hover:bg-[#faf9f5] font-medium'
    }`}
  >
    <span className="shrink-0 flex items-center">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);
