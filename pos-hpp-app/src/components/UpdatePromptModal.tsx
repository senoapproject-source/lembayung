import React, { useState } from 'react';
import { CuaninLogo } from './CuaninLogo';
import { applyOtaBundleUpdate, markVersionInstalled, type AppUpdateInfo } from '../services/syncService';
import { Download, RefreshCw, Sparkles, X } from 'lucide-react';

interface UpdatePromptModalProps {
  info: AppUpdateInfo;
  onDismiss: () => void;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  info,
  onDismiss,
}) => {
  const [updating, setUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleOtaInstall = async () => {
    if (!info.bundleZipUrl) return;
    setUpdating(true);
    setErrorMsg('');
    try {
      const res = await applyOtaBundleUpdate(info.bundleZipUrl, info.latestVersion);
      if (!res.success) {
        setErrorMsg(res.message);
      }
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-5">
      <div className="bg-white w-full max-w-[380px] rounded-2xl p-5 flex flex-col gap-4 shadow-xl border border-[#e2e0d8]">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2.5">
            <CuaninLogo size={42} />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base text-[#1f1e1d]">Update Lembayung</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A] flex items-center gap-1">
                  <Sparkles size={11} /> v{info.latestVersion}
                </span>
              </div>
              <div className="text-xs text-[#6b6a68]">
                Versi terpasang: v{info.currentVersion}
              </div>
            </div>
          </div>
          {!info.forceUpdate && !updating && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1 text-[#6b6a68] hover:text-[#1f1e1d]"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3.5 flex flex-col gap-1">
          <div className="text-xs font-semibold text-[#4a4947]">Apa yang baru:</div>
          <div className="text-xs text-[#6b6a68] whitespace-pre-line leading-relaxed">
            {info.releaseNotes}
          </div>
        </div>

        <div className="text-[11px] text-[#6b6a68]">
          Data bahan, resep, menu, dan transaksi Anda <strong>tetap aman dan tidak akan hilang</strong> saat memperbarui aplikasi.
        </div>

        {errorMsg && (
          <div className="text-xs bg-[#fbe4e1] text-[#9b1c12] px-3 py-2 rounded-lg">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {info.bundleZipUrl ? (
            <button
              type="button"
              disabled={updating}
              onClick={handleOtaInstall}
              className="h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <RefreshCw size={16} className={updating ? 'animate-spin' : ''} />
              {updating
                ? 'Mengunduh & Memasang Update...'
                : `Update Otomatis Sekarang (v${info.latestVersion})`}
            </button>
          ) : (
            <a
              href={info.downloadUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                markVersionInstalled(info.latestVersion);
                onDismiss();
              }}
              className="h-12 rounded-[10px] bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Download size={16} /> Download Update APK (v{info.latestVersion})
            </a>
          )}

          {!info.forceUpdate && !updating && (
            <button
              type="button"
              onClick={onDismiss}
              className="h-10 rounded-[10px] border border-[#d6d3c8] text-xs font-semibold text-[#6b6a68]"
            >
              Nanti Saja
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
