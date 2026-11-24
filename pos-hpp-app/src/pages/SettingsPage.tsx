import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db, hashPassword } from '../db/database';
import {
  addAuditLog,
  enqueueSync,
  resetOperationalData,
  updateSettings,
} from '../db/actions';
import {
  applyOtaBundleUpdate,
  checkForAppUpdate,
  deleteUserFromSupabase,
  getAppEnvironment,
  getInstalledAppVersion,
  getWebBackofficeUrl,
  markVersionInstalled,
  syncWithCloud,
} from '../services/syncService';
import {
  initDeviceNotifications,
  isNotificationsEnabled,
  sendDeviceNotification,
  setNotificationsEnabled,
} from '../services/notificationService';
import { validateEmail, validatePassword, validatePin } from '../lib/validation';
import {
  findDuplicatePinOwner,
  generateStrongPassword,
  generateUniqueSixDigitPin,
  generateUniqueUsername,
  getDuplicatePinSet,
} from '../services/attendanceService';
import { checkEmailDuplicateInCloud, sendEmployeeCredentialsEmail } from '../services/authEmailService';
import { compressLogoFileToDataUrl } from '../lib/receipt';
import { CustomSelect } from '../components/CustomSelect';
import type { AppSettings, RoundingStep, User } from '../types/models';
import { AlertCircle, Check, Copy, LogOut, RotateCcw, Store, Trash2, Upload, X } from 'lucide-react';

const FALLBACK_SETTINGS: AppSettings = {
  id: 'global',
  namaUsaha: 'Lembayung',
  namaCabang: 'Pusat',
  alamatUsaha: '-',
  teleponUsaha: '',
  strukFooter: 'Terima kasih!',
  strukTampilkanKasir: true,
  strukTampilkanCatatanItem: true,
  strukTampilkanWaUsaha: true,
  defaultMarginPersen: 50,
  metodeHargaBahan: 'last',
  jumlahPembelianN: 5,
  pembulatanHarga: 500,
  ambangMepetBepPersen: 10,
  defaultKasirDiscount: false,
  defaultKasirRecordExpense: true,
  cloudSyncMode: 'supabase',
  outletId: '',
  lastBackupAt: '',
};

interface SettingsPageProps {
  user: User;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onBack: () => void;
  onLogout: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  user,
  darkMode,
  onToggleDarkMode,
  onBack,
  onLogout,
}) => {
  const rawSettings = useLiveQuery(() => db.settings.get('global'));
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  const categories = useLiveQuery(() => db.expenseCategories.toArray()) ?? [];

  // Modal Tambah/Atur User
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [uNama, setUNama] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uNoHp, setUNoHp] = useState('');
  const [uRole, setURole] = useState<'manager' | 'kasir'>('kasir');
  const [uPassword, setUPassword] = useState('');
  const [uPin, setUPin] = useState('');
  const [uCanDiscount, setUCanDiscount] = useState(false);
  const [uCanRecordExp, setUCanRecordExp] = useState(true);
  const [uActive, setUActive] = useState(true);
  const [createdCredModal, setCreatedCredModal] = useState<{
    title?: string;
    nama: string;
    role: 'manager' | 'kasir';
    username: string;
    pin: string;
    password?: string;
    email: string;
    emailSent: boolean;
    backofficeUrl?: string;
  } | null>(null);

  // Modal Profil Usaha & Pengaturan Struk (FR-SET-01)
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [pLogoUsaha, setPLogoUsaha] = useState<string | undefined>(undefined);
  const [pNamaUsaha, setPNamaUsaha] = useState('');
  const [pAlamat, setPAlamat] = useState('');
  const [pTelepon, setPTelepon] = useState('');
  const [pStrukHeader, setPStrukHeader] = useState('');
  const [pStrukFooter, setPStrukFooter] = useState('');
  const [pShowKasir, setPShowKasir] = useState(true);
  const [pShowNotes, setPShowNotes] = useState(true);
  const [pShowWa, setPShowWa] = useState(true);

  const [statusMessage, setStatusMessage] = useState('');
  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => isNotificationsEnabled());

  // Status Salin Kode Toko & Info Sinkronisasi
  const [copiedOutletCode, setCopiedOutletCode] = useState(false);
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // Tarik daftar pengguna & pengaturan terbaru dari Cloud saat membuka halaman Pengaturan
  useEffect(() => {
    db.settings
      .get('global')
      .then((existing) => {
        if (!existing) {
          return db.settings.put({
            ...FALLBACK_SETTINGS,
            ownerEmail: user.email || undefined,
          });
        }
      })
      .catch(() => {});

    if (navigator.onLine) {
      syncWithCloud().catch(() => {});
    }
  }, [user.email]);

  const settings: AppSettings = rawSettings ?? {
    ...FALLBACK_SETTINGS,
    ownerEmail: user.email || undefined,
  };

  const notify = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(''), 3500);
  };

  const toggleSetting = async (
    key: 'defaultKasirDiscount' | 'defaultKasirRecordExpense',
    val: boolean
  ) => {
    await updateSettings({ [key]: val }, user);
  };

  const handleToggleCategoryHpp = async (catId: string, currentVal: boolean) => {
    await db.expenseCategories.update(catId, { sudahMasukHpp: !currentVal });
    await addAuditLog(
      user,
      'UBAH_KATEGORI',
      catId,
      `Sudah masuk HPP = ${!currentVal ? 'Ya' : 'Tidak'}`
    );
    await enqueueSync('master', catId, 'upsert', { catId, sudahMasukHpp: !currentVal });
  };

  // Profil Usaha & Struk
  const openProfileModal = () => {
    setPLogoUsaha(settings.logoUsaha);
    setPNamaUsaha(settings.namaUsaha);
    setPAlamat(settings.alamatUsaha);
    setPTelepon(settings.teleponUsaha);
    setPStrukHeader(settings.strukHeader ?? '');
    setPStrukFooter(settings.strukFooter ?? 'Terima kasih!');
    setPShowKasir(settings.strukTampilkanKasir ?? true);
    setPShowNotes(settings.strukTampilkanCatatanItem ?? true);
    setPShowWa(settings.strukTampilkanWaUsaha ?? true);
    setShowProfileModal(true);
  };

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressLogoFileToDataUrl(file);
      setPLogoUsaha(dataUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal memuat logo usaha.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pNamaUsaha.trim()) return;
    await updateSettings(
      {
        logoUsaha: pLogoUsaha,
        namaUsaha: pNamaUsaha.trim(),
        alamatUsaha: pAlamat.trim() || '-',
        teleponUsaha: pTelepon.trim(),
        strukHeader: pStrukHeader.trim() || undefined,
        strukFooter: pStrukFooter.trim() || 'Terima kasih!',
        strukTampilkanKasir: pShowKasir,
        strukTampilkanCatatanItem: pShowNotes,
        strukTampilkanWaUsaha: pShowWa,
      },
      user
    );
    setShowProfileModal(false);
    notify('Profil usaha & pengaturan struk berhasil disimpan.');
  };

  // User Management
  const openAddUserModal = () => {
    setEditingUser(null);
    setUNama('');
    setUEmail('');
    setUNoHp('');
    setURole('kasir');
    setUPassword('');
    setUPin(generateUniqueSixDigitPin(users));
    setUCanDiscount(settings.defaultKasirDiscount);
    setUCanRecordExp(settings.defaultKasirRecordExpense);
    setUActive(true);
    setShowAddUser(true);
  };

  const openEditUserModal = (target: User) => {
    if (user.role === 'manager' && target.role !== 'kasir') {
      alert('Manager hanya dapat mengatur akun Kasir.');
      return;
    }
    setEditingUser(target);
    setUNama(target.nama);
    setUEmail(target.email ?? '');
    setUNoHp(target.noHp ?? '');
    setURole(target.role === 'manager' ? 'manager' : 'kasir');
    setUPassword('');
    setUPin(target.pin ?? '');
    setUCanDiscount(target.canDiscount);
    setUCanRecordExp(target.canRecordExpense);
    setUActive(target.active);
    setShowAddUser(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNama = uNama.trim();
    const cleanEmail = uEmail.trim().toLowerCase();
    const cleanNoHp = uNoHp.trim();
    if (!cleanNama) return;

    const allUsers = await db.users.toArray();
    const nowIso = new Date().toISOString();

    if (editingUser) {
      // Karyawan (Kasir / Manager): identitas, email, dan PIN DIKUNCI — hanya boleh ubah peran (Owner), hak akses, dan status aktif
      if (editingUser.role !== 'owner') {
        const targetRole: 'manager' | 'kasir' = user.role === 'owner' ? uRole : 'kasir';
        const isPromotedToManager = editingUser.role === 'kasir' && targetRole === 'manager';
        const promotedPassword = isPromotedToManager ? generateStrongPassword() : undefined;

        const patch: Partial<User> = {
          role: targetRole,
          canDiscount: targetRole === 'manager' ? true : uCanDiscount,
          canRecordExpense: targetRole === 'manager' ? true : uCanRecordExp,
          active: uActive,
          updatedAt: nowIso,
        };
        if (promotedPassword) {
          patch.passwordHash = await hashPassword(promotedPassword);
        }

        await db.users.update(editingUser.id, patch);
        await addAuditLog(
          user,
          isPromotedToManager ? 'PROMOSI_MANAGER' : 'UBAH_AKSES_PENGGUNA',
          editingUser.nama,
          `Role: ${targetRole} · Aktif: ${uActive}`
        );
        await enqueueSync('master', editingUser.id, 'upsert', { ...patch, isUser: true });

        if (isPromotedToManager && promotedPassword) {
          const backofficeUrl = getWebBackofficeUrl();
          let emailSent = false;
          if (navigator.onLine && editingUser.email) {
            const mailRes = await sendEmployeeCredentialsEmail({
              email: editingUser.email,
              nama: editingUser.nama,
              role: 'manager',
              username: editingUser.username,
              pin: editingUser.pin || '-',
              password: promotedPassword,
              namaUsaha: settings.namaUsaha || 'Lembayung',
              namaCabang: settings.namaCabang || 'Pusat',
              outletId: settings.outletId || '',
              backofficeUrl,
              reason: 'promoted_to_manager',
            }).catch(() => ({ success: false }));
            emailSent = Boolean(mailRes.success);
          }
          setShowAddUser(false);
          setCreatedCredModal({
            title: 'Promosi ke Manager Berhasil',
            nama: editingUser.nama,
            role: 'manager',
            username: editingUser.username,
            pin: editingUser.pin || '-',
            password: promotedPassword,
            email: editingUser.email || '-',
            emailSent,
            backofficeUrl,
          });
          return;
        }

        notify(`Hak akses & status ${editingUser.nama} diperbarui.`);
        setShowAddUser(false);
        return;
      }

      // Edit akun Owner sendiri (email tetap dikunci agar unik)
      const effectivePin = uPin.trim();
      const pinErr = validatePin(effectivePin);
      if (pinErr) {
        alert(pinErr);
        return;
      }
      const dupPinOwner = findDuplicatePinOwner(effectivePin, allUsers, editingUser.id);
      if (dupPinOwner) {
        alert(
          `PIN "${effectivePin}" sudah dipakai oleh ${dupPinOwner.nama}. Setiap akun wajib memiliki PIN 6 angka yang unik.`
        );
        return;
      }
      if (uPassword.trim()) {
        const passErr = validatePassword(uPassword);
        if (passErr) {
          alert(passErr);
          return;
        }
      }

      const patch: Partial<User> = {
        nama: cleanNama,
        pin: effectivePin,
        updatedAt: nowIso,
      };
      if (uPassword.trim()) {
        patch.passwordHash = await hashPassword(uPassword);
      }
      await db.users.update(editingUser.id, patch);
      await addAuditLog(user, 'UBAH_PENGGUNA', cleanNama, 'Pembaruan profil Owner');
      await enqueueSync('master', editingUser.id, 'upsert', { ...patch, isUser: true });
      notify(`Profil Owner ${cleanNama} disimpan.`);
      setShowAddUser(false);
      return;
    }

    const emailErr = validateEmail(cleanEmail);
    if (emailErr) {
      alert(emailErr);
      return;
    }
    const dupEmailLocal = allUsers.find(
      (u) => (u.email || '').trim().toLowerCase() === cleanEmail
    );
    if (dupEmailLocal) {
      alert(
        `Email "${cleanEmail}" sudah digunakan oleh ${dupEmailLocal.nama}. Setiap akun wajib menggunakan email yang berbeda.`
      );
      return;
    }
    const dupEmailCloud = await checkEmailDuplicateInCloud(cleanEmail);
    if (dupEmailCloud) {
      alert(dupEmailCloud);
      return;
    }
    if (cleanNoHp.replace(/\D/g, '').length < 9) {
      alert('Nomor WhatsApp / HP wajib diisi (minimal 9 angka).');
      return;
    }

    const newRole: 'manager' | 'kasir' = user.role === 'owner' ? uRole : 'kasir';
    const generatedUsername = generateUniqueUsername(cleanNama, allUsers);
    const generatedPin = generateUniqueSixDigitPin(allUsers);
    const generatedPassword = newRole === 'manager' ? generateStrongPassword() : undefined;
    const hash = generatedPassword ? await hashPassword(generatedPassword) : '';

    const newUserId = uuidv4();
    await db.users.add({
      id: newUserId,
      nama: cleanNama,
      username: generatedUsername,
      email: cleanEmail,
      noHp: cleanNoHp,
      passwordHash: hash,
      pin: generatedPin,
      role: newRole,
      canDiscount: newRole === 'manager' ? true : uCanDiscount,
      canRecordExpense: newRole === 'manager' ? true : uCanRecordExp,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await addAuditLog(user, 'TAMBAH_PENGGUNA', cleanNama, `Role: ${newRole} · ${cleanEmail}`);
    sendDeviceNotification({
      title: `Pengguna Baru: ${cleanNama}`,
      body: `${newRole === 'manager' ? 'Manager' : 'Kasir'} baru (${generatedUsername}) ditambahkan oleh ${user.nama}`,
      dedupKey: `user-add-${newUserId}`,
    });
    await enqueueSync('master', newUserId, 'upsert', { id: newUserId, isUser: true });

    const backofficeUrl = getWebBackofficeUrl();
    let emailSent = false;
    if (navigator.onLine) {
      const mailRes = await sendEmployeeCredentialsEmail({
        email: cleanEmail,
        nama: cleanNama,
        role: newRole,
        username: generatedUsername,
        pin: generatedPin,
        password: generatedPassword,
        namaUsaha: settings.namaUsaha || 'Lembayung',
        namaCabang: settings.namaCabang || 'Pusat',
        outletId: settings.outletId || '',
        backofficeUrl,
        reason: 'new',
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    setShowAddUser(false);
    if (user.role === 'owner') {
      setCreatedCredModal({
        title: 'Karyawan Berhasil Didaftarkan',
        nama: cleanNama,
        role: newRole,
        username: generatedUsername,
        pin: generatedPin,
        password: generatedPassword,
        email: cleanEmail,
        emailSent,
        backofficeUrl: newRole === 'manager' ? backofficeUrl : undefined,
      });
    } else {
      notify(
        emailSent
          ? `${cleanNama} berhasil ditambahkan. Username & PIN dikirim ke ${cleanEmail}.`
          : `${cleanNama} berhasil ditambahkan.`
      );
    }
  };

  const handleResetManagerPassword = async (target: User) => {
    if (user.role !== 'owner' || target.role !== 'manager') return;
    if (!confirm(`Reset kata sandi Manager "${target.nama}" dan buat kata sandi acak baru?`)) return;
    const newPassword = generateStrongPassword();
    const passwordHash = await hashPassword(newPassword);
    const nowIso = new Date().toISOString();
    await db.users.update(target.id, { passwordHash, updatedAt: nowIso });
    await addAuditLog(user, 'RESET_PASSWORD_MANAGER', target.nama, 'Kata sandi Manager di-reset otomatis');
    await enqueueSync('master', target.id, 'upsert', { passwordHash, updatedAt: nowIso, isUser: true });

    const backofficeUrl = getWebBackofficeUrl();
    let emailSent = false;
    if (navigator.onLine && target.email) {
      const mailRes = await sendEmployeeCredentialsEmail({
        email: target.email,
        nama: target.nama,
        role: 'manager',
        username: target.username,
        pin: target.pin || '-',
        password: newPassword,
        namaUsaha: settings.namaUsaha || 'Lembayung',
        namaCabang: settings.namaCabang || 'Pusat',
        outletId: settings.outletId || '',
        backofficeUrl,
        reason: 'password_reset',
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    setShowAddUser(false);
    setCreatedCredModal({
      title: 'Kata Sandi Manager Di-reset',
      nama: target.nama,
      role: 'manager',
      username: target.username,
      pin: target.pin || '-',
      password: newPassword,
      email: target.email || '-',
      emailSent,
      backofficeUrl,
    });
  };

  const canDeleteUser = (target: User): boolean => {
    if (target.id === user.id) return false;
    if (user.role === 'manager') {
      return target.role === 'kasir';
    }
    if (user.role !== 'owner') return false;
    if (target.role === 'owner') {
      const ownerCount = users.filter((u) => u.role === 'owner').length;
      if (ownerCount <= 1) return false;
    }
    return true;
  };

  const handleDeleteUser = async (target: User) => {
    if (!canDeleteUser(target)) {
      alert('Akun Owner utama atau akun yang sedang login tidak dapat dihapus.');
      return;
    }
    if (
      !confirm(
        `Hapus pengguna "${target.nama}" (${target.username}) secara permanen?\n\nAkun ini tidak akan bisa login lagi, namun riwayat transaksi dan laporan lama tetap tersimpan utuh.`
      )
    ) {
      return;
    }

    await db.users.delete(target.id);
    await addAuditLog(user, 'HAPUS_PENGGUNA', target.nama, `Username: ${target.username}`);
    sendDeviceNotification({
      title: `Pengguna Dihapus: ${target.nama}`,
      body: `Akun ${target.username} dihapus oleh ${user.nama}`,
      dedupKey: `user-del-${target.id}`,
    });

    // Hapus langsung dari Supabase jika online; jika offline, antrekan ke syncQueue
    const cloudRes = await deleteUserFromSupabase(target.id);
    if (!cloudRes.success) {
      await enqueueSync('master', target.id, 'delete', { table: 'users', id: target.id });
    }

    if (editingUser?.id === target.id) {
      setShowAddUser(false);
      setEditingUser(null);
    }
    notify(
      cloudRes.success
        ? `Pengguna "${target.nama}" dihapus dari perangkat & Cloud (${cloudRes.outletId}).`
        : `Pengguna "${target.nama}" dihapus lokal (Cloud menunggu sinkron: ${cloudRes.error || 'offline'}).`
    );
  };

  const handleCopyOutletCode = async () => {
    const code = settings.outletId || 'CUAN-8899';
    try {
      await navigator.clipboard?.writeText(code);
      setCopiedOutletCode(true);
      notify(`Kode Toko ${code} disalin.`);
      setTimeout(() => setCopiedOutletCode(false), 2000);
    } catch {
      alert(`Kode Toko Anda: ${code}`);
    }
  };

  const handleCheckUpdateManual = async () => {
    setSyncLoading(true);
    try {
      const info = await checkForAppUpdate();
      if (!info) {
        alert('Tidak dapat memeriksa pembaruan. Pastikan perangkat terhubung ke internet lalu coba lagi.');
        return;
      }
      if (info.hasUpdate) {
        if (info.bundleZipUrl) {
          if (
            confirm(
              `Pembaruan Lembayung v${info.latestVersion} tersedia!\n\nApa yang baru:\n${info.releaseNotes}\n\nPasang pembaruan sekarang?`
            )
          ) {
            const res = await applyOtaBundleUpdate(info.bundleZipUrl, info.latestVersion);
            if (!res.success) alert(res.message);
          }
        } else if (
          confirm(
            `Pembaruan Lembayung v${info.latestVersion} tersedia!\n\nApa yang baru:\n${info.releaseNotes}\n\nUnduh versi terbaru sekarang?`
          )
        ) {
          markVersionInstalled(info.latestVersion);
          if (info.downloadUrl) window.open(info.downloadUrl, '_blank', 'noopener,noreferrer');
        }
      } else {
        alert(`Aplikasi Lembayung Anda sudah versi terbaru (v${getInstalledAppVersion()}).`);
      }
    } finally {
      setSyncLoading(false);
    }
  };

  const handleResetDemo = async () => {
    if (
      !confirm(
        'Bersihkan seluruh data bahan, resep, menu, transaksi, dan pengeluaran agar mulai dari kosong? Akun pengguna & profil usaha tetap dipertahankan.'
      )
    ) {
      return;
    }
    await resetOperationalData(user);
    notify('Seluruh data operasional berhasil dibersihkan.');
  };

  const isNativeApp = Capacitor.isNativePlatform();

  return (
    <div className="px-3.5 sm:px-5 pt-4 sm:pt-5 pb-8 flex flex-col gap-3 w-full max-w-full overflow-x-hidden">
      {isNativeApp && (
        <div className="flex justify-between items-center gap-2">
          <div>
            <h1 className="text-[22px] font-bold">Pengaturan</h1>
            <div className="text-xs text-[#6b6a68]">Hanya Owner</div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-3.5 rounded-full border border-[#d6d3c8] bg-white text-[13px] font-medium"
          >
            ‹ Kembali
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="bg-[#e4f1ea] border border-[#c5dfd1] text-[#1F7A5A] text-xs font-semibold px-3.5 py-2.5 rounded-xl">
          {statusMessage}
        </div>
      )}

      {/* Tampilan & Notifikasi (Khusus Aplikasi Perangkat) */}
      {isNativeApp && (
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#4a4947] mt-1">
            Tampilan &amp; Notifikasi
          </div>
          <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
            <div className="px-3.5 py-3 flex justify-between items-center gap-3">
              <div>
                <div className="font-medium text-sm">Mode Gelap (Dark Mode)</div>
                <div className="text-xs text-[#6b6a68]">
                  {darkMode ? 'Aktif · nyaman untuk mata di tempat redup' : 'Nonaktif · menggunakan tema terang'}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleDarkMode}
                className={`w-11 h-[26px] rounded-full relative transition shrink-0 ${
                  darkMode ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
                }`}
              >
                <span
                  className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                    darkMode ? 'right-[3px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>

            <div className="px-3.5 py-3 flex justify-between items-center gap-3">
              <div>
                <div className="font-medium text-sm">Notifikasi Transaksi ke Perangkat</div>
                <div className="text-xs text-[#6b6a68]">
                  Bunyi &amp; pop-up saat ada penjualan, void, belanja bahan, atau pengeluaran
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {notifEnabled && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await initDeviceNotifications();
                      if (!ok) {
                        alert('Izin notifikasi belum diberikan. Mohon aktifkan izin notifikasi untuk Lembayung di pengaturan HP/Tab.');
                        return;
                      }
                      await sendDeviceNotification({
                        title: 'Tes Notifikasi Lembayung',
                        body: 'Notifikasi transaksi perangkat sudah aktif dan siap digunakan!',
                      });
                    }}
                    className="text-[11px] font-semibold text-[#1F7A5A] bg-[#e4f1ea] px-2.5 py-1 rounded-full"
                  >
                    Tes
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const next = !notifEnabled;
                    setNotificationsEnabled(next);
                    setNotifEnabled(next);
                    if (next) {
                      await initDeviceNotifications();
                      notify('Notifikasi transaksi diaktifkan.');
                    } else {
                      notify('Notifikasi transaksi dimatikan.');
                    }
                  }}
                  className={`w-11 h-[26px] rounded-full relative transition shrink-0 ${
                    notifEnabled ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                      notifEnabled ? 'right-[3px]' : 'left-[3px]'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Profil Usaha & Pengaturan Struk (FR-SET-01) */}
      <div className="text-xs font-semibold uppercase tracking-wide text-[#4a4947] mt-1">
        Profil Usaha &amp; Pengaturan Struk
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-2.5">
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center shrink-0 overflow-hidden border border-[#c5dfd1]">
              {settings.logoUsaha ? (
                <img
                  src={settings.logoUsaha}
                  alt="Logo Usaha"
                  className="w-full h-full object-contain p-0.5 bg-white"
                />
              ) : (
                <Store size={18} />
              )}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{settings.namaUsaha}</div>
              <div className="text-xs text-[#6b6a68] truncate">{settings.alamatUsaha}</div>
              {settings.teleponUsaha && (
                <div className="text-xs text-[#6b6a68]">WA: {settings.teleponUsaha}</div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={openProfileModal}
            className="h-8 px-3 rounded-full bg-[#e4f1ea] text-[12px] font-semibold text-[#1F7A5A] shrink-0"
          >
            Atur Struk
          </button>
        </div>
        <div className="border-t border-[#eeece5] pt-2 text-xs text-[#6b6a68] flex flex-col gap-0.5">
          <div>
            Header: <span className="text-[#1f1e1d]">{settings.strukHeader || '(Tidak ada)'}</span>
          </div>
          <div>
            Footer: <span className="text-[#1f1e1d]">{settings.strukFooter || 'Terima kasih!'}</span>
          </div>
        </div>
      </div>

      {/* Harga dan HPP */}
      <div className="text-xs font-semibold uppercase tracking-wide text-[#4a4947] mt-1">
        Harga dan HPP
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
        <div className="px-3.5 py-3 flex justify-between items-center">
          <span className="font-medium text-sm">Margin default (%)</span>
          <input
            type="number"
            min="0"
            max="95"
            value={settings.defaultMarginPersen}
            onChange={(e) =>
              updateSettings({ defaultMarginPersen: Number(e.target.value) || 0 }, user)
            }
            className="w-16 h-9 text-center font-semibold text-[#1F7A5A] border border-[#d6d3c8] rounded-lg text-sm"
          />
        </div>

        <div className="px-3.5 py-3 flex flex-col gap-2.5">
          <span className="font-medium text-sm">Metode harga bahan</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => updateSettings({ metodeHargaBahan: 'last' }, user)}
              className={`h-8 px-3 rounded-full text-[13px] font-medium border ${
                settings.metodeHargaBahan === 'last'
                  ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                  : 'bg-white border-[#d6d3c8]'
              }`}
            >
              Harga terakhir
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ metodeHargaBahan: 'weighted_avg' }, user)}
              className={`h-8 px-3 rounded-full text-[13px] font-medium border ${
                settings.metodeHargaBahan === 'weighted_avg'
                  ? 'bg-[#1F7A5A] border-[#1F7A5A] text-white'
                  : 'bg-white border-[#d6d3c8]'
              }`}
            >
              Rata-rata N
            </button>
          </div>
          {settings.metodeHargaBahan === 'weighted_avg' && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-[#6b6a68]">Jumlah pembelian (N)</span>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.jumlahPembelianN}
                onChange={(e) =>
                  updateSettings({ jumlahPembelianN: Math.max(1, Number(e.target.value) || 5) }, user)
                }
                className="w-16 h-9 text-center font-semibold border border-[#d6d3c8] rounded-lg text-sm"
              />
            </div>
          )}
        </div>

        <div className="px-3.5 py-3 flex justify-between items-center gap-3">
          <span className="font-medium text-sm">Pembulatan harga saran</span>
          <div className="w-40 shrink-0">
            <CustomSelect
              value={String(settings.pembulatanHarga)}
              className="h-9 text-xs font-semibold text-[#1F7A5A]"
              onChange={(val) =>
                updateSettings({ pembulatanHarga: Number(val) as RoundingStep }, user)
              }
              options={[
                { value: '500', label: 'Ke atas Rp500' },
                { value: '1000', label: 'Ke atas Rp1.000' },
              ]}
            />
          </div>
        </div>

        <div className="px-3.5 py-3 flex justify-between items-center">
          <span className="font-medium text-sm">Ambang “Mepet BEP” (%)</span>
          <input
            type="number"
            min="1"
            max="50"
            value={settings.ambangMepetBepPersen}
            onChange={(e) =>
              updateSettings({ ambangMepetBepPersen: Number(e.target.value) || 10 }, user)
            }
            className="w-16 h-9 text-center font-semibold text-[#1F7A5A] border border-[#d6d3c8] rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Kategori Pengeluaran & Anti Hitung Ganda */}
      <div className="text-xs font-semibold uppercase tracking-wide text-[#4a4947] mt-1">
        Kategori Pengeluaran (Anti Hitung Ganda)
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
        {categories.map((cat) => (
          <div key={cat.id} className="px-3.5 py-2.5 flex justify-between items-center gap-2">
            <div>
              <div className="font-medium text-sm">{cat.nama}</div>
              <div className="text-xs text-[#6b6a68]">
                {cat.sudahMasukHpp
                  ? 'Sudah masuk HPP (tidak kurangi laba lagi)'
                  : 'Biaya operasional (mengurangi laba bersih)'}
              </div>
            </div>
            <button
              type="button"
              disabled={cat.isSystem}
              onClick={() => handleToggleCategoryHpp(cat.id, cat.sudahMasukHpp)}
              className={`w-11 h-[26px] rounded-full relative transition shrink-0 ${
                cat.sudahMasukHpp ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
              } ${cat.isSystem ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span
                className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                  cat.sudahMasukHpp ? 'right-[3px]' : 'left-[3px]'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      {/* Izin Kasir Default */}
      <div className="text-xs font-semibold uppercase tracking-wide text-[#4a4947] mt-1">
        Izin Kasir (default untuk kasir baru)
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
        <div className="px-3.5 py-3 flex justify-between items-center gap-3">
          <div>
            <div className="font-medium text-sm">Boleh memberi diskon</div>
            <div className="text-xs text-[#6b6a68]">Default tidak diizinkan</div>
          </div>
          <button
            type="button"
            onClick={() => toggleSetting('defaultKasirDiscount', !settings.defaultKasirDiscount)}
            className={`w-11 h-[26px] rounded-full relative transition shrink-0 ${
              settings.defaultKasirDiscount ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
            }`}
          >
            <span
              className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                settings.defaultKasirDiscount ? 'right-[3px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>
        <div className="px-3.5 py-3 flex justify-between items-center gap-3">
          <div>
            <div className="font-medium text-sm">Boleh catat pembelian &amp; pengeluaran</div>
            <div className="text-xs text-[#6b6a68]">Tidak membuka HPP, laba, atau laporan</div>
          </div>
          <button
            type="button"
            onClick={() =>
              toggleSetting('defaultKasirRecordExpense', !settings.defaultKasirRecordExpense)
            }
            className={`w-11 h-[26px] rounded-full relative transition shrink-0 ${
              settings.defaultKasirRecordExpense ? 'bg-[#1F7A5A]' : 'bg-[#cfcbbf]'
            }`}
          >
            <span
              className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${
                settings.defaultKasirRecordExpense ? 'right-[3px]' : 'left-[3px]'
              }`}
            />
          </button>
        </div>

        {/* PIN Otorisasi Kasir (Masuk Mode Kasir & Hapus Open Bill) */}
        <div className="px-3.5 py-3 flex flex-col gap-2">
          <div className="flex justify-between items-center gap-2">
            <div>
              <div className="font-medium text-sm">PIN Otorisasi Mode Kasir (6 Angka)</div>
              <div className="text-xs text-[#6b6a68]">
                Khusus outlet <strong>{settings.outletId || 'ini'}</strong> · Dipakai untuk masuk Mode Kasir &amp; hapus pesanan tersimpan (Open Bill)
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const generated = generateUniqueSixDigitPin(users);
                await updateSettings({ kasirAuthPin: generated }, user);
                notify(`PIN Otorisasi Mode Kasir berhasil di-reset: ${generated}`);
              }}
              className="text-xs font-semibold text-[#1F7A5A] bg-[#e4f1ea] px-2.5 py-1.5 rounded-lg shrink-0 whitespace-nowrap"
            >
              Reset / Acak PIN
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              defaultValue={settings.kasirAuthPin || ''}
              key={settings.kasirAuthPin || 'empty-auth-pin'}
              placeholder="Contoh: 889900"
              onBlur={async (e) => {
                const val = e.target.value.replace(/\D/g, '').trim();
                if (!val || val === (settings.kasirAuthPin || '')) return;
                const pinErr = validatePin(val);
                if (pinErr) {
                  alert(pinErr);
                  e.target.value = settings.kasirAuthPin || '';
                  return;
                }
                const dup = findDuplicatePinOwner(val, users);
                if (dup) {
                  alert(`PIN "${val}" sudah dipakai oleh akun ${dup.nama}. Gunakan 6 angka lain.`);
                  e.target.value = settings.kasirAuthPin || '';
                  return;
                }
                await updateSettings({ kasirAuthPin: val }, user);
                notify('PIN Otorisasi Mode Kasir berhasil disimpan.');
              }}
              className="flex-1 h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm font-bold tracking-[0.25em] text-[#1F7A5A]"
            />
          </div>
        </div>
      </div>

      {/* Pengguna (di Website sudah ada menu khusus Cabang & Tim) */}
      {isNativeApp && (
        <>
          <div className="flex justify-between items-center mt-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4a4947]">Pengguna</span>
            <button
              type="button"
              onClick={openAddUserModal}
              className="text-[13px] font-semibold text-[#1F7A5A]"
            >
              + Tambah pengguna
            </button>
          </div>
          <div className="bg-white border border-[#e2e0d8] rounded-xl overflow-hidden divide-y divide-[#eeece5]">
            {(() => {
              const dupPins = getDuplicatePinSet(users);
              return users.map((u) => {
                const hasDupPin = Boolean(u.active && u.pin && dupPins.has(u.pin.trim()));
                return (
                  <div key={u.id} className="px-3.5 py-3 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <div className={`font-semibold text-sm flex items-center gap-1.5 flex-wrap ${!u.active ? 'text-[#6b6a68]' : ''}`}>
                        {u.nama}
                        {u.role === 'owner' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1F7A5A] text-white">
                            Owner
                          </span>
                        )}
                        {u.role === 'manager' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#e0e7ff] text-[#3730a3]">
                            Manager
                          </span>
                        )}
                        {u.pin && !hasDupPin && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#e4f1ea] text-[#1F7A5A] font-mono">
                            {user.role === 'owner' ? `PIN: ${u.pin}` : 'PIN Aktif'}
                          </span>
                        )}
                        {hasDupPin && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#fbeed9] text-[#7a4300]">
                            {user.role === 'owner' ? `PIN Duplikat (${u.pin})` : 'PIN Duplikat'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#6b6a68]">
                        {u.role === 'owner'
                          ? 'Akses penuh seluruh cabang'
                          : u.role === 'manager'
                          ? `Manager · akses laporan, void, resep & tim kasir${u.email ? ` · ${u.email}` : ''}`
                          : !u.active
                          ? 'Kasir · nonaktif, riwayat tetap utuh'
                          : `Kasir · diskon ${u.canDiscount ? 'aktif' : 'nonaktif'} · pembelian ${
                              u.canRecordExpense ? 'aktif' : 'nonaktif'
                            }`}
                      </div>
                      {hasDupPin && (
                        <button
                          type="button"
                          onClick={async () => {
                            const newPin = generateUniqueSixDigitPin(users);
                            const nowIso = new Date().toISOString();
                            await db.users.update(u.id, { pin: newPin, updatedAt: nowIso });
                            await addAuditLog(user, 'UBAH_PIN', u.nama, 'Acak PIN unik baru (atasi duplikat)');
                            await enqueueSync('master', u.id, 'upsert', { id: u.id, pin: newPin, isUser: true });
                            notify(`PIN baru untuk ${u.nama}: ${newPin}`);
                          }}
                          className="mt-1.5 text-[11px] font-semibold text-[#7a4300] bg-[#fbeed9] hover:bg-[#f6dfb9] px-2.5 py-1 rounded-lg"
                        >
                          Acak PIN Baru
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditUserModal(u)}
                        className="text-[13px] font-semibold text-[#1F7A5A]"
                      >
                        Atur
                      </button>
                      {canDeleteUser(u) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          title={`Hapus ${u.nama}`}
                          className="p-1.5 rounded-lg text-[#9b1c12] hover:bg-[#fbe4e1] transition"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}

      {/* Data, Backup & Reset */}
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#4a4947]">
          {isNativeApp ? 'Kode Toko & Sinkronisasi Cloud' : 'Kode Toko Perangkat Kasir'}
        </span>
        {isNativeApp && getAppEnvironment() === 'testing' && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#fbeed9] text-[#7a4300]">
            ENV: TESTING
          </span>
        )}
      </div>
      <div className="bg-white border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-3">
        <div className="flex justify-between items-center gap-2 bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#1f4d3a]">
              Kode Toko Anda (Bagikan ke HP Kasir)
            </div>
            <div className="text-base font-bold tracking-wider text-[#1F7A5A] truncate">
              {settings.outletId || 'CUAN-8899'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyOutletCode}
            className="h-8 px-3 rounded-full bg-white text-[12px] font-semibold text-[#1F7A5A] border border-[#c5dfd1] flex items-center gap-1.5 shrink-0"
          >
            {copiedOutletCode ? <Check size={13} /> : <Copy size={13} />}
            {copiedOutletCode ? 'Tersalin' : 'Salin'}
          </button>
        </div>

        {Capacitor.isNativePlatform() && (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1F7A5A]">
                  <span>Sinkronisasi Otomatis Aktif</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSyncInfo((v) => !v)}
                  title="Informasi Sinkronisasi Otomatis"
                  className="w-6 h-6 rounded-full bg-[#ece9e0] hover:bg-[#e2e0d8] text-[#4a4947] flex items-center justify-center shrink-0 transition"
                >
                  <AlertCircle size={14} />
                </button>
              </div>
              {showSyncInfo && (
                <div className="text-xs text-[#6b6a68] bg-[#faf9f5] border border-[#e2e0d8] rounded-lg px-3 py-2 leading-relaxed">
                  Saat offline, data disimpan aman di HP. Begitu terhubung internet, seluruh transaksi, menu, pengguna &amp; perubahan otomatis disinkronkan ke Cloud dan perangkat lain tanpa perlu klik manual.
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-[#eeece5]">
              <div className="text-xs text-[#6b6a68]">
                Versi Aplikasi: <strong className="text-[#1f1e1d]">v{getInstalledAppVersion()}</strong>
              </div>
              <button
                type="button"
                disabled={syncLoading}
                onClick={handleCheckUpdateManual}
                className="text-xs font-semibold text-[#1F7A5A] hover:underline"
              >
                Cek Update Aplikasi
              </button>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-[#eeece5]">
              {getAppEnvironment() === 'testing' ? (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="text-xs font-semibold text-[#7a4300] flex items-center gap-1.5"
                >
                  <RotateCcw size={13} /> Bersihkan Data Demo
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onLogout}
                className="text-xs font-semibold text-[#9b1c12] flex items-center gap-1.5"
              >
                <LogOut size={13} /> Keluar Akun
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal Edit Profil Usaha & Pengaturan Struk */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">Profil Usaha &amp; Pengaturan Struk</div>
              <button type="button" onClick={() => setShowProfileModal(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-3">
              {/* Logo Usaha untuk Struk */}
              <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl bg-white border border-[#d6d3c8] flex items-center justify-center overflow-hidden shrink-0">
                  {pLogoUsaha ? (
                    <img
                      src={pLogoUsaha}
                      alt="Preview Logo"
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <Store size={24} className="text-[#6b6a68]" />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="text-xs font-semibold text-[#1f1e1d]">
                    Logo Usaha (Tampil di Struk)
                  </div>
                  <div className="text-[11px] text-[#6b6a68]">
                    Otomatis dikompres ringan (PNG/JPG). Opsional.
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <label className="h-8 px-3 rounded-lg bg-[#e4f1ea] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:opacity-90">
                      <Upload size={13} /> {pLogoUsaha ? 'Ganti Logo' : 'Pilih Logo'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileChange}
                        className="hidden"
                      />
                    </label>
                    {pLogoUsaha && (
                      <button
                        type="button"
                        onClick={() => setPLogoUsaha(undefined)}
                        className="h-8 px-2.5 rounded-lg border border-[#f5c2bc] text-[#9b1c12] text-xs font-semibold flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Hapus
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Nama Usaha *</label>
                <input
                  type="text"
                  value={pNamaUsaha}
                  onChange={(e) => setPNamaUsaha(e.target.value)}
                  className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Tagline / Header Struk (opsional)
                </label>
                <input
                  type="text"
                  value={pStrukHeader}
                  onChange={(e) => setPStrukHeader(e.target.value)}
                  placeholder="Contoh: Masakan Rumahan & Kopi Hangat"
                  className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Alamat (tampil di struk)</label>
                <input
                  type="text"
                  value={pAlamat}
                  onChange={(e) => setPAlamat(e.target.value)}
                  className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">Nomor HP / WhatsApp Toko</label>
                <input
                  type="text"
                  value={pTelepon}
                  onChange={(e) => setPTelepon(e.target.value)}
                  placeholder="0812-xxxx-xxxx"
                  className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4a4947] mb-1">
                  Pesan Bawah / Footer Struk
                </label>
                <input
                  type="text"
                  value={pStrukFooter}
                  onChange={(e) => setPStrukFooter(e.target.value)}
                  placeholder="Terima kasih sudah berbelanja!"
                  className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                />
              </div>
              <div className="border-t border-[#eeece5] pt-2 flex flex-col gap-2 text-sm">
                <label className="flex items-center justify-between">
                  <span>Tampilkan nama kasir di struk</span>
                  <input
                    type="checkbox"
                    checked={pShowKasir}
                    onChange={(e) => setPShowKasir(e.target.checked)}
                    className="accent-[#1F7A5A] w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Tampilkan catatan per item di struk</span>
                  <input
                    type="checkbox"
                    checked={pShowNotes}
                    onChange={(e) => setPShowNotes(e.target.checked)}
                    className="accent-[#1F7A5A] w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Tampilkan nomor WA toko di struk</span>
                  <input
                    type="checkbox"
                    checked={pShowWa}
                    onChange={(e) => setPShowWa(e.target.checked)}
                    className="accent-[#1F7A5A] w-4 h-4"
                  />
                </label>
              </div>

              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px] mt-1"
              >
                Simpan Pengaturan Struk
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah / Atur Pengguna */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between items-center">
              <div className="text-base font-bold">
                {editingUser ? `Atur Pengguna: ${editingUser.nama}` : 'Tambah Kasir Baru'}
              </div>
              <button type="button" onClick={() => setShowAddUser(false)}>
                <X size={20} className="text-[#6b6a68]" />
              </button>
            </div>
            <form onSubmit={handleSaveUser} className="flex flex-col gap-3">
              {/* MODE TAMBAH KARYAWAN BARU */}
              {!editingUser && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Nama Lengkap *
                    </label>
                    <input
                      type="text"
                      value={uNama}
                      onChange={(e) => setUNama(e.target.value)}
                      placeholder="Contoh: Budi Santoso"
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>

                  {user.role === 'owner' && (
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">Peran (Role)</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setURole('kasir')}
                          className={`h-9 rounded-lg border text-xs font-semibold transition ${
                            uRole === 'kasir'
                              ? 'bg-[#e4f1ea] border-[#1F7A5A] text-[#1F7A5A]'
                              : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                          }`}
                        >
                          Kasir (POS)
                        </button>
                        <button
                          type="button"
                          onClick={() => setURole('manager')}
                          className={`h-9 rounded-lg border text-xs font-semibold transition ${
                            uRole === 'manager'
                              ? 'bg-[#e0e7ff] border-[#4338ca] text-[#3730a3]'
                              : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                          }`}
                        >
                          Manager (Web &amp; App)
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Email Karyawan *
                    </label>
                    <input
                      type="email"
                      value={uEmail}
                      onChange={(e) => setUEmail(e.target.value)}
                      placeholder="nama@gmail.com"
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      No. WhatsApp / HP *
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={uNoHp}
                      onChange={(e) => setUNoHp(e.target.value)}
                      placeholder="081234567890"
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>

                  <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl px-3 py-2.5 text-[11px] text-[#1f4d3a] leading-relaxed">
                    <strong>Username</strong> &amp; <strong>PIN 6 angka</strong>
                    {uRole === 'manager' ? ' beserta Kata Sandi & Link Web Backoffice' : ''} akan dibuat otomatis oleh sistem dan dikirim ke email karyawan.
                  </div>
                </>
              )}

              {/* MODE ATUR KARYAWAN (IDENTITAS, EMAIL, PIN DIKUNCI — HANYA HAK AKSES, PERAN & STATUS AKTIF) */}
              {editingUser && editingUser.role !== 'owner' && (
                <>
                  <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b6a68]">Nama</span>
                      <span className="font-semibold text-[#1f1e1d] text-right">{editingUser.nama}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b6a68]">Username</span>
                      <span className="font-mono font-semibold text-[#1f1e1d]">@{editingUser.username}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b6a68]">Email</span>
                      <span className="font-medium text-[#1f1e1d] truncate">{editingUser.email || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#6b6a68]">No. WA/HP</span>
                      <span className="font-medium text-[#1f1e1d]">{editingUser.noHp || '-'}</span>
                    </div>
                    {user.role === 'owner' && (
                      <div className="flex justify-between gap-2 pt-1 border-t border-[#eeece5]">
                        <span className="text-[#6b6a68]">PIN Pribadi</span>
                        <span className="font-mono font-bold tracking-widest text-[#1F7A5A]">
                          {editingUser.pin || '-'}
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] text-[#6b6a68] pt-1 border-t border-[#eeece5]">
                      Data identitas, email, dan PIN dikunci untuk menjaga keunikan akun.
                    </div>
                  </div>

                  {user.role === 'owner' && (
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">Peran (Jabatan)</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setURole('kasir')}
                          className={`h-9 rounded-lg border text-xs font-semibold transition ${
                            uRole === 'kasir'
                              ? 'bg-[#e4f1ea] border-[#1F7A5A] text-[#1F7A5A]'
                              : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                          }`}
                        >
                          Kasir (POS)
                        </button>
                        <button
                          type="button"
                          onClick={() => setURole('manager')}
                          className={`h-9 rounded-lg border text-xs font-semibold transition ${
                            uRole === 'manager'
                              ? 'bg-[#e0e7ff] border-[#4338ca] text-[#3730a3]'
                              : 'bg-white border-[#d6d3c8] text-[#4a4947]'
                          }`}
                        >
                          Manager (Web &amp; App)
                        </button>
                      </div>
                      {editingUser.role === 'kasir' && uRole === 'manager' && (
                        <div className="mt-2 bg-[#eef2ff] border border-[#c7d2fe] text-[#3730a3] rounded-xl px-3 py-2 text-[11px] leading-relaxed">
                          Naik jabatan ke <strong>Manager</strong> akan otomatis membuatkan <strong>Kata Sandi Web Backoffice</strong> dan mengirim link backoffice ke email karyawan.
                        </div>
                      )}
                    </div>
                  )}

                  {user.role === 'owner' && editingUser.role === 'manager' && uRole === 'manager' && (
                    <button
                      type="button"
                      onClick={() => handleResetManagerPassword(editingUser)}
                      className="h-9 rounded-xl border border-[#c7d2fe] bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#3730a3] text-xs font-semibold transition"
                    >
                      Reset Kata Sandi Manager Otomatis &amp; Kirim Email
                    </button>
                  )}
                </>
              )}

              {/* MODE EDIT PROFIL OWNER SENDIRI */}
              {editingUser && editingUser.role === 'owner' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Nama Lengkap *
                    </label>
                    <input
                      type="text"
                      value={uNama}
                      onChange={(e) => setUNama(e.target.value)}
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>
                  <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl px-3 py-2 text-xs text-[#6b6a68] flex flex-col gap-0.5">
                    <div>Username: <strong className="text-[#1f1e1d] font-mono">@{editingUser.username}</strong></div>
                    <div>Email: <strong className="text-[#1f1e1d]">{editingUser.email || '-'}</strong></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Ubah Kata Sandi (opsional)
                      </label>
                      <input
                        type="password"
                        value={uPassword}
                        onChange={(e) => setUPassword(e.target.value)}
                        placeholder="Kosongkan jika tetap"
                        className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        PIN Owner (6 Angka)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={uPin}
                        onChange={(e) => setUPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Wajib 6 angka"
                        className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm font-mono font-bold tracking-widest"
                        required
                      />
                    </div>
                  </div>
                </>
              )}

              {editingUser?.role !== 'owner' && (
                <>
                  {uRole === 'kasir' && (
                    <>
                      <label className="flex items-center justify-between text-sm pt-1">
                        <span>Izinkan memberi diskon</span>
                        <input
                          type="checkbox"
                          checked={uCanDiscount}
                          onChange={(e) => setUCanDiscount(e.target.checked)}
                          className="accent-[#1F7A5A] w-4 h-4"
                        />
                      </label>
                      <label className="flex items-center justify-between text-sm">
                        <span>Izinkan catat pembelian &amp; pengeluaran</span>
                        <input
                          type="checkbox"
                          checked={uCanRecordExp}
                          onChange={(e) => setUCanRecordExp(e.target.checked)}
                          className="accent-[#1F7A5A] w-4 h-4"
                        />
                      </label>
                    </>
                  )}
                  {editingUser && (
                    <label className="flex items-center justify-between text-sm pt-1 border-t border-[#eeece5]">
                      <span>Status akun aktif</span>
                      <input
                        type="checkbox"
                        checked={uActive}
                        onChange={(e) => setUActive(e.target.checked)}
                        className="accent-[#1F7A5A] w-4 h-4"
                      />
                    </label>
                  )}
                </>
              )}

              <button
                type="submit"
                className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-[15px] mt-1"
              >
                Simpan Pengguna
              </button>

              {editingUser && canDeleteUser(editingUser) && (
                <button
                  type="button"
                  onClick={() => handleDeleteUser(editingUser)}
                  className="h-11 rounded-[10px] border border-[#f5c2bc] bg-[#fdf7f6] hover:bg-[#fbe4e1] text-[#9b1c12] font-semibold text-sm flex items-center justify-center gap-1.5 transition"
                >
                  <Trash2 size={15} /> Hapus Pengguna Ini
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Modal Kredensial Karyawan / Promosi Manager (Khusus Owner) */}
      {createdCredModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[390px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl border border-[#e2e0d8]">
            <div className="flex justify-between items-center">
              <div className="font-bold text-base text-[#1F7A5A]">
                {createdCredModal.title || 'Karyawan Berhasil Didaftarkan'}
              </div>
              <button type="button" onClick={() => setCreatedCredModal(null)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div className="text-xs text-[#6b6a68]">
              <strong>{createdCredModal.nama}</strong> ({createdCredModal.role === 'manager' ? 'Manager' : 'Kasir'})
              {createdCredModal.emailSent
                ? ` · Kredensial otomatis dikirim ke ${createdCredModal.email}.`
                : ` · Catat kredensial berikut (email belum terkirim saat offline).`}
            </div>
            <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl p-3.5 flex flex-col gap-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-[#6b6a68]">Email Login</span>
                <span className="font-semibold text-[#1f1e1d] truncate">{createdCredModal.email}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#6b6a68]">Username</span>
                <span className="font-mono font-bold text-[#1f1e1d]">{createdCredModal.username}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#6b6a68]">PIN Pribadi</span>
                <span className="font-mono font-extrabold text-sm tracking-widest text-[#1F7A5A]">
                  {createdCredModal.pin}
                </span>
              </div>
              {createdCredModal.password && (
                <div className="flex justify-between gap-2 border-t border-[#c5dfd1] pt-2">
                  <span className="text-[#6b6a68]">Kata Sandi Manager</span>
                  <span className="font-mono font-bold text-[#1f1e1d]">{createdCredModal.password}</span>
                </div>
              )}
              {createdCredModal.backofficeUrl && (
                <div className="border-t border-[#c5dfd1] pt-2 flex flex-col gap-1">
                  <span className="text-[#6b6a68]">Link Web Backoffice</span>
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={createdCredModal.backofficeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1F7A5A] font-semibold underline truncate"
                    >
                      {createdCredModal.backofficeUrl}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(createdCredModal.backofficeUrl || '');
                        notify('Link Web Backoffice disalin.');
                      }}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-[#c5dfd1] text-[#1F7A5A] shrink-0"
                    >
                      Salin
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCreatedCredModal(null)}
              className="h-10 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
