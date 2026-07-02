import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { VitePWA } from 'vite-plugin-pwa'

// vite-plugin-pwaはgenerateSWモードで、ビルド成果物の書き込み後（closeBundle）に
// 全HTMLエントリの</head>直前へデフォルトmanifest（/manifest.webmanifest）への
// <link rel="manifest">を直接書き込むため、transformIndexHtmlフックでは間に合わない。
// worker.html / inventory.html が独自に持つ専用manifestタグと重複してしまうので、
// closeBundle完了後にdistファイルを直接後処理して重複分を除去する。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const stripDuplicateManifestLink = (pageName) => ({
    name: `strip-duplicate-manifest-${pageName}`,
    apply: 'build',
    closeBundle: {
        sequential: true,
        order: 'post',
        handler() {
            const filePath = resolve(__dirname, 'dist', `${pageName}.html`)
            try {
                const html = readFileSync(filePath, 'utf-8')
                const stripped = html.replace('<link rel="manifest" href="/manifest.webmanifest">', '')
                if (stripped !== html) writeFileSync(filePath, stripped, 'utf-8')
            } catch {
                // dist未生成時（devサーバー等）は何もしない
            }
        },
    },
})

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
            includeAssets: [
                'favicon.png', 'apple-touch-icon.png', 'fonts/*',
                'icons/worker/*.png', 'icons/inventory/*.png',
                'manifest-worker.webmanifest', 'manifest-inventory.webmanifest',
            ],
            // index.html（管理者トップ）用のデフォルトマニフェスト。
            // worker.html / inventory.html は各HTMLの<link rel="manifest">で専用マニフェストを参照し、
            // ホーム画面追加時に個別のアイコン・名前を持たせている。
            manifest: {
                name: '工事原価管理システム',
                short_name: '工事原価管理',
                description: '建設業向け工事原価管理・作業日報アプリ',
                start_url: '/',
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
                globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,ico,webmanifest}'],
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
        stripDuplicateManifestLink('worker'),
        stripDuplicateManifestLink('inventory'),
    ],
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                worker: 'worker.html',
                inventory: 'inventory.html',
            },
        },
    },
})
