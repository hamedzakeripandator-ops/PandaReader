import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      // این خط به ما کمک می‌کند اگر خواستیم بعداً از آدرس‌دهی‌های میانبر استفاده کنیم به مشکل نخوریم
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // مرحله ۳ ـ بخش الف (ممیزی §۱.۲): بدونِ سورس‌مپ در پروداکشن،
    // هدفِ مناسبِ Electron 33 (کرومیوم ۱۲۶ — همهٔ سینتکسِ مدرن را
    // دارد)، و چانک‌های جدا برای سنگین‌ترین وابستگی‌ها تا باندلِ
    // اولیه سبک شود. آستانهٔ هشدارِ اندازه هم بالا رفت تا چانکِ
    // pdfjs (که ذاتاً بزرگ است) لاگِ بیلد را شلوغ نکند.
    sourcemap: false,
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('node_modules/konva') || id.includes('node_modules/react-konva')) return 'vendor-konva';
          return undefined;
        },
      },
    },
  },
});