import { eq } from 'drizzle-orm';
import {
  erroResponseSchema,
  loginResponseSchema,
  usuarioSessaoSchema,
} from '@sistema-contabil/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ZodError } from 'zod';
import { loadConfig } from '../../src/config.ts';
import { sessao, usuario, usuarioEmpresa } from '../../src/db/schema.ts';
import { definirUsuarioAtivo, criarUsuario } from '../../src/services/usuarios.ts';
import {
  criarUsuarioTeste,
  fazerLogin,
  usuarioPorId,
  SENHA_TESTE,
} from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('autenticação e sessão (RF-03, RF-19, H14, H16)', () => {
  test('CA-18 sem sessão autenticada toda rota de dados é negada e nada de conteúdo de empresa volta', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [1, 2],
      });

      const rotas = [
        { method: 'GET' as const, url: '/me' },
        { method: 'GET' as const, url: '/auditoria?empresa_id=1' },
        { method: 'POST' as const, url: '/logout' },
      ];

      for (const rota of rotas) {
        const resposta = await t.app.inject(rota);

        expect(resposta.statusCode, `sem sessão em ${rota.method} ${rota.url}`).toBe(401);
        const corpo = erroResponseSchema.parse(resposta.json());
        expect(corpo.erro).toMatch(/sessão/i);
        // nenhuma credencial, escopo ou evento de empresa na resposta
        expect(resposta.body).not.toMatch(/empresa_ids|eventos|senha_hash|@escritorio/);
        expect(resposta.headers['set-cookie']).toBeUndefined();
      }

      // tela de dados exige sessão (a rota GET /empresas nasceu na TASK-012 —
      // RF-01; antes ela nem existia e retornava 404; sem sessão continua 401
      // sem vazar conteúdo)
      const semRota = await t.app.inject({ method: 'GET', url: '/empresas' });
      expect(semRota.statusCode).toBe(401);
      expect(semRota.body).not.toMatch(/empresa_ids|eventos|razao_social/);

      // nenhum usuário sem sessão: estado preservado
      expect(usuarioPorId(t.database.db, usuarioTeste.id)?.ativo).toBe(true);
    } finally {
      await t.close();
    }
  });

  test('CA-19 com credenciais inválidas o login é recusado e nenhuma sessão é criada', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, { papel: 'contador' });

      const resposta = await t.app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: usuarioTeste.email, senha: 'senha-errada-999' },
      });

      expect(resposta.statusCode).toBe(401);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/credenciais/i);
      expect(resposta.headers['set-cookie']).toBeUndefined();
      // nenhuma linha em sessao
      expect(t.database.db.select().from(sessao).all()).toHaveLength(0);

      // login inexistente também é 401 sem sessão
      const desconhecido = await t.app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'nao.existe@escritorio.test', senha: SENHA_TESTE },
      });
      expect(desconhecido.statusCode).toBe(401);
      expect(t.database.db.select().from(sessao).all()).toHaveLength(0);

      // a senha correta continua funcionando (a falha não bloqueou nem criou estado)
      const ok = await t.app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: usuarioTeste.email, senha: SENHA_TESTE },
      });
      expect(ok.statusCode).toBe(200);
      expect(loginResponseSchema.parse(ok.json()).usuario.papel).toBe('contador');
      expect(t.database.db.select().from(sessao).all()).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  test('CA-22 usuário desativado é recusado na tentativa seguinte, inclusive com a sessão anterior', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, { papel: 'contador' });
      const { cookie } = await fazerLogin(t.app, usuarioTeste.email);

      const antes = await t.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
      expect(antes.statusCode).toBe(200);
      expect(usuarioSessaoSchema.parse(antes.json()).ativo).toBe(true);

      await definirUsuarioAtivo(t.database.db, { usuarioId: usuarioTeste.id, ativo: false });

      // a sessão anterior CONTINUA no banco: a recusa vem da validação por requisição
      expect(t.database.db.select().from(sessao).all()).toHaveLength(1);

      const depois = await t.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
      expect(depois.statusCode).toBe(401);
      expect(erroResponseSchema.parse(depois.json()).erro).toMatch(/sessão|acesso/i);

      // novo login também é recusado (RF-03)
      const novoLogin = await t.app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: usuarioTeste.email, senha: SENHA_TESTE },
      });
      expect(novoLogin.statusCode).toBe(401);
      expect(t.database.db.select().from(sessao).all()).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  test('H14 a sessão expira pelo TTL configurado (30 min por padrão) e é negada na requisição seguinte', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));

    const t = await createTestApp();
    try {
      expect(t.app.config.sessionTtlMinutes).toBe(30); // default H14
      const usuarioTeste = await criarUsuarioTeste(t.database.db, { papel: 'contador' });
      const { cookie } = await fazerLogin(t.app, usuarioTeste.email);

      const linha = t.database.db.select().from(sessao).all()[0];
      expect(linha).toBeDefined();
      expect(Date.parse(linha!.expiraEm) - Date.parse(linha!.criadaEm)).toBe(30 * 60_000);

      // um segundo antes do fim: válida
      vi.setSystemTime(new Date('2026-10-20T12:29:59.000Z'));
      const valida = await t.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
      expect(valida.statusCode).toBe(200);

      // após o TTL: negada, sem novo login (sessão não é renovada sozinha)
      vi.setSystemTime(new Date('2026-10-20T12:30:01.000Z'));
      const expirada = await t.app.inject({ method: 'GET', url: '/me', headers: { cookie } });
      expect(expirada.statusCode).toBe(401);
      expect(erroResponseSchema.parse(expirada.json()).erro).toMatch(/expirada/i);
    } finally {
      vi.useRealTimers();
      await t.close();
    }
  });

  test('H14 cookie de sessão é HttpOnly e SameSite=Lax, e ganha Secure quando configurado por env', async () => {
    const padrao = await createTestApp();
    const comSecure = await createTestApp({
      config: loadConfig({ SESSION_COOKIE_SECURE: 'true' }),
    });
    try {
      const usuarioTeste = await criarUsuarioTeste(padrao.database.db, { papel: 'contador' });
      const loginPadrao = await fazerLogin(padrao.app, usuarioTeste.email);

      expect(loginPadrao.setCookie).toContain('HttpOnly');
      expect(loginPadrao.setCookie).toContain('SameSite=Lax');
      expect(loginPadrao.setCookie).toContain('Max-Age=1800'); // 30 min em segundos
      expect(loginPadrao.setCookie).not.toContain('Secure');

      const usuarioSecure = await criarUsuarioTeste(comSecure.database.db, {
        email: 'admin@escritorio.test',
        papel: 'administrador',
      });
      const loginSecure = await fazerLogin(comSecure.app, usuarioSecure.email);
      expect(loginSecure.setCookie).toContain('Secure');
      expect(loginSecure.setCookie).toContain('HttpOnly');
      expect(loginSecure.setCookie).toContain('SameSite=Lax');

      // o valor é assinado com SESSION_SECRET (cookie adulterado é rejeitado)
      expect(loginPadrao.cookie).toMatch(/^sessao=.+\..+$/);
      const valor = loginPadrao.cookie.slice('sessao='.length);
      const forgado = `sessao=${valor.slice(0, valor.lastIndexOf('.'))}.assinatura-invalida`;
      const adulterado = await padrao.app.inject({
        method: 'GET',
        url: '/me',
        headers: { cookie: forgado },
      });
      expect(adulterado.statusCode).toBe(401);
    } finally {
      await padrao.close();
      await comSecure.close();
    }
  });

  test('escopo de tenant vem do banco: empresa_id enviado na URL é ignorado e remoção de atribuição vale imediatamente', async () => {
    const t = await createTestApp();
    try {
      const usuarioTeste = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [7],
      });
      const { cookie } = await fazerLogin(t.app, usuarioTeste.email);

      // cliente tenta apontar o escopo para outra empresa: servidor ignora
      const adulterado = await t.app.inject({
        method: 'GET',
        url: '/me?empresa_id=999',
        headers: { cookie, 'x-empresa-id': '999' },
      });
      expect(adulterado.statusCode).toBe(200);
      const corpo = usuarioSessaoSchema.parse(adulterado.json());
      expect(corpo.empresa_ids).toEqual([7]);
      expect(JSON.stringify(corpo)).not.toContain('999');

      // remoção da atribuição tem efeito na requisição seguinte (sem novo login)
      t.database.db
        .delete(usuarioEmpresa)
        .where(eq(usuarioEmpresa.usuarioId, usuarioTeste.id))
        .prepare()
        .run();

      const semAtribuicao = await t.app.inject({
        method: 'GET',
        url: '/me',
        headers: { cookie },
      });
      expect(semAtribuicao.statusCode).toBe(200);
      expect(usuarioSessaoSchema.parse(semAtribuicao.json()).empresa_ids).toEqual([]);
    } finally {
      await t.close();
    }
  });

  test('CA-50 política de senha: senha menor que 8 caracteres recusada citando a política; 8 ou mais aceita', async () => {
    const t = await createTestApp();
    try {
      const erro = await criarUsuario(t.database.db, {
        email: 'curta@escritorio.test',
        senha: '1234567',
        papel: 'contador',
      }).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(ZodError);
      const mensagens = (erro as ZodError).issues.map((issue) => issue.message).join('; ');
      expect(mensagens).toMatch(/política de senha/i);
      expect(mensagens).toMatch(/8/);
      // nada persistido
      expect(
        t.database.db
          .select()
          .from(usuario)
          .where(eq(usuario.email, 'curta@escritorio.test'))
          .all(),
      ).toHaveLength(0);

      const aceito = await criarUsuario(t.database.db, {
        email: 'ok@escritorio.test',
        senha: '12345678',
        papel: 'contador',
      });
      expect(aceito.email).toBe('ok@escritorio.test');

      // senha guardada como hash Argon2id, nunca em claro
      const linha = usuarioPorId(t.database.db, aceito.id);
      expect(linha?.senhaHash).toMatch(/^\$argon2id\$/);
      expect(linha?.senhaHash).not.toContain('12345678');
    } finally {
      await t.close();
    }
  });
});
