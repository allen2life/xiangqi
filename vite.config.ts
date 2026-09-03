import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import path from 'path';

// git 从 cwd 向上定位仓库根：monorepo 子目录与独立仓库都能取到 hash
function buildHash(): string {
  try {
    const opts = { cwd: __dirname };
    const hash = execSync('git rev-parse --short HEAD', opts).toString().trim();
    const dirty = execSync('git status --porcelain', opts).toString().trim() ? '-dirty' : '';
    return hash + dirty;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: {
    // 未提交修改时标记 -dirty，避免版本号与已发布版本混淆
    __BUILD_HASH__: JSON.stringify(buildHash()),
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
