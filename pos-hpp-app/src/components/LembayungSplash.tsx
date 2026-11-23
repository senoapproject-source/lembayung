import React from 'react';

interface LembayungSplashProps {
  exiting: boolean;
}

export const LembayungSplash: React.FC<LembayungSplashProps> = ({ exiting }) => {
  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-between px-6 py-12 select-none overflow-hidden transition-all duration-500 ease-out ${
        exiting ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{
        background:
          'radial-gradient(circle at 50% 36%, #1E845E 0%, #135A3F 52%, #0B3827 100%)',
      }}
    >
      {/* Cahaya latar senja lembayung & zamrud */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="lembayung-splash-orb absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full opacity-35 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(251,176,64,0.75) 0%, rgba(236,106,82,0.35) 55%, transparent 100%)',
          }}
        />
        <div
          className="lembayung-splash-ring absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full border border-white/10"
        />
        <div
          className="lembayung-splash-ring-delayed absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full border border-white/5"
        />
      </div>

      {/* Spacer atas */}
      <div className="h-6" />

      {/* Konten Tengah: Logo Animasi + Nama Brand */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Kartu Ikon Animasi */}
        <div className="lembayung-splash-badge relative p-1.5 rounded-[30px] bg-white/15 backdrop-blur-md shadow-2xl border border-white/25">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={104}
            height={104}
            viewBox="0 0 1024 1024"
            className="rounded-[24px] block shadow-inner"
            role="img"
            aria-label="Logo Lembayung"
          >
            <defs>
              <linearGradient id="splashBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1E915E" />
                <stop offset="100%" stopColor="#105E3F" />
              </linearGradient>
              <linearGradient id="splashSun" x1="0.3" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="#FFC155" />
                <stop offset="60%" stopColor="#F48450" />
                <stop offset="100%" stopColor="#EC6A52" />
              </linearGradient>
              <clipPath id="splashSunClip">
                <rect x="330" y="180" width="520" height="440" />
              </clipPath>
            </defs>

            {/* Latar hijau zamrud */}
            <rect width="1024" height="1024" rx="220" fill="url(#splashBg)" />

            {/* Matahari senja lembayung yang terbit perlahan */}
            <g clipPath="url(#splashSunClip)">
              <circle
                cx="565"
                cy="485"
                r="245"
                fill="url(#splashSun)"
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
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-xs">
            Lembayung
          </h1>
          <p className="mt-1.5 text-xs font-medium tracking-wide text-white/80">
            Kasir Pintar &amp; Kalkulator HPP Usaha
          </p>
        </div>

        {/* Bar Progres Halus */}
        <div className="lembayung-splash-text mt-7 w-40 h-1.5 rounded-full bg-white/15 overflow-hidden p-[1px]">
          <div
            className="lembayung-splash-progress h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, #FBB040 0%, #FFFFFF 55%, #84E4B8 100%)',
            }}
          />
        </div>
      </div>

      {/* Footer Bawah */}
      <div className="lembayung-splash-text relative z-10 flex flex-col items-center gap-1 text-center">
        <span className="text-[11px] font-medium tracking-wider uppercase text-white/65">
          Siap Melayani Transaksi
        </span>
      </div>
    </div>
  );
};
