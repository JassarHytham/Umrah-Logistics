
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Fix: Explicitly import process from node:process to ensure cwd() is correctly typed in the Vite configuration environment
import process from 'node:process';

export default defineConfig(({ mode }) => {
  // Load env variables from system or .env file. 
  // The third parameter '' loads all variables regardless of prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  // Priority: 
  // 1. VITE_GEMINI_API_KEY (Standard Vite prefix)
  // 2. API_KEY (Commonly used in deployment environments)
  const apiKey = env.VITE_GEMINI_API_KEY || env.API_KEY || '';

  return {
    plugins: [react()],
    define: {
      // Stringify the key to ensure it's injected as a string literal in the bundle
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      // Ensure the build fails if the key is missing to catch errors early (Optional)
    }
  };
});
