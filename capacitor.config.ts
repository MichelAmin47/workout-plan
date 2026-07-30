import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.workout.plan',
  appName: 'Workout Plan',
  webDir: 'workout-app/dist',
  server: {
    url: 'https://workout-plan-taupe.vercel.app',
    cleartext: false,
    allowNavigation: ['*.vercel.app'],
  },
};

export default config;
