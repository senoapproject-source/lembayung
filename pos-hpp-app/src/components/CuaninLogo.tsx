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
    className={`rounded-[24%] shadow-xs shrink-0 ${className}`}
    role="img"
    aria-label="Logo Lembayung"
  >
    <defs>
      <linearGradient id="lembayungBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#1B8A5A" />
        <stop offset="100%" stopColor="#126846" />
      </linearGradient>
      <linearGradient id="lembayungSun" x1="0.3" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#FBB040" />
        <stop offset="60%" stopColor="#F48450" />
        <stop offset="100%" stopColor="#EC6A52" />
      </linearGradient>
      <clipPath id="lembayungSunClip">
        <rect x="330" y="180" width="520" height="440" />
      </clipPath>
    </defs>
    {/* Latar hijau zamrud Lembayung */}
    <rect width="1024" height="1024" rx="220" fill="url(#lembayungBg)" />
    {/* Matahari senja lembayung di belakang grafik */}
    <circle cx="565" cy="485" r="245" fill="url(#lembayungSun)" clipPath="url(#lembayungSunClip)" />
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
