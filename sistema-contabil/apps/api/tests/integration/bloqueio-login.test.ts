import { eq } from 'drizzle-orm';
import { erroResponseSchema } from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, sessao } from '../../src/db/schema.ts';
import {
  criarUsuarioTeste,
  fazerLogin,
  usuarioPorId,
  SENHA_TESTE,
} from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('limite de tentativas de login (RF-19, H16)', () => {
  test('CA-51 após 5 falhas consecutivas a tentativa seguinte é bloqueada mesmo com a senha correta, e o bloqueio é auditado', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, { papel: 'contador' });

      for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
        const resposta = await t.app.inject({
          method: 'POST',
          url: '/login',
          payload: { email: usuarioTeste.email, senha: `senha-errada-${tentativa}` },
        });
        expect(resposta.statusCode, `tentativa ${tentativa}`).toBe(401);
        expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/credenciais/i);
      }

      const bloqueado = usuarioPorId(t.database.db, usuarioTeste.id);
      expect(bloqueado?.failedLogins).toBe(5);
      expect(bloqueado?.lockedUntil).toMatch(ISO);
      expect(Date.parse(bloqueado!.lockedUntil!)).toBeGreaterThan(Date.now());

      // 6ª tentativa com a senha CORRETA: recusada por causa do bloqueio
      const sexta = await t.app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: usuarioTeste.email, senha: SENHA_TESTE },
      });
      expect(sexta.statusCode).toBe(403);
      expect(erroResponseSchema.parse(sexta.json()).erro).toMatch(/bloquead/i);
      expect(sexta.headers['set-cookie']).toBeUndefined();
      expect(t.database.db.select().from(sessao).all()).toHaveLength(0);

      // evento de bloqueio registrado na trilha, com o usuário
      const bloqueios = t.database.db
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.acao, 'login.bloqueio'))
        .all();
      expect(bloqueios.length).toBeGreaterThanOrEqual(1);
      expect(bloqueios.every((evento) => evento.usuarioId === usuarioTeste.id)).toBe(true);
      expect(bloqueios.every((evento) => ISO.test(evento.criadoEm))).toBe(true);
    } finally {
      await t.close();
    }
  });

  test('CA-52 a trilha registra no mesmo dia, para o mesmo usuário, sucesso + falha + bloqueio com usuário, tipo e data/hora', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, { papel: 'contador' });

      // sucesso
      const login = await fazerLogin(t.app, usuarioTeste.email);
      expect(login.corpo.usuario.email).toBe(usuarioTeste.email);

      // falhas (a 5ª também dispara o bloqueio)
      for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
        const resposta = await t.app.inject({
          method: 'POST',
          url: '/login',
          payload: { email: usuarioTeste.email, senha: `senha-errada-${tentativa}` },
        });
        expect(resposta.statusCode).toBe(401);
      }

      const eventos = t.database.db
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.usuarioId, usuarioTeste.id))
        .all();

      const hoje = new Date().toISOString().slice(0, 10);
      for (const acao of ['login.sucesso', 'login.falha', 'login.bloqueio']) {
        const doTipo = eventos.filter((evento) => evento.acao === acao);
        expect(doTipo.length, `eventos "${acao}"`).toBeGreaterThan(0);

        for (const evento of doTipo) {
          expect(evento.usuarioId, `${acao}: usuário`).toBe(usuarioTeste.id);
          expect(evento.criadoEm, `${acao}: data/hora`).toMatch(ISO);
          expect(evento.criadoEm.slice(0, 10), `${acao}: mesmo dia`).toBe(hoje);
        }
      }

      // tipos esperados presentes, com data/hora em ordem cronológica
      const tipos = new Set(eventos.map((evento) => evento.acao));
      expect(tipos.has('login.sucesso')).toBe(true);
      expect(tipos.has('login.falha')).toBe(true);
      expect(tipos.has('login.bloqueio')).toBe(true);
    } finally {
      await t.close();
    }
  });
});
