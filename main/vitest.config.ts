import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['__tests__/**/*.test.ts'],
        exclude: ['node_modules', '.next'],
        testTimeout: 120000, // 120s timeout for real LLM calls (GLM 4.5 Air uses reasoning tokens)
        hookTimeout: 30000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['lib/**/*.ts'],
            exclude: ['lib/**/*.d.ts']
        },
        // Environment variables for tests
        env: {
            NODE_ENV: 'test'
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './')
        }
    }
})
