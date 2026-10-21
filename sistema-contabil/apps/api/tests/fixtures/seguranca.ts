import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LoginResponse } from '@sistema-contabil/shared';
import type { AppDb } from '../../src/db/index.ts';
import { usuarioEmpresa, usuario, type Papel, type Usuario } from '../../src/db/schema.ts';
import { criarUsuario } from '../../src/services/usuarios.ts';
import { garantirEmpresaTeste } from './empresas.ts';

/**
 * Fixtures mínimas de segurança para os testes da TASK-011.
 *
 * Usuários são criados pelo serviço interno (`criarUsuario`, que também aplica
 * a política de senha e audita a criação); o CRUD HTTP de
 * usuários/atribuições vem na TASK-012 (`routes/gestao-usuarios.ts`).
 */

/** Senha padrão das fixtures (>= 8 caracteres, conforme H15). */
export const SENHA_TESTE = 'senha-forte-123';

type Resposta = Awaited<ReturnType<FastifyInstance['inject']>>;

export interface UsuarioTeste {
  id: number;
  email: string;
  papel: Papel;
}

export interface OpcoesUsuarioTeste {
  email?: string;
  papel?: Papel;
  senha?: string;
  /** Atribuições em `usuario_empresa` (empresas ainda não existem: ids livres). */
  empresas?: number[];
}

/** Cria usuário (+ atribuições) direto no banco temporário do teste. */
export async function criarUsuarioTeste(
  db: AppDb,
  opcoes: OpcoesUsuarioTeste = {},
): Promise<UsuarioTeste> {
  const usuario = await criarUsuario(db, {
    email: opcoes.email ?? 'admin@escritorio.test',
    senha: opcoes.senha ?? SENHA_TESTE,
    papel: opcoes.papel ?? 'administrador',
  });

  for (const empresaId of opcoes.empresas ?? []) {
    // FK `usuario_empresa -> empresa` é verificada em runtime (TASK-012):
    // a atribuição só entra se a empresa existir — garante antes de inserir.
    garantirEmpresaTeste(db, empresaId);
    db.insert(usuarioEmpresa)
      .values({ usuarioId: usuario.id, empresaId })
      .prepare()
      .run();
  }

  return usuario;
}

/** Extrai um cookie específico do header `Set-Cookie`. */
export function setCookieDe(resposta: Resposta, nome: string): string {
  const bruto = resposta.headers['set-cookie'];
  const lista = typeof bruto === 'string' ? [bruto] : (bruto ?? []);
  const cookie = lista.find((item) => item.startsWith(`${nome}=`));
  if (!cookie) throw new Error(`cookie "${nome}" ausente na resposta (${resposta.statusCode})`);
  return cookie;
}

export interface LoginTeste {
  /** Header `Set-Cookie` completo (para inspecionar flags). */
  setCookie: string;
  /** `sessao=<valor>` pronto para enviar em `headers.cookie`. */
  cookie: string;
  corpo: LoginResponse;
}

/** Faz login via HTTP e devolve o cookie de sessão. Falha o teste se recusado. */
export async function fazerLogin(
  app: FastifyInstance,
  email: string,
  senha: string = SENHA_TESTE,
): Promise<LoginTeste> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, senha },
  });
  if (resposta.statusCode !== 200) {
    throw new Error(`login de teste falhou (${resposta.statusCode}): ${resposta.body}`);
  }

  const setCookie = setCookieDe(resposta, 'sessao');
  return {
    setCookie,
    cookie: setCookie.split(';')[0] ?? '',
    corpo: resposta.json<LoginResponse>(),
  };
}

/** Linha de usuário por id (asserts de estado: bloqueio, senha, situação). */
export function usuarioPorId(db: AppDb, usuarioId: number): Usuario | undefined {
  return db.select().from(usuario).where(eq(usuario.id, usuarioId)).all()[0];
}
