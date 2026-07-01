import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        nodePolyfills({
            include: ['stream', 'util'], // xlsx-js-style needs stream and util
            globals: {
                Buffer: true,
            },
        }),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.png', 'apple-touch-icon.png', 'fonts/*'],
            manifest: {
                name: '工事原価管理システム',
                short_name: '工事原価管理',
                description: '建設業向け工事原価管理・作業日報アプリ',
                start_url: '/?mode=worker',
                scope: '/',
                display: 'standalone',
                background_color: '#ffffff',
                theme_color: '#2563eb',
                lang: 'ja',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,ico}'],
                maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
                // Supabase API呼び出しはService Workerでキャッシュせず、
                // アプリ側のofflineCache.jsによるlocalStorageフォールバックに任せる
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'fonts-cache',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 60 * 24 * 365,
                            },
                        },
                    },
                ],
            },
        }),
    ],
})
