import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db, hashPassword } from '../db/database';
import { addAuditLog, enqueueSync } from '../db/actions';
import {
  createNewBranch,
  resetBranchKasirAuthPin,
  updateBranchProfile,
} from '../services/branchService';
import { deleteUserFromSupabase, getWebBackofficeUrl } from '../services/syncService';
import { validateEmail, validatePassword, validatePin } from '../lib/validation';
import {
  findDuplicatePinOwner,
  generateStrongPassword,
  generateUniqueSixDigitPin,
  generateUniqueUsername,
} from '../services/attendanceService';
import { checkEmailDuplicateInCloud, sendEmployeeCredentialsEmail } from '../services/authEmailService';
import type { AppSettings, BranchInfo, User } from '../types/models';
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

interface WebBranchesTeamPageProps {
  user: User;
  settings?: AppSettings;
  branches: BranchInfo[];
  activeOutletId: string;
  section?: 'branches' | 'team' | 'all';
  onBranchCreated: (branch: BranchInfo) => void;
  onBranchUpdated?: (branch: BranchInfo) => void;
  onOpenBranchSettings?: (outletId: string) => void;
  onSelectBranch: (outletId: string) => void;
}

export const WebBranchesTeamPage: React.FC<WebBranchesTeamPageProps> = ({
  user,
  settings,
  branches,
  activeOutletId,
  section = 'all',
  onBranchCreated,
  onBranchUpdated,
  onOpenBranchSettings,
}) => {
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  const isOwner = user.role === 'owner';

  const [copiedId, setCopiedId] = useState('');
  const [branchSearch, setBranchSearch] = useState('');

  // Modal Edit Cabang
  const [editingBranch, setEditingBranch] = useState<BranchInfo | null>(null);
  const [ebNamaCabang, setEbNamaCabang] = useState('');
  const [ebAlamat, setEbAlamat] = useState('');
  const [ebTelepon, setEbTelepon] = useState('');
  const [ebSaving, setEbSaving] = useState(false);
  const [ebErr, setEbErr] = useState('');
  const [resettingPinOutletId, setResettingPinOutletId] = useState('');
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [bNamaCabang, setBNamaCabang] = useState('');
  const [bAlamat, setBAlamat] = useState('');
  const [bTelepon, setBTelepon] = useState('');
  const [bCopyCatalog, setBCopyCatalog] = useState(true);
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchErr, setBranchErr] = useState('');

  // Modal Tambah/Edit Tim (Manager & Kasir)
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [uNama, setUNama] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uNoHp, setUNoHp] = useState('');
  const [uRole, setURole] = useState<'manager' | 'kasir'>('kasir');
  const [uPassword, setUPassword] = useState('');
  const [uPin, setUPin] = useState('');
  const [uCanDiscount, setUCanDiscount] = useState(false);
  const [uCanExpense, setUCanExpense] = useState(true);
  const [uActive, setUActive] = useState(true);
  const [userErr, setUserErr] = useState('');
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

  const handleCopyOutlet = async (oid: string) => {
    await navigator.clipboard?.writeText(oid);
    setCopiedId(oid);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setBranchErr('');
    if (!bNamaCabang.trim()) {
      setBranchErr('Nama cabang wajib diisi.');
      return;
    }
    setBranchSaving(true);
    try {
      const res = await createNewBranch({
        owner: user,
        currentSettings: settings,
        namaUsaha: settings.namaUsaha,
        namaCabang: bNamaCabang.trim(),
        alamatUsaha: bAlamat.trim() || '-',
        teleponUsaha: bTelepon.trim(),
        copyCatalogFromOutletId: bCopyCatalog ? activeOutletId : undefined,
      });
      if (!res.success || !res.branch) {
        setBranchErr(res.error || 'Gagal membuat cabang baru.');
        return;
      }
      setShowAddBranch(false);
      setBNamaCabang('');
      setBAlamat('');
      setBTelepon('');
      onBranchCreated(res.branch);
      alert(
        `Cabang "${res.branch.namaCabang}" berhasil dibuat!\n\n` +
          `ID Outlet: ${res.branch.outletId}\n` +
          `PIN Otorisasi Mode Kasir: ${res.kasirAuthPin || '-'}\n\n` +
          (res.emailSent
            ? `Informasi lengkap juga telah dikirim ke email Owner (${res.branch.ownerEmail || user.email || ''}).`
            : 'Catat ID Outlet & PIN Otorisasi di atas (juga bisa dilihat/di-reset di menu Pengaturan).')
      );
    } finally {
      setBranchSaving(false);
    }
  };

  const openEditBranch = (b: BranchInfo) => {
    setEditingBranch(b);
    setEbNamaCabang(b.namaCabang);
    setEbAlamat(b.alamatUsaha === '-' ? '' : b.alamatUsaha);
    setEbTelepon(b.teleponUsaha || '');
    setEbErr('');
  };

  const handleSaveEditBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch) return;
    if (!ebNamaCabang.trim()) {
      setEbErr('Nama cabang wajib diisi.');
      return;
    }
    setEbSaving(true);
    setEbErr('');
    try {
      const res = await updateBranchProfile({
        outletId: editingBranch.outletId,
        namaCabang: ebNamaCabang.trim(),
        alamatUsaha: ebAlamat.trim() || '-',
        teleponUsaha: ebTelepon.trim(),
      });
      if (!res.success) {
        setEbErr(res.error || 'Gagal menyimpan perubahan cabang.');
        return;
      }
      onBranchUpdated?.({
        ...editingBranch,
        namaCabang: ebNamaCabang.trim(),
        alamatUsaha: ebAlamat.trim() || '-',
        teleponUsaha: ebTelepon.trim(),
        updatedAt: res.updatedAt || new Date().toISOString(),
      });
      setEditingBranch(null);
    } finally {
      setEbSaving(false);
    }
  };

  const handleResetBranchPin = async (b: BranchInfo) => {
    if (
      !confirm(
        `Reset PIN Otorisasi Mode Kasir untuk "${b.namaCabang}" (${b.outletId})? PIN lama tidak akan bisa dipakai lagi.`
      )
    ) {
      return;
    }
    setResettingPinOutletId(b.outletId);
    try {
      const excludePins = users.map((u) => u.pin || '').filter(Boolean);
      if (b.kasirAuthPin) excludePins.push(b.kasirAuthPin);
      const res = await resetBranchKasirAuthPin(b.outletId, excludePins);
      if (!res.success || !res.newPin) {
        alert(res.error || 'Gagal mereset PIN Otorisasi.');
        return;
      }
      onBranchUpdated?.({
        ...b,
        kasirAuthPin: res.newPin,
        updatedAt: res.updatedAt || new Date().toISOString(),
      });
      alert(`PIN Otorisasi Mode Kasir "${b.namaCabang}" berhasil di-reset!\n\nPIN Baru: ${res.newPin}`);
    } finally {
      setResettingPinOutletId('');
    }
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUNama('');
    setUEmail('');
    setUNoHp('');
    setURole('kasir');
    setUPassword('');
    setUPin(generateUniqueSixDigitPin(users));
    setUCanDiscount(settings?.defaultKasirDiscount ?? false);
    setUCanExpense(settings?.defaultKasirRecordExpense ?? true);
    setUActive(true);
    setUserErr('');
    setShowUserModal(true);
  };

  const openEditUser = (target: User) => {
    if (!isOwner && target.role !== 'kasir') return;
    setEditingUser(target);
    setUNama(target.nama);
    setUEmail(target.email || '');
    setUNoHp(target.noHp || '');
    setURole(target.role === 'manager' ? 'manager' : 'kasir');
    setUPassword('');
    setUPin(target.pin || '');
    setUCanDiscount(target.canDiscount);
    setUCanExpense(target.canRecordExpense);
    setUActive(target.active);
    setUserErr('');
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserErr('');
    const cleanNama = uNama.trim();
    const cleanEmail = uEmail.trim().toLowerCase();
    const cleanNoHp = uNoHp.trim();
    if (!cleanNama) {
      setUserErr('Nama lengkap wajib diisi.');
      return;
    }

    const nowIso = new Date().toISOString();
    if (editingUser) {
      // Karyawan (Kasir / Manager): identitas, email, dan PIN DIKUNCI — hanya ubah peran (Owner), hak akses, dan status aktif
      if (editingUser.role !== 'owner') {
        const finalRole: 'manager' | 'kasir' = isOwner ? uRole : 'kasir';
        const isPromotedToManager = editingUser.role === 'kasir' && finalRole === 'manager';
        const promotedPassword = isPromotedToManager ? generateStrongPassword() : undefined;

        const patch: Partial<User> = {
          role: finalRole,
          canDiscount: finalRole === 'kasir' ? uCanDiscount : true,
          canRecordExpense: finalRole === 'kasir' ? uCanExpense : true,
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
          `Role: ${finalRole} · Aktif: ${uActive}`
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
              namaUsaha: settings?.namaUsaha || 'Lembayung',
              namaCabang: settings?.namaCabang || 'Pusat',
              outletId: activeOutletId || settings?.outletId || '',
              backofficeUrl,
              reason: 'promoted_to_manager',
            }).catch(() => ({ success: false }));
            emailSent = Boolean(mailRes.success);
          }
          setShowUserModal(false);
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

        setShowUserModal(false);
        return;
      }

      // Edit akun Owner sendiri (email tetap dikunci agar unik)
      const effectivePin = uPin.trim();
      const pinErr = validatePin(effectivePin);
      if (pinErr) return setUserErr(pinErr);
      const dupPin = findDuplicatePinOwner(effectivePin, users, editingUser.id);
      if (dupPin) {
        return setUserErr(
          `PIN "${effectivePin}" sudah dipakai oleh ${dupPin.nama}. Setiap akun wajib memiliki PIN 6 angka yang unik.`
        );
      }
      if (uPassword.trim()) {
        const passErr = validatePassword(uPassword);
        if (passErr) return setUserErr(passErr);
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
      setShowUserModal(false);
      return;
    }

    // === TAMBAH KARYAWAN BARU (Nama Lengkap, Email, No. WA/HP -> Auto-generate Username, PIN, & Password Manager) ===
    const emailErr = validateEmail(cleanEmail);
    if (emailErr) return setUserErr(emailErr);
    const dupEmailLocal = users.find(
      (u) => (u.email || '').trim().toLowerCase() === cleanEmail
    );
    if (dupEmailLocal) {
      return setUserErr(
        `Email "${cleanEmail}" sudah digunakan oleh ${dupEmailLocal.nama}. Setiap akun wajib menggunakan email yang berbeda.`
      );
    }
    const dupEmailCloud = await checkEmailDuplicateInCloud(cleanEmail);
    if (dupEmailCloud) return setUserErr(dupEmailCloud);
    if (cleanNoHp.replace(/\D/g, '').length < 9) {
      return setUserErr('Nomor WhatsApp / HP wajib diisi (minimal 9 angka).');
    }

    const finalRole: 'manager' | 'kasir' = isOwner ? uRole : 'kasir';
    const generatedUsername = generateUniqueUsername(cleanNama, users);
    const generatedPin = generateUniqueSixDigitPin(users);
    const generatedPassword = finalRole === 'manager' ? generateStrongPassword() : undefined;
    const passwordHash = generatedPassword ? await hashPassword(generatedPassword) : '';

    const id = uuidv4();
    const newUser: User = {
      id,
      nama: cleanNama,
      username: generatedUsername,
      email: cleanEmail,
      noHp: cleanNoHp,
      passwordHash,
      pin: generatedPin,
      role: finalRole,
      canDiscount: finalRole === 'kasir' ? uCanDiscount : true,
      canRecordExpense: finalRole === 'kasir' ? uCanExpense : true,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await db.users.add(newUser);
    await addAuditLog(user, 'TAMBAH_PENGGUNA', cleanNama, `Role: ${finalRole} · ${cleanEmail}`);
    await enqueueSync('master', id, 'upsert', { ...newUser, isUser: true });

    const backofficeUrl = getWebBackofficeUrl();
    let emailSent = false;
    if (navigator.onLine) {
      const mailRes = await sendEmployeeCredentialsEmail({
        email: cleanEmail,
        nama: cleanNama,
        role: finalRole,
        username: generatedUsername,
        pin: generatedPin,
        password: generatedPassword,
        namaUsaha: settings?.namaUsaha || 'Lembayung',
        namaCabang: settings?.namaCabang || 'Pusat',
        outletId: activeOutletId || settings?.outletId || '',
        backofficeUrl,
        reason: 'new',
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    setShowUserModal(false);
    if (isOwner) {
      setCreatedCredModal({
        title: 'Karyawan Berhasil Didaftarkan',
        nama: cleanNama,
        role: finalRole,
        username: generatedUsername,
        pin: generatedPin,
        password: generatedPassword,
        email: cleanEmail,
        emailSent,
        backofficeUrl: finalRole === 'manager' ? backofficeUrl : undefined,
      });
    } else {
      alert(
        emailSent
          ? `${cleanNama} berhasil ditambahkan. Username & PIN telah dikirim otomatis ke email ${cleanEmail}.`
          : `${cleanNama} berhasil ditambahkan.`
      );
    }
  };

  const handleResetManagerPassword = async (target: User) => {
    if (!isOwner || target.role !== 'manager') return;
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
        namaUsaha: settings?.namaUsaha || 'Lembayung',
        namaCabang: settings?.namaCabang || 'Pusat',
        outletId: activeOutletId || settings?.outletId || '',
        backofficeUrl,
        reason: 'password_reset',
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    setShowUserModal(false);
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

  const canDelete = (target: User) => {
    if (target.id === user.id) return false;
    // Wajib dinonaktifkan terlebih dahulu sebelum boleh dihapus
    if (target.active) return false;
    if (!isOwner) return target.role === 'kasir';
    if (target.role === 'owner') return users.filter((u) => u.role === 'owner').length > 1;
    return true;
  };

  const handleDelete = async (target: User) => {
    if (target.active) {
      alert('Nonaktifkan akun karyawan terlebih dahulu sebelum menghapusnya.');
      return;
    }
    if (!canDelete(target)) return;
    if (!confirm(`Hapus permanen akun "${target.nama}" (${target.role}) dari Pusat & semua cabang?`)) return;
    await db.users.delete(target.id);
    await deleteUserFromSupabase(target.id).catch(() => {});
    await addAuditLog(user, 'HAPUS_PENGGUNA', target.nama, `Role: ${target.role}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Bagian 1: Manajemen Multi-Cabang (Khusus Owner) — Tampilan List Informatif + Pencarian */}
      {isOwner && section !== 'team' && (() => {
        const q = branchSearch.trim().toLowerCase();
        const filteredBranches = q
          ? branches.filter(
              (b) =>
                b.namaCabang.toLowerCase().includes(q) ||
                b.outletId.toLowerCase().includes(q) ||
                (b.alamatUsaha || '').toLowerCase().includes(q) ||
                (b.teleponUsaha || '').toLowerCase().includes(q)
            )
          : branches;

        const fmtUpdated = (iso?: string) => {
          if (!iso) return '—';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return '—';
          return d.toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        };

        const openCount = branches.filter((b) => b.isStoreOpen).length;
        const closedCount = branches.length - openCount;

        const fmtTimeOnly = (iso?: string) => {
          if (!iso) return '';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        };

        return (
          <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#eeece5] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2 flex-wrap">
                  <Building2 size={18} className="text-[#1F7A5A]" /> Daftar Cabang ({branches.length})
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A]">
                    {openCount} Buka
                  </span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ece9e0] text-[#4a4947]">
                    {closedCount} Tutup
                  </span>
                </h2>
                <p className="text-xs text-[#6b6a68] mt-0.5">
                  Pantau status buka/tutup toko, ID Outlet, PIN Otorisasi Mode Kasir, dan kelola informasi tiap cabang.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6a68] pointer-events-none"
                  />
                  <input
                    type="text"
                    value={branchSearch}
                    onChange={(e) => setBranchSearch(e.target.value)}
                    placeholder="Cari cabang, ID Outlet, alamat..."
                    className="h-9 w-64 max-w-full pl-8 pr-7 rounded-xl border border-[#d6d3c8] bg-[#faf9f5] focus:bg-white text-xs text-[#1f1e1d] focus:outline-none focus:border-[#1F7A5A] transition"
                  />
                  {branchSearch && (
                    <button
                      type="button"
                      onClick={() => setBranchSearch('')}
                      aria-label="Hapus pencarian"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6b6a68] hover:text-[#1f1e1d]"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBranchErr('');
                    setShowAddBranch(true);
                  }}
                  className="h-9 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <Plus size={15} /> Tambah Cabang Baru
                </button>
              </div>
            </div>

            {q && (
              <div className="px-5 py-2 bg-[#faf9f5] border-b border-[#eeece5] text-[11px] text-[#6b6a68]">
                Menampilkan <strong className="text-[#1f1e1d]">{filteredBranches.length}</strong> dari{' '}
                <strong className="text-[#1f1e1d]">{branches.length}</strong> cabang untuk kata kunci &ldquo;{branchSearch.trim()}&rdquo;
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Nama Cabang</th>
                    <th className="py-3 px-3 font-semibold">Status Toko</th>
                    <th className="py-3 px-3 font-semibold">ID Outlet (Kode Toko)</th>
                    <th className="py-3 px-3 font-semibold">PIN Otorisasi Kasir</th>
                    <th className="py-3 px-3 font-semibold">Alamat &amp; Kontak</th>
                    <th className="py-3 px-3 font-semibold">Pembaruan</th>
                    <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eeece5]">
                  {filteredBranches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 px-4 text-center text-[#6b6a68]">
                        Tidak ada cabang yang cocok dengan pencarian &ldquo;{branchSearch.trim()}&rdquo;.
                      </td>
                    </tr>
                  ) : (
                    filteredBranches.map((b) => {
                      const isCurrent = b.outletId === activeOutletId;
                      const isPusat = !b.parentOutletId || b.parentOutletId === b.outletId;
                      return (
                        <tr
                          key={b.outletId}
                          className={isCurrent ? 'bg-[#e4f1ea]/25' : 'hover:bg-[#faf9f5]'}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-[#1f1e1d] text-[13px]">
                                {b.namaCabang}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isPusat
                                    ? 'bg-[#e0e7ff] text-[#3730a3]'
                                    : 'bg-[#ece9e0] text-[#4a4947]'
                                }`}
                              >
                                {isPusat ? 'Pusat' : 'Cabang'}
                              </span>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 whitespace-nowrap">
                            {b.isStoreOpen ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#e4f1ea] text-[#15803d] w-fit">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                                  Buka
                                </span>
                                {(b.activeCashierName || b.shiftOpenedAt) && (
                                  <span className="text-[10px] text-[#6b6a68]">
                                    {b.activeCashierName}
                                    {b.shiftOpenedAt ? ` · ${fmtTimeOnly(b.shiftOpenedAt)}` : ''}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#ece9e0] text-[#6b6a68] w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />
                                Tutup
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <span className="font-mono font-bold text-[#1F7A5A] bg-[#faf9f5] border border-[#d6d3c8] px-2 py-1 rounded-lg">
                                {b.outletId}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopyOutlet(b.outletId)}
                                title="Salin ID Outlet"
                                className="h-7 px-2 rounded-lg border border-[#d6d3c8] bg-white text-[11px] font-medium text-[#4a4947] inline-flex items-center gap-1 hover:bg-[#ece9e0]"
                              >
                                {copiedId === b.outletId ? <Check size={12} className="text-[#1F7A5A]" /> : <Copy size={12} />}
                                {copiedId === b.outletId ? 'Tersalin' : 'Salin'}
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 whitespace-nowrap">
                            {b.kasirAuthPin ? (
                              <span className="font-mono font-bold tracking-[0.18em] text-[#1F7A5A] bg-[#f4f9f6] border border-[#c5dfd1] px-2.5 py-1 rounded-lg">
                                {b.kasirAuthPin}
                              </span>
                            ) : (
                              <span className="text-[11px] text-[#9b1c12] bg-[#fbe4e1] px-2 py-0.5 rounded-full font-medium">
                                Belum diatur
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-[#4a4947] max-w-[240px]">
                            <div className="flex items-start gap-1.5">
                              <MapPin size={12} className="text-[#6b6a68] shrink-0 mt-0.5" />
                              <span className="line-clamp-2">{b.alamatUsaha || '—'}</span>
                            </div>
                            {b.teleponUsaha && (
                              <div className="flex items-center gap-1.5 text-[11px] text-[#6b6a68] mt-1">
                                <Phone size={11} className="text-[#1F7A5A] shrink-0" />
                                <span>{b.teleponUsaha}</span>
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-3 text-[#6b6a68] whitespace-nowrap text-[11px]">
                            {fmtUpdated(b.updatedAt)}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {onOpenBranchSettings && (
                                <button
                                  type="button"
                                  onClick={() => onOpenBranchSettings(b.outletId)}
                                  className="h-8 px-2.5 rounded-lg border border-[#1F7A5A] bg-[#1F7A5A] hover:bg-[#15563f] text-white text-[11px] font-semibold inline-flex items-center gap-1 transition"
                                >
                                  <Settings size={12} /> Pengaturan
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditBranch(b)}
                                className="h-8 px-2.5 rounded-lg border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] text-[#1f1e1d] text-[11px] font-semibold inline-flex items-center gap-1 transition"
                              >
                                <Pencil size={12} /> Edit
                              </button>
                              <button
                                type="button"
                                disabled={resettingPinOutletId === b.outletId}
                                onClick={() => handleResetBranchPin(b)}
                                className="h-8 px-2.5 rounded-lg border border-[#c5dfd1] bg-[#f4f9f6] hover:bg-[#e4f1ea] text-[#1F7A5A] text-[11px] font-semibold inline-flex items-center gap-1 transition disabled:opacity-50"
                              >
                                <KeyRound size={12} />
                                {resettingPinOutletId === b.outletId ? 'Mereset...' : 'Reset PIN'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Bagian 2: Manajemen Tim Usaha Lintas Cabang (Owner -> Manager & Kasir; Manager -> Kasir) */}
      {section !== 'branches' && (
      <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#eeece5] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2">
              <Users size={18} className="text-[#1F7A5A]" /> Tim Usaha Lintas Cabang ({users.length})
            </h2>
            <p className="text-xs text-[#6b6a68] mt-0.5">
              {isOwner
                ? '1 daftar tim berlaku otomatis untuk Pusat & semua cabang. Karyawan resign wajib dinonaktifkan dulu sebelum dihapus.'
                : 'Manager dapat menambahkan dan mengatur akun Kasir. Karyawan resign wajib dinonaktifkan dulu sebelum dihapus.'}
            </p>
          </div>
          <button
            type="button"
            onClick={openAddUser}
            className="h-9 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <UserPlus size={15} /> {isOwner ? 'Tambah Manager / Kasir' : 'Tambah Kasir'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#faf9f5] text-[#6b6a68] border-b border-[#eeece5]">
              <tr>
                <th className="py-3 px-4 font-semibold">Nama</th>
                <th className="py-3 px-3 font-semibold">Username</th>
                <th className="py-3 px-3 font-semibold">Email &amp; WA</th>
                {isOwner && <th className="py-3 px-3 font-semibold">PIN</th>}
                <th className="py-3 px-3 font-semibold">Peran</th>
                <th className="py-3 px-3 font-semibold">Status &amp; Izin</th>
                <th className="py-3 px-4 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eeece5]">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#faf9f5]">
                  <td className="py-3 px-4 font-semibold text-[#1f1e1d]">{u.nama}</td>
                  <td className="py-3 px-3 font-mono text-[11px]">{u.username}</td>
                  <td className="py-3 px-3 text-[#6b6a68]">
                    <div>{u.email || '—'}</div>
                    {u.noHp && <div className="text-[10px] text-[#1F7A5A]">{u.noHp}</div>}
                  </td>
                  {isOwner && (
                    <td className="py-3 px-3 font-mono font-bold text-[#1F7A5A]">
                      {u.pin || '—'}
                    </td>
                  )}
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1 ${
                        u.role === 'owner'
                          ? 'bg-[#1F7A5A] text-white'
                          : u.role === 'manager'
                          ? 'bg-[#e0e7ff] text-[#3730a3]'
                          : 'bg-[#ece9e0] text-[#4a4947]'
                      }`}
                    >
                      {u.role === 'manager' && <Shield size={10} />}
                      {u.role === 'owner' ? 'Owner' : u.role === 'manager' ? 'Manager' : 'Kasir'}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-[#6b6a68]">
                    {!u.active ? (
                      <span className="text-[#9b1c12] font-semibold">Nonaktif</span>
                    ) : u.role === 'kasir' ? (
                      `Diskon: ${u.canDiscount ? 'Ya' : 'Tidak'} · Pengeluaran: ${u.canRecordExpense ? 'Ya' : 'Tidak'}`
                    ) : (
                      'Aktif · Akses Web & Aplikasi'
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {(isOwner || u.role === 'kasir') && (
                      <button
                        type="button"
                        onClick={() => openEditUser(u)}
                        className="text-[#1F7A5A] font-semibold hover:underline mr-3"
                      >
                        Edit
                      </button>
                    )}
                    {canDelete(u) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(u)}
                        className="text-[#9b1c12] hover:underline inline-flex items-center gap-0.5"
                      >
                        <Trash2 size={12} /> Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Modal Edit Info Cabang */}
      {editingBranch && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditBranch}
            className="bg-white w-full max-w-[430px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-base text-[#1f1e1d]">Edit Informasi Cabang</div>
                <div className="text-[11px] font-mono text-[#1F7A5A]">{editingBranch.outletId}</div>
              </div>
              <button type="button" onClick={() => setEditingBranch(null)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">
                Nama Cabang *
              </label>
              <input
                type="text"
                value={ebNamaCabang}
                onChange={(e) => setEbNamaCabang(e.target.value)}
                placeholder="Contoh: Cabang Sudirman"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">Alamat</label>
              <input
                type="text"
                value={ebAlamat}
                onChange={(e) => setEbAlamat(e.target.value)}
                placeholder="Jl. Sudirman No. 12"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">
                No. WhatsApp / Telepon Cabang
              </label>
              <input
                type="tel"
                value={ebTelepon}
                onChange={(e) => setEbTelepon(e.target.value)}
                placeholder="0812-xxxx-xxxx"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
              />
            </div>
            {ebErr && (
              <div className="text-xs bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                {ebErr}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingBranch(null)}
                className="h-10 px-4 rounded-xl border border-[#d6d3c8] text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={ebSaving}
                className="h-10 px-5 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold disabled:opacity-60"
              >
                {ebSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Tambah Cabang Baru */}
      {showAddBranch && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateBranch}
            className="bg-white w-full max-w-[440px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <div className="font-bold text-base text-[#1f1e1d]">Tambah Cabang Baru</div>
              <button type="button" onClick={() => setShowAddBranch(false)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Nama Cabang *
              </label>
              <input
                type="text"
                value={bNamaCabang}
                onChange={(e) => setBNamaCabang(e.target.value)}
                placeholder="Contoh: Cabang Sudirman / Cabang 2"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                Alamat Cabang (untuk struk)
              </label>
              <input
                type="text"
                value={bAlamat}
                onChange={(e) => setBAlamat(e.target.value)}
                placeholder="Jl. Sudirman No. 25"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4a4947] mb-1">
                No. Telepon / WA Cabang (opsional)
              </label>
              <input
                type="text"
                value={bTelepon}
                onChange={(e) => setBTelepon(e.target.value)}
                placeholder="0812-xxxx-xxxx"
                className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
              />
            </div>
            <label className="flex items-start gap-2.5 bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3 text-xs text-[#4a4947]">
              <input
                type="checkbox"
                checked={bCopyCatalog}
                onChange={(e) => setBCopyCatalog(e.target.checked)}
                className="accent-[#1F7A5A] mt-0.5"
              />
              <span>
                <strong>Salin katalog otomatis:</strong> ikut menyalin seluruh Bahan Baku, Resep HPP, dan Daftar Menu dari cabang aktif saat ini ke cabang baru.
              </span>
            </label>
            {branchErr && (
              <div className="text-xs bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                {branchErr}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddBranch(false)}
                className="h-10 px-4 rounded-xl border border-[#d6d3c8] text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={branchSaving}
                className="h-10 px-5 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold disabled:opacity-60"
              >
                {branchSaving ? 'Membuat Cabang...' : 'Buat Cabang'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Tambah / Edit Pengguna */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUser}
            className="bg-white w-full max-w-[440px] rounded-2xl p-5 flex flex-col gap-3 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="font-bold text-base">
                {editingUser ? `Edit Akun: ${editingUser.nama}` : 'Tambah Anggota Tim'}
              </div>
              <button type="button" onClick={() => setShowUserModal(false)}>
                <X size={18} className="text-[#6b6a68]" />
              </button>
            </div>

            {/* MODE TAMBAH KARYAWAN BARU */}
            {!editingUser && (
              <>
                {isOwner && (
                  <div>
                    <label className="block text-xs font-semibold text-[#4a4947] mb-1">Peran</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setURole('kasir')}
                        className={`h-9 rounded-xl border text-xs font-semibold ${
                          uRole === 'kasir'
                            ? 'bg-[#e4f1ea] border-[#1F7A5A] text-[#1F7A5A]'
                            : 'border-[#d6d3c8] text-[#4a4947]'
                        }`}
                      >
                        Kasir (Aplikasi POS)
                      </button>
                      <button
                        type="button"
                        onClick={() => setURole('manager')}
                        className={`h-9 rounded-xl border text-xs font-semibold ${
                          uRole === 'manager'
                            ? 'bg-[#e0e7ff] border-[#4338ca] text-[#3730a3]'
                            : 'border-[#d6d3c8] text-[#4a4947]'
                        }`}
                      >
                        Manager (Web &amp; App)
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Nama Lengkap *
                  </label>
                  <input
                    type="text"
                    value={uNama}
                    onChange={(e) => setUNama(e.target.value)}
                    placeholder="Contoh: Budi Santoso"
                    className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Email Karyawan *
                    </label>
                    <input
                      type="email"
                      value={uEmail}
                      onChange={(e) => setUEmail(e.target.value)}
                      placeholder="nama@gmail.com"
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
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
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                      required
                    />
                  </div>
                </div>

                <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl px-3 py-2.5 text-[11px] text-[#1f4d3a] leading-relaxed">
                  <strong>Username</strong> &amp; <strong>PIN 6 angka</strong>
                  {uRole === 'manager' ? ' beserta Kata Sandi & Link Web Backoffice' : ''} akan dibuat otomatis dan dikirim langsung ke email karyawan.
                </div>
              </>
            )}

            {/* MODE ATUR KARYAWAN (IDENTITAS, EMAIL, PIN DIKUNCI) */}
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
                  {isOwner && (
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

                {isOwner && (
                  <div>
                    <label className="block text-xs font-semibold text-[#4a4947] mb-1">Peran (Jabatan)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setURole('kasir')}
                        className={`h-9 rounded-xl border text-xs font-semibold ${
                          uRole === 'kasir'
                            ? 'bg-[#e4f1ea] border-[#1F7A5A] text-[#1F7A5A]'
                            : 'border-[#d6d3c8] text-[#4a4947]'
                        }`}
                      >
                        Kasir (Aplikasi POS)
                      </button>
                      <button
                        type="button"
                        onClick={() => setURole('manager')}
                        className={`h-9 rounded-xl border text-xs font-semibold ${
                          uRole === 'manager'
                            ? 'bg-[#e0e7ff] border-[#4338ca] text-[#3730a3]'
                            : 'border-[#d6d3c8] text-[#4a4947]'
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

                {isOwner && editingUser.role === 'manager' && uRole === 'manager' && (
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
                    className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                    required
                  />
                </div>
                <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl px-3 py-2 text-xs text-[#6b6a68] flex flex-col gap-0.5">
                  <div>Username: <strong className="text-[#1f1e1d] font-mono">@{editingUser.username}</strong></div>
                  <div>Email: <strong className="text-[#1f1e1d]">{editingUser.email || '-'}</strong></div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Ubah Kata Sandi (opsional)
                    </label>
                    <input
                      type="password"
                      value={uPassword}
                      onChange={(e) => setUPassword(e.target.value)}
                      placeholder="Kosongkan jika tetap"
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
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
                      placeholder="123456"
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm font-mono font-bold tracking-widest"
                      required
                    />
                  </div>
                </div>
              </>
            )}

            {uRole === 'kasir' && editingUser?.role !== 'owner' && (
              <div className="flex flex-col gap-2 pt-1 text-xs">
                <label className="flex items-center justify-between">
                  <span>Izinkan memberi diskon di Kasir</span>
                  <input
                    type="checkbox"
                    checked={uCanDiscount}
                    onChange={(e) => setUCanDiscount(e.target.checked)}
                    className="accent-[#1F7A5A]"
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Izinkan catat pengeluaran kas kecil</span>
                  <input
                    type="checkbox"
                    checked={uCanExpense}
                    onChange={(e) => setUCanExpense(e.target.checked)}
                    className="accent-[#1F7A5A]"
                  />
                </label>
              </div>
            )}

            {editingUser && editingUser.id !== user.id && (
              <label className="flex items-center justify-between text-xs pt-1 border-t border-[#eeece5]">
                <span>Akun Aktif</span>
                <input
                  type="checkbox"
                  checked={uActive}
                  onChange={(e) => setUActive(e.target.checked)}
                  className="accent-[#1F7A5A]"
                />
              </label>
            )}

            {userErr && (
              <div className="text-xs bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                {userErr}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="h-10 px-4 rounded-xl border border-[#d6d3c8] text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold"
              >
                Simpan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Kredensial Karyawan / Promosi Manager (Khusus Owner) */}
      {createdCredModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[400px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl border border-[#e2e0d8]">
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
                ? ` · Kredensial telah dikirim otomatis ke ${createdCredModal.email}.`
                : ` · Email belum terkirim (pastikan koneksi internet aktif).`}
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
