import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hashPassword } from '../db/database';
import { generateOutletCode, registerNewBusiness } from '../db/actions';
import {
  getAppEnvironment,
  getInstalledAppVersion,
  pullAllFromSupabase,
  syncWithCloud,
} from '../services/syncService';
import {
  confirmOwnerForgotPassword,
  lookupOwnerOutletIdInCloud,
  requestOwnerForgotOutletId,
  requestOwnerForgotPassword,
  requestOwnerForgotUsername,
  sendRegisterOtpEmail,
  sendWelcomeOutletEmail,
  verifyRegisterOtpEmail,
} from '../services/authEmailService';
import {
  validateEmail,
  validateOwnerUsername,
  validatePassword,
  validatePin,
} from '../lib/validation';
import { CuaninLogo } from '../components/CuaninLogo';
import { PasswordInputWithRules } from '../components/PasswordInputWithRules';
import type { User } from '../types/models';
import { Delete, Eye, EyeOff, KeyRound, LogIn, Mail, ShieldCheck, UserPlus } from 'lucide-react';

export const REMEMBERED_USER_KEY = 'pos_hpp_remembered_user_id';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
  onEnterKasirMode?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, onEnterKasirMode }) => {
  const users = useLiveQuery(() => db.users.toArray());
  const settings = useLiveQuery(() => db.settings.get('global'));

  const [rememberedUserId, setRememberedUserId] = useState<string | null>(() =>
    localStorage.getItem(REMEMBERED_USER_KEY)
  );

  /**
   * 4 Kondisi Utama Layar:
   * 1. 'pin_lock'       : Perangkat SUDAH terhubung ke toko -> dropdown pilih kasir/owner + Numpad PIN 6 digit
   * 2. 'forgot_pin'     : Muncul hanya jika user klik "Lupa PIN?" di layar PIN -> verifikasi password untuk reset PIN
   * 3. 'unlogged'       : Perangkat BELUM login -> tab "Masuk (Login)" atau "Buat Akun (Daftar Owner)"
   * 4. 'owner_recovery' : Bantuan Akun Khusus Owner (Lupa Password, Lupa Username, Lupa ID Outlet)
   */
  const [screenMode, setScreenMode] = useState<
    'pin_lock' | 'forgot_pin' | 'unlogged' | 'owner_recovery'
  >('unlogged');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(() =>
    localStorage.getItem(REMEMBERED_USER_KEY)
  );
  const [unloggedTab, setUnloggedTab] = useState<'login' | 'register'>('login');

  // State PIN Lock
  const [pinInput, setPinInput] = useState('');
  const [newPinSetup, setNewPinSetup] = useState('');
  const [pendingPrivilegedUser, setPendingPrivilegedUser] = useState<User | null>(null);
  const [duplicatePinMatches, setDuplicatePinMatches] = useState<User[]>([]);
  const [privilegedPassInput, setPrivilegedPassInput] = useState('');
  const [showPrivilegedPass, setShowPrivilegedPass] = useState(false);

  // State Lupa PIN (Verifikasi Password -> Buat PIN Baru)
  const [forgotPassInput, setForgotPassInput] = useState('');
  const [forgotNewPin, setForgotNewPin] = useState('');
  const [showForgotPass, setShowForgotPass] = useState(false);

  // State Login (Saat perangkat belum login)
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginOutletCode, setLoginOutletCode] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // State Buat Akun / Daftar Usaha Baru (Owner: Username & Email terpisah + Verifikasi OTP Email)
  const [regNamaUsaha, setRegNamaUsaha] = useState('');
  const [regAlamat, setRegAlamat] = useState('');
  const [regNamaOwner, setRegNamaOwner] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regIncludeSample, setRegIncludeSample] = useState(false);
  const [regStep, setRegStep] = useState<'form' | 'otp'>('form');
  const [regOtpInput, setRegOtpInput] = useState('');
  const [regMaskedEmail, setRegMaskedEmail] = useState('');

  // State Bantuan Akun Khusus Owner (Lupa Password / Lupa Username / Lupa ID Outlet)
  const [recoveryTab, setRecoveryTab] = useState<'password' | 'username' | 'outlet'>('password');
  const [recIdentifier, setRecIdentifier] = useState('');
  const [recEmail, setRecEmail] = useState('');
  const [recOtpSent, setRecOtpSent] = useState(false);
  const [recOtpInput, setRecOtpInput] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const activeUsers = (users ?? [])
    .filter((u) => u.active)
    .sort((a, b) => {
      // Tampilkan Kasir terlebih dahulu untuk kemudahan ganti shift, lalu Owner
      if (a.role !== b.role) return a.role === 'kasir' ? -1 : 1;
      return a.nama.localeCompare(b.nama);
    });

  const isDeviceLinkedToStore = Boolean(rememberedUserId && activeUsers.length > 0);
  const rememberedUser =
    activeUsers.find((u) => u.id === selectedUserId) ??
    activeUsers.find((u) => u.id === rememberedUserId);

  useEffect(() => {
    if (!users) return;
    if (isDeviceLinkedToStore) {
      if (!activeUsers.some((u) => u.id === selectedUserId)) {
        setSelectedUserId(activeUsers[0]?.id ?? null);
      }
      setScreenMode('pin_lock');
      if (navigator.onLine) {
        syncWithCloud().catch(() => { });
      }
    } else {
      setScreenMode('unlogged');
    }
  }, [users?.length, isDeviceLinkedToStore]);

  if (!users) return null;

  const completeLogin = (user: User) => {
    localStorage.setItem(REMEMBERED_USER_KEY, user.id);
    setRememberedUserId(user.id);
    setSelectedUserId(user.id);
    onLoginSuccess(user);
  };

  // Keluar sepenuhnya dari perangkat ini (kembali ke mode perangkat belum login)
  const handleForgetDeviceAccount = () => {
    localStorage.removeItem(REMEMBERED_USER_KEY);
    setRememberedUserId(null);
    setSelectedUserId(null);
    setPinInput('');
    setError('');
    setScreenMode('unlogged');
    setUnloggedTab('login');
  };

  // ============================================================================
  // 1. HANDLER NUMPAD PIN (TANPA DROPDOWN: DETEKSI ROLE OTOMATIS DARI PIN)
  // ============================================================================
  const anyUserHasPin = activeUsers.some((u) => Boolean(u.pin));

  const proceedWithMatchedUser = (matched: User) => {
    setDuplicatePinMatches([]);
    if (matched.role === 'owner' || matched.role === 'manager') {
      // Owner & Manager wajib konfirmasi kata sandi (100% offline) agar aman walau PIN sempat diintip
      setPendingPrivilegedUser(matched);
      setPrivilegedPassInput('');
      setShowPrivilegedPass(false);
      setPinInput('');
      return;
    }
    completeLogin(matched);
  };

  const handleDigitPress = (digit: string) => {
    setError('');
    if (pinInput.length >= 6) return;
    const nextPin = pinInput + digit;
    setPinInput(nextPin);

    if (nextPin.length === 6) {
      // 1. Cek apakah ini PIN Otorisasi Mode Kasir
      const kasirAuthPin = String(settings?.kasirAuthPin || '').trim();
      if (kasirAuthPin && nextPin === kasirAuthPin && onEnterKasirMode) {
        setPinInput('');
        onEnterKasirMode();
        return;
      }

      // 2. Cek apakah ini PIN Owner atau Manager
      const privilegedMatches = activeUsers.filter(
        (u) => (u.role === 'owner' || u.role === 'manager') && String(u.pin || '').trim() === nextPin
      );
      if (privilegedMatches.length === 1) {
        proceedWithMatchedUser(privilegedMatches[0]);
        return;
      }
      if (privilegedMatches.length > 1) {
        setDuplicatePinMatches(privilegedMatches);
        setPinInput('');
        return;
      }

      // 3. Jika kasir mengetik PIN pribadinya di layar utama -> tolak dengan pesan jelas
      const kasirMatch = activeUsers.find(
        (u) => u.role === 'kasir' && String(u.pin || '').trim() === nextPin
      );
      if (kasirMatch) {
        setError(
          kasirAuthPin
            ? 'Masukkan PIN Otorisasi Mode Kasir dulu untuk masuk ke Mode Kasir. PIN pribadi digunakan di dalam Mode Kasir (Absen & Buka Kasir).'
            : 'PIN Otorisasi Mode Kasir belum diatur oleh Owner di menu Pengaturan.'
        );
        setTimeout(() => setPinInput(''), 350);
        return;
      }

      setError('PIN tidak dikenali. Periksa kembali 6 angka PIN Anda.');
      setTimeout(() => setPinInput(''), 350);
    }
  };

  const handlePrivilegedPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPrivilegedUser) return;
    setError('');
    const hashed = await hashPassword(privilegedPassInput);
    if (hashed !== pendingPrivilegedUser.passwordHash) {
      setError('Kata sandi salah. Silakan coba lagi.');
      return;
    }
    const target = pendingPrivilegedUser;
    setPendingPrivilegedUser(null);
    setPrivilegedPassInput('');
    completeLogin(target);
  };

  const handleBackspace = () => {
    setError('');
    setPinInput((p) => p.slice(0, -1));
  };

  // Jika akun yang login belum sempat membuat PIN, minta buat PIN 6 digit
  const handleSaveInitialPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rememberedUser) return;
    const pinErr = validatePin(newPinSetup);
    if (pinErr) {
      setError(pinErr);
      return;
    }
    await db.users.update(rememberedUser.id, { pin: newPinSetup.trim() });
    const updated = await db.users.get(rememberedUser.id);
    if (updated) completeLogin(updated);
  };

  // ============================================================================
  // 2. HANDLER LUPA PIN (VERIFIKASI KATA SANDI -> ATUR PIN BARU 6 ANGKA)
  // ============================================================================
  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rememberedUser) return;
    setError('');

    const pinErr = validatePin(forgotNewPin);
    if (pinErr) {
      setError(pinErr);
      return;
    }

    setLoading(true);
    try {
      const hashed = await hashPassword(forgotPassInput);
      if (hashed !== rememberedUser.passwordHash) {
        setError('Kata sandi akun salah. Tidak dapat mereset PIN.');
        return;
      }

      await db.users.update(rememberedUser.id, {
        pin: forgotNewPin,
        updatedAt: new Date().toISOString(),
      });
      const updated = await db.users.get(rememberedUser.id);
      if (updated) {
        completeLogin(updated);
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // 3. HANDLER SAAT PERANGKAT BELUM LOGIN (TAB MASUK, DAFTAR OWNER, PEMULIHAN OWNER)
  // ============================================================================
  const matchUserLoginIdentifier = (u: User, cleanLower: string) =>
    u.username.trim().toLowerCase() === cleanLower ||
    (u.email ? u.email.trim().toLowerCase() === cleanLower : false) ||
    u.nama.trim().toLowerCase() === cleanLower;

  const handleUnloggedLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);
    try {
      const clean = loginUsername.trim();
      const cleanLower = clean.toLowerCase();
      let codeInput = loginOutletCode.trim().toUpperCase();
      const currentCode = (settings?.outletId || '').trim().toUpperCase();

      // Jika user memasukkan Kode Toko dari cloud, tarik data toko tersebut terlebih dahulu
      if (codeInput && codeInput !== currentCode) {
        const pullRes = await pullAllFromSupabase(codeInput);
        if (!pullRes.success) {
          setError(pullRes.message);
          return;
        }
      }

      let allUsers = await db.users.toArray();
      let user = allUsers.find((u) => matchUserLoginIdentifier(u, cleanLower));

      // Jika belum ketemu di lokal & sedang online:
      // 1) Coba tarik dari kode toko yang ada, atau
      // 2) Khusus Owner, cari otomatis outlet_id di Cloud berdasarkan username atau email!
      if (!user && navigator.onLine) {
        if (!codeInput && !currentCode) {
          const foundOutlet = await lookupOwnerOutletIdInCloud(clean);
          if (foundOutlet) {
            codeInput = foundOutlet;
          }
        }
        const targetCode = codeInput || currentCode;
        if (targetCode) {
          await pullAllFromSupabase(targetCode);
          allUsers = await db.users.toArray();
          user = allUsers.find((u) => matchUserLoginIdentifier(u, cleanLower));
        }
      }

      if (!user) {
        setError('Username atau email tidak ditemukan.');
        return;
      }
      if (!user.active) {
        setError('Akun ini sedang nonaktif. Hubungi Owner.');
        return;
      }

      const hashed = await hashPassword(loginPassword);
      if (hashed !== user.passwordHash) {
        setError('Kata sandi salah.');
        return;
      }

      completeLogin(user);
    } finally {
      setLoading(false);
    }
  };

  // Langkah 1 Daftar Owner: Validasi form terpisah (Username & Email) lalu kirim OTP verifikasi email
  const handleRegisterSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!regNamaUsaha.trim() || !regNamaOwner.trim()) {
      setError('Nama Usaha dan Nama Owner wajib diisi.');
      return;
    }
    const userErr = validateOwnerUsername(regUsername);
    if (userErr) {
      setError(userErr);
      return;
    }
    const emailErr = validateEmail(regEmail);
    if (emailErr) {
      setError(emailErr);
      return;
    }
    const pinErr = validatePin(regPin);
    if (pinErr) {
      setError(pinErr);
      return;
    }
    const passErr = validatePassword(regPassword);
    if (passErr) {
      setError(passErr);
      return;
    }

    setLoading(true);
    try {
      const res = await sendRegisterOtpEmail({
        email: regEmail.trim().toLowerCase(),
        username: regUsername.trim(),
        namaUsaha: regNamaUsaha.trim(),
        namaOwner: regNamaOwner.trim(),
      });
      if (!res.success) {
        setError(res.error || 'Gagal mengirim kode verifikasi email.');
        return;
      }
      setRegMaskedEmail(res.maskedEmail || regEmail.trim().toLowerCase());
      setRegOtpInput('');
      setRegStep('otp');
      setInfoMessage(res.message || `Kode verifikasi 6 angka telah dikirim ke ${regEmail.trim()}.`);
    } finally {
      setLoading(false);
    }
  };

  // Langkah 2 Daftar Owner: Verifikasi OTP -> Buat Akun & Outlet -> Kirim Email ID Outlet -> Login
  const handleRegisterVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!/^\d{6}$/.test(regOtpInput.trim())) {
      setError('Kode verifikasi wajib tepat 6 angka.');
      return;
    }

    setLoading(true);
    try {
      const preparedOutletId = generateOutletCode(regNamaUsaha.trim());
      const verifyRes = await verifyRegisterOtpEmail({
        email: regEmail.trim().toLowerCase(),
        username: regUsername.trim(),
        otp: regOtpInput.trim(),
        namaOwner: regNamaOwner.trim(),
        namaUsaha: regNamaUsaha.trim(),
        outletId: preparedOutletId,
      });
      if (!verifyRes.success || !verifyRes.verified) {
        setError(verifyRes.error || 'Kode verifikasi salah atau kedaluwarsa.');
        return;
      }

      const { owner: newOwner, outletId } = await registerNewBusiness({
        namaUsaha: regNamaUsaha,
        alamatUsaha: regAlamat,
        namaOwner: regNamaOwner,
        username: regUsername,
        email: regEmail.trim().toLowerCase(),
        emailVerified: true,
        password: regPassword,
        pin: regPin,
        includeSampleData: getAppEnvironment() === 'testing' ? regIncludeSample : false,
        customOutletId: preparedOutletId,
      });

      // Fallback hanya jika server belum mengirim email ID Outlet di dalam verify_register_otp
      if (!verifyRes.welcomeEmailSent) {
        await sendWelcomeOutletEmail({
          email: regEmail.trim().toLowerCase(),
          namaOwner: regNamaOwner.trim(),
          namaUsaha: regNamaUsaha.trim(),
          username: regUsername.trim(),
          outletId,
        }).catch(() => {});
      }

      completeLogin(newOwner);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat akun usaha.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // 4. HANDLER PEMULIHAN AKUN KHUSUS OWNER (LUPA PASSWORD / USERNAME / ID OUTLET)
  // ============================================================================
  const openOwnerRecovery = (tab: 'password' | 'username' | 'outlet') => {
    setRecoveryTab(tab);
    setRecIdentifier('');
    setRecEmail('');
    setRecOtpSent(false);
    setRecOtpInput('');
    setRecNewPassword('');
    setError('');
    setInfoMessage('');
    setScreenMode('owner_recovery');
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!recOtpSent) {
      if (!recIdentifier.trim()) {
        setError('Masukkan Username atau Email Owner.');
        return;
      }
      setLoading(true);
      try {
        const res = await requestOwnerForgotPassword(recIdentifier);
        if (!res.success) {
          setError(res.error || 'Gagal mengirim OTP reset kata sandi.');
          return;
        }
        setRecOtpSent(true);
        setInfoMessage(res.message || 'Kode OTP reset kata sandi telah dikirim ke email Owner.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!/^\d{6}$/.test(recOtpInput.trim())) {
      setError('Kode OTP wajib 6 angka.');
      return;
    }
    const passErr = validatePassword(recNewPassword);
    if (passErr) {
      setError(passErr);
      return;
    }

    setLoading(true);
    try {
      const newPasswordHash = await hashPassword(recNewPassword);
      const res = await confirmOwnerForgotPassword({
        identifier: recIdentifier,
        otp: recOtpInput,
        newPasswordHash,
      });
      if (!res.success) {
        setError(res.error || 'Gagal mereset kata sandi.');
        return;
      }

      // Sinkronkan hash password baru ke database lokal jika akun tersebut ada di perangkat ini
      if (res.userId) {
        const localUser = await db.users.get(res.userId);
        if (localUser) {
          await db.users.update(res.userId, {
            passwordHash: newPasswordHash,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      setInfoMessage(res.message || 'Kata sandi Owner berhasil diubah. Silakan masuk kembali.');
      setRecOtpSent(false);
      setRecOtpInput('');
      setRecNewPassword('');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    const emailErr = validateEmail(recEmail);
    if (emailErr) {
      setError(emailErr);
      return;
    }
    setLoading(true);
    try {
      const res = await requestOwnerForgotUsername(recEmail);
      if (!res.success) {
        setError(res.error || 'Email Owner tidak ditemukan.');
        return;
      }
      setInfoMessage(res.message || 'Informasi Username telah dikirim ke email Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotOutletSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    if (!recIdentifier.trim()) {
      setError('Masukkan Username atau Email Owner.');
      return;
    }
    setLoading(true);
    try {
      const res = await requestOwnerForgotOutletId(recIdentifier);
      if (!res.success) {
        setError(res.error || 'Akun Owner tidak ditemukan.');
        return;
      }
      setInfoMessage(res.message || 'Informasi ID Outlet telah dikirim ke email terdaftar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#faf9f5] flex flex-col justify-center px-6 py-8">
      <div className="w-full max-w-[360px] mx-auto flex flex-col gap-5">
        {/* Header Logo Lembayung */}
        <div className="flex flex-col items-center gap-1.5">
          <CuaninLogo size={56} />
          <div className="text-xl font-bold text-[#1f1e1d] tracking-tight mt-0.5">Lembayung</div>
          <div className="text-xs font-medium text-[#1F7A5A] -mt-1">
            {screenMode === 'pin_lock' && settings?.namaUsaha
              ? `${settings.namaUsaha} · POS & HPP`
              : 'POS & Kalkulator HPP'}
          </div>
        </div>

        {/* ====================================================================
            KONDISI 1: PERANGKAT SUDAH LOGIN -> NUMPAD PIN TANPA DROPDOWN + TOMBOL ABSEN
           ==================================================================== */}
        {screenMode === 'pin_lock' && rememberedUser && (
          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-6 flex flex-col items-center gap-4 shadow-xs">
            {duplicatePinMatches.length > 1 ? (
              <div className="w-full flex flex-col gap-2.5">
                <div className="text-center">
                  <div className="text-sm font-bold text-[#1f1e1d]">Pilih Nama Anda</div>
                  <div className="text-[11px] text-[#7a4300] mt-0.5">
                    PIN ini masih dipakai lebih dari 1 akun lama. Disarankan ubah PIN unik di Pengaturan.
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {duplicatePinMatches.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => proceedWithMatchedUser(u)}
                      className="h-11 px-4 rounded-xl border border-[#d6d3c8] bg-[#faf9f5] hover:bg-[#e4f1ea] hover:border-[#1F7A5A] text-sm font-semibold text-[#1f1e1d] flex items-center justify-between"
                    >
                      <span>{u.nama}</span>
                      <span className="text-[11px] font-medium text-[#6b6a68] capitalize">
                        {u.role}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDuplicatePinMatches([])}
                  className="text-xs font-medium text-[#6b6a68] text-center pt-1"
                >
                  ‹ Kembali ke Numpad
                </button>
              </div>
            ) : pendingPrivilegedUser ? (
              <form
                onSubmit={handlePrivilegedPasswordSubmit}
                className="w-full flex flex-col gap-3"
              >
                <div className="flex flex-col items-center text-center gap-1">
                  <div className="w-11 h-11 rounded-full bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center font-bold text-base">
                    {pendingPrivilegedUser.nama.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="text-sm font-bold text-[#1f1e1d] mt-1">
                    Halo, {pendingPrivilegedUser.nama}
                  </div>
                  <div className="text-xs text-[#6b6a68]">
                    Masukkan kata sandi akun{' '}
                    <strong>{pendingPrivilegedUser.role === 'owner' ? 'Owner' : 'Manager'}</strong>{' '}
                    untuk melanjutkan (100% offline).
                  </div>
                </div>

                <div className="relative">
                  <input
                    type={showPrivilegedPass ? 'text' : 'password'}
                    value={privilegedPassInput}
                    onChange={(e) => setPrivilegedPassInput(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] pl-3.5 pr-10 text-sm focus:outline-none focus:border-[#1F7A5A]"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivilegedPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6a68]"
                  >
                    {showPrivilegedPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-1.5 rounded-lg text-center">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPrivilegedUser(null);
                      setPrivilegedPassInput('');
                      setError('');
                    }}
                    className="h-11 px-4 rounded-[10px] border border-[#d6d3c8] text-xs font-semibold text-[#4a4947]"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="flex-1 h-11 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm"
                  >
                    Masuk
                  </button>
                </div>
              </form>
            ) : anyUserHasPin ? (
              <>
                <div className="flex flex-col items-center text-center gap-0.5">
                  <div className="text-sm font-bold text-[#1f1e1d]">
                    {settings?.namaUsaha || 'Lembayung'}
                  </div>
                  <div className="text-xs text-[#6b6a68]">
                    Masukkan PIN Otorisasi Kasir atau PIN Owner / Manager
                  </div>
                </div>

                {/* Indikator Titik PIN */}
                <div className="flex items-center justify-center gap-3.5 my-1">
                  {Array.from({ length: 6 }).map((_, idx) => {
                    const filled = idx < pinInput.length;
                    return (
                      <div
                        key={idx}
                        className={`w-3.5 h-3.5 rounded-full transition-all ${filled
                          ? 'bg-[#1F7A5A] scale-110'
                          : 'bg-[#ece9e0] border border-[#d6d3c8]'
                          }`}
                      />
                    );
                  })}
                </div>

                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-1.5 rounded-lg text-center">
                    {error}
                  </div>
                )}

                {/* Numpad Angka */}
                <div className="grid grid-cols-3 gap-3 w-full max-w-[260px] mt-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDigitPress(d)}
                      className="h-14 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
                    >
                      {d}
                    </button>
                  ))}
                  <div />
                  <button
                    key="0"
                    type="button"
                    onClick={() => handleDigitPress('0')}
                    className="h-14 rounded-2xl bg-[#faf9f5] hover:bg-[#e4f1ea] active:bg-[#1F7A5A] active:text-white border border-[#e2e0d8] text-lg font-bold text-[#1f1e1d] transition select-none"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleBackspace}
                    className="h-14 rounded-2xl bg-[#faf9f5] hover:bg-[#fbe4e1] text-[#4a4947] hover:text-[#9b1c12] border border-[#e2e0d8] flex items-center justify-center transition"
                  >
                    <Delete size={20} />
                  </button>
                </div>
              </>
            ) : (
              /* Jika akun belum punya PIN, minta buat PIN 6 digit dulu */
              <form onSubmit={handleSaveInitialPin} className="w-full flex flex-col gap-3">
                <div className="text-xs text-[#6b6a68] text-center">
                  Buat <strong>6 angka PIN</strong> agar setiap buka aplikasi cukup masukkan PIN saja.
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPinSetup}
                  onChange={(e) => setNewPinSetup(e.target.value.replace(/\D/g, ''))}
                  placeholder="Wajib 6 angka PIN"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] text-center text-lg font-bold tracking-widest"
                  required
                />
                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-1.5 rounded-lg text-center">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  className="h-11 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-sm"
                >
                  Simpan PIN &amp; Masuk
                </button>
              </form>
            )}

            {/* Opsi Ganti Akun / Keluar dari Perangkat */}
            <div className="pt-2 border-t border-[#eeece5] w-full flex justify-between items-center text-xs">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setForgotPassInput('');
                  setForgotNewPin('');
                  setScreenMode('forgot_pin');
                }}
                className="font-semibold text-[#1F7A5A] hover:underline"
              >
                Lupa PIN?
              </button>
              <button
                type="button"
                onClick={handleForgetDeviceAccount}
                className="text-[#6b6a68] hover:text-[#9b1c12]"
              >
                Ganti Akun Lain
              </button>
            </div>
          </div>
        )}

        {/* ====================================================================
            KONDISI 2: LUPA PIN -> MASUKKAN PASSWORD AKUN UNTUK BUAT PIN BARU
           ==================================================================== */}
        {screenMode === 'forgot_pin' && rememberedUser && (
          <form
            onSubmit={handleResetPinSubmit}
            className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4 shadow-xs"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center shrink-0">
                <KeyRound size={18} />
              </div>
              <div>
                <div className="font-bold text-sm text-[#1f1e1d]">
                  Atur Ulang PIN ({rememberedUser.nama})
                </div>
                <div className="text-xs text-[#6b6a68]">
                  Masukkan kata sandi akun untuk membuat PIN baru
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">
                Username / Email
              </label>
              <input
                type="text"
                value={rememberedUser.username}
                disabled
                className="w-full h-10 border border-[#d6d3c8] rounded-[10px] bg-[#faf9f5] px-3 text-xs text-[#6b6a68]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">
                Kata Sandi Akun *
              </label>
              <div className="relative">
                <input
                  type={showForgotPass ? 'text' : 'password'}
                  value={forgotPassInput}
                  onChange={(e) => setForgotPassInput(e.target.value)}
                  placeholder="Masukkan kata sandi Anda"
                  className="w-full h-11 border border-[#d6d3c8] rounded-[10px] bg-white px-3 pr-20 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowForgotPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#1F7A5A]"
                >
                  {showForgotPass ? 'Sembunyi' : 'Tampilkan'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4a4947] mb-1">
                PIN Baru (Wajib 6 Angka) *
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={forgotNewPin}
                onChange={(e) => setForgotNewPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Contoh: 123456"
                className="w-full h-11 border border-[#d6d3c8] rounded-[10px] bg-white px-3 text-center text-lg font-bold tracking-widest"
                required
              />
            </div>

            {error && (
              <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-12 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-sm"
            >
              {loading ? 'Memproses...' : 'Simpan PIN Baru & Masuk'}
            </button>

            <button
              type="button"
              onClick={() => {
                setError('');
                setPinInput('');
                setScreenMode('pin_lock');
              }}
              className="text-xs font-semibold text-[#1F7A5A] text-center"
            >
              ‹ Kembali ke Layar PIN
            </button>
          </form>
        )}

        {/* ====================================================================
            KONDISI 3: PERANGKAT BELUM LOGIN -> MUNCUL PILIHAN LOGIN / BUAT AKUN
           ==================================================================== */}
        {screenMode === 'unlogged' && (
          <>
            {/* Tab Switcher: Masuk (Login) vs Buat Akun */}
            <div className="flex bg-[#ece9e0] rounded-[10px] p-[3px] text-xs">
              <button
                type="button"
                onClick={() => {
                  setUnloggedTab('login');
                  setError('');
                  setInfoMessage('');
                }}
                className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${unloggedTab === 'login'
                  ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                  : 'text-[#4a4947] font-medium'
                  }`}
              >
                <LogIn size={14} /> Masuk (Login)
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnloggedTab('register');
                  setRegStep('form');
                  setError('');
                  setInfoMessage('');
                }}
                className={`flex-1 py-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${unloggedTab === 'register'
                  ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                  : 'text-[#4a4947] font-medium'
                  }`}
              >
                <UserPlus size={14} /> Buat Akun
              </button>
            </div>

            {unloggedTab === 'login' ? (
              <form
                onSubmit={handleUnloggedLoginSubmit}
                className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xs"
              >
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Username atau Email *
                  </label>
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="budi_owner atau budi@gmail.com"
                    className="w-full h-11 border border-[#d6d3c8] rounded-[10px] bg-white px-3 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Kata Sandi *
                  </label>
                  <div className="relative">
                    <input
                      type={showLoginPass ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Masukkan kata sandi"
                      className="w-full h-11 border border-[#d6d3c8] rounded-[10px] bg-white px-3 pr-20 text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#1F7A5A]"
                    >
                      {showLoginPass ? 'Sembunyi' : 'Tampilkan'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    ID Outlet / Kode Toko (Opsional untuk Owner, wajib untuk Kasir baru)
                  </label>
                  <input
                    type="text"
                    value={loginOutletCode}
                    onChange={(e) => setLoginOutletCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: CUAN-8899"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] bg-white px-3 text-xs uppercase font-semibold tracking-wider"
                  />
                </div>

                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loading ? 'Memproses...' : 'Masuk'}
                </button>

                {/* Bantuan Akun Khusus Owner */}
                <div className="pt-2.5 border-t border-[#eeece5] flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-[#6b6a68] text-center">
                    Bantuan Akun (Khusus Owner)
                  </div>
                  <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => openOwnerRecovery('password')}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Lupa Password?
                    </button>
                    <span className="text-[#d6d3c8]">•</span>
                    <button
                      type="button"
                      onClick={() => openOwnerRecovery('username')}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Lupa Username?
                    </button>
                    <span className="text-[#d6d3c8]">•</span>
                    <button
                      type="button"
                      onClick={() => openOwnerRecovery('outlet')}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Lupa ID Outlet?
                    </button>
                  </div>
                </div>
              </form>
            ) : regStep === 'form' ? (
              /* TAB BUAT AKUN BARU (REGISTER OWNER - LANGKAH 1: ISI DATA & KIRIM OTP) */
              <form
                onSubmit={handleRegisterSendOtp}
                className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-3 shadow-xs"
              >
                <div className="text-xs text-[#6b6a68] bg-[#faf9f5] border border-[#e2e0d8] rounded-lg p-2.5">
                  Buat akun usaha baru (<strong>Owner</strong>). Email akan diverifikasi terlebih dahulu, lalu <strong>ID Outlet</strong> dikirim otomatis ke email Anda.
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Nama Usaha *
                  </label>
                  <input
                    type="text"
                    value={regNamaUsaha}
                    onChange={(e) => setRegNamaUsaha(e.target.value)}
                    placeholder="Contoh: Kedai Kopi Nusantara"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Alamat Usaha (untuk struk)
                  </label>
                  <input
                    type="text"
                    value={regAlamat}
                    onChange={(e) => setRegAlamat(e.target.value)}
                    placeholder="Jl. Sudirman No. 10"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      Nama Owner *
                    </label>
                    <input
                      type="text"
                      value={regNamaOwner}
                      onChange={(e) => setRegNamaOwner(e.target.value)}
                      placeholder="Nama Anda"
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#4a4947] mb-1">
                      PIN Keamanan (6 Angka) *
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={regPin}
                      onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Wajib 6 angka"
                      className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Username Owner *
                  </label>
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value.replace(/\s/g, ''))}
                    placeholder="Contoh: budi_owner (tanpa spasi & tanpa @)"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Email Owner *
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="Contoh: budi@gmail.com"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                  <div className="text-[11px] text-[#6b6a68] mt-1">
                    Digunakan untuk verifikasi OTP, menerima ID Outlet, dan pemulihan akun.
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Kata Sandi *
                  </label>
                  <PasswordInputWithRules
                    value={regPassword}
                    onChange={setRegPassword}
                    placeholder="Contoh: aBcd3fgh!"
                    inputClassName="w-full h-10 border border-[#d6d3c8] rounded-[10px] pl-3 pr-10 text-sm"
                  />
                </div>

                {getAppEnvironment() === 'testing' && (
                  <label className="flex items-start gap-2 text-xs text-[#4a4947] pt-0.5">
                    <input
                      type="checkbox"
                      checked={regIncludeSample}
                      onChange={(e) => setRegIncludeSample(e.target.checked)}
                      className="accent-[#1F7A5A] mt-0.5"
                    />
                    <span>Isi contoh bahan, resep, &amp; menu dulu untuk belajar</span>
                  </label>
                )}

                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loading ? 'Mengirim Kode Verifikasi...' : 'Kirim Kode Verifikasi Email'}
                </button>
              </form>
            ) : (
              /* TAB BUAT AKUN BARU (REGISTER OWNER - LANGKAH 2: VERIFIKASI OTP EMAIL) */
              <form
                onSubmit={handleRegisterVerifyOtpSubmit}
                className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-3.5 shadow-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center shrink-0">
                    <Mail size={18} />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-[#1f1e1d]">Verifikasi Email Owner</div>
                    <div className="text-xs text-[#6b6a68]">
                      Kode 6 angka dikirim ke <strong>{regMaskedEmail}</strong>
                    </div>
                  </div>
                </div>

                {infoMessage && (
                  <div className="text-xs font-medium bg-[#e4f1ea] text-[#14532d] px-3 py-2 rounded-lg">
                    {infoMessage}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Masukkan Kode Verifikasi (6 Angka) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={regOtpInput}
                    onChange={(e) => setRegOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-12 border border-[#d6d3c8] rounded-[10px] bg-white px-3 text-center text-xl font-bold tracking-[0.4em]"
                    required
                  />
                </div>

                {error && (
                  <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || regOtpInput.length !== 6}
                  className="h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-50"
                >
                  {loading ? 'Memverifikasi & Membuat Akun...' : 'Verifikasi & Buat Akun'}
                </button>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleRegisterSendOtp}
                    className="font-semibold text-[#1F7A5A] hover:underline disabled:opacity-50"
                  >
                    Kirim Ulang Kode
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegStep('form');
                      setError('');
                      setInfoMessage('');
                    }}
                    className="text-[#6b6a68] hover:text-[#1f1e1d]"
                  >
                    ‹ Ubah Data
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* ====================================================================
            KONDISI 4: BANTUAN AKUN KHUSUS OWNER (LUPA PASSWORD / USERNAME / ID OUTLET)
           ==================================================================== */}
        {screenMode === 'owner_recovery' && (
          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center shrink-0">
                <ShieldCheck size={18} />
              </div>
              <div>
                <div className="font-bold text-sm text-[#1f1e1d]">Pemulihan Akun Owner</div>
                <div className="text-xs text-[#6b6a68]">Khusus akun dengan role Owner</div>
              </div>
            </div>

            {/* Tab Pemulihan */}
            <div className="grid grid-cols-3 bg-[#ece9e0] rounded-[10px] p-[3px] text-[11px]">
              <button
                type="button"
                onClick={() => openOwnerRecovery('password')}
                className={`py-2 rounded-lg transition ${recoveryTab === 'password'
                  ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                  : 'text-[#4a4947] font-medium'
                  }`}
              >
                Lupa Password
              </button>
              <button
                type="button"
                onClick={() => openOwnerRecovery('username')}
                className={`py-2 rounded-lg transition ${recoveryTab === 'username'
                  ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                  : 'text-[#4a4947] font-medium'
                  }`}
              >
                Lupa Username
              </button>
              <button
                type="button"
                onClick={() => openOwnerRecovery('outlet')}
                className={`py-2 rounded-lg transition ${recoveryTab === 'outlet'
                  ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                  : 'text-[#4a4947] font-medium'
                  }`}
              >
                Lupa ID Outlet
              </button>
            </div>

            {infoMessage && (
              <div className="text-xs font-medium bg-[#e4f1ea] text-[#14532d] px-3 py-2 rounded-lg">
                {infoMessage}
              </div>
            )}

            {error && (
              <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            {recoveryTab === 'password' && (
              <form onSubmit={handleForgotPasswordSubmit} className="flex flex-col gap-3">
                <div className="text-xs text-[#6b6a68]">
                  Masukkan <strong>Username atau Email</strong> Owner. Kode OTP akan dikirim ke email terdaftar untuk membuat kata sandi baru.
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Username atau Email Owner *
                  </label>
                  <input
                    type="text"
                    value={recIdentifier}
                    onChange={(e) => setRecIdentifier(e.target.value)}
                    disabled={recOtpSent}
                    placeholder="budi_owner atau budi@gmail.com"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm disabled:bg-[#faf9f5]"
                    required
                  />
                </div>

                {recOtpSent && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Kode OTP Email (6 Angka) *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={recOtpInput}
                        onChange={(e) => setRecOtpInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="w-full h-11 border border-[#d6d3c8] rounded-[10px] px-3 text-center text-lg font-bold tracking-[0.35em]"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Kata Sandi Baru *
                      </label>
                      <PasswordInputWithRules
                        value={recNewPassword}
                        onChange={setRecNewPassword}
                        placeholder="Contoh: aBcd3fgh!"
                        inputClassName="w-full h-10 border border-[#d6d3c8] rounded-[10px] pl-3 pr-10 text-sm"
                      />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loading
                    ? 'Memproses...'
                    : recOtpSent
                      ? 'Simpan Kata Sandi Baru'
                      : 'Kirim Kode OTP ke Email'}
                </button>
              </form>
            )}

            {recoveryTab === 'username' && (
              <form onSubmit={handleForgotUsernameSubmit} className="flex flex-col gap-3">
                <div className="text-xs text-[#6b6a68]">
                  Masukkan <strong>Email</strong> terdaftar milik Owner. Informasi Username Anda akan dikirim langsung ke kotak masuk email tersebut.
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Email Owner *
                  </label>
                  <input
                    type="email"
                    value={recEmail}
                    onChange={(e) => setRecEmail(e.target.value)}
                    placeholder="budi@gmail.com"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loading ? 'Mengirim...' : 'Kirim Username ke Email'}
                </button>
              </form>
            )}

            {recoveryTab === 'outlet' && (
              <form onSubmit={handleForgotOutletSubmit} className="flex flex-col gap-3">
                <div className="text-xs text-[#6b6a68]">
                  Masukkan <strong>Username atau Email</strong> Owner. Informasi <strong>ID Outlet</strong> akan dikirim ke email terdaftar Anda.
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4a4947] mb-1">
                    Username atau Email Owner *
                  </label>
                  <input
                    type="text"
                    value={recIdentifier}
                    onChange={(e) => setRecIdentifier(e.target.value)}
                    placeholder="budi_owner atau budi@gmail.com"
                    className="w-full h-10 border border-[#d6d3c8] rounded-[10px] px-3 text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                >
                  {loading ? 'Mengirim...' : 'Kirim ID Outlet ke Email'}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => {
                setError('');
                setInfoMessage('');
                setScreenMode('unlogged');
                setUnloggedTab('login');
              }}
              className="text-xs font-semibold text-[#1F7A5A] text-center pt-1"
            >
              ‹ Kembali ke Halaman Masuk
            </button>
          </div>
        )}

        <div className="text-center text-[11px] text-[#6b6a68]">
          Lembayung v{getInstalledAppVersion()}
        </div>
      </div>
    </div>
  );
};
