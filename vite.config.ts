import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import path from 'path';

export default defineConfig({
  define: {
    // 未提交修改时标记 -dirty，避免版本号与已发布版本混淆
    __BUILD_HASH__: JSON.stringify(
      execSync('git -C .. rev-parse --short HEAD').toString().trim()
      + (execSync('git -C .. status --porcelain').toString().trim() ? '-dirty' : ''),
    ),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'wasm': path.resolve(__dirname, 'engine/dist'),
    },
  },
  server: {
    port: 3002,
    host: '0.0.0.0',
    allowedHosts: ['allenlinux','192.168.0.5'],
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
