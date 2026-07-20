import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.workout.plan.beta',
  appName: 'Workout Beta',
  webDir: 'dist',
  server: {
    url: 'https://workout-plan-git-beta-michelamin-5305s-projects.vercel.app',
    cleartext: false,
  },
};

export default config;
