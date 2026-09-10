import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = env.PORT || '5175';
  const backendTarget = env.DEV_BACKEND_URL || `http://127.0.0.1:${backendPort}`;

  return {
    root: '.',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/web', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist/web',
      emptyOutDir: true,
    },
    server: {
      port: Number(env.DEV_WEB_PORT || 5174),
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/auth': { target: backendTarget, changeOrigin: true },
      },
    },
  };
});
