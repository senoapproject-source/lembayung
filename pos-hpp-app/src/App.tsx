import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/database';
import { seedInitialDataIfEmpty } from './db/seed';
import {
  checkForAppUpdate,
  getAppEnvironment,
  getInstalledAppVersion,
  initOtaUpdater,
  processSyncQueue,
  syncWithCloud,
  type AppUpdateInfo,
} from './services/syncService';
import {
  initDeviceNotifications,
  sendDeviceNotification,
  startRealtimeTransactionNotifications,
  stopRealtimeTransactionNotifications,
} from './services/notificationService';
import {
  registerFcmPushForUser,
  unregisterFcmPushToken,
} from './services/pushNotificationService';
import { decodeReceiptFromHash, type PublicReceiptPayload } from './lib/receipt';
import { PublicReceiptView } from './components/PublicReceiptView';
import { CuaninLogo } from './components/CuaninLogo';
import { UpdatePromptModal } from './components/UpdatePromptModal';
import { CloseShiftModal, OpenShiftScreen } from './components/CashierShiftModals';
import type { User } from './types/models';
import { LoginPage, REMEMBERED_USER_KEY } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { RecipesMenuPage } from './pages/RecipesMenuPage';
import { IngredientsPage } from './pages/IngredientsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { HistoryPage } from './pages/HistoryPage';
import { TargetBepPage } from './pages/TargetBepPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  BarChart3,
  BookOpen,
  LogOut,
  Moon,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Sun,
  Target,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';

type ActiveView =
  | 'kasir'
  | 'resep'
  | 'bahan'
  | 'laporan'
  | 'pengeluaran'
  | 'riwayat'
  | 'target'
  | 'pengaturan';

const SESSION_KEY = 'pos_hpp_active_user_id';
const THEME_KEY = 'cuanin_theme_mode';

export function App() {
  const [ready, setReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() =>
    localStorage.getItem(SESSION_KEY)
  );
  const [activeView, setActiveView] = useState<ActiveView>('kasir');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isAutoSyncing, setIsAutoSyncing] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    () => localStorage.getItem(THEME_KEY) === 'dark'
  );
  const [publicReceipt, setPublicReceipt] = useState<PublicReceiptPayload | null>(() =>
    decodeReceiptFromHash(window.location.hash)
  );
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState<boolean>(false);
  const [backExitToast, setBackExitToast] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);

  // Riwayat navigasi menu untuk tombol Back di navbar Android & browser
  const viewHistoryRef = useRef<ActiveView[]>([]);
  const prevViewRef = useRef<ActiveView>('kasir');
  const activeViewRef = useRef<ActiveView>('kasir');
  const currentUserIdRef = useRef<string | null>(currentUserId);
  const isNavigatingBackRef = useRef<boolean>(false);
  const lastBackPressRef = useRef<number>(0);

  const settings = useLiveQuery(() => db.settings.get('global'));
  const currentUser = useLiveQuery(
    () => (currentUserId ? db.users.get(currentUserId) : undefined),
    [currentUserId]
  );
  const pendingSyncCount = useLiveQuery(() => db.syncQueue.count()) ?? 0;
  const activeCashierShift = useLiveQuery(
    async () => {
      if (!currentUserId) return undefined;
      const openShifts = await db.cashierShifts
        .where('kasirId')
        .equals(currentUserId)
        .filter((s) => s.status === 'open')
        .toArray();
      return openShifts[0];
    },
    [currentUserId]
  );

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem(THEME_KEY, 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem(THEME_KEY, 'light');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((v) => !v);

  const checkAndNotifyUpdate = async () => {
    const info = await checkForAppUpdate();
    if (!info?.hasUpdate) return;
    const dismissedVer = sessionStorage.getItem('cuanin_dismissed_update_ver');
    if (dismissedVer === info.latestVersion && !info.forceUpdate) return;
    setUpdateInfo((prev) => {
      if (prev?.latestVersion !== info.latestVersion) {
        setUpdateDismissed(false);
      }
      return info;
    });
    const isManualApk = !info.bundleZipUrl;
    sendDeviceNotification({
      title: `Update Lembayung v${info.latestVersion} Tersedia`,
      body: isManualApk
        ? 'Pembaruan aplikasi (APK) tersedia. Silakan download & update secara manual.'
        : `${info.releaseNotes || 'Pembaruan fitur terbaru siap dipasang.'}`,
      dedupKey: `app-update-${info.latestVersion}`,
    });
  };

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      document.documentElement.classList.add('capacitor-native');
    }
    initOtaUpdater();
    initDeviceNotifications();
    seedInitialDataIfEmpty().then(async () => {
      setReady(true);
      if (navigator.onLine) {
        const hasSettings = await db.settings.get('global');
        if (hasSettings) {
          setIsAutoSyncing(true);
          await syncWithCloud().catch(() => {});
          setIsAutoSyncing(false);
          startRealtimeTransactionNotifications();
        }
        checkAndNotifyUpdate().catch(() => {});
      }
    });
    return () => {
      stopRealtimeTransactionNotifications();
    };
  }, []);

  useEffect(() => {
    const runAutoSync = async () => {
      if (!navigator.onLine) return;
      setIsAutoSyncing(true);
      await processSyncQueue();
      setIsAutoSyncing(false);
    };

    const handleOnline = () => {
      setIsOnline(true);
      setIsAutoSyncing(true);
      syncWithCloud()
        .catch(() => {})
        .finally(() => setIsAutoSyncing(false));
      startRealtimeTransactionNotifications();
      checkAndNotifyUpdate().catch(() => {});
    };
    const handleOffline = () => setIsOnline(false);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncWithCloud().catch(() => {});
        startRealtimeTransactionNotifications();
        checkAndNotifyUpdate().catch(() => {});
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    let tick = 0;
    const interval = setInterval(() => {
      if (!navigator.onLine) return;
      tick += 1;
      db.syncQueue.count().then((cnt) => {
        if (cnt > 0) {
          runAutoSync();
        } else if (tick % 2 === 0) {
          // Setiap ~10 detik saat idle, tarik pembaruan dari Cloud (user/menu/resep/transaksi dari perangkat lain)
          syncWithCloud().catch(() => {});
        }
      });
      // Setiap ~60 detik (12 * 5s), cek apakah ada update versi baru (OTA / APK manual)
      if (tick % 12 === 0) {
        checkAndNotifyUpdate().catch(() => {});
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, []);

  // Tarik pembaruan terbaru dari Cloud secara diam-diam setiap kali user berpindah tab/menu
  useEffect(() => {
    if (ready && currentUserId && navigator.onLine) {
      syncWithCloud().catch(() => {});
    }
  }, [activeView, ready, currentUserId]);

  // Simpan riwayat perpindahan menu agar tombol Back navbar kembali ke menu sebelumnya
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    activeViewRef.current = activeView;
    if (isNavigatingBackRef.current) {
      isNavigatingBackRef.current = false;
      prevViewRef.current = activeView;
      return;
    }
    if (prevViewRef.current !== activeView) {
      viewHistoryRef.current = [...viewHistoryRef.current.slice(-29), prevViewRef.current];
      prevViewRef.current = activeView;
      try {
        window.history.pushState({ cuaninView: activeView }, '');
      } catch {
        // ignore
      }
    }
  }, [activeView]);

  useEffect(() => {
    const handleHardwareBack = (): boolean => {
      if (!currentUserIdRef.current) return false;

      if (viewHistoryRef.current.length > 0) {
        const previous = viewHistoryRef.current.pop()!;
        isNavigatingBackRef.current = true;
        setActiveView(previous);
        return true;
      }

      if (activeViewRef.current !== 'kasir') {
        isNavigatingBackRef.current = true;
        setActiveView('kasir');
        return true;
      }

      // Sudah di menu awal (Kasir): tekan Back 2x dalam 2 detik untuk keluar aplikasi
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        setBackExitToast(false);
        return false;
      }
      lastBackPressRef.current = now;
      setBackExitToast(true);
      setTimeout(() => setBackExitToast(false), 2000);
      return true;
    };

    const win = window as unknown as { __cuaninHandleBack?: () => boolean };
    win.__cuaninHandleBack = handleHardwareBack;

    const handlePopState = () => {
      if (viewHistoryRef.current.length > 0) {
        const previous = viewHistoryRef.current.pop()!;
        isNavigatingBackRef.current = true;
        setActiveView(previous);
      } else if (activeViewRef.current !== 'kasir') {
        isNavigatingBackRef.current = true;
        setActiveView('kasir');
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      delete win.__cuaninHandleBack;
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const handleLogin = (user: User) => {
    localStorage.setItem(SESSION_KEY, user.id);
    localStorage.setItem(REMEMBERED_USER_KEY, user.id);
    viewHistoryRef.current = [];
    prevViewRef.current = 'kasir';
    setCurrentUserId(user.id);
    setActiveView('kasir');
    // Daftarkan perangkat ke Firebase Cloud Messaging (FCM) agar notif masuk walau app ditutup
    initDeviceNotifications();
    registerFcmPushForUser(user).catch(() => {});
    // Pastikan channel notifikasi Realtime langsung aktif setelah login di perangkat baru
    if (navigator.onLine) {
      startRealtimeTransactionNotifications();
    }
  };

  const handleLockToPin = () => {
    localStorage.removeItem(SESSION_KEY);
    viewHistoryRef.current = [];
    setCurrentUserId(null);
  };

  const handleFullLogout = () => {
    unregisterFcmPushToken().catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBERED_USER_KEY);
    viewHistoryRef.current = [];
    setCurrentUserId(null);
  };

  useEffect(() => {
    if (currentUser && navigator.onLine) {
      registerFcmPushForUser(currentUser).catch(() => {});
    }
  }, [currentUser?.id]);

  useEffect(() => {
    const handleHashChange = () => {
      setPublicReceipt(decodeReceiptFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (publicReceipt) {
    return (
      <PublicReceiptView
        receipt={publicReceipt}
        onCloseToApp={() => {
          window.location.hash = '';
          setPublicReceipt(null);
        }}
      />
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#faf9f5] flex items-center justify-center text-sm text-[#6b6a68]">
        Menyiapkan database offline...
      </div>
    );
  }

  if (!currentUser || !currentUser.active) {
    return (
      <div className="min-h-screen bg-[#faf9f5] safe-frame flex justify-center items-center relative">
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? 'Mode Terang' : 'Mode Gelap'}
          className="fixed top-9 right-4 z-20 w-10 h-10 rounded-full bg-white border border-[#e2e0d8] flex items-center justify-center text-[#4a4947] shadow-xs"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="w-full max-w-[440px]">
          <LoginPage onLoginSuccess={handleLogin} />
        </div>
      {backExitToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#18181B]/95 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
          Tekan kembali sekali lagi untuk keluar
        </div>
      )}

      {updateInfo?.hasUpdate && !updateDismissed && (
          <UpdatePromptModal
            info={updateInfo}
            onDismiss={() => {
              if (updateInfo?.latestVersion) {
                sessionStorage.setItem('cuanin_dismissed_update_ver', updateInfo.latestVersion);
              }
              setUpdateDismissed(true);
            }}
          />
        )}
      </div>
    );
  }

  const isOwner = currentUser.role === 'owner';

  // Khusus Kasir: wajib Buka Kasir (hitung & input uang modal awal) sebelum masuk ke halaman Kasir
  if (!isOwner && !activeCashierShift) {
    return (
      <OpenShiftScreen
        user={currentUser}
        namaUsaha={settings?.namaUsaha}
        onOpened={() => setActiveView('kasir')}
        onSwitchUser={handleLockToPin}
      />
    );
  }

  const safeView: ActiveView = (() => {
    if (isOwner) return activeView;
    if (activeView === 'kasir' || activeView === 'riwayat') return activeView;
    if (activeView === 'pengeluaran' && currentUser.canRecordExpense) return activeView;
    return 'kasir';
  })();

  const isLaporanGroup =
    safeView === 'laporan' ||
    safeView === 'pengeluaran' ||
    safeView === 'riwayat' ||
    safeView === 'target' ||
    safeView === 'pengaturan';

  const syncStatusBadge = isOnline ? (
    <span
      title={
        isAutoSyncing
          ? 'Menyinkronkan ke Cloud...'
          : pendingSyncCount > 0
          ? `Menunggu sinkron (${pendingSyncCount})`
          : 'Online · Cloud Sinkron'
      }
      className="inline-flex items-center gap-1 text-[#16a34a]"
    >
      <span
        className={`w-2.5 h-2.5 rounded-full bg-[#16a34a] inline-block shrink-0 ${
          isAutoSyncing ? 'animate-pulse' : ''
        }`}
      />
      <Wifi size={13} />
    </span>
  ) : (
    <span
      title={`Offline (${pendingSyncCount} antrean)`}
      className="inline-flex items-center gap-1 text-[#dc2626]"
    >
      <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626] inline-block shrink-0" />
      <WifiOff size={13} />
      {pendingSyncCount > 0 && (
        <span className="text-[10px] font-bold">{pendingSyncCount}</span>
      )}
    </span>
  );

  return (
    <div className="h-screen w-screen bg-[#faf9f5] safe-frame flex flex-col md:flex-row overflow-hidden">
      {/* ====================================================================
          SIDEBAR NAVIGASI UNTUK TABLET & DESKTOP (md:flex)
         ==================================================================== */}
      <aside className="hidden md:flex md:w-[216px] lg:w-[238px] bg-white border-r border-[#e2e0d8] flex-col justify-between shrink-0 select-none">
        <div className="p-3.5 flex flex-col gap-4 overflow-y-auto">
          {/* Brand Header */}
          <div className="flex items-center gap-2.5 px-1">
            <CuaninLogo size={34} />
            <div className="min-w-0">
              <div className="font-bold text-sm text-[#1f1e1d] leading-tight truncate flex items-center gap-1.5">
                <span className="truncate">{settings?.namaUsaha || 'Lembayung'}</span>
                {getAppEnvironment() === 'testing' && (
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fbeed9] text-[#7a4300] shrink-0">
                    TEST
                  </span>
                )}
              </div>
              <div className="text-[11px] font-medium text-[#1F7A5A]">
                Lembayung · POS &amp; HPP
              </div>
            </div>
          </div>

          {/* Menu Utama Sidebar */}
          <nav className="flex flex-col gap-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68] px-3 mb-0.5">
              Menu Utama
            </div>
            <SidebarItem
              active={safeView === 'kasir'}
              onClick={() => setActiveView('kasir')}
              icon={<ShoppingCart size={17} />}
              label="Kasir (POS)"
            />
            {isOwner && (
              <>
                <SidebarItem
                  active={safeView === 'resep'}
                  onClick={() => setActiveView('resep')}
                  icon={<BookOpen size={17} />}
                  label="Resep & Menu"
                />
                <SidebarItem
                  active={safeView === 'bahan'}
                  onClick={() => setActiveView('bahan')}
                  icon={<Package size={17} />}
                  label="Bahan Baku"
                />
                <SidebarItem
                  active={safeView === 'laporan'}
                  onClick={() => setActiveView('laporan')}
                  icon={<BarChart3 size={17} />}
                  label="Laporan & Grafik"
                />
                <SidebarItem
                  active={safeView === 'target'}
                  onClick={() => setActiveView('target')}
                  icon={<Target size={17} />}
                  label="Target & BEP"
                />
              </>
            )}

            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68] px-3 mt-2.5 mb-0.5">
              Operasional
            </div>
            <SidebarItem
              active={safeView === 'riwayat'}
              onClick={() => setActiveView('riwayat')}
              icon={<Receipt size={17} />}
              label="Riwayat Transaksi"
            />
            {(isOwner || currentUser.canRecordExpense) && (
              <SidebarItem
                active={safeView === 'pengeluaran'}
                onClick={() => setActiveView('pengeluaran')}
                icon={<Wallet size={17} />}
                label="Pengeluaran"
              />
            )}
            {isOwner && (
              <SidebarItem
                active={safeView === 'pengaturan'}
                onClick={() => setActiveView('pengaturan')}
                icon={<Settings size={17} />}
                label="Pengaturan"
              />
            )}
          </nav>
        </div>

        {/* Footer Sidebar (Status Cloud, Tutup Kasir, User, Dark Mode, Kunci PIN) */}
        <div className="p-3 border-t border-[#e2e0d8] flex flex-col gap-2 bg-[#faf9f5]">
          {!isOwner && activeCashierShift && (
            <button
              type="button"
              onClick={() => setShowCloseShiftModal(true)}
              className="w-full h-9 rounded-xl bg-[#fbe4e1] hover:bg-[#f7d0cb] text-[#9b1c12] font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <LogOut size={13} /> Tutup Kasir
            </button>
          )}
          <div className="text-xs px-1 flex items-center justify-between gap-2">
            <span>{syncStatusBadge}</span>
            <span className="text-[10px] font-medium text-[#6b6a68] shrink-0">
              v{getInstalledAppVersion()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 bg-white border border-[#e2e0d8] rounded-xl p-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center font-bold text-xs shrink-0">
                {currentUser.nama.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-xs text-[#1f1e1d] truncate">
                  {currentUser.nama}
                </div>
                <div className="text-[10px] text-[#6b6a68]">
                  {isOwner ? 'Owner' : 'Kasir'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={toggleDarkMode}
                title={darkMode ? 'Mode Terang' : 'Mode Gelap'}
                className="p-1.5 rounded-lg text-[#4a4947] hover:bg-[#ece9e0] transition"
              >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={handleLockToPin}
                  title="Ganti Kasir / Kunci PIN"
                  className="p-1.5 rounded-lg text-[#9b1c12] hover:bg-[#fbe4e1] transition"
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* ====================================================================
          HEADER ATAS KHUSUS LAYAR HP (md:hidden)
         ==================================================================== */}
      <div className="md:hidden bg-white border-b border-[#e2e0d8] px-3.5 py-2.5 flex justify-between items-center gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 pr-1.5 border-r border-[#e2e0d8] shrink-0">
            <CuaninLogo size={20} />
            <span className="font-bold text-xs text-[#1f1e1d]">Lembayung</span>
            <span className="text-[10px] font-medium text-[#6b6a68]">
              v{getInstalledAppVersion()}
            </span>
            {getAppEnvironment() === 'testing' && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#fbeed9] text-[#7a4300]">
                TEST
              </span>
            )}
          </div>
          <div className="truncate">{syncStatusBadge}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isOwner && activeCashierShift ? (
            <button
              type="button"
              onClick={() => setShowCloseShiftModal(true)}
              className="px-2 py-1 rounded-full bg-[#fbe4e1] text-[#9b1c12] font-semibold text-[11px] shrink-0"
            >
              Tutup Kasir
            </button>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947] font-semibold max-w-[115px] truncate">
              {currentUser.nama} ({isOwner ? 'Owner' : 'Kasir'})
            </span>
          )}
          <button
            type="button"
            onClick={toggleDarkMode}
            title={darkMode ? 'Ubah ke Mode Terang' : 'Ubah ke Mode Gelap'}
            className="p-1.5 rounded-md text-[#4a4947] hover:bg-[#ece9e0] transition"
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={() => setActiveView('pengaturan')}
              title="Pengaturan"
              className={`p-1.5 rounded-md transition ${
                safeView === 'pengaturan'
                  ? 'bg-[#e4f1ea] text-[#1F7A5A]'
                  : 'text-[#4a4947] hover:bg-[#ece9e0]'
              }`}
            >
              <Settings size={15} />
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={handleLockToPin}
              title="Kunci Layar PIN"
              className="text-[#9b1c12] p-1.5 hover:bg-[#fbe4e1] rounded-md transition"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ====================================================================
          AREA KONTEN UTAMA (FULL-WIDTH RESPONSIVE DI TABLET & HP)
         ==================================================================== */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {safeView === 'kasir' && (
          <PosPage user={currentUser} onOpenHistory={() => setActiveView('riwayat')} />
        )}
        {safeView === 'resep' && isOwner && <RecipesMenuPage user={currentUser} />}
        {safeView === 'bahan' && isOwner && <IngredientsPage user={currentUser} />}
        {safeView === 'laporan' && isOwner && (
          <ReportsPage
            onOpenExpenses={() => setActiveView('pengeluaran')}
            onOpenHistory={() => setActiveView('riwayat')}
            onOpenTargetBep={() => setActiveView('target')}
          />
        )}
        {safeView === 'pengeluaran' && (isOwner || currentUser.canRecordExpense) && (
          <ExpensesPage
            user={currentUser}
            activeShift={!isOwner ? activeCashierShift : undefined}
            onBack={isOwner ? () => setActiveView('laporan') : undefined}
          />
        )}
        {safeView === 'riwayat' && (
          <HistoryPage
            user={currentUser}
            activeShift={!isOwner ? activeCashierShift : undefined}
            onBack={() => setActiveView(isOwner ? 'laporan' : 'kasir')}
          />
        )}
        {safeView === 'target' && isOwner && (
          <TargetBepPage onBack={() => setActiveView('laporan')} />
        )}
        {safeView === 'pengaturan' && isOwner && (
          <SettingsPage
            user={currentUser}
            darkMode={darkMode}
            onToggleDarkMode={toggleDarkMode}
            onBack={() => setActiveView('laporan')}
            onLogout={handleFullLogout}
          />
        )}
      </main>

      {/* ====================================================================
          BOTTOM TAB NAVIGATION KHUSUS LAYAR HP (md:hidden)
         ==================================================================== */}
      <nav className="md:hidden bg-white border-t border-[#e2e0d8] h-[68px] flex shrink-0">
        {isOwner ? (
          <>
            <TabButton
              active={safeView === 'kasir'}
              onClick={() => setActiveView('kasir')}
              icon={<ShoppingCart size={18} />}
              label="Kasir"
            />
            <TabButton
              active={safeView === 'resep'}
              onClick={() => setActiveView('resep')}
              icon={<BookOpen size={18} />}
              label="Resep"
            />
            <TabButton
              active={safeView === 'bahan'}
              onClick={() => setActiveView('bahan')}
              icon={<Package size={18} />}
              label="Bahan"
            />
            <TabButton
              active={isLaporanGroup}
              onClick={() => setActiveView('laporan')}
              icon={<BarChart3 size={18} />}
              label="Laporan"
            />
          </>
        ) : (
          <>
            <TabButton
              active={safeView === 'kasir'}
              onClick={() => setActiveView('kasir')}
              icon={<ShoppingCart size={18} />}
              label="Kasir"
            />
            <TabButton
              active={safeView === 'riwayat'}
              onClick={() => setActiveView('riwayat')}
              icon={<Receipt size={18} />}
              label="Riwayat"
            />
            {currentUser.canRecordExpense && (
              <TabButton
                active={safeView === 'pengeluaran'}
                onClick={() => setActiveView('pengeluaran')}
                icon={<Wallet size={18} />}
                label="Pengeluaran"
              />
            )}
          </>
        )}
      </nav>

      {/* Modal Update APK Otomatis via Supabase */}
      {showCloseShiftModal && activeCashierShift && (
        <CloseShiftModal
          shift={activeCashierShift}
          user={currentUser}
          onClose={() => setShowCloseShiftModal(false)}
          onShiftClosed={() => {
            setShowCloseShiftModal(false);
            handleLockToPin();
          }}
        />
      )}

      {backExitToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#18181B]/95 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
          Tekan kembali sekali lagi untuk keluar
        </div>
      )}

      {updateInfo?.hasUpdate && !updateDismissed && (
        <UpdatePromptModal
          info={updateInfo}
          onDismiss={() => {
              if (updateInfo?.latestVersion) {
                sessionStorage.setItem('cuanin_dismissed_update_ver', updateInfo.latestVersion);
              }
              setUpdateDismissed(true);
            }}
        />
      )}
    </div>
  );
}

interface SidebarItemProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ active, onClick, icon, label }) => (
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
    <span className="truncate leading-snug">{label}</span>
  </button>
);

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center gap-1 border-t-[3px] transition ${
      active
        ? 'border-[#1F7A5A] text-[#1F7A5A] font-semibold'
        : 'border-transparent text-[#6b6a68] font-medium'
    }`}
  >
    {icon}
    <span className="text-xs">{label}</span>
  </button>
);

export default App;
