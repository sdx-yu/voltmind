import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4318,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('node_modules/react') || id.includes('react-dom')) return 'react'
          if (id.includes('mammoth')) return 'import-docx'
          if (id.includes('jszip')) return 'zip'
          if (id.includes('@xmldom') || id.includes('/sax/')) return 'xml'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
