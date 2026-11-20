import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { formatJam, formatRupiah, formatTanggalLengkap } from '../lib/calculations';
import {
  buildWhatsAppReceiptText,
  buildWhatsAppUrl,
  generateReceiptPngBlob,
  uploadReceiptImageToSupabase,
} from '../lib/receipt';
import type { AppSettings, Transaction } from '../types/models';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageCircle,
  Share2,
  X,
} from 'lucide-react';

interface ReceiptModalProps {
  tx: Transaction;
  settings?: AppSettings;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  tx,
  settings,
  onClose,
}) => {
  const [waNumber, setWaNumber] = useState(tx.noWaPelanggan || '');
  const [copiedLink, setCopiedLink] = useState(false);

  // Link Struk PNG langsung di Supabase Storage (Tanpa hosting tambahan)
  const [cloudReceiptUrl, setCloudReceiptUrl] = useState<string>('');
  const [uploadingLink, setUploadingLink] = useState<boolean>(false);
  const [uploadErr, setUploadErr] = useState<string>('');

  const showKasir = settings?.strukTampilkanKasir ?? true;
  const showNotes = settings?.strukTampilkanCatatanItem ?? true;
  const showPhone = settings?.strukTampilkanWaUsaha ?? true;
  const footerText = settings?.strukFooter || 'Terima kasih!';

  // Otomatis generate & upload Gambar Struk PNG ke Supabase Storage saat modal dibuka (jika online)
  useEffect(() => {
    let active = true;
    const autoUpload = async () => {
      if (!navigator.onLine) return;
      setUploadingLink(true);
      setUploadErr('');
      const res = await uploadReceiptImageToSupabase(tx, settings);
      if (!active) return;
      setUploadingLink(false);
      if (res.success && res.publicUrl) {
        setCloudReceiptUrl(res.publicUrl);
      } else if (res.error) {
        setUploadErr(res.error);
      }
    };
    autoUpload();
    return () => {
      active = false;
    };
  }, [tx.id]);

  const handleSendWhatsApp = async () => {
    let finalUrl = cloudReceiptUrl;
    if (!finalUrl && navigator.onLine && !uploadingLink) {
      setUploadingLink(true);
      const res = await uploadReceiptImageToSupabase(tx, settings);
      setUploadingLink(false);
      if (res.success && res.publicUrl) {
        finalUrl = res.publicUrl;
        setCloudReceiptUrl(res.publicUrl);
      }
    }
    const message = buildWhatsAppReceiptText(tx, settings, true, finalUrl || undefined);
    const url = buildWhatsAppUrl(waNumber, message);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = async () => {
    if (!cloudReceiptUrl) return;
    await navigator.clipboard?.writeText(cloudReceiptUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleSaveReceipt = async () => {
    const fileName = `struk-${tx.nomorStruk.replace(/[^a-zA-Z0-9]/g, '')}.png`;

    // Di APK Android (WebView), blob download diblokir oleh sistem Android.
    // Solusi paten: gunakan parameter ?download= pada URL Supabase Storage agar langsung terunduh ke HP!
    if (Capacitor.isNativePlatform()) {
      let targetUrl = cloudReceiptUrl;
      if (!targetUrl) {
        if (!navigator.onLine) {
          alert('Perangkat sedang offline. Sambungkan internet sebentar untuk mengunduh gambar struk.');
          return;
        }
        setUploadingLink(true);
        const res = await uploadReceiptImageToSupabase(tx, settings);
        setUploadingLink(false);
        if (res.success && res.publicUrl) {
          targetUrl = res.publicUrl;
          setCloudReceiptUrl(res.publicUrl);
        } else {
          alert(res.error || 'Gagal menyiapkan file struk untuk diunduh.');
          return;
        }
      }
      const sep = targetUrl.includes('?') ? '&' : '?';
      const downloadUrl = `${targetUrl}${sep}download=${encodeURIComponent(fileName)}`;
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // Di browser web biasa, unduh langsung dari Canvas Blob
    try {
      const blob = await generateReceiptPngBlob(tx, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert('Gagal menyimpan gambar struk.');
    }
  };

  const handleNativeShare = async () => {
    const message = buildWhatsAppReceiptText(tx, settings, true, cloudReceiptUrl || undefined);
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Struk ${tx.nomorStruk}`,
          text: message,
          url: cloudReceiptUrl || undefined,
        });
        return;
      } catch {
        // fallback copy
      }
    }
    await navigator.clipboard?.writeText(message);
    alert('Teks & link struk berhasil disalin ke clipboard.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-[390px] rounded-2xl p-5 flex flex-col gap-3.5 max-h-[88vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-start">
          <div className="w-6" />
          <div className="flex flex-col items-center text-center gap-1">
            <CheckCircle2 size={36} className="text-[#1F7A5A]" />
            <div className="font-bold text-base">Struk Transaksi {tx.nomorStruk}</div>
            <div className="text-xs text-[#6b6a68]">
              {formatTanggalLengkap(tx.waktu)} · {formatJam(tx.waktu)} · {tx.metodeBayar}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[#6b6a68]">
            <X size={20} />
          </button>
        </div>

        {/* Kertas Struk Preview */}
        <div className="bg-[#faf9f5] border border-[#e2e0d8] rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
          {settings?.logoUsaha && (
            <div className="flex justify-center pb-1">
              <img
                src={settings.logoUsaha}
                alt="Logo usaha"
                className="max-h-14 max-w-[140px] object-contain rounded-lg"
              />
            </div>
          )}
          <div className="font-bold text-sm text-center">
            {settings?.namaUsaha ?? 'Warung Sari'}
          </div>
          {settings?.strukHeader && (
            <div className="text-center italic text-[#6b6a68] text-[11px]">
              {settings.strukHeader}
            </div>
          )}
          <div className="text-center text-[#6b6a68] pb-2 border-b border-dashed border-[#d6d3c8]">
            {settings?.alamatUsaha}
            {showPhone && settings?.teleponUsaha ? ` · WA: ${settings.teleponUsaha}` : ''}
          </div>

          {(showKasir || tx.namaPelanggan) && (
            <div className="flex justify-between text-[11px] text-[#6b6a68] pb-1.5 border-b border-dashed border-[#d6d3c8]">
              {showKasir ? <span>Kasir: {tx.kasirNama}</span> : <span />}
              {tx.namaPelanggan && (
                <span className="font-semibold text-[#1f1e1d]">{tx.namaPelanggan}</span>
              )}
            </div>
          )}

          {tx.items.map((it) => (
            <div key={it.id} className="flex flex-col gap-0.5">
              <div className="flex justify-between">
                <span>
                  {it.menuNama} ×{it.jumlah}
                </span>
                <span className="font-medium">{formatRupiah(it.hargaJual * it.jumlah)}</span>
              </div>
              {showNotes && it.catatan && (
                <div className="text-[11px] text-[#6b6a68] italic">Catatan: {it.catatan}</div>
              )}
            </div>
          ))}

          {tx.diskonNominal > 0 && (
            <div className="flex justify-between text-[#9b1c12] pt-1">
              <span>{tx.diskonLabel || 'Diskon'}</span>
              <span>−{formatRupiah(tx.diskonNominal)}</span>
            </div>
          )}

          <div className="border-t border-dashed border-[#d6d3c8] pt-2 mt-1 flex justify-between font-bold text-sm">
            <span>Total ({tx.metodeBayar})</span>
            <span>{formatRupiah(tx.total)}</span>
          </div>

          {tx.metodeBayar === 'Cash' && (
            <div className="flex justify-between text-[#6b6a68]">
              <span>Tunai {formatRupiah(tx.uangDiterima)}</span>
              <span>Kembali {formatRupiah(tx.kembalian)}</span>
            </div>
          )}

          {footerText && (
            <div className="text-center text-[11px] text-[#6b6a68] pt-2 mt-1 border-t border-dashed border-[#d6d3c8]">
              {footerText}
            </div>
          )}
        </div>

        {/* Pengiriman lewat WhatsApp Biasa */}
        <div className="bg-[#e4f1ea] border border-[#c5dfd1] rounded-xl p-3 flex flex-col gap-2">
          <label className="text-xs font-semibold text-[#1f4d3a]">
            Kirim Struk + Link via WhatsApp Biasa
          </label>
          <div className="flex gap-2">
            <input
              type="tel"
              value={waNumber}
              onChange={(e) => setWaNumber(e.target.value)}
              placeholder="No. WA Pelanggan (0812... / kosongkan)"
              className="flex-1 h-10 rounded-lg border border-[#d6d3c8] bg-white px-3 text-xs focus:outline-none focus:border-[#1F7A5A]"
            />
            <button
              type="button"
              disabled={uploadingLink}
              onClick={handleSendWhatsApp}
              className="h-10 px-3.5 rounded-lg bg-[#1F7A5A] hover:bg-[#15563f] text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-60"
            >
              {uploadingLink ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <MessageCircle size={15} />
              )}
              Kirim WA
            </button>
          </div>
          <div className="text-[11px] text-[#6b6a68]">
            {cloudReceiptUrl
              ? 'Link gambar struk otomatis ikut terkirim di pesan WhatsApp.'
              : 'Isi nomor WA pelanggan untuk langsung chat, atau kosongkan untuk memilih kontak.'}
          </div>
        </div>

        {/* Link Struk Digital (Supabase Storage PNG) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-[#4a4947]">
              Link Gambar Struk Digital (Online)
            </span>
            {uploadingLink && (
              <span className="text-[11px] text-[#1F7A5A] flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" /> Membuat link...
              </span>
            )}
          </div>

          {cloudReceiptUrl ? (
            <div className="flex gap-1.5">
              <input
                type="text"
                readOnly
                value={cloudReceiptUrl}
                className="flex-1 h-9 rounded-lg border border-[#d6d3c8] bg-[#faf9f5] px-2.5 text-[11px] text-[#6b6a68]"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="h-9 px-3 rounded-lg border border-[#1F7A5A] text-[#1F7A5A] text-xs font-semibold flex items-center gap-1 shrink-0"
              >
                <Copy size={13} /> {copiedLink ? 'Tersalin!' : 'Salin'}
              </button>
              <a
                href={cloudReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Buka gambar struk"
                className="h-9 px-2.5 rounded-lg border border-[#d6d3c8] text-[#4a4947] flex items-center justify-center"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          ) : (
            <div className="text-[11px] text-[#6b6a68] bg-[#faf9f5] border border-[#e2e0d8] rounded-lg px-3 py-2">
              {uploadErr
                ? uploadErr
                : !navigator.onLine
                ? 'Sedang offline — kirim WA tetap jalan menggunakan teks struk lengkap.'
                : 'Menyiapkan link gambar struk...'}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            disabled={uploadingLink}
            onClick={handleSaveReceipt}
            className="h-11 rounded-[10px] border border-[#d6d3c8] text-[#1f1e1d] font-semibold text-xs flex items-center justify-center gap-1 disabled:opacity-60"
          >
            <Download size={14} /> Simpan Struk
          </button>
          <button
            type="button"
            onClick={handleNativeShare}
            className="h-11 rounded-[10px] border border-[#d6d3c8] text-[#1f1e1d] font-semibold text-xs flex items-center justify-center gap-1"
          >
            <Share2 size={14} /> Bagikan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-[10px] bg-[#1F7A5A] text-white font-semibold text-xs"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
