import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.lembayung.app',
  appName: 'Lembayung',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorUpdater: {
      // Kita kelola download & apply bundle secara mandiri dari Supabase Storage
      autoUpdate: false,
      resetWhenUpdate: true,
      statsUrl: '',
    },
  },
};

export default config;
