import { useEffect, useState } from 'react';

/**
 * Navegação por hash (`#/empresas`, `#/lancamentos`, …).
 *
 * Sem dependência de roteador: o MVP é desktop-first (R12) e as 11 telas são
 * telas internas autenticadas. O hash mantém URL compartilhável e o botão
 * "voltar" do navegador funcionando sem lib externa.
 */

/** Tela padrão após o login — ADR-0004 (Q-UI-3): login encerra em empresas. */
export const ROTA_PADRAO = '/empresas';

export function rotaAtual(): string {
  const bruto = window.location.hash.replace(/^#/, '');
  if (bruto === '' || bruto === '/') return ROTA_PADRAO;
  return bruto.startsWith('/') ? bruto : `/${bruto}`;
}

export function navegarPara(rota: string): void {
  const alvo = rota.startsWith('/') ? rota : `/${rota}`;
  if (window.location.hash === `#${alvo}`) return;
  window.location.hash = alvo;
}

/** Rota corrente, reativa a `hashchange`. */
export function useRota(): string {
  const [rota, setRota] = useState<string>(rotaAtual);

  useEffect(() => {
    const aoMudar = (): void => setRota(rotaAtual());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  return rota;
}
