import React, { useState } from 'react';
import { buildSelfOrderUrl } from '../services/selfOrderService';
import type { AppSettings } from '../types/models';
import { Check, Copy, ExternalLink, QrCode, Share2, X } from 'lucide-react';

interface SelfOrderShareModalProps {
  settings?: AppSettings;
  onClose: () => void;
}

export const SelfOrderShareModal: React.FC<SelfOrderShareModalProps> = ({
  settings,
  onClose,
}) => {
  const outletId = (settings?.outletId || '').trim().toUpperCase();
  const [mejaInput, setMejaInput] = useState('');
  const [copied, setCopied] = useState(false);

  const orderUrl = buildSelfOrderUrl(outletId, {
    meja: mejaInput.trim() || undefined,
    customBaseUrl: settings?.strukBaseUrl || undefined,
  });

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(
    orderUrl
  )}`;

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(orderUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWa = () => {
    const storeName = settings?.namaUsaha || 'Lembayung';
    const branchName = settings?.namaCabang ? ` (${settings.namaCabang})` : '';
    const text =
      `Halo! Pesan menu *${storeName}${branchName}* langsung dari HP Anda (bisa Makan di Tempat, Ambil Sendiri, Pesan Antar, atau *Pesan Bareng* teman):\n\n` +
      `${orderUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[420px] rounded-2xl p-5 flex flex-col gap-4 shadow-2xl border border-[#e2e0d8] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#e4f1ea] text-[#1F7A5A] flex items-center justify-center">
              <QrCode size={18} />
            </div>
            <div>
              <div className="font-bold text-base text-[#1f1e1d]">QR &amp; Link Self-Order</div>
              <div className="text-[11px] text-[#6b6a68]">
                Makan di Tempat · Ambil Sendiri · Pesan Antar · Pesan Bareng
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose}>
            <X size={20} className="text-[#6b6a68]" />
          </button>
        </div>

        {/* Filter opsional Nomor Meja untuk cetak QR Meja */}
        <div>
          <label className="block text-xs font-semibold text-[#4a4947] mb-1">
            Label Meja (Opsional — kosongkan untuk Link Umum / Delivery)
          </label>
          <input
            type="text"
            value={mejaInput}
            onChange={(e) => setMejaInput(e.target.value)}
            placeholder="Contoh: Meja 1, Meja 2, VIP..."
            className="w-full h-10 border border-[#d6d3c8] rounded-xl px-3 text-xs focus:outline-none focus:border-[#1F7A5A]"
          />
        </div>

        {/* Kartu QR Siap Cetak / Scan */}
        <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-2xl p-4 flex flex-col items-center text-center gap-2.5">
          <div className="font-bold text-sm text-[#1f1e1d]">
            {settings?.namaUsaha || 'Lembayung'}
            {settings?.namaCabang ? ` · ${settings.namaCabang}` : ''}
          </div>
          {mejaInput.trim() ? (
            <span className="text-xs font-bold px-3 py-0.5 rounded-full bg-[#1F7A5A] text-white">
              {mejaInput.trim()}
            </span>
          ) : (
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#e4f1ea] text-[#1F7A5A]">
              Self-Order · Delivery · Pesan Bareng
            </span>
          )}
          <div className="bg-white p-3 rounded-2xl border border-[#e2e0d8] shadow-xs">
            <img
              src={qrImageUrl}
              alt="QR Code Self-Order"
              className="w-48 h-48 object-contain"
            />
          </div>
          <div className="text-[11px] text-[#6b6a68] max-w-[260px]">
            Scan QR atau buka link di bawah untuk memilih menu langsung dari HP tanpa install aplikasi.
          </div>
        </div>

        {/* Link Box */}
        <div className="bg-[#f4f9f6] border border-[#c5dfd1] rounded-xl p-2.5 flex items-center justify-between gap-2">
          <div className="text-[11px] font-mono text-[#1f4d3a] truncate select-all">
            {orderUrl}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="h-8 px-3 rounded-lg bg-white border border-[#c5dfd1] text-[#1F7A5A] text-xs font-semibold inline-flex items-center gap-1 shrink-0"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Tersalin' : 'Salin'}
          </button>
        </div>

        {/* Tombol Aksi */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleShareWa}
            className="h-10 rounded-xl bg-[#1F7A5A] hover:bg-[#15563f] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Share2 size={14} /> Bagikan ke WA
          </button>
          <a
            href={orderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-10 rounded-xl border border-[#d6d3c8] bg-white hover:bg-[#faf9f5] text-[#1f1e1d] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={14} /> Tes Buka Link
          </a>
        </div>
      </div>
    </div>
  );
};
