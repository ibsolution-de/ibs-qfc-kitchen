import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, '');
    return {
      base: '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:8080',
            changeOrigin: true,
            ws: true,
          },
        },
      },
      plugins: [react(), tailwindcss()],
      define: {
        '__APP_VERSION__': JSON.stringify(pkg.version),
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      },
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: 'vendor-react',
                  test: /node_modules[\\/](react|react-dom|react-router(?:-dom)?)[\\/]/,
                  priority: 3
                },
                {
                  name: 'vendor-ai',
                  test: /node_modules[\\/](@google[\\/]genai)[\\/]/,
                  priority: 2
                },
                {
                  name: 'vendor-date',
                  test: /node_modules[\\/](date-fns)[\\/]/,
                  priority: 1
                }
              ]
            }
          }
        }
      }
    };
});
