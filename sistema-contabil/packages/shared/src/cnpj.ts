/**
 * Validação de CNPJ (RF-01, CA-15).
 *
 * Domínio puro, sem dependências: usado pela API (validação na entrada do
 * cadastro de empresa) e pelo web (mesma regra no formulário). O valor é
 * armazenado normalizado em 14 dígitos sem pontuação (convenção do schema
 * `empresa.cnpj`); a apresentação pt-BR (`XX.XXX.XXX/0001-XX`) é só camada de
 * UI.
 *
 * Regras dos dígitos verificadores (Receita Federal):
 * - 12 dígitos base + 2 verificadores calculados módulo 11;
 * - CNPJ com todos os dígitos iguais é estruturalmente inválido.
 */

/** Remove tudo que não for dígito. */
export function normalizarCnpj(entrada: string): string {
  return entrada.replace(/\D/g, '');
}

/** Formata para o padrão pt-BR; devolve os dígitos se a contagem não fechar. */
export function formatarCnpj(entrada: string): string {
  const cnpj = normalizarCnpj(entrada);
  if (cnpj.length !== 14) return cnpj;
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base
    .split('')
    .reduce((acc, digito, indice) => acc + Number(digito) * (pesos[indice] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Valida um CNPJ (aceita com ou sem pontuação). Números estruturalmente
 * inválidos (tamanho diferente de 14 ou todos os dígitos iguais) retornam
 * `false` antes do cálculo dos verificadores.
 */
export function validarCnpj(entrada: string): boolean {
  const cnpj = normalizarCnpj(entrada);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const base = cnpj.slice(0, 12);
  const dv1 = digitoVerificador(base, PESOS_DV1);
  const dv2 = digitoVerificador(`${base}${dv1}`, PESOS_DV2);
  return cnpj === `${base}${dv1}${dv2}`;
}

/**
 * Completa 12 dígitos base com os dois dígitos verificadores calculados.
 * Uti para fixtures de teste e seeds — não é regra de produto.
 */
export function montarCnpj(base12: string): string {
  const base = normalizarCnpj(base12).slice(0, 12).padStart(12, '0');
  const dv1 = digitoVerificador(base, PESOS_DV1);
  const dv2 = digitoVerificador(`${base}${dv1}`, PESOS_DV2);
  return `${base}${dv1}${dv2}`;
}
