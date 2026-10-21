/**
 * Erro de aplicação com status HTTP previsível.
 *
 * Vira `{ erro: <mensagem> }` no `setErrorHandler` da API (padrão de resposta
 * de erro usado pelos schemas compartilhados `erroResponseSchema`).
 * Uso: recusas de permissão (403), sessão inválida (401), conflitos (409)...
 */
export class ErroAplicacao extends Error {
  readonly statusCode: number;
  readonly codigo: string;

  constructor(statusCode: number, message: string, codigo?: string) {
    super(message);
    this.name = 'ErroAplicacao';
    this.statusCode = statusCode;
    this.codigo = codigo ?? String(statusCode);
  }
}
