import React from 'react';
import { formatJam, formatRupiah, formatTanggalLengkap } from '../lib/calculations';
import type { PublicReceiptPayload } from '../lib/receipt';
import { CheckCircle2, Printer, XCircle } from 'lucide-react';

interface PublicReceiptViewProps {
  receipt: PublicReceiptPayload;
  onCloseToApp?: () => void;
}

export const PublicReceiptView: React.FC<PublicReceiptViewProps> = ({
  receipt,
  onCloseToApp,
}) => {
  const isVoid = receipt.st === 'void';

  return (
    <div className="min-h-screen bg-[#ece9e0]/70 flex justify-center py-6 px-4">
      <div className="w-full max-w-[380px] flex flex-col gap-4">
        <div className="bg-white border border-[#e2e0d8] rounded-2xl p-5 shadow-sm flex flex-col gap-3.5">
          {/* Status badge */}
          <div className="flex flex-col items-center text-center gap-1">
            {isVoid ? (
              <XCircle size={36} className="text-[#9b1c12]" />
            ) : (
              <CheckCircle2 size={36} className="text-[#1F7A5A]" />
            )}
            <div className="font-bold text-lg text-[#1f1e1d]">{receipt.u}</div>
            {receipt.h && <div className="text-xs italic text-[#6b6a68]">{receipt.h}</div>}
            {receipt.a && receipt.a !== '-' && (
              <div className="text-xs text-[#6b6a68]">{receipt.a}</div>
            )}
            {receipt.p && <div className="text-xs text-[#6b6a68]">WA/Telp: {receipt.p}</div>}
          </div>

          {/* Info Transaksi */}
          <div className="border-t border-b border-dashed border-[#d6d3c8] py-2.5 text-xs flex flex-col gap-1 text-[#4a4947]">
            <div className="flex justify-between">
              <span>No. Struk</span>
              <span className="font-semibold text-[#1f1e1d]">{receipt.n}</span>
            </div>
            <div className="flex justify-between">
              <span>Waktu</span>
              <span>
                {formatTanggalLengkap(receipt.w)} · {formatJam(receipt.w)}
              </span>
            </div>
            {receipt.k && (
              <div className="flex justify-between">
                <span>Kasir</span>
                <span>{receipt.k}</span>
              </div>
            )}
            {receipt.c && (
              <div className="flex justify-between">
                <span>Pelanggan / Meja</span>
                <span className="font-semibold text-[#1f1e1d]">{receipt.c}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Metode Bayar</span>
              <span className="font-semibold text-[#1F7A5A]">{receipt.m}</span>
            </div>
          </div>

          {/* Item Pesanan */}
          <div className="flex flex-col gap-2 text-xs">
            {receipt.it.map((it, idx) => (
              <div key={idx} className="flex flex-col gap-0.5">
                <div className="flex justify-between items-start gap-2">
                  <span className="font-medium text-[#1f1e1d]">
                    {it.nm} ×{it.q}
                  </span>
                  <span className="font-semibold text-[#1f1e1d]">
                    {formatRupiah(it.hj * it.q)}
                  </span>
                </div>
                <div className="text-[11px] text-[#6b6a68]">
                  @ {formatRupiah(it.hj)}
                  {it.ct ? ` · Catatan: ${it.ct}` : ''}
                </div>
              </div>
            ))}
          </div>

          {/* Total & Kembalian */}
          <div className="border-t border-dashed border-[#d6d3c8] pt-2.5 flex flex-col gap-1 text-xs">
            {receipt.d > 0 && (
              <>
                <div className="flex justify-between text-[#6b6a68]">
                  <span>Subtotal</span>
                  <span>{formatRupiah(receipt.s)}</span>
                </div>
                <div className="flex justify-between text-[#9b1c12]">
                  <span>{receipt.dl || 'Diskon'}</span>
                  <span>−{formatRupiah(receipt.d)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center font-bold text-base text-[#1f1e1d] pt-1">
              <span>Total</span>
              <span>{formatRupiah(receipt.t)}</span>
            </div>
            {receipt.m === 'Cash' && (
              <>
                <div className="flex justify-between text-[#6b6a68]">
                  <span>Tunai Diterima</span>
                  <span>{formatRupiah(receipt.b)}</span>
                </div>
                <div className="flex justify-between text-[#6b6a68]">
                  <span>Kembalian</span>
                  <span>{formatRupiah(receipt.kb)}</span>
                </div>
              </>
            )}
          </div>

          {/* Footer Struk */}
          {receipt.f && (
            <div className="border-t border-[#eeece5] pt-3 text-center text-xs text-[#6b6a68]">
              {receipt.f}
            </div>
          )}
        </div>

        {/* Tombol Cetak / Kembali */}
        <div className="flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 h-11 rounded-xl border border-[#d6d3c8] bg-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Printer size={15} /> Cetak / Simpan PDF
          </button>
          {onCloseToApp && (
            <button
              type="button"
              onClick={onCloseToApp}
              className="flex-1 h-11 rounded-xl bg-[#1F7A5A] text-white text-xs font-semibold"
            >
              Buka Aplikasi POS
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
