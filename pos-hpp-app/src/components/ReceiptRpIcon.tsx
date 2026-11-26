import React from 'react';

interface ReceiptRpIconProps {
  size?: number;
  className?: string;
}

/**
 * Ikon Struk / Riwayat Transaksi bergaya Lucide dengan tulisan "Rp" (Rupiah)
 * sebagai pengganti ikon Receipt bawaan yang memakai simbol "$".
 */
export const ReceiptRpIcon: React.FC<ReceiptRpIconProps> = ({
  size = 18,
  className = '',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 3v18l2.5-1.5L9 21l3-1.5L15 21l2.5-1.5L20 21V3l-2.5 1.5L15 3l-3 1.5L9 3 6.5 4.5 4 3Z" />
    <text
      x="12"
      y="14.6"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
      fontSize="7.4"
      fontWeight="700"
      fontFamily="system-ui, -apple-system, sans-serif"
      letterSpacing="-0.3"
    >
      Rp
    </text>
  </svg>
);
