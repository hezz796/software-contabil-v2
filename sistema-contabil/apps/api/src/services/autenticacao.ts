import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config.ts';
import type { AppDb } from '../db/index.ts';
import { usuario } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { carregarAtribuicoes } from './escopo.ts';
import { inserirSessao, type Autenticacao } from './sessao.ts';
import { conferirSenha } from './senha.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';
import { buscarUsuarioPorEmail, normalizarEmail } from './usuarios.ts';

/**
 * Autenticação por login (RF-03, RF-19, H14/H15/H16).
 *
 * Regras:
 * - credencial inválida => 401 genérico, **nenhuma sessão criada** (CA-19);
 * - `LOGIN_MAX_TENTATIVAS` falhas consecutivas => `locked_until` no usuário e
 *   evento `login.bloqueio`; enquanto bloqueado, até a senha correta é recusada
 *   (H16/CA-51);
 * - acerto zera `failed_logins` e o bloqueio;
 * - toda alteração e o evento de acesso saem na MESMA transação (R8/CA-52).
 *
 * Mensagens de erro são genéricas para não revelar se o e-mail existe.
 */

export interface EntradaLogin {
  email: string;
  senha: string;
}

function mensagemBloqueio(loginMaxTentativas: number): string {
  return `Usuário bloqueado após ${loginMaxTentativas} tentativas de login falhas. `
    + 'Aguarde o período de bloqueio ou solicite o desbloqueio a um administrador.';
}

/**
 * Executa o login. Sucesso devolve a sessão a ser emitida no cookie; falha
 * lança `ErroAplicacao` com o status adequado (401 credencial, 403 bloqueio).
 */
export async function autenticar(
  db: AppDb,
  config: AppConfig,
  entrada: EntradaLogin,
): Promise<Autenticacao> {
  const email = normalizarEmail(entrada.email);
  const conta = await buscarUsuarioPorEmail(db, email);

  if (!conta) {
    // Evento de acesso mesmo sem usuário correspondente (usuário_id NULL).
    registrarEvento(db, {
      acao: 'login.falha',
      dados: { email, motivo: 'usuario_inexistente' },
    });
    throw new ErroAplicacao(401, 'Credenciais inválidas.', 'credenciais_invalidas');
  }

  if (!conta.ativo) {
    // RF-03/R10: desativado não autentica; resposta genérica para não revelar
    // a situação da conta (a trilha registra o motivo).
    registrarEvento(db, {
      acao: 'login.falha',
      usuarioId: conta.id,
      dados: { email, motivo: 'usuario_inativo' },
    });
    throw new ErroAplicacao(401, 'Credenciais inválidas.', 'credenciais_invalidas');
  }

  const agora = new Date().toISOString();
  if (conta.lockedUntil && conta.lockedUntil > agora) {
    registrarEvento(db, {
      acao: 'login.bloqueio',
      usuarioId: conta.id,
      dados: { email, motivo: 'bloqueio_ativo', locked_until: conta.lockedUntil },
    });
    throw new ErroAplicacao(403, mensagemBloqueio(config.loginMaxTentativas), 'usuario_bloqueado');
  }

  const senhaCorreta = await conferirSenha(conta.senhaHash, entrada.senha);

  if (!senhaCorreta) {
    const falhas = conta.failedLogins + 1;
    const bloquear = falhas >= config.loginMaxTentativas;
    const lockedUntil = bloquear
      ? new Date(Date.now() + config.loginBloqueioMinutos * 60_000).toISOString()
      : null;

    transacaoComAuditoria(db, (tx, auditoria) => {
      tx.update(usuario)
        .set({ failedLogins: falhas, lockedUntil })
        .where(eq(usuario.id, conta.id))
        .prepare()
        .run();

      auditoria.registrar({
        acao: 'login.falha',
        usuarioId: conta.id,
        dados: { email, tentativa: falhas },
      });

      if (bloquear) {
        auditoria.registrar({
          acao: 'login.bloqueio',
          usuarioId: conta.id,
          dados: {
            email,
            motivo: 'limite_atingido',
            tentativas: falhas,
            locked_until: lockedUntil,
          },
        });
      }
    });

    // A tentativa que ATINGE o limite também é uma falha de credencial (401);
    // o bloqueio passa a recusar as tentativas seguintes (403) — CA-51.
    throw new ErroAplicacao(401, 'Credenciais inválidas.', 'credenciais_invalidas');
  }

  const empresaIds = await carregarAtribuicoes(db, conta.id);

  return transacaoComAuditoria(db, (tx, auditoria) => {
    tx.update(usuario)
      .set({ failedLogins: 0, lockedUntil: null })
      .where(eq(usuario.id, conta.id))
      .prepare()
      .run();

    const { sessaoId, expiraEm } = inserirSessao(tx, conta.id, config.sessionTtlMinutes);

    auditoria.registrar({
      acao: 'login.sucesso',
      usuarioId: conta.id,
      dados: { email, expira_em: expiraEm },
    });

    return {
      sessaoId,
      usuario: { ...conta, ativo: true, failedLogins: 0, lockedUntil: null },
      empresaIds,
    };
  });
}
