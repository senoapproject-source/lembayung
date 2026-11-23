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
    LocalNotifications: {
      smallIcon: 'ic_stat_lembayung',
      iconColor: '#1F7A5A',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
