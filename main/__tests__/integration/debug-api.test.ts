import { describe, it } from 'vitest';

/**
 * Debug test to see what error the API is returning
 */

const API_BASE_URL = 'http://localhost:3000';

describe('Debug API Response', () => {
    it('should show full API response', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: 'test',
                provider: 'openrouter',
                model: 'qwen/qwen-2.5-coder-32b-instruct',
            }),
        });

        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                console.log('Chunk:', chunk);
            }
        }
    }, 60000);
});
