import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginRequest, UsuarioSessao } from '@sistema-contabil/shared';
import { login as entrarNaApi, logout as sairDaApi, me } from '../api-client/auth.ts';
import { ErroApi } from '../api-client/client.ts';

/**
 * Estado de sessão da aplicação.
 *
 * A fonte da verdade é o servidor: a sessão vive em cookie HttpOnly assinado
 * (a API grava/apaga), então o que o front sabe é apenas "estou
 * autenticado?", respondido por `GET /me` (RF-03, CA-18). Nenhum token é
 * armazenado em localStorage — não existe token legível pelo JS.
 */
export type FaseSessao = 'verificando' | 'sem-sessao' | 'autenticado';

/**
 * Aviso exibido no login quando o app descobre que a sessão caiu ou que a
 * API não respondeu:
 * - `CE-11` sessão expirada (401 em chamada protegida) → estado `neutro`;
 * - `conexao` API inacessível → estado `erro` (não é recusa de acesso) com a
 *   mensagem da própria tentativa, quando disponível.
 */
export interface AvisoLogin {
  codigo: 'CE-11' | 'conexao';
  titulo?: string;
}

interface ContextoSessao {
  fase: FaseSessao;
  usuario: UsuarioSessao | null;
  aviso: AvisoLogin | null;
  /** Tenta criar sessão; lança `ErroApi` com a mensagem da API em recusa. */
  entrar: (credenciais: LoginRequest) => Promise<void>;
  /** Encerra a sessão no servidor e volta ao login. */
  sair: () => Promise<void>;
  /** Revalida a sessão no servidor (usada a cada navegação). */
  recarregar: () => Promise<void>;
  limparAviso: () => void;
}

const SessaoContexto = createContext<ContextoSessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<{ fase: FaseSessao; usuario: UsuarioSessao | null }>({
    fase: 'verificando',
    usuario: null,
  });
  const [aviso, setAviso] = useState<AvisoLogin | null>(null);

  // Verificação inicial: `GET /me` diz se há sessão válida (CA-18).
  useEffect(() => {
    let vivo = true;
    void me()
      .then((usuario) => {
        if (vivo) setEstado({ fase: 'autenticado', usuario });
      })
      .catch((erro: unknown) => {
        if (!vivo) return;
        if (erro instanceof ErroApi && erro.status === 401) {
          // Primeira visita sem sessão: login sem aviso.
          setEstado({ fase: 'sem-sessao', usuario: null });
          return;
        }
        // API fora do ar / resposta inesperada: login + aviso de conexão.
        setEstado({ fase: 'sem-sessao', usuario: null });
        setAviso({ codigo: 'conexao', titulo: erro instanceof ErroApi ? erro.message : undefined });
      });
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = useCallback(async (credenciais: LoginRequest) => {
    const usuario = await entrarNaApi(credenciais);
    setEstado({ fase: 'autenticado', usuario });
    setAviso(null);
  }, []);

  const sair = useCallback(async () => {
    try {
      await sairDaApi();
    } catch {
      // Sessão já ausente/expirada no servidor: o login é o mesmo destino.
    }
    setEstado({ fase: 'sem-sessao', usuario: null });
    setAviso(null);
  }, []);

  const recarregar = useCallback(async () => {
    try {
      const usuario = await me();
      setEstado({ fase: 'autenticado', usuario });
      setAviso(null);
    } catch (erro: unknown) {
      if (erro instanceof ErroApi && erro.status === 401) {
        // Sessão caiu durante o uso (H14/CE-11): volta ao login com aviso neutro.
        setEstado({ fase: 'sem-sessao', usuario: null });
        setAviso({ codigo: 'CE-11' });
      }
      // Falha transitória (rede/5xx) não derruba uma sessão válida.
    }
  }, []);

  const limparAviso = useCallback(() => setAviso(null), []);

  const valor = useMemo<ContextoSessao>(
    () => ({ ...estado, aviso, entrar, sair, recarregar, limparAviso }),
    [estado, aviso, entrar, sair, recarregar, limparAviso],
  );

  return <SessaoContexto.Provider value={valor}>{children}</SessaoContexto.Provider>;
}

export function useSessao(): ContextoSessao {
  const contexto = useContext(SessaoContexto);
  if (!contexto) {
    throw new Error('useSessao precisa estar dentro de <SessaoProvider>.');
  }
  return contexto;
}
