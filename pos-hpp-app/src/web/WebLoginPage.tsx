import React, { useEffect, useState } from 'react';
import { db, hashPassword } from '../db/database';
import { generateOutletCode, registerNewBusiness } from '../db/actions';
import {
  getLatestAndroidDownloadInfo,
  pullAllFromSupabase,
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
import { LembayungLogo } from '../components/CuaninLogo';
import { PasswordInputWithRules } from '../components/PasswordInputWithRules';
import type { User } from '../types/models';
import {
  BarChart3,
  Building2,
  Calculator,
  Download,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';

interface WebLoginPageProps {
  onLoginSuccess: (user: User) => void;
}

export const WebLoginPage: React.FC<WebLoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'recovery'>('login');

  // Login Web (Khusus Owner & Manager — Email + Password)
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Register Owner Baru
  const [regNamaUsaha, setRegNamaUsaha] = useState('');
  const [regAlamat, setRegAlamat] = useState('');
  const [regNamaOwner, setRegNamaOwner] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regStep, setRegStep] = useState<'form' | 'otp'>('form');
  const [regOtp, setRegOtp] = useState('');
  const [regMaskedEmail, setRegMaskedEmail] = useState('');

  // Recovery Owner
  const [recTab, setRecTab] = useState<'password' | 'username' | 'outlet'>('password');
  const [recIdentifier, setRecIdentifier] = useState('');
  const [recEmail, setRecEmail] = useState('');
  const [recOtpSent, setRecOtpSent] = useState(false);
  const [recOtp, setRecOtp] = useState('');
  const [recNewPass, setRecNewPass] = useState('');

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [androidDownloadUrl, setAndroidDownloadUrl] = useState('');

  useEffect(() => {
    getLatestAndroidDownloadInfo()
      .then((res) => setAndroidDownloadUrl(res.downloadUrl))
      .catch(() => {});
  }, []);

  const handleWebLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    const clean = emailInput.trim();
    const cleanLower = clean.toLowerCase();
    if (!clean || !passwordInput) {
      setError('Email dan kata sandi wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      const matchUser = (u: User) =>
        (u.email ? u.email.trim().toLowerCase() === cleanLower : false) ||
        u.username.trim().toLowerCase() === cleanLower;

      let allUsers = await db.users.toArray();
      let user = allUsers.find(matchUser);

      // Tarik dari Cloud otomatis berdasarkan email/username Owner atau Manager
      if (!user && navigator.onLine) {
        const foundOutlet = await lookupOwnerOutletIdInCloud(clean);
        if (foundOutlet) {
          await pullAllFromSupabase(foundOutlet);
          allUsers = await db.users.toArray();
          user = allUsers.find(matchUser);
        }
      }

      if (!user) {
        setError('Email atau kata sandi tidak ditemukan.');
        return;
      }

      if (user.role === 'kasir') {
        setError(
          'Dashboard Website khusus untuk akun Owner dan Manager. Untuk kasir, silakan login melalui aplikasi Lembayung di perangkat kasir.'
        );
        return;
      }

      if (!user.active) {
        setError('Akun ini sedang nonaktif. Hubungi Owner utama.');
        return;
      }

      const hashed = await hashPassword(passwordInput);
      if (hashed !== user.passwordHash) {
        setError('Kata sandi salah.');
        return;
      }

      onLoginSuccess(user);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!regNamaUsaha.trim() || !regNamaOwner.trim()) {
      setError('Nama Usaha dan Nama Owner wajib diisi.');
      return;
    }
    const userErr = validateOwnerUsername(regUsername);
    if (userErr) return setError(userErr);
    const emailErr = validateEmail(regEmail);
    if (emailErr) return setError(emailErr);
    const pinErr = validatePin(regPin);
    if (pinErr) return setError(pinErr);
    const passErr = validatePassword(regPassword);
    if (passErr) return setError(passErr);

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
      setRegStep('otp');
      setRegOtp('');
      setInfo(res.message || `Kode verifikasi 6 angka telah dikirim ke ${regEmail.trim()}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(regOtp.trim())) {
      setError('Kode verifikasi wajib tepat 6 angka.');
      return;
    }

    setLoading(true);
    try {
      const preparedOutletId = generateOutletCode(regNamaUsaha.trim());
      const verifyRes = await verifyRegisterOtpEmail({
        email: regEmail.trim().toLowerCase(),
        username: regUsername.trim(),
        otp: regOtp.trim(),
        namaOwner: regNamaOwner.trim(),
        namaUsaha: regNamaUsaha.trim(),
        outletId: preparedOutletId,
      });
      if (!verifyRes.success || !verifyRes.verified) {
        setError(verifyRes.error || 'Kode verifikasi salah atau kedaluwarsa.');
        return;
      }

      const { owner, outletId } = await registerNewBusiness({
        namaUsaha: regNamaUsaha,
        alamatUsaha: regAlamat,
        namaOwner: regNamaOwner,
        username: regUsername,
        email: regEmail.trim().toLowerCase(),
        emailVerified: true,
        password: regPassword,
        pin: regPin,
        includeSampleData: false,
        customOutletId: preparedOutletId,
      });

      if (!verifyRes.welcomeEmailSent) {
        await sendWelcomeOutletEmail({
          email: regEmail.trim().toLowerCase(),
          namaOwner: regNamaOwner.trim(),
          namaUsaha: regNamaUsaha.trim(),
          username: regUsername.trim(),
          outletId,
        }).catch(() => {});
      }

      onLoginSuccess(owner);
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (recTab === 'username') {
      const err = validateEmail(recEmail);
      if (err) return setError(err);
      setLoading(true);
      try {
        const res = await requestOwnerForgotUsername(recEmail);
        if (!res.success) return setError(res.error || 'Email tidak ditemukan.');
        setInfo(res.message || 'Username telah dikirim ke email Anda.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (recTab === 'outlet') {
      if (!recIdentifier.trim()) return setError('Masukkan Email atau Username Owner.');
      setLoading(true);
      try {
        const res = await requestOwnerForgotOutletId(recIdentifier);
        if (!res.success) return setError(res.error || 'Akun Owner tidak ditemukan.');
        setInfo(res.message || 'ID Outlet telah dikirim ke email terdaftar.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Lupa Password
    if (!recOtpSent) {
      if (!recIdentifier.trim()) return setError('Masukkan Email atau Username Owner.');
      setLoading(true);
      try {
        const res = await requestOwnerForgotPassword(recIdentifier);
        if (!res.success) return setError(res.error || 'Gagal mengirim OTP.');
        setRecOtpSent(true);
        setInfo(res.message || 'Kode OTP reset kata sandi telah dikirim.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!/^\d{6}$/.test(recOtp.trim())) return setError('Kode OTP wajib 6 angka.');
    const passErr = validatePassword(recNewPass);
    if (passErr) return setError(passErr);

    setLoading(true);
    try {
      const hash = await hashPassword(recNewPass);
      const res = await confirmOwnerForgotPassword({
        identifier: recIdentifier,
        otp: recOtp,
        newPasswordHash: hash,
      });
      if (!res.success) return setError(res.error || 'Gagal memperbarui kata sandi.');
      if (res.userId) {
        const local = await db.users.get(res.userId);
        if (local) await db.users.update(res.userId, { passwordHash: hash });
      }
      setInfo(res.message || 'Kata sandi berhasil diperbarui. Silakan masuk.');
      setRecOtpSent(false);
      setRecOtp('');
      setRecNewPass('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#f6f5f0] grid lg:grid-cols-12">
      {/* Panel Kiri: Branding Website SaaS Backoffice */}
      <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 bg-gradient-to-br from-[#12543C] via-[#1F7A5A] to-[#166247] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <LembayungLogo size={46} />
          <div>
            <div className="text-xl font-bold tracking-tight">Lembayung</div>
            <div className="text-xs text-white/80">Owner &amp; Manager Web Backoffice</div>
          </div>
        </div>

        <div className="relative z-10 max-w-lg flex flex-col gap-6">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Pantau omzet, HPP, laba bersih, dan semua cabang dalam satu layar.
          </h1>
          <p className="text-sm text-white/85 leading-relaxed">
            Portal web khusus Owner dan Manager. Setiap perubahan bahan baku, resep HPP, dan harga menu otomatis tersinkron ke perangkat kasir Android di toko secara real-time.
          </p>

          <div className="grid grid-cols-1 gap-3 pt-2">
            <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-2xl p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <BarChart3 size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm">Analitik Penjualan &amp; Laba Rugi Detail</div>
                <div className="text-xs text-white/75 mt-0.5">
                  Grafik tren harian, margin per menu, arus kas anti hitung ganda, dan audit selisih shift kasir.
                </div>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-2xl p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <Building2 size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm">Multi-Cabang &amp; Akses Tim Terstruktur</div>
                <div className="text-xs text-white/75 mt-0.5">
                  Kelola beberapa cabang sekaligus, salin katalog menu 1 klik, dan delegasikan operasional ke Manager cabang.
                </div>
              </div>
            </div>

            <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-2xl p-4 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <Calculator size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm">Kalkulator HPP &amp; Manajemen Bahan Baku</div>
                <div className="text-xs text-white/75 mt-0.5">
                  Hitung otomatis harga pokok resep, sub-resep, dan saran harga jual ideal di layar lebar.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/70 flex items-center justify-between gap-3">
          <span>Lembayung Web Backoffice</span>
          <span>Transaksi Kasir (POS) khusus di aplikasi Android</span>
        </div>
      </div>

      {/* Panel Kanan: Form Login / Register / Recovery */}
      <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-center items-center p-6 sm:p-10">
        <div className="w-full max-w-[430px] flex flex-col gap-5">
          <div className="flex lg:hidden items-center gap-2.5 justify-center">
            <LembayungLogo size={42} />
            <div>
              <div className="text-lg font-bold text-[#1f1e1d]">Lembayung</div>
              <div className="text-xs text-[#1F7A5A] font-medium">Owner &amp; Manager Web Portal</div>
            </div>
          </div>

          <div className="bg-white border border-[#e2e0d8] rounded-2xl p-7 shadow-sm flex flex-col gap-5">
            {mode === 'login' && (
              <>
                <div>
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#e4f1ea] text-[#1F7A5A] mb-2">
                    <ShieldCheck size={13} /> Portal Admin (Owner &amp; Manager)
                  </div>
                  <h2 className="text-2xl font-bold text-[#1f1e1d]">Masuk ke Dashboard</h2>
                  <p className="text-xs text-[#6b6a68] mt-1">
                    Gunakan email dan kata sandi akun Owner atau Manager Anda.
                  </p>
                </div>

                <form onSubmit={handleWebLogin} className="flex flex-col gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#4a4947] mb-1.5">
                      Email *
                    </label>
                    <div className="relative">
                      <Mail
                        size={16}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b6a68]"
                      />
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="owner@usahaanda.com"
                        className="w-full h-11 border border-[#d6d3c8] rounded-xl pl-10 pr-3.5 text-sm focus:outline-none focus:border-[#1F7A5A]"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#4a4947] mb-1.5">
                      Kata Sandi *
                    </label>
                    <div className="relative">
                      <Lock
                        size={16}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b6a68]"
                      />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="Masukkan kata sandi"
                        className="w-full h-11 border border-[#d6d3c8] rounded-xl pl-10 pr-11 text-sm focus:outline-none focus:border-[#1F7A5A]"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6a68] hover:text-[#1f1e1d]"
                      >
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3.5 py-2.5 rounded-xl">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm transition disabled:opacity-60"
                  >
                    {loading ? 'Memeriksa Akun...' : 'Masuk Dashboard'}
                  </button>
                </form>

                <div className="pt-3 border-t border-[#eeece5] flex flex-col gap-2.5 text-xs text-center">
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('recovery');
                        setRecTab('password');
                        setError('');
                        setInfo('');
                      }}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Lupa Password?
                    </button>
                    <span className="text-[#d6d3c8]">•</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('recovery');
                        setRecTab('outlet');
                        setError('');
                        setInfo('');
                      }}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Lupa ID Outlet?
                    </button>
                  </div>
                  <div className="text-[#6b6a68]">
                    Belum punya akun usaha?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setRegStep('form');
                        setError('');
                        setInfo('');
                      }}
                      className="font-semibold text-[#1F7A5A] hover:underline"
                    >
                      Daftar Usaha Baru
                    </button>
                  </div>
                </div>
              </>
            )}

            {mode === 'register' && (
              <>
                <div>
                  <h2 className="text-xl font-bold text-[#1f1e1d]">
                    {regStep === 'form' ? 'Daftar Usaha Baru (Owner)' : 'Verifikasi Email Owner'}
                  </h2>
                  <p className="text-xs text-[#6b6a68] mt-1">
                    {regStep === 'form'
                      ? 'Email akan diverifikasi OTP, lalu ID Outlet dikirim otomatis ke email Anda.'
                      : `Masukkan kode 6 angka yang dikirim ke ${regMaskedEmail}`}
                  </p>
                </div>

                {regStep === 'form' ? (
                  <form onSubmit={handleRegisterSendOtp} className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium text-[#4a4947] mb-1">
                          Nama Usaha *
                        </label>
                        <input
                          type="text"
                          value={regNamaUsaha}
                          onChange={(e) => setRegNamaUsaha(e.target.value)}
                          placeholder="Kedai Kopi"
                          className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#4a4947] mb-1">
                          Nama Owner *
                        </label>
                        <input
                          type="text"
                          value={regNamaOwner}
                          onChange={(e) => setRegNamaOwner(e.target.value)}
                          placeholder="Nama Anda"
                          className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Alamat Usaha
                      </label>
                      <input
                        type="text"
                        value={regAlamat}
                        onChange={(e) => setRegAlamat(e.target.value)}
                        placeholder="Jl. Sudirman No. 10"
                        className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs font-medium text-[#4a4947] mb-1">
                          Username *
                        </label>
                        <input
                          type="text"
                          value={regUsername}
                          onChange={(e) => setRegUsername(e.target.value.replace(/\s/g, ''))}
                          placeholder="budi_owner"
                          className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[#4a4947] mb-1">
                          PIN Aplikasi (6 Angka) *
                        </label>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          value={regPin}
                          onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ''))}
                          placeholder="123456"
                          className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Email Owner *
                      </label>
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="owner@gmail.com"
                        className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4a4947] mb-1">
                        Kata Sandi *
                      </label>
                      <PasswordInputWithRules
                        value={regPassword}
                        onChange={setRegPassword}
                        placeholder="Min. 8 karakter (Aa1!)"
                      />
                    </div>
                    {error && (
                      <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                        {error}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={loading}
                      className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm disabled:opacity-60"
                    >
                      {loading ? 'Mengirim Kode...' : 'Kirim Kode Verifikasi Email'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleRegisterVerify} className="flex flex-col gap-3">
                    {info && (
                      <div className="text-xs font-medium bg-[#e4f1ea] text-[#14532d] px-3 py-2 rounded-xl">
                        {info}
                      </div>
                    )}
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={regOtp}
                      onChange={(e) => setRegOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full h-12 border border-[#d6d3c8] rounded-xl text-center text-xl font-bold tracking-[0.4em]"
                      required
                    />
                    {error && (
                      <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                        {error}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={loading || regOtp.length !== 6}
                      className="h-11 rounded-xl bg-[#1F7A5A] text-white font-semibold text-sm disabled:opacity-50"
                    >
                      {loading ? 'Memverifikasi...' : 'Verifikasi & Masuk Dashboard'}
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                    setInfo('');
                  }}
                  className="text-xs font-semibold text-[#1F7A5A] text-center"
                >
                  ‹ Kembali ke Halaman Masuk
                </button>
              </>
            )}

            {mode === 'recovery' && (
              <>
                <div>
                  <h2 className="text-xl font-bold text-[#1f1e1d]">Pemulihan Akun Owner</h2>
                  <p className="text-xs text-[#6b6a68] mt-1">
                    Pilih bantuan akun yang Anda butuhkan.
                  </p>
                </div>

                <div className="grid grid-cols-3 bg-[#ece9e0] rounded-xl p-1 text-xs">
                  {(['password', 'username', 'outlet'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setRecTab(t);
                        setRecOtpSent(false);
                        setError('');
                        setInfo('');
                      }}
                      className={`py-2 rounded-lg transition ${
                        recTab === t
                          ? 'bg-white text-[#1F7A5A] font-semibold shadow-2xs'
                          : 'text-[#4a4947]'
                      }`}
                    >
                      {t === 'password' ? 'Password' : t === 'username' ? 'Username' : 'ID Outlet'}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleRecoverySubmit} className="flex flex-col gap-3">
                  {recTab === 'username' ? (
                    <input
                      type="email"
                      value={recEmail}
                      onChange={(e) => setRecEmail(e.target.value)}
                      placeholder="Email terdaftar Owner"
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                      required
                    />
                  ) : (
                    <input
                      type="text"
                      value={recIdentifier}
                      onChange={(e) => setRecIdentifier(e.target.value)}
                      disabled={recTab === 'password' && recOtpSent}
                      placeholder="Email atau Username Owner"
                      className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-sm"
                      required
                    />
                  )}

                  {recTab === 'password' && recOtpSent && (
                    <>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={recOtp}
                        onChange={(e) => setRecOtp(e.target.value.replace(/\D/g, ''))}
                        placeholder="Kode OTP 6 Angka"
                        className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-center font-bold tracking-widest"
                        required
                      />
                      <PasswordInputWithRules
                        value={recNewPass}
                        onChange={setRecNewPass}
                        placeholder="Kata sandi baru (min. 8 karakter)"
                      />
                    </>
                  )}

                  {info && (
                    <div className="text-xs font-medium bg-[#e4f1ea] text-[#14532d] px-3 py-2 rounded-xl">
                      {info}
                    </div>
                  )}
                  {error && (
                    <div className="text-xs font-medium bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-xl">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 rounded-xl bg-[#1F7A5A] text-white font-semibold text-sm disabled:opacity-60"
                  >
                    {loading
                      ? 'Memproses...'
                      : recTab === 'password' && recOtpSent
                      ? 'Simpan Kata Sandi Baru'
                      : 'Kirim ke Email'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                    setInfo('');
                  }}
                  className="text-xs font-semibold text-[#1F7A5A] text-center"
                >
                  ‹ Kembali ke Halaman Masuk
                </button>
              </>
            )}
          </div>

          {/* Tombol Unduh Aplikasi Kasir Android */}
          {androidDownloadUrl && (
            <a
              href={androidDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] hover:border-[#1F7A5A] text-[#1f1e1d] text-xs font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <Download size={15} className="text-[#1F7A5A]" />
              Unduh Aplikasi Kasir Android
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
