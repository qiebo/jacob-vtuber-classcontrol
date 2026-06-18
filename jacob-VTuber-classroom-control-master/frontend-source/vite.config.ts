import { defineConfig, normalizePath } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';

const createConfig = async (outDir: string) => ({
  plugins: [
    (await import('vite-plugin-static-copy')).viteStaticCopy({
      targets: [
        {
          src: normalizePath(path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js')),
          dest: './libs/vad/',
        },
        {
          src: normalizePath(path.resolve(__dirname, 'src/renderer/public/libs/silero_vad_legacy.onnx')),
          dest: './libs/vad/',
        },
        {
          src: normalizePath(path.resolve(__dirname, 'src/renderer/public/libs/silero_vad_v5.onnx')),
          dest: './libs/vad/',
        },
        {
          src: normalizePath(path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.wasm')),
          dest: './libs/',
        },
        {
          src: normalizePath(path.resolve(__dirname, 'src/renderer/WebSDK/Core/live2dcubismcore.js')),
          dest: './libs/',
        },
      ],
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/renderer/src"),
      "@internationalized/date": path.resolve(
        __dirname,
        "./node_modules/@internationalized/date/dist/module.js",
      ),
      "@framework": path.resolve(__dirname, "./src/renderer/WebSDK/Framework/src"),
      "@cubismsdksamples": path.resolve(__dirname, "./src/renderer/WebSDK/src"),
      "@motionsyncframework": path.resolve(
        __dirname,
        "./src/renderer/MotionSync/Framework/src",
      ),
      "@motionsync": path.resolve(__dirname, "./src/renderer/MotionSync/src"),
      "framer-motion": path.resolve(
        __dirname,
        "./node_modules/framer-motion/dist/cjs/index.js",
      ),
      "framer-motion/dom": path.resolve(
        __dirname,
        "./node_modules/framer-motion/dist/cjs/dom.js",
      ),
      "framer-motion/dom/mini": path.resolve(
        __dirname,
        "./node_modules/framer-motion/dist/cjs/dom-mini.js",
      ),
      "framer-motion/m": path.resolve(
        __dirname,
        "./node_modules/framer-motion/dist/cjs/m.js",
      ),
      "framer-motion/mini": path.resolve(
        __dirname,
        "./node_modules/framer-motion/dist/cjs/mini.js",
      ),
      "/src": path.resolve(__dirname, "./src/renderer/src"),
    },
  },
  root: path.join(__dirname, "src/renderer"),
  publicDir: path.join(__dirname, "src/renderer/public"),
  base: "./",
  server: {
    port: 3000,
  },
  build: {
    outDir: path.join(__dirname, outDir),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        main: path.join(__dirname, "src/renderer/index.html"),
      },
    },
  },
  ssr: {
    noExternal: ['vite-plugin-static-copy'],
  },
});

export default defineConfig(async ({ mode }) => {
  if (mode === 'web') {
    return createConfig('dist/web');
  }
  return createConfig('dist/renderer');
});
