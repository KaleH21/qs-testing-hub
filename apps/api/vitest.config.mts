import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// swc để giữ decorator metadata cho DI của Nest trong test
export default defineConfig({ plugins: [swc.vite()], test: { include: ['src/**/*.test.ts'] } });
