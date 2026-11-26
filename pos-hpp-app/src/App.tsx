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
  verifyActiveOutletInCloud,
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
import {
  decodeReceiptFromHash,
  fetchPublicReceiptFromQuery,
  type PublicReceiptPayload,
} from './lib/receipt';
import { PublicReceiptView } from './components/PublicReceiptView';
import { PublicSelfOrderView } from './components/PublicSelfOrderView';
import { WebLoginPage } from './web/WebLoginPage';
import { WebDashboardShell } from './web/WebDashboardShell';
import { WebBranchesTeamPage } from './web/WebBranchesTeamPage';
import {
  evaluateStoreOpenStatus,
  fetchOwnerBranches,
  switchActiveBranch,
  toggleStoreOpenByOwner,
} from './services/branchService';
import { SelfOrderShareModal } from './components/SelfOrderShareModal';
import { CuaninLogo } from './components/CuaninLogo';
import { LembayungSplash } from './components/LembayungSplash';
import { AttendanceKioskModal } from './components/AttendanceKioskModal';
import { KasirStandbyScreen } from './components/KasirStandbyScreen';
import { UpdatePromptModal } from './components/UpdatePromptModal';
import { MAX_OPEN_ATTENDANCE_HOURS } from './services/attendanceService';
import { CloseShiftModal, OpenShiftScreen } from './components/CashierShiftModals';
import type { BranchInfo, User } from './types/models';
import { LoginPage, REMEMBERED_USER_KEY } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { RecipesMenuPage } from './pages/RecipesMenuPage';
import { IngredientsPage } from './pages/IngredientsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { HistoryPage } from './pages/HistoryPage';
import { TargetBepPage } from './pages/TargetBepPage';
import { AttendanceReportPage } from './pages/AttendanceReportPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  BarChart3,
  BookOpen,
  Building2,
  Clock,
  LogOut,
  Moon,
  Package,
  Power,
  QrCode,
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
  | 'absensi'
  | 'cabang'
  | 'pengaturan';

const SESSION_KEY = 'pos_hpp_active_user_id';
const THEME_KEY = 'cuanin_theme_mode';
const KASIR_MODE_KEY = 'lembayung_kasir_mode_active';

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
  const isWebPortal = !Capacitor.isNativePlatform();
  const [publicReceipt, setPublicReceipt] = useState<PublicReceiptPayload | null>(() =>
    decodeReceiptFromHash(window.location.hash)
  );
  const [loadingQueryReceipt, setLoadingQueryReceipt] = useState<boolean>(() =>
    Boolean(new URLSearchParams(window.location.search).get('s'))
  );
  const [hasSelfOrderQuery] = useState<boolean>(() =>
    Boolean(new URLSearchParams(window.location.search).get('order'))
  );
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState<boolean>(false);
  const [backExitToast, setBackExitToast] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);
  const [showAttendanceKiosk, setShowAttendanceKiosk] = useState<boolean>(false);
  const [ownerBranches, setOwnerBranches] = useState<BranchInfo[]>([]);
  const [switchingBranch, setSwitchingBranch] = useState<boolean>(false);
  const [showSelfOrderShare, setShowSelfOrderShare] = useState<boolean>(false);
  const [togglingOwnerStore, setTogglingOwnerStore] = useState<boolean>(false);
  const [kasirModeActive, setKasirModeActive] = useState<boolean>(
    () => localStorage.getItem(KASIR_MODE_KEY) === '1'
  );
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (Capacitor.isNativePlatform()) return true;
    return sessionStorage.getItem('lembayung_splash_done') !== '1';
  });
  const [splashExiting, setSplashExiting] = useState<boolean>(false);
  const mountTimeRef = useRef<number>(Date.now());

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
  const activeUserAttendance = useLiveQuery(
    async () => {
      if (!currentUserId) return null;
      const open = await db.attendances
        .where('userId')
        .equals(currentUserId)
        .filter((a) => !a.clockOutAt && a.status !== 'lupa_pulang')
        .toArray();
      if (open.length === 0) return null;
      open.sort((a, b) => Date.parse(b.clockInAt) - Date.parse(a.clockInAt));
      const latest = open[0];
      const elapsedHrs = (Date.now() - Date.parse(latest.clockInAt)) / (1000 * 60 * 60);
      if (elapsedHrs >= MAX_OPEN_ATTENDANCE_HOURS) return null;
      return latest;
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
    if (isWebPortal) return;
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
      title: `Pembaruan Lembayung v${info.latestVersion} Tersedia`,
      body: isManualApk
        ? 'Versi terbaru Lembayung sudah tersedia. Ketuk untuk mengunduh pembaruan.'
        : `${info.releaseNotes || 'Pembaruan fitur dan perbaikan terbaru siap dipasang.'}`,
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
          const savedUid = localStorage.getItem(SESSION_KEY);
          const savedUser = savedUid ? await db.users.get(savedUid) : undefined;
          const outletCheck = await verifyActiveOutletInCloud(savedUser?.role);
          if (!outletCheck.valid) {
            unregisterFcmPushToken().catch(() => {});
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(REMEMBERED_USER_KEY);
            localStorage.removeItem(KASIR_MODE_KEY);
            await db.syncQueue.clear().catch(() => {});
            if (outletCheck.reason === 'not_found') {
              await db.settings.clear().catch(() => {});
              await db.users.clear().catch(() => {});
            }
            setKasirModeActive(false);
            setCurrentUserId(null);
            alert(
              outletCheck.reason === 'deactivated'
                ? `Cabang (${outletCheck.outletId}) sedang dinonaktifkan oleh Owner. Anda telah dikeluarkan otomatis.`
                : `ID Outlet toko Anda (${outletCheck.outletId}) telah diperbarui ke format standar baru (LM-AXXXXX) atau sudah dihapus. Silakan Login ulang menggunakan Email/Username Anda.`
            );
          } else if (savedUid) {
            setIsAutoSyncing(true);
            await syncWithCloud().catch(() => {});
            setIsAutoSyncing(false);
            startRealtimeTransactionNotifications();
          }
        }
        checkAndNotifyUpdate().catch(() => {});
      }
    });
    return () => {
      stopRealtimeTransactionNotifications();
    };
  }, []);

  useEffect(() => {
    if (!ready || !showSplash) return;
    const elapsed = Date.now() - mountTimeRef.current;
    const minDuration = 2650;
    const remaining = Math.max(0, minDuration - elapsed);

    const exitTimer = setTimeout(() => {
      setSplashExiting(true);
    }, remaining);

    const removeTimer = setTimeout(() => {
      setShowSplash(false);
      try {
        sessionStorage.setItem('lembayung_splash_done', '1');
      } catch {
        // ignore
      }
    }, remaining + 720);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [ready, showSplash]);

  useEffect(() => {
    const runAutoSync = async () => {
      if (!navigator.onLine) return;
      setIsAutoSyncing(true);
      await processSyncQueue();
      setIsAutoSyncing(false);
    };

    const verifyAndHandleInvalidOutlet = async (): Promise<boolean> => {
      const savedUid = localStorage.getItem(SESSION_KEY);
      if (!savedUid) return false;
      const savedUser = await db.users.get(savedUid);
      const outletCheck = await verifyActiveOutletInCloud(savedUser?.role);
      if (!outletCheck.valid) {
        unregisterFcmPushToken().catch(() => {});
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(REMEMBERED_USER_KEY);
        localStorage.removeItem(KASIR_MODE_KEY);
        await db.syncQueue.clear().catch(() => {});
        if (outletCheck.reason === 'not_found') {
          await db.settings.clear().catch(() => {});
          await db.users.clear().catch(() => {});
        }
        setKasirModeActive(false);
        setCurrentUserId(null);
        alert(
          outletCheck.reason === 'deactivated'
            ? `Cabang (${outletCheck.outletId}) sedang dinonaktifkan oleh Owner. Anda telah dikeluarkan otomatis.`
            : `ID Outlet toko Anda (${outletCheck.outletId}) telah diperbarui ke format standar baru (LM-AXXXXX) atau sudah dihapus. Silakan Login ulang menggunakan Email/Username Anda.`
        );
        return false;
      }
      return true;
    };

    const handleOnline = async () => {
      setIsOnline(true);
      const ok = await verifyAndHandleInvalidOutlet();
      if (!ok) return;
      setIsAutoSyncing(true);
      syncWithCloud()
        .catch(() => {})
        .finally(() => setIsAutoSyncing(false));
      startRealtimeTransactionNotifications();
      checkAndNotifyUpdate().catch(() => {});
    };
    const handleOffline = () => setIsOnline(false);

    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        const ok = await verifyAndHandleInvalidOutlet();
        if (!ok) return;
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
      if (!localStorage.getItem(SESSION_KEY)) return;
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

  const handleEnterKasirMode = () => {
    localStorage.setItem(KASIR_MODE_KEY, '1');
    setKasirModeActive(true);
  };

  const handleExitKasirMode = () => {
    localStorage.removeItem(KASIR_MODE_KEY);
    localStorage.removeItem(SESSION_KEY);
    setKasirModeActive(false);
    setCurrentUserId(null);
  };

  const handleFullLogout = () => {
    unregisterFcmPushToken().catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REMEMBERED_USER_KEY);
    localStorage.removeItem(KASIR_MODE_KEY);
    viewHistoryRef.current = [];
    setKasirModeActive(false);
    setCurrentUserId(null);
  };

  useEffect(() => {
    if (currentUser && navigator.onLine) {
      initDeviceNotifications().catch(() => {});
      registerFcmPushForUser(currentUser).catch(() => {});
      startRealtimeTransactionNotifications();
    }
  }, [currentUser?.id, settings?.outletId, isOnline]);

  // Muat daftar cabang milik Owner di Aplikasi Android agar Owner bisa pantau & pindah cabang langsung dari HP
  useEffect(() => {
    if (isWebPortal || !currentUser || currentUser.role !== 'owner') {
      setOwnerBranches([]);
      return;
    }
    fetchOwnerBranches(currentUser)
      .then((list) => setOwnerBranches(list))
      .catch(() => {});
  }, [isWebPortal, currentUser?.id, currentUser?.role, settings?.outletId, isOnline]);

  const handleNativeBranchSwitch = async (targetOutletId: string) => {
    const cleanTarget = targetOutletId.trim().toUpperCase();
    const currentOid = (settings?.outletId || '').trim().toUpperCase();
    if (!cleanTarget || cleanTarget === currentOid) return;
    if (!navigator.onLine) {
      alert('Pindah cabang memerlukan koneksi internet.');
      return;
    }
    setSwitchingBranch(true);
    try {
      const res = await switchActiveBranch(cleanTarget);
      if (!res.success) {
        alert(res.message);
      }
    } finally {
      setSwitchingBranch(false);
    }
  };

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get('s');
    if (queryToken) {
      fetchPublicReceiptFromQuery(window.location.search)
        .then((res) => {
          if (res) setPublicReceipt(res);
        })
        .finally(() => setLoadingQueryReceipt(false));
    }
    const handleHashChange = () => {
      setPublicReceipt(decodeReceiptFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (hasSelfOrderQuery) {
    return <PublicSelfOrderView />;
  }

  if (loadingQueryReceipt) {
    return (
      <div className="min-h-screen bg-[#faf9f5] flex items-center justify-center text-sm text-[#6b6a68]">
        Memuat struk digital...
      </div>
    );
  }

  if (publicReceipt) {
    return (
      <PublicReceiptView
        receipt={publicReceipt}
        onCloseToApp={() => {
          if (window.location.search.includes('s=')) {
            window.history.replaceState({}, '', window.location.pathname);
          }
          window.location.hash = '';
          setPublicReceipt(null);
        }}
      />
    );
  }

  if (!ready) {
    return <LembayungSplash exiting={false} />;
  }

  const splashOverlay = showSplash ? <LembayungSplash exiting={splashExiting} /> : null;

  // ============================================================================
  // MODE WEBSITE BACKOFFICE (KHUSUS OWNER & MANAGER — TANPA MENU KASIR)
  // ============================================================================
  if (isWebPortal) {
    if (!currentUser || !currentUser.active || currentUser.role === 'kasir') {
      return (
        <>
          {splashOverlay}
          <WebLoginPage onLoginSuccess={handleLogin} />
        </>
      );
    }
    return (
      <>
        {splashOverlay}
        <WebDashboardShell
          user={currentUser}
          isOnline={isOnline}
          isAutoSyncing={isAutoSyncing}
          pendingSyncCount={pendingSyncCount}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          onLogout={handleFullLogout}
        />
      </>
    );
  }

  if (!currentUser || !currentUser.active) {
    if (kasirModeActive) {
      return (
        <>
          {splashOverlay}
          <KasirStandbyScreen
            onCashierIdentified={handleLogin}
            onExitKasirMode={handleExitKasirMode}
          />
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
        </>
      );
    }

    return (
      <div className="min-h-screen bg-[#faf9f5] safe-frame flex justify-center items-center relative">
        {splashOverlay}
        <button
          type="button"
          onClick={toggleDarkMode}
          title={darkMode ? 'Mode Terang' : 'Mode Gelap'}
          className="fixed top-9 right-4 z-20 w-10 h-10 rounded-full bg-white border border-[#e2e0d8] flex items-center justify-center text-[#4a4947] shadow-xs"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="w-full max-w-[440px]">
          <LoginPage
            onLoginSuccess={handleLogin}
            onEnterKasirMode={handleEnterKasirMode}
          />
        </div>
      {backExitToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#18181B]/95 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
          Tekan kembali sekali lagi untuk keluar
        </div>
      )}

      {showAttendanceKiosk && (
        <AttendanceKioskModal onClose={() => setShowAttendanceKiosk(false)} />
      )}

      {showSelfOrderShare && (
        <SelfOrderShareModal
          settings={settings}
          onClose={() => setShowSelfOrderShare(false)}
        />
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
  const isManagerOrOwner = currentUser.role === 'owner' || currentUser.role === 'manager';

  // Khusus Kasir: wajib Absen Masuk (Selfie) dulu sebelum Buka Kasir (hanya jika belum ada shift kasir terbuka)
  if (!isManagerOrOwner && !activeCashierShift && activeUserAttendance === null) {
    return (
      <>
        {splashOverlay}
        <div className="min-h-[100dvh] bg-[#faf9f5] safe-frame">
          <AttendanceKioskModal
            preselectedUser={currentUser}
            mandatoryClockIn
            onSwitchUser={handleLockToPin}
          />
        </div>
      </>
    );
  }

  // Khusus Kasir: wajib Buka Kasir (hitung & input uang modal awal) sebelum masuk ke halaman Kasir
  if (!isManagerOrOwner && !activeCashierShift) {
    return (
      <>
        {splashOverlay}
        <OpenShiftScreen
          user={currentUser}
          namaUsaha={settings?.namaUsaha}
          onOpened={() => setActiveView('kasir')}
          onSwitchUser={handleLockToPin}
        />
      </>
    );
  }

  const safeView: ActiveView = (() => {
    if (isManagerOrOwner) return activeView;
    if (activeView === 'kasir' || activeView === 'riwayat') return activeView;
    if (activeView === 'pengeluaran' && currentUser.canRecordExpense) return activeView;
    return 'kasir';
  })();

  const isLaporanGroup =
    safeView === 'laporan' ||
    safeView === 'pengeluaran' ||
    safeView === 'riwayat' ||
    safeView === 'target' ||
    safeView === 'absensi' ||
    safeView === 'cabang' ||
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
      <Wifi size={14} className={isAutoSyncing ? 'animate-pulse' : ''} />
    </span>
  ) : (
    <span
      title={`Offline (${pendingSyncCount} antrean)`}
      className="inline-flex items-center gap-1 text-[#dc2626]"
    >
      <WifiOff size={14} />
      {pendingSyncCount > 0 && (
        <span className="text-[10px] font-bold">{pendingSyncCount}</span>
      )}
    </span>
  );

  const openCashierShiftForStatus = useLiveQuery(() =>
    db.cashierShifts.where('status').equals('open').first()
  );
  const storeOpenState = evaluateStoreOpenStatus({
    hasOpenShift: Boolean(openCashierShiftForStatus),
    activeCashierName: openCashierShiftForStatus?.kasirNama,
    shiftOpenedAt: openCashierShiftForStatus?.waktuBuka,
    hoursConfig: {
      autoStoreHoursEnabled: settings?.autoStoreHoursEnabled,
      storeOpenTime: settings?.storeOpenTime,
      storeCloseTime: settings?.storeCloseTime,
      storeManualOverride: settings?.storeManualOverride,
    },
  });

  const handleToggleStoreByOwner = async () => {
    if (!currentUser || currentUser.role !== 'owner' || togglingOwnerStore) return;
    setTogglingOwnerStore(true);
    try {
      await toggleStoreOpenByOwner({
        targetOpen: !storeOpenState.isStoreOpen,
        owner: currentUser,
      });
    } finally {
      setTogglingOwnerStore(false);
    }
  };

  return (
    <div className="h-[100dvh] w-full max-w-full bg-[#faf9f5] safe-frame flex flex-col md:flex-row overflow-hidden">
      {splashOverlay}
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
                POS &amp; HPP
              </div>
            </div>
          </div>

          {/* Branch Switcher di Sidebar Tablet (Khusus Owner > 1 Cabang) */}
          {isOwner && ownerBranches.length > 1 && (
            <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-2 flex flex-col gap-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6b6a68]">
                Cabang Aktif
              </div>
              <select
                value={(settings?.outletId || '').trim().toUpperCase()}
                disabled={switchingBranch}
                onChange={(e) => handleNativeBranchSwitch(e.target.value)}
                className="w-full h-8 rounded-lg border border-[#d6d3c8] bg-white px-2 text-xs font-semibold text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
              >
                {ownerBranches.map((b) => (
                  <option key={b.outletId} value={b.outletId}>
                    {b.namaCabang} ({b.outletId}) {b.isStoreOpen ? '• Buka' : '• Tutup'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status Toko & Akses Cepat QR Self-Order di Sidebar */}
          <div className="grid grid-cols-2 gap-1.5">
            {isOwner ? (
              <button
                type="button"
                disabled={togglingOwnerStore}
                onClick={handleToggleStoreByOwner}
                title="Klik untuk Buka / Tutup Toko langsung tanpa input modal uang"
                className={`h-8 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center gap-1 transition whitespace-nowrap ${
                  storeOpenState.isStoreOpen
                    ? 'border-[#c5dfd1] bg-[#e4f1ea] text-[#15803d] hover:bg-[#d5eadf]'
                    : 'border-[#f5c2bc] bg-[#fbe4e1] text-[#9b1c12] hover:bg-[#f7d0cb]'
                }`}
              >
                <Power size={12} />
                <span>{storeOpenState.isStoreOpen ? 'Toko Buka' : 'Toko Tutup'}</span>
              </button>
            ) : (
              <div
                className={`h-8 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap ${
                  storeOpenState.isStoreOpen
                    ? 'border-[#c5dfd1] bg-[#e4f1ea] text-[#15803d]'
                    : 'border-[#e2e0d8] bg-[#faf9f5] text-[#6b6a68]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    storeOpenState.isStoreOpen ? 'bg-[#16a34a]' : 'bg-[#9ca3af]'
                  }`}
                />
                <span>{storeOpenState.isStoreOpen ? 'Toko Buka' : 'Toko Tutup'}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowSelfOrderShare(true)}
              title="Bagikan QR & Link Self-Order / Delivery / Pesan Bareng"
              className="h-8 px-2 rounded-xl border border-[#c5dfd1] bg-[#f4f9f6] hover:bg-[#e4f1ea] text-[#1F7A5A] text-[11px] font-semibold flex items-center justify-center gap-1 transition whitespace-nowrap"
            >
              <QrCode size={12} />
              <span>QR Order</span>
            </button>
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
            {isManagerOrOwner && (
              <SidebarItem
                active={safeView === 'absensi'}
                onClick={() => setActiveView('absensi')}
                icon={<Clock size={17} />}
                label="Absensi Tim"
              />
            )}
            {isOwner && (
              <SidebarItem
                active={safeView === 'pengaturan' || safeView === 'cabang'}
                onClick={() => setActiveView('pengaturan')}
                icon={<Settings size={17} />}
                label="Cabang & Pengaturan"
              />
            )}
          </nav>
        </div>

        {/* Footer Sidebar (Status Cloud, Absen, Tutup Kasir, User, Dark Mode, Kunci PIN) */}
        <div className="p-3 border-t border-[#e2e0d8] flex flex-col gap-2 bg-[#faf9f5]">
          {!isOwner && (
            <button
              type="button"
              onClick={() => setShowAttendanceKiosk(true)}
              className="w-full h-9 rounded-xl bg-[#e4f1ea] hover:bg-[#d5eadf] text-[#1F7A5A] font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Clock size={13} /> Absen Karyawan
            </button>
          )}
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
                  {isOwner ? 'Owner' : currentUser.role === 'manager' ? 'Manager' : 'Kasir'}
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
      <div className="md:hidden bg-white border-b border-[#e2e0d8] px-2.5 sm:px-3.5 py-2 flex justify-between items-center gap-1.5 text-[11px] shrink-0 w-full max-w-full overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1 pr-1.5 border-r border-[#e2e0d8] min-w-0">
            <CuaninLogo size={20} />
            <span className="font-bold text-xs text-[#1f1e1d] truncate">
              {settings?.namaUsaha || 'POS'}
            </span>
            <span className="text-[10px] font-medium text-[#6b6a68] shrink-0">
              v{getInstalledAppVersion()}
            </span>
            {getAppEnvironment() === 'testing' && (
              <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-[#fbeed9] text-[#7a4300] shrink-0">
                TEST
              </span>
            )}
          </div>
          <div className="shrink-0">{syncStatusBadge}</div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {!isOwner && activeCashierShift ? (
            <button
              type="button"
              onClick={() => setShowCloseShiftModal(true)}
              className="px-2 py-1 rounded-full bg-[#fbe4e1] text-[#9b1c12] font-semibold text-[11px] shrink-0 whitespace-nowrap"
            >
              Tutup Kasir
            </button>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947] font-semibold max-w-[78px] sm:max-w-[120px] truncate">
              {currentUser.nama}
            </span>
          )}
          {!isOwner && (
            <button
              type="button"
              onClick={() => setShowAttendanceKiosk(true)}
              title="Absen Masuk / Pulang Karyawan"
              className="px-2 py-1 rounded-full bg-[#e4f1ea] text-[#1F7A5A] font-semibold text-[11px] flex items-center gap-1 shrink-0 whitespace-nowrap"
            >
              <Clock size={12} /> Absen
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              disabled={togglingOwnerStore}
              onClick={handleToggleStoreByOwner}
              title={storeOpenState.isStoreOpen ? 'Toko Buka (Klik untuk tutup)' : 'Toko Tutup (Klik untuk buka)'}
              className={`px-2 py-1 rounded-full font-semibold text-[10px] flex items-center gap-1 shrink-0 whitespace-nowrap border ${
                storeOpenState.isStoreOpen
                  ? 'border-[#c5dfd1] bg-[#e4f1ea] text-[#15803d]'
                  : 'border-[#f5c2bc] bg-[#fbe4e1] text-[#9b1c12]'
              }`}
            >
              <Power size={11} />
              <span>{storeOpenState.isStoreOpen ? 'Buka' : 'Tutup'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSelfOrderShare(true)}
            title="QR & Link Self-Order"
            className="p-1.5 rounded-md text-[#1F7A5A] hover:bg-[#e4f1ea] transition"
          >
            <QrCode size={15} />
          </button>
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
              title="Cabang & Pengaturan"
              className={`p-1.5 rounded-md transition ${
                safeView === 'pengaturan' || safeView === 'cabang'
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

      {/* Bar Pindah Cabang Cepat di HP (Khusus Owner yang memiliki > 1 cabang) */}
      {isOwner && ownerBranches.length > 1 && (
        <div className="md:hidden bg-[#faf9f5] border-b border-[#e2e0d8] px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4a4947] shrink-0">
            <Building2 size={13} className="text-[#1F7A5A]" />
            <span>Cabang:</span>
          </div>
          <select
            value={(settings?.outletId || '').trim().toUpperCase()}
            disabled={switchingBranch}
            onChange={(e) => handleNativeBranchSwitch(e.target.value)}
            className="flex-1 min-w-0 h-7 rounded-lg border border-[#d6d3c8] bg-white px-2 text-xs font-semibold text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A]"
          >
            {ownerBranches.map((b) => (
              <option key={b.outletId} value={b.outletId}>
                {b.namaCabang} ({b.outletId}) {b.isStoreOpen ? '• Buka' : '• Tutup'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ====================================================================
          AREA KONTEN UTAMA (FULL-WIDTH RESPONSIVE DI TABLET & HP)
         ==================================================================== */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {switchingBranch && (
          <div className="bg-[#e4f1ea] text-[#1F7A5A] text-xs font-semibold px-4 py-2 text-center border-b border-[#c5dfd1]">
            Memuat data cabang...
          </div>
        )}
        {safeView === 'kasir' && (
          <PosPage user={currentUser} onOpenHistory={() => setActiveView('riwayat')} />
        )}
        {safeView === 'resep' && isOwner && <RecipesMenuPage user={currentUser} />}
        {safeView === 'bahan' && isOwner && <IngredientsPage user={currentUser} />}
        {safeView === 'laporan' && isManagerOrOwner && (
          <ReportsPage
            onOpenExpenses={() => setActiveView('pengeluaran')}
            onOpenHistory={() => setActiveView('riwayat')}
            onOpenTargetBep={() => setActiveView('target')}
            onOpenAttendance={() => setActiveView('absensi')}
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
        {safeView === 'absensi' && isManagerOrOwner && (
          <AttendanceReportPage user={currentUser} onBack={() => setActiveView('laporan')} />
        )}
        {(safeView === 'pengaturan' || safeView === 'cabang') && isOwner && (
          <div className="flex flex-col">
            <div className="px-3.5 sm:px-5 pt-3 pb-1 flex items-center gap-1.5 max-w-[1200px] w-full mx-auto">
              <button
                type="button"
                onClick={() => setActiveView('pengaturan')}
                className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition ${
                  safeView === 'pengaturan'
                    ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                    : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                }`}
              >
                <Settings size={13} /> Pengaturan Outlet
              </button>
              <button
                type="button"
                onClick={() => setActiveView('cabang')}
                className={`h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition ${
                  safeView === 'cabang'
                    ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                    : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                }`}
              >
                <Building2 size={13} /> Daftar Cabang ({ownerBranches.length || 1})
              </button>
            </div>
            {safeView === 'cabang' ? (
              <div className="p-3.5 sm:p-5 max-w-[1200px] w-full mx-auto">
                <WebBranchesTeamPage
                  user={currentUser}
                  settings={settings}
                  branches={ownerBranches}
                  activeOutletId={(settings?.outletId || '').trim().toUpperCase()}
                  section="branches"
                  onBranchCreated={(b) => setOwnerBranches((prev) => [...prev, b])}
                  onBranchUpdated={(updated) =>
                    setOwnerBranches((prev) =>
                      prev.map((b) => (b.outletId === updated.outletId ? { ...b, ...updated } : b))
                    )
                  }
                  onBranchDeleted={async (deletedOid) => {
                    const remaining = ownerBranches.filter((b) => b.outletId !== deletedOid);
                    setOwnerBranches(remaining);
                    if ((settings?.outletId || '').trim().toUpperCase() === deletedOid && remaining.length > 0) {
                      const pusat = remaining.find((b) => !b.parentOutletId || b.parentOutletId === b.outletId) || remaining[0];
                      await switchActiveBranch(pusat.outletId);
                    }
                  }}
                  onOpenBranchSettings={async (oid) => {
                    await handleNativeBranchSwitch(oid);
                    setActiveView('pengaturan');
                  }}
                  onSelectBranch={handleNativeBranchSwitch}
                />
              </div>
            ) : (
              <SettingsPage
                user={currentUser}
                darkMode={darkMode}
                onToggleDarkMode={toggleDarkMode}
                onBack={() => setActiveView('laporan')}
                onLogout={handleFullLogout}
              />
            )}
          </div>
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
        ) : isManagerOrOwner ? (
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
            <TabButton
              active={safeView === 'absensi'}
              onClick={() => setActiveView('absensi')}
              icon={<Clock size={18} />}
              label="Absensi"
            />
            <TabButton
              active={safeView === 'laporan'}
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

      {showAttendanceKiosk && (
        <AttendanceKioskModal onClose={() => setShowAttendanceKiosk(false)} />
      )}

      {showSelfOrderShare && (
        <SelfOrderShareModal
          settings={settings}
          onClose={() => setShowSelfOrderShare(false)}
        />
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
