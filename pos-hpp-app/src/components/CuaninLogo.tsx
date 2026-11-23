import React from 'react';

interface CuaninLogoProps {
  size?: number;
  className?: string;
}

export const LembayungLogo: React.FC<CuaninLogoProps> = ({ size = 56, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    className={`rounded-[24%] shadow-xs shrink-0 block ${className}`}
    role="img"
    aria-label="Logo Lembayung"
  >
    {/* Latar hijau zamrud Lembayung (solid tanpa url(#id) agar tidak bentrok dengan elemen hidden) */}
    <rect width="1024" height="1024" rx="220" fill="#187852" />
    {/* Matahari senja lembayung di belakang grafik */}
    <path
      d="M 360.55 620 A 245 245 0 1 1 769.45 620 Z"
      fill="#F48450"
    />
    {/* Batang grafik 1 (kiri) */}
    <path
      d="M428 620 L428 538 Q428 462 504 456 L516 456 L516 620 Z"
      fill="#FFFFFF"
    />
    {/* Batang grafik 2 (kanan, lebih tinggi) */}
    <path
      d="M556 620 L556 440 Q556 356 642 350 L654 350 L654 620 Z"
      fill="#FFFFFF"
    />
    {/* Huruf L tegas & elegan */}
    <path
      d="M294 294 Q384 316 384 410 L384 662 L730 662 Q690 748 594 748 L294 748 Z"
      fill="#FFFFFF"
    />
  </svg>
);

export const CuaninLogo = LembayungLogo;
