import { describe, expect, test } from 'vitest';
import { formatarCnpj, montarCnpj, normalizarCnpj, validarCnpj } from '@sistema-contabil/shared';

/**
 * Domínio de CNPJ (RF-01, CA-15): base do teste de integração do cadastro de
 * empresa — aqui só a regra pura (dígitos verificadores, normalização).
 */
describe('CNPJ (RF-01, CA-15)', () => {
  test('CA-15 dígitos verificadores: CNPJs conhecidos válidos passam e dígito adulterado falha', () => {
    // CNPJs de exemplo amplamente usados em documentação/testes
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
    expect(validarCnpj('04.252.011/0001-10')).toBe(true);

    // dígito verificador alterado
    expect(validarCnpj('11.222.333/0001-82')).toBe(false);
    expect(validarCnpj('11222333000100')).toBe(false);
  });

  test('estruturas inválidas: tamanho errado e todos os dígitos iguais', () => {
    expect(validarCnpj('')).toBe(false);
    expect(validarCnpj('123')).toBe(false);
    expect(validarCnpj('11111111111111')).toBe(false); // 14 dígitos iguais
    expect(validarCnpj('00000000000000')).toBe(false);
  });

  test('normalização: pontuação é ignorada na validação', () => {
    expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizarCnpj(' 11 222 333 0001 81 ')).toBe('11222333000181');
    expect(validarCnpj(normalizarCnpj('11.222.333/0001-81'))).toBe(true);
  });

  test('montarCnpj completa os verificadores (fixtures) e o resultado valida', () => {
    const cnpj = montarCnpj('112223330001');
    expect(cnpj).toBe('11222333000181');
    expect(validarCnpj(cnpj)).toBe(true);
  });

  test('formatarCnpj apresenta no padrão pt-BR', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarCnpj('123')).toBe('123'); // incompleto: devolve como está
  });
});
