import { healthResponseSchema } from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { createTestApp } from '../harness.ts';

describe('GET /health', () => {
  test('responde 200 com corpo validado pelo schema compartilhado (Zod)', async () => {
    const t = await createTestApp();
    try {
      const resposta = await t.app.inject({ method: 'GET', url: '/health' });
      expect(resposta.statusCode).toBe(200);

      const corpo = healthResponseSchema.parse(resposta.json<unknown>());
      expect(corpo).toEqual({ status: 'ok', database: 'ok' });
    } finally {
      await t.close();
    }
  });

  test('cada app de teste usa seu próprio banco temporário', async () => {
    const um = await createTestApp();
    const dois = await createTestApp();
    try {
      expect(um.database.filePath).not.toBe(dois.database.filePath);
      expect(um.app.hasDecorator('db')).toBe(true);

      const r1 = await um.app.inject({ method: 'GET', url: '/health' });
      const r2 = await dois.app.inject({ method: 'GET', url: '/health' });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
    } finally {
      await um.close();
      await dois.close();
    }
  });
});
