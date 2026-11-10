/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Tauri WebView 环境目标：Windows WebView2（Chromium 105+）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri 期望固定端口；被占用直接失败而非换端口
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'chrome105',
    sourcemap: false,
    // Vite 8（rolldown）内建 oxc 压缩器；esbuild 需另行安装且已废弃
    minify: 'oxc',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
