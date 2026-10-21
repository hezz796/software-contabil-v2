import { useState, type ReactNode } from 'react';
import { texts } from '../i18n/pt-BR.ts';
import { useRota } from '../navegacao.ts';
import { useSessao } from '../sessao/SessaoContext.tsx';
import { ORDEM_GRUPOS, telasVisiveis, type GrupoTela } from '../telas.ts';

/**
 * Shell de navegação (estrutura aprovada nos wireframes): barra superior com
 * marca, usuário logado e saída; menu lateral agrupado com visibilidade por
 * papel; área de conteúdo.
 *
 * Sem dashboard/KPIs (ADR-0004, Q-UI-3) — o login encerra em empresas.
 * A saída chama `POST /logout` (a API apaga a sessão e limpa o cookie).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { usuario, sair } = useSessao();
  const rota = useRota();
  const [saindo, setSaindo] = useState(false);

  if (!usuario) return null;

  const papel =
    usuario.papel === 'administrador'
      ? texts.shell.papelAdministrador
      : texts.shell.papelContador;

  const visiveis = telasVisiveis(usuario.papel);
  const ehAdmin = usuario.papel === 'administrador';

  const aoSair = async (): Promise<void> => {
    setSaindo(true);
    try {
      await sair();
    } finally {
      setSaindo(false);
    }
  };

  return (
    <div>
      <header className="topbar">
        <span className="marca">{texts.appTitle}</span>
        <span className="spacer" />
        <span className="usuario" title={texts.shell.rotuloUsuario}>
          {usuario.email}
        </span>
        <span className="papel">{papel}</span>
        <button
          type="button"
          className="btn btn-topo"
          onClick={() => void aoSair()}
          disabled={saindo}
        >
          {saindo ? texts.shell.saindo : texts.shell.sair}
        </button>
      </header>

      <div className="layout">
        <nav className="sidebar" aria-label="Navegação principal">
          {ORDEM_GRUPOS.map((grupo: GrupoTela) => {
            const itens = visiveis.filter((tela) => tela.grupo === grupo);
            if (itens.length === 0) return null;
            return (
              <div key={grupo}>
                <div className="grupo">{texts.shell.grupos[grupo]}</div>
                {itens.map((tela) => {
                  const ativo = tela.rota === rota;
                  return (
                    <a
                      key={tela.rota}
                      className={ativo ? 'item-menu ativo' : 'item-menu'}
                      href={`#${tela.rota}`}
                      aria-current={ativo ? 'page' : undefined}
                    >
                      <span>{tela.rotulo}</span>
                      {ehAdmin ? (
                        <em className="quem">
                          {tela.visibilidade === 'solo-admin'
                            ? texts.shell.legendasQuem.soAdmin
                            : tela.visibilidade === 'admin-leitura'
                              ? texts.shell.legendasQuem.adminLeitura
                              : texts.shell.legendasQuem.ambos}
                        </em>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            );
          })}

          {ehAdmin ? <div className="legenda">{texts.shell.legendaMenu}</div> : null}
        </nav>

        <main className="conteudo">{children}</main>
      </div>
    </div>
  );
}
