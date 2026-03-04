import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Ayah آية',
        short_name: 'Ayah',
        description: 'Quran Verse Recognition',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#10b981',
        theme_color: '#10b981',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB — needed for large JSON data
        globPatterns: ['**/*.{js,css,html,png,json,woff2}']
      }
    })
  ],
})
