import { eq } from 'drizzle-orm';
import { auditoriaResponseSchema, erroResponseSchema } from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent } from '../../src/db/schema.ts';
import { inserirEvento } from '../../src/services/auditoria.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('trilha de auditoria (RF-05, R11, CA-21, CA-38, CA-39)', () => {
  test('CA-21 contador não consulta a trilha de auditoria: tentativa direta à rota é recusada', async () => {
    const t = await createTestApp();
    try {
      const admin = await criarUsuarioTeste(t.database.db, {
        email: 'admin@escritorio.test',
        papel: 'administrador',
        empresas: [1],
      });
      const contador = await criarUsuarioTeste(t.database.db, {
        email: 'contador@escritorio.test',
        papel: 'contador',
        empresas: [1],
      });

      inserirEvento(t.database.db, {
        acao: 'usuario.criacao',
        empresaId: 1,
        usuarioId: admin.id,
        dados: { email: contador.email },
      });

      const { cookie } = await fazerLogin(t.app, contador.email);
      const resposta = await t.app.inject({
        method: 'GET',
        url: '/auditoria?empresa_id=1',
        headers: { cookie },
      });

      expect(resposta.statusCode).toBe(403);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/permissão negada/i);
      // nada da trilha vaza na resposta
      expect(resposta.body).not.toMatch(/usuario\.criacao|criado_em|eventos/);

      // sem sessão também não consulta (401) — dupla barreira
      const semSessao = await t.app.inject({ method: 'GET', url: '/auditoria?empresa_id=1' });
      expect(semSessao.statusCode).toBe(401);
    } finally {
      await t.close();
    }
  });

  test('CA-38 UPDATE e DELETE diretos em audit_event são abortados pelo banco e não existem rotas de edição/remoção', async () => {
    const t = await createTestApp();
    try {
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [1],
      });
      inserirEvento(t.database.db, {
        acao: 'lancamento.criacao',
        empresaId: 1,
        usuarioId: admin.id,
        objetoTipo: 'lancamento',
        objetoId: '42',
        dados: { historico: 'Compra de material' },
      });

      // snapshot completo da trilha (inclui o evento de criação do usuário)
      const antes = t.database.db.select().from(auditEvent).all();
      const alvo = antes.find((evento) => evento.acao === 'lancamento.criacao');
      expect(alvo).toBeDefined();
      const id = alvo!.id;

      // 1) tentativa direta no SQLite (o que um bug de aplicação faria)
      expect(() =>
        t.database.sqlite.prepare(`UPDATE audit_event SET acao = 'adulterado' WHERE id = ?`).run(id),
      ).toThrow(/append-only/i);
      expect(() =>
        t.database.sqlite.prepare('DELETE FROM audit_event WHERE id = ?').run(id),
      ).toThrow(/append-only/i);

      // 2) pela camada Drizzle, usada pela aplicação
      await expect(
        t.database.db
          .update(auditEvent)
          .set({ acao: 'adulterado' })
          .where(eq(auditEvent.id, id))
          .execute(),
      ).rejects.toThrow(/append-only/i);
      await expect(
        t.database.db.delete(auditEvent).where(eq(auditEvent.id, id)).execute(),
      ).rejects.toThrow(/append-only/i);

      // eventos originais preservados, byte a byte
      const depois = t.database.db.select().from(auditEvent).all();
      expect(depois).toEqual(antes);

      // 3) produto: nenhuma rota de edição/remoção da trilha (ainda autenticado como admin)
      const { cookie } = await fazerLogin(t.app, admin.email);
      for (const metodo of ['DELETE', 'PATCH', 'PUT'] as const) {
        const semId = await t.app.inject({ method: metodo, url: '/auditoria', headers: { cookie } });
        expect(semId.statusCode, `${metodo} /auditoria`).toBe(404);
        const comId = await t.app.inject({
          method: metodo,
          url: `/auditoria/${id}`,
          headers: { cookie },
        });
        expect(comId.statusCode, `${metodo} /auditoria/${id}`).toBe(404);
        expect(erroResponseSchema.parse(comId.json()).erro).toMatch(/não encontrada/i);
      }

      // rota de leitura continua devolvendo o evento original
      const leitura = await t.app.inject({
        method: 'GET',
        url: '/auditoria?empresa_id=1',
        headers: { cookie },
      });
      expect(leitura.statusCode).toBe(200);
      expect(auditoriaResponseSchema.parse(leitura.json()).eventos).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  test('CA-39 consulta da trilha filtra por empresa e período; período sem eventos retorna lista vazia sem erro', async () => {
    const t = await createTestApp();
    try {
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [1, 2],
      });

      inserirEvento(t.database.db, {
        acao: 'lancamento.criacao',
        empresaId: 1,
        usuarioId: admin.id,
        criadoEm: '2026-03-10T10:00:00.000Z',
        dados: { resumo: 'evento da empresa 1 em marco' },
      });
      inserirEvento(t.database.db, {
        acao: 'lancamento.criacao',
        empresaId: 2,
        usuarioId: admin.id,
        criadoEm: '2026-03-10T11:00:00.000Z',
        dados: { resumo: 'evento da empresa 2 em marco' },
      });
      inserirEvento(t.database.db, {
        acao: 'usuario.criacao',
        empresaId: 1,
        usuarioId: admin.id,
        criadoEm: '2026-02-05T09:00:00.000Z',
        dados: { resumo: 'evento da empresa 1 em fevereiro' },
      });

      const { cookie } = await fazerLogin(t.app, admin.email);
      const consultar = async (url: string) =>
        t.app.inject({ method: 'GET', url, headers: { cookie } });

      // empresa 1, período de março: só o evento da empresa 1 naquele período
      const marco = await consultar('/auditoria?empresa_id=1&de=2026-03-01&ate=2026-03-31');
      expect(marco.statusCode).toBe(200);
      const corpo = auditoriaResponseSchema.parse(marco.json());
      expect(corpo.eventos).toHaveLength(1);
      expect(corpo.eventos[0]?.empresa_id).toBe(1);
      expect(corpo.eventos[0]?.criado_em).toMatch(ISO);
      const serializado = JSON.stringify(corpo);
      expect(serializado).not.toContain('2026-02-05'); // outro mês não aparece
      expect(serializado).not.toMatch(/"empresa_id":2/); // outra empresa não aparece

      // sem período: todos os eventos da empresa 1 (março + fevereiro)
      const empresa1 = await consultar('/auditoria?empresa_id=1');
      expect(empresa1.statusCode).toBe(200);
      expect(auditoriaResponseSchema.parse(empresa1.json()).eventos).toHaveLength(2);

      // empresa 2: só o evento dela
      const empresa2 = await consultar('/auditoria?empresa_id=2&de=2026-03-01&ate=2026-03-31');
      const corpo2 = auditoriaResponseSchema.parse(empresa2.json());
      expect(corpo2.eventos).toHaveLength(1);
      expect(corpo2.eventos[0]?.empresa_id).toBe(2);

      // período sem eventos: 200 com lista vazia, sem erro
      const abril = await consultar('/auditoria?empresa_id=1&de=2026-04-01&ate=2026-04-30');
      expect(abril.statusCode).toBe(200);
      expect(auditoriaResponseSchema.parse(abril.json())).toEqual({ eventos: [] });

      // empresa fora das atribuições do usuário: recusa genérica (RF-04)
      const negada = await consultar('/auditoria?empresa_id=99&de=2026-03-01&ate=2026-03-31');
      expect(negada.statusCode).toBe(403);
      expect(erroResponseSchema.parse(negada.json()).erro).toMatch(/acesso negado/i);
    } finally {
      await t.close();
    }
  });
});
