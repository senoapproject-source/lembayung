import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db, hashPassword } from '../db/database';
import { addAuditLog, enqueueSync } from '../db/actions';
import { createNewBranch } from '../services/branchService';
import { deleteUserFromSupabase } from '../services/syncService';
import { validateEmail, validatePassword, validatePin } from '../lib/validation';
import {
  findDuplicatePinOwner,
  generateStrongPassword,
  generateUniqueSixDigitPin,
  generateUniqueUsername,
} from '../services/attendanceService';
import { sendEmployeeCredentialsEmail } from '../services/authEmailService';
import type { AppSettings, BranchInfo, User } from '../types/models';
import {
  Building2,
  Check,
  Copy,
  Plus,
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
  onBranchCreated: (branch: BranchInfo) => void;
  onSelectBranch: (outletId: string) => void;
}

export const WebBranchesTeamPage: React.FC<WebBranchesTeamPageProps> = ({
  user,
  settings,
  branches,
  activeOutletId,
  onBranchCreated,
  onSelectBranch,
}) => {
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  const isOwner = user.role === 'owner';

  const [copiedId, setCopiedId] = useState('');
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
  const [uUsername, setUUsername] = useState('');
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
    nama: string;
    role: 'manager' | 'kasir';
    username: string;
    pin: string;
    password?: string;
    email: string;
    emailSent: boolean;
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
    } finally {
      setBranchSaving(false);
    }
  };

  const openAddUser = () => {
    setEditingUser(null);
    setUNama('');
    setUUsername('');
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
    setUUsername(target.username);
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
      const cleanUsername = uUsername.trim();
      if (!cleanUsername) {
        setUserErr('Username wajib diisi.');
        return;
      }
      const dup = users.find(
        (u) =>
          u.id !== editingUser.id &&
          u.username.trim().toLowerCase() === cleanUsername.toLowerCase()
      );
      if (dup) {
        setUserErr(`Username "${cleanUsername}" sudah digunakan oleh ${dup.nama}.`);
        return;
      }

      const finalRole =
        editingUser.role === 'owner' ? 'owner' : isOwner ? uRole : 'kasir';

      if (finalRole === 'manager' && cleanEmail) {
        const eErr = validateEmail(cleanEmail);
        if (eErr) return setUserErr(eErr);
      }

      const effectivePin = isOwner ? uPin.trim() : (editingUser.pin || '');
      if (isOwner) {
        const pinErr = validatePin(effectivePin);
        if (pinErr) return setUserErr(pinErr);
        const dupPin = findDuplicatePinOwner(effectivePin, users, editingUser.id);
        if (dupPin) {
          return setUserErr(
            `PIN "${effectivePin}" sudah dipakai oleh ${dupPin.nama}. Setiap akun wajib memiliki PIN 6 angka yang unik.`
          );
        }
      }

      if ((finalRole === 'owner' || finalRole === 'manager') && uPassword.trim()) {
        const passErr = validatePassword(uPassword);
        if (passErr) return setUserErr(passErr);
      }

      const patch: Partial<User> = {
        nama: cleanNama,
        username: cleanUsername,
        email: cleanEmail || undefined,
        noHp: cleanNoHp || undefined,
        role: finalRole,
        pin: effectivePin || undefined,
        canDiscount: finalRole === 'kasir' ? uCanDiscount : true,
        canRecordExpense: finalRole === 'kasir' ? uCanExpense : true,
        active: uActive,
        updatedAt: nowIso,
      };
      if ((finalRole === 'owner' || finalRole === 'manager') && uPassword.trim()) {
        patch.passwordHash = await hashPassword(uPassword);
      }
      await db.users.update(editingUser.id, patch);
      await addAuditLog(user, 'UBAH_PENGGUNA', cleanNama, `Role: ${finalRole}`);
      await enqueueSync('master', editingUser.id, 'upsert', { ...patch, isUser: true });
      setShowUserModal(false);
      return;
    }

    // === TAMBAH KARYAWAN BARU (Nama Lengkap, Email, No. WA/HP -> Auto-generate Username, PIN, & Password Manager) ===
    const emailErr = validateEmail(cleanEmail);
    if (emailErr) return setUserErr(emailErr);
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
      }).catch(() => ({ success: false }));
      emailSent = Boolean(mailRes.success);
    }

    setShowUserModal(false);
    if (isOwner) {
      setCreatedCredModal({
        nama: cleanNama,
        role: finalRole,
        username: generatedUsername,
        pin: generatedPin,
        password: generatedPassword,
        email: cleanEmail,
        emailSent,
      });
    } else {
      alert(
        emailSent
          ? `${cleanNama} berhasil ditambahkan. Username & PIN telah dikirim otomatis ke email ${cleanEmail}.`
          : `${cleanNama} berhasil ditambahkan.`
      );
    }
  };

  const canDelete = (target: User) => {
    if (target.id === user.id) return false;
    if (!isOwner) return target.role === 'kasir';
    if (target.role === 'owner') return users.filter((u) => u.role === 'owner').length > 1;
    return true;
  };

  const handleDelete = async (target: User) => {
    if (!canDelete(target)) return;
    if (!confirm(`Hapus akun "${target.nama}" (${target.role}) dari cabang ini?`)) return;
    await db.users.delete(target.id);
    await deleteUserFromSupabase(target.id).catch(() => {});
    await addAuditLog(user, 'HAPUS_PENGGUNA', target.nama, `Role: ${target.role}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Bagian 1: Manajemen Multi-Cabang (Khusus Owner) */}
      {isOwner && (
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2">
                <Building2 size={18} className="text-[#1F7A5A]" /> Daftar Cabang ({branches.length})
              </h2>
              <p className="text-xs text-[#6b6a68] mt-0.5">
                Setiap cabang memiliki ID Outlet sendiri untuk perangkat kasir, dengan katalog menu yang dapat disalin otomatis.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setBranchErr('');
                setShowAddBranch(true);
              }}
              className="h-9 px-4 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus size={15} /> Tambah Cabang Baru
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {branches.map((b) => {
              const isCurrent = b.outletId === activeOutletId;
              return (
                <div
                  key={b.outletId}
                  className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition ${
                    isCurrent
                      ? 'border-[#1F7A5A] bg-[#e4f1ea]/35'
                      : 'border-[#e2e0d8] bg-[#faf9f5]/60 hover:bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-[#1f1e1d] truncate">
                        {b.namaCabang}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1F7A5A] text-white shrink-0">
                          Cabang Aktif
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6b6a68] mt-1 truncate">{b.alamatUsaha}</div>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <span className="text-[11px] font-mono font-bold bg-white border border-[#d6d3c8] px-2.5 py-1 rounded-lg text-[#1F7A5A]">
                        {b.outletId}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyOutlet(b.outletId)}
                        className="h-7 px-2 rounded-lg border border-[#d6d3c8] bg-white text-[11px] font-medium text-[#4a4947] flex items-center gap-1 hover:bg-[#ece9e0]"
                      >
                        {copiedId === b.outletId ? <Check size={12} /> : <Copy size={12} />}
                        {copiedId === b.outletId ? 'Tersalin' : 'Salin ID'}
                      </button>
                    </div>
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => onSelectBranch(b.outletId)}
                      className="h-8 rounded-xl border border-[#1F7A5A] text-[#1F7A5A] hover:bg-[#e4f1ea] text-xs font-semibold"
                    >
                      Pindah ke Cabang Ini
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bagian 2: Manajemen Tim Cabang Aktif (Owner -> Manager & Kasir; Manager -> Kasir) */}
      <div className="bg-white border border-[#e2e0d8] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#eeece5] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base text-[#1f1e1d] flex items-center gap-2">
              <Users size={18} className="text-[#1F7A5A]" /> Tim Cabang Aktif ({users.length})
            </h2>
            <p className="text-xs text-[#6b6a68] mt-0.5">
              {isOwner
                ? 'Owner dapat menambahkan akun Manager (akses Web & Aplikasi cabang) dan Kasir.'
                : 'Manager dapat menambahkan dan mengatur akun Kasir di cabang ini.'}
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

            {isOwner && editingUser?.role !== 'owner' && (
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
                  required={!editingUser}
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
                  required={!editingUser}
                />
              </div>
            </div>

            {!editingUser ? (
              <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl px-3 py-2.5 text-[11px] text-[#1f4d3a] leading-relaxed">
                <strong>Username</strong> &amp; <strong>PIN 6 angka</strong>
                {uRole === 'manager' ? ' beserta Kata Sandi sementara Manager' : ''} akan dibuat otomatis dan dikirim langsung ke email karyawan.
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">Username *</label>
                  <input
                    type="text"
                    value={uUsername}
                    onChange={(e) => setUUsername(e.target.value)}
                    className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {(editingUser.role === 'owner' || uRole === 'manager') && (
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Reset Kata Sandi (opsional)
                      </label>
                      <input
                        type="password"
                        value={uPassword}
                        onChange={(e) => setUPassword(e.target.value)}
                        placeholder="Kosongkan jika tetap"
                        className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                      />
                    </div>
                  )}
                  {isOwner && (
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        PIN 6 Angka (Khusus Owner)
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
                  )}
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

      {/* Modal Kredensial Karyawan Baru (Khusus Owner) */}
      {createdCredModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[400px] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xl border border-[#e2e0d8]">
            <div className="flex justify-between items-center">
              <div className="font-bold text-base text-[#1F7A5A]">Karyawan Berhasil Didaftarkan</div>
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
              <div className="flex justify-between">
                <span className="text-[#6b6a68]">Username</span>
                <span className="font-mono font-bold text-[#1f1e1d]">{createdCredModal.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6b6a68]">PIN Pribadi</span>
                <span className="font-mono font-extrabold text-sm tracking-widest text-[#1F7A5A]">
                  {createdCredModal.pin}
                </span>
              </div>
              {createdCredModal.password && (
                <div className="flex justify-between border-t border-[#c5dfd1] pt-2">
                  <span className="text-[#6b6a68]">Kata Sandi Manager</span>
                  <span className="font-mono font-bold text-[#1f1e1d]">{createdCredModal.password}</span>
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
