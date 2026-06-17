import { defineConfig } from 'vite'

// Cloudflare Tunnel 実機確認時のみ有効化（npm run dev:tunnel）
// localhost 開発では未設定のまま → ws://localhost:5174（既定）で HMR
const tunnelDev = process.env.VITE_TUNNEL === '1' || process.env.VITE_TUNNEL === 'true'

export default defineConfig({
  server: {
    // LAN / Cloudflare Tunnel から実機アクセス用
    host: true,
    // quick tunnel: ホスト名は毎回変わるため開発中は全ホスト許可
    allowedHosts: true,
    // cloudflared は http://localhost:5174 に合わせる
    port: 5174,
    strictPort: true,
    hmr: tunnelDev
      ? false // 実機確認では HMR 不要。ws://…:443 等の接続試行もしない
      : true, // localhost:5174 開発（clientPort:443 を付けると ws://localhost:443 で赤エラーになる）
  },
  preview: {
    allowedHosts: ['.trycloudflare.com'],
  },
})
