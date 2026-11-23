import React from 'react';

interface LembayungSplashProps {
  exiting: boolean;
}

export const LembayungSplash: React.FC<LembayungSplashProps> = ({ exiting }) => {
  return (
    <div
      className={`fixed inset-0 z-[100] bg-[#1F7A5A] flex flex-col items-center justify-between px-6 py-12 select-none overflow-hidden transition-all duration-700 ease-in-out ${
        exiting ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Lingkaran cincin tipis solid tanpa gradasi */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="lembayung-splash-ring absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full border border-white/10" />
        <div className="lembayung-splash-ring-delayed absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full border border-white/5" />
      </div>

      {/* Spacer atas */}
      <div className="h-6" />

      {/* Konten Tengah: Logo Animasi + Nama Brand */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Kartu Ikon Animasi (Warna Solid) */}
        <div className="lembayung-splash-badge relative p-2 rounded-[30px] bg-white/12 shadow-xl border border-white/20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={108}
            height={108}
            viewBox="0 0 1024 1024"
            className="rounded-[24px] block"
            role="img"
            aria-label="Logo Lembayung"
          >
            <defs>
              <clipPath id="splashSunClip">
                <rect x="330" y="180" width="520" height="440" />
              </clipPath>
            </defs>

            {/* Latar hijau solid */}
            <rect width="1024" height="1024" rx="220" fill="#166247" />

            {/* Matahari senja lembayung solid yang terbit perlahan */}
            <g clipPath="url(#splashSunClip)">
              <circle
                cx="565"
                cy="485"
                r="245"
                fill="#F48450"
                className="lembayung-splash-sun"
              />
            </g>

            {/* Batang grafik 1 (kiri) tumbuh dari bawah */}
            <path
              d="M428 620 L428 538 Q428 462 504 456 L516 456 L516 620 Z"
              fill="#FFFFFF"
              className="lembayung-splash-bar1"
            />

            {/* Batang grafik 2 (kanan) tumbuh lebih tinggi */}
            <path
              d="M556 620 L556 440 Q556 356 642 350 L654 350 L654 620 Z"
              fill="#FFFFFF"
              className="lembayung-splash-bar2"
            />

            {/* Huruf L utama */}
            <path
              d="M294 294 Q384 316 384 410 L384 662 L730 662 Q690 748 594 748 L294 748 Z"
              fill="#FFFFFF"
              className="lembayung-splash-letter"
            />
          </svg>
        </div>

        {/* Tipografi Brand */}
        <div className="lembayung-splash-text mt-6 flex flex-col items-center text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Lembayung
          </h1>
          <p className="mt-1.5 text-xs font-medium tracking-wide text-white/85">
            Kasir Pintar &amp; Kalkulator HPP Usaha
          </p>
        </div>

        {/* Bar Progres Solid */}
        <div className="lembayung-splash-text mt-7 w-44 h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div className="lembayung-splash-progress h-full rounded-full bg-white" />
        </div>
      </div>

      {/* Footer Bawah */}
      <div className="lembayung-splash-text relative z-10 flex flex-col items-center gap-1 text-center">
        <span className="text-[11px] font-medium tracking-wider uppercase text-white/70">
          Siap Melayani Transaksi
        </span>
      </div>
    </div>
  );
};
