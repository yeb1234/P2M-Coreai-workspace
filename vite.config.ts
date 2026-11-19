import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // 端口规则：<服务前缀><两位项目号>。P2 的 Web 入口是 12302；
    // dev 取 12322（= 12302 + 20，沿用旧 11102→11122 的 +20 惯例），
    // 代理仍打到生产入口 12302（同源，不触发 CORS）
    port: 12322,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:12302',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 必须清空：之前是 false，导致每次构建只新增不删除旧 chunk。
    // 累积下来 dist/assets 里堆了 839 个文件（同名页面 44 个 hash 版本），
    // 镜像 71MB，而首页实际只引用 17 个 js。
    // public/ 里的 favicon / icons / sounds 会被自动重新复制，不受影响。
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react') || id.includes('\\react') || id.includes('react-router-dom')) return 'react';
          if (id.includes('zustand') || id.includes('dexie')) return 'state';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
})
