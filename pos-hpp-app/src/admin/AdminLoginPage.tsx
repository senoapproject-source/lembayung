import React, { useEffect, useState } from 'react';
import { CuaninLogo } from '../components/CuaninLogo';
import { getAppEnvironment } from '../services/syncService';
import {
  checkAdminBootstrapStatus,
  confirmAdminBootstrap,
  loginPlatformAdmin,
  saveAdminSession,
  sendAdminBootstrapOtp,
  type AdminSession,
} from './adminService';
import { Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserPlus } from 'lucide-react';

interface AdminLoginPageProps {
  onLoginSuccess: (session: AdminSession) => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({ onLoginSuccess }) => {
  const [checking, setChecking] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Bootstrap first Super Admin state
  const [bootNama, setBootNama] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootOtpSent, setBootOtpSent] = useState(false);
  const [bootOtp, setBootOtp] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const env = getAppEnvironment();

  useEffect(() => {
    checkAdminBootstrapStatus()
      .then((res) => {
        if (res.success) {
          setNeedsBootstrap(Boolean(res.needsBootstrap));
        }
      })
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await loginPlatformAdmin(email.trim().toLowerCase(), password);
      if (!res.success || !res.token || !res.admin) {
        setError(res.error || 'Gagal masuk ke Portal Administrator.');
        return;
      }
      const session: AdminSession = { token: res.token, admin: res.admin };
      saveAdminSession(session);
      onLoginSuccess(session);
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!bootNama.trim() || !bootEmail.includes('@') || bootPassword.length < 8) {
      setError('Nama, email valid, dan kata sandi minimal 8 karakter wajib diisi.');
      return;
    }
    setLoading(true);
    try {
      const res = await sendAdminBootstrapOtp(bootNama.trim(), bootEmail.trim().toLowerCase());
      if (!res.success) {
        setError(res.error || 'Gagal mengirim OTP aktivasi.');
        return;
      }
      setBootOtpSent(true);
      setInfo(res.message || 'Kode OTP 6 digit telah dikirim ke email Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await confirmAdminBootstrap({
        nama: bootNama.trim(),
        email: bootEmail.trim().toLowerCase(),
        password: bootPassword,
        otp: bootOtp.trim(),
      });
      if (!res.success || !res.token || !res.admin) {
        setError(res.error || 'Gagal memverifikasi OTP.');
        return;
      }
      const session: AdminSession = { token: res.token, admin: res.admin };
      saveAdminSession(session);
      onLoginSuccess(session);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-[430px] bg-[#1e293b] border border-[#334155] rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CuaninLogo size={40} />
            <div>
              <div className="font-bold text-base tracking-tight flex items-center gap-2">
                <span>Lembayung Admin</span>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    env === 'production'
                      ? 'bg-[#1F7A5A]/25 text-[#4ade80] border border-[#1F7A5A]'
                      : 'bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/50'
                  }`}
                >
                  {env === 'production' ? 'PROD' : 'TEST'}
                </span>
              </div>
              <div className="text-xs text-[#94a3b8]">Platform Control &amp; Multi-Admin Console</div>
            </div>
          </div>
          <ShieldCheck size={22} className="text-[#34d399] shrink-0" />
        </div>

        {checking ? (
          <div className="py-10 text-center text-xs text-[#94a3b8]">
            Memeriksa konfigurasi Administrator server...
          </div>
        ) : needsBootstrap ? (
          <div className="flex flex-col gap-3.5">
            <div className="bg-[#0f172a] border border-[#1F7A5A]/60 rounded-xl p-3 text-xs text-[#cbd5e1] flex items-start gap-2.5">
              <UserPlus size={16} className="text-[#34d399] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[#34d399]">Aktivasi Super Admin Pertama</div>
                <div className="mt-0.5 text-[#94a3b8]">
                  Belum ada akun Administrator di environment ini. Daftarkan Super Admin utama Anda dengan verifikasi OTP email.
                </div>
              </div>
            </div>

            {!bootOtpSent ? (
              <form onSubmit={handleBootstrapSendOtp} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Nama Super Admin</label>
                  <input
                    type="text"
                    value={bootNama}
                    onChange={(e) => setBootNama(e.target.value)}
                    placeholder="Contoh: Seno Agung"
                    className="w-full h-10 rounded-xl bg-[#0f172a] border border-[#334155] px-3 text-sm text-white focus:outline-none focus:border-[#34d399]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Email Super Admin</label>
                  <input
                    type="email"
                    value={bootEmail}
                    onChange={(e) => setBootEmail(e.target.value)}
                    placeholder="admin@lembayung.id"
                    className="w-full h-10 rounded-xl bg-[#0f172a] border border-[#334155] px-3 text-sm text-white focus:outline-none focus:border-[#34d399]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Kata Sandi (min. 8 karakter)</label>
                  <input
                    type="password"
                    value={bootPassword}
                    onChange={(e) => setBootPassword(e.target.value)}
                    placeholder="Minimal 8 karakter kuat"
                    className="w-full h-10 rounded-xl bg-[#0f172a] border border-[#334155] px-3 text-sm text-white focus:outline-none focus:border-[#34d399]"
                    required
                  />
                </div>
                {error && <div className="text-xs bg-red-950/60 border border-red-700 text-red-200 px-3 py-2 rounded-xl">{error}</div>}
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm transition disabled:opacity-50"
                >
                  {loading ? 'Mengirim OTP...' : 'Kirim Kode OTP Aktivasi'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleBootstrapConfirm} className="flex flex-col gap-3">
                {info && <div className="text-xs bg-emerald-950/60 border border-emerald-700 text-emerald-200 px-3 py-2 rounded-xl">{info}</div>}
                <div>
                  <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Kode OTP 6 Digit dari Email</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={bootOtp}
                    onChange={(e) => setBootOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-11 rounded-xl bg-[#0f172a] border border-[#334155] px-3 text-center text-lg font-mono tracking-[0.4em] text-white focus:outline-none focus:border-[#34d399]"
                    required
                  />
                </div>
                {error && <div className="text-xs bg-red-950/60 border border-red-700 text-red-200 px-3 py-2 rounded-xl">{error}</div>}
                <button
                  type="submit"
                  disabled={loading}
                  className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm transition disabled:opacity-50"
                >
                  {loading ? 'Memverifikasi...' : 'Aktifkan Super Admin'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Email Administrator</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@lembayung.id"
                  className="w-full h-10 rounded-xl bg-[#0f172a] border border-[#334155] pl-9 pr-3 text-sm text-white focus:outline-none focus:border-[#34d399]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#cbd5e1] mb-1">Kata Sandi</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-10 rounded-xl bg-[#0f172a] border border-[#334155] pl-9 pr-10 text-sm text-white focus:outline-none focus:border-[#34d399]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-white"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs bg-red-950/60 border border-red-700 text-red-200 px-3 py-2 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-11 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-50 mt-1"
            >
              <KeyRound size={15} />
              {loading ? 'Memverifikasi...' : 'Masuk Console Admin'}
            </button>
          </form>
        )}

        <div className="text-center text-[11px] text-[#64748b] border-t border-[#334155] pt-3">
          Autentikasi diverifikasi di server Edge Function (HMAC-SHA256)
        </div>
      </div>
    </div>
  );
};
