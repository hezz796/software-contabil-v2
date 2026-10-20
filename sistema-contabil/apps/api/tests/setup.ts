import { afterEach, expect } from 'vitest';
import { activeTestDatabaseCount } from './harness.ts';

// Garante o critério "um banco temporário por teste, destruído ao final":
// qualquer teste que saia com banco aberto derruba a suíte.
afterEach(() => {
  expect(
    activeTestDatabaseCount(),
    'teste terminou com banco temporário aberto (faltou destroy())',
  ).toBe(0);
});
