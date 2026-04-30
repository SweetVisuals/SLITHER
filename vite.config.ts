import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// Custom plugin to serve the Particle Network WASM file correctly.
// When Vite pre-bundles @particle-network/thresh-sig, the WASM fetch URL
// (built from import.meta.url) points to the wrong location.
// This middleware intercepts any request ending in the WASM filename
// and serves it directly from node_modules.
function serveParticleWasm() {
  return {
    name: 'serve-particle-wasm',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url?.includes('thresh_sig_wasm_bg.wasm')) {
          const wasmPath = path.resolve(__dirname, 'node_modules/@particle-network/thresh-sig/wasm/thresh_sig_wasm_bg.wasm');
          if (fs.existsSync(wasmPath)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            fs.createReadStream(wasmPath).pipe(res);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'stream', 'events'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
      }),
      serveParticleWasm(),
      react(), 
      tailwindcss(),
      topLevelAwait(),
      wasm(),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'global': 'globalThis',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Particle SDK packages are pinned to node_modules to prevent duplicate resolution
        '@particle-network/auth-core': path.resolve(__dirname, 'node_modules/@particle-network/auth-core'),
        '@particle-network/aa': path.resolve(__dirname, 'node_modules/@particle-network/aa'),
        '@particle-network/auth-core-modal': path.resolve(__dirname, 'node_modules/@particle-network/auth-core-modal'),
        '@particle-network/wallet': path.resolve(__dirname, 'node_modules/@particle-network/wallet'),
        '@particle-network/chains': path.resolve(__dirname, 'node_modules/@particle-network/chains'),
      },
    },
    optimizeDeps: {
      include: [
        'buffer',
        'process',
        '@particle-network/aa',
        '@particle-network/auth-core-modal',
        '@particle-network/chains',
        '@particle-network/thresh-sig',
        'ethers'
      ],
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks: {
            antd: ['antd', '@ant-design/icons'],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
