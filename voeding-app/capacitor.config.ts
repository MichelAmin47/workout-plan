import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nutrition.coach',
  appName: 'Coach',
  webDir: 'dist',
  server: {
    url: 'https://workout-plan-77mz.vercel.app',
    cleartext: false,
    allowNavigation: ['*.vercel.app'],
  },
};

export default config;
