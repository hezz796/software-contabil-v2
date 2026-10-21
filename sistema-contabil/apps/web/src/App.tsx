import { useEffect } from 'react';
import { AppShell } from './components/AppShell.tsx';
import { texts } from './i18n/pt-BR.ts';
import { ROTA_PADRAO, navegarPara, useRota } from './navegacao.ts';
import { AcessoNegado } from './pages/AcessoNegado.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { TelaPendente } from './pages/TelaPendente.tsx';
import { SessaoProvider, useSessao } from './sessao/SessaoContext.tsx';
import { telaDaRota } from './telas.ts';

/**
 * Aplicação autenticada: gate de sessão + navegação por hash.
 *
 * - sem sessão (ou sessão verificando) não há conteúdo de dados (CA-18):
 *   o login é a única tela fora do shell;
 * - a cada navegação a sessão é revalidada em `GET /me` — é o servidor que
 *   decide se o cookie ainda vale (H14/CE-11);
 * - sem dashboard/KPIs: após o login o destino é `#/empresas` (ADR-0004).
 */
export function App() {
  return (
    <SessaoProvider>
      <Aplicacao />
    </SessaoProvider>
  );
}

function Aplicacao() {
  const { fase, usuario, recarregar } = useSessao();
  const rota = useRota();
  const tela = telaDaRota(rota);

  // Revalidação por navegação (401 => CE-11 e volta ao login). `fase` é
  // lida do render corrente; a dependência é a rota — a validação inicial já
  // acontece no `SessaoProvider` e não precisa ser repetida aqui.
  useEffect(() => {
    if (fase !== 'autenticado') return;
    void recarregar();
  }, [rota, recarregar]);

  // Rota inexistente volta para a tela padrão (empresas).
  useEffect(() => {
    if (fase === 'autenticado' && tela === null) navegarPara(ROTA_PADRAO);
  }, [fase, tela]);

  if (fase === 'verificando') {
    return (
      <div className="carregando" role="status" aria-live="polite">
        <div className="esqueleto" aria-hidden="true" />
        <span>{texts.estados.verificandoSessao}</span>
      </div>
    );
  }

  if (fase !== 'autenticado') return <LoginPage />;

  const acessoNegado =
    tela !== null && tela.visibilidade === 'solo-admin' && usuario?.papel !== 'administrador';

  return (
    <AppShell>
      {tela === null ? null : acessoNegado ? <AcessoNegado /> : <TelaPendente tela={tela} />}
    </AppShell>
  );
}
