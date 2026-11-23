import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/poe-trade-stats': {
        target: 'https://www.pathofexile.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-trade-stats/, ''),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PoEHelper/0.1.0 local market client',
        },
      },
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
