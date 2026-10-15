import { defineConfig } from 'vite';

// 公開 URL は game.chozo.net/hanbunko-vegetables/ 。
// 相対パス (base: './') で出力し、Workers のアセット配信パスに合わせて dist/hanbunko-vegetables/ に置く
export const PUBLIC_PATH = 'hanbunko-vegetables';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    outDir: `dist/${PUBLIC_PATH}`,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
