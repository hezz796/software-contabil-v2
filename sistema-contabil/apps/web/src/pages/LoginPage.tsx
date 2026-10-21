import { loginRequestSchema } from '@sistema-contabil/shared';
import { useState, type FormEvent } from 'react';
import { ErroApi } from '../api-client/client.ts';
import { Mensagem, type ConteudoMensagem } from '../components/Mensagem.tsx';
import { texts } from '../i18n/pt-BR.ts';
import { ROTA_PADRAO, navegarPara } from '../navegacao.ts';
import { useSessao } from '../sessao/SessaoContext.tsx';

interface ErrosCampo {
  email?: string;
  senha?: string;
}

/**
 * Tela de login (RF-03): única tela acessível sem sessão (CA-18).
 *
 * - consome `POST /login` e deixa o cookie de sessão com o servidor (sem
 *   token em localStorage — o cookie é HttpOnly);
 * - validação de campo com `loginRequestSchema` (feedback imediato, mesma
 *   regra do contrato compartilhado); a autoridade continua no servidor;
 * - estados: carregando (enviando), credencial inválida (401), bloqueio
 *   CE-17 (403), sessão expirada CE-11 (neutro, vindo do contexto) e falha
 *   de conexão.
 */
export function LoginPage() {
  const { entrar, aviso, limparAviso } = useSessao();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [errosCampo, setErrosCampo] = useState<ErrosCampo>({});
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState<ConteudoMensagem | null>(null);

  const avisoContexto: ConteudoMensagem | null =
    aviso === null
      ? null
      : aviso.codigo === 'CE-11'
        ? {
            titulo: texts.recusas.ce11.titulo,
            detalhe: texts.recusas.ce11.detalhe,
            acao: texts.recusas.ce11.acaoSugerida,
          }
        : {
            titulo: aviso.titulo ?? texts.recusas.conexao.titulo,
            detalhe: texts.recusas.conexao.detalhe,
            acao: texts.recusas.conexao.acaoSugerida,
          };

  const aoEnviar = async (evento: FormEvent<HTMLFormElement>): Promise<void> => {
    evento.preventDefault();
    if (enviando) return;

    setRecusa(null);
    limparAviso();

    // Feedback imediato de campo (FB-1); o servidor revalida sempre.
    const validacao = loginRequestSchema.safeParse({ email: email.trim(), senha });
    if (!validacao.success) {
      const erros: ErrosCampo = {};
      for (const issue of validacao.error.issues) {
        if (issue.path[0] === 'email') erros.email = issue.message;
        if (issue.path[0] === 'senha') erros.senha = issue.message;
      }
      setErrosCampo(erros);
      document.getElementById('login-email')?.focus();
      return;
    }
    setErrosCampo({});

    setEnviando(true);
    try {
      await entrar({ email: email.trim(), senha });
      navegarPara(ROTA_PADRAO);
    } catch (erro: unknown) {
      setRecusa(mapearRecusaDeLogin(erro));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="pagina-login">
      <div className="cabecalho">
        <div className="linha1">
          <h1>{texts.login.h1}</h1>
          <span className="ref">RF-03</span>
          <span className="ref">R6</span>
        </div>
        <p className="sub">{texts.login.subtitulo}</p>
      </div>

      <div className="painel">
        <div className="topo">
          <h2>{texts.login.titulo}</h2>
        </div>
        <div className="corpo">
          {recusa ? (
            <Mensagem tipo="erro" mensagem={recusa} />
          ) : null}
          {!recusa && avisoContexto ? (
            <Mensagem
              tipo={aviso?.codigo === 'conexao' ? 'erro' : 'neutro'}
              mensagem={avisoContexto}
            />
          ) : null}

          <form className="formulario" onSubmit={(evento) => void aoEnviar(evento)} noValidate>
            <div className="campo">
              <label htmlFor="login-email">
                {texts.login.rotuloEmail}{' '}
                <span className="obrig">{texts.login.obrigatorio}</span>
              </label>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                aria-required="true"
                aria-invalid={errosCampo.email ? true : undefined}
                aria-describedby={errosCampo.email ? 'login-email-erro' : undefined}
                value={email}
                disabled={enviando}
                onChange={(evento) => setEmail(evento.target.value)}
              />
              {errosCampo.email ? (
                <span className="erro-campo" id="login-email-erro">
                  {errosCampo.email}
                </span>
              ) : null}
            </div>

            <div className="campo">
              <label htmlFor="login-senha">
                {texts.login.rotuloSenha}{' '}
                <span className="obrig">{texts.login.obrigatorio}</span>
              </label>
              <input
                id="login-senha"
                type="password"
                name="senha"
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={errosCampo.senha ? true : undefined}
                aria-describedby={errosCampo.senha ? 'login-senha-erro' : undefined}
                value={senha}
                disabled={enviando}
                onChange={(evento) => setSenha(evento.target.value)}
              />
              {errosCampo.senha ? (
                <span className="erro-campo" id="login-senha-erro">
                  {errosCampo.senha}
                </span>
              ) : null}
            </div>

            <div className="acoes-formulario">
              <button type="submit" className="btn primario" disabled={enviando}>
                {enviando ? texts.login.botaoEntrando : texts.login.botaoEntrar}
              </button>
            </div>
          </form>

          <p className="nota">{texts.login.notaEscopo}</p>
        </div>
      </div>
    </div>
  );
}

/** Traduz a falha de `POST /login` no banner da tela (§5.2: título da API + detalhe/ação). */
function mapearRecusaDeLogin(erro: unknown): ConteudoMensagem {
  if (erro instanceof ErroApi) {
    if (erro.recusa === 'CE-17') {
      return {
        titulo: erro.message,
        detalhe: texts.recusas.ce17.detalhe,
        acao: texts.recusas.ce17.acaoSugerida,
      };
    }
    if (erro.status === 401) {
      return {
        titulo: erro.message,
        detalhe: texts.recusas.credencial.detalhe,
        acao: texts.recusas.credencial.acaoSugerida,
      };
    }
    if (erro.status === 400) {
      return {
        titulo: erro.message,
        detalhe: texts.recusas.dadosInvalidos.detalhe,
        acao: texts.recusas.dadosInvalidos.acaoSugerida,
      };
    }
    if (erro.status === 0) {
      return {
        titulo: erro.message,
        detalhe: texts.recusas.conexao.detalhe,
        acao: texts.recusas.conexao.acaoSugerida,
      };
    }
    return {
      titulo: erro.message,
      detalhe:
        erro.status >= 500
          ? texts.recusas.falhaServidor.detalhe
          : texts.recusas.dadosInvalidos.detalhe,
      acao: erro.status >= 500
        ? texts.recusas.falhaServidor.acaoSugerida
        : texts.recusas.dadosInvalidos.acaoSugerida,
    };
  }

  return {
    titulo: 'Falha inesperada ao entrar.',
    detalhe: texts.recusas.falhaServidor.detalhe,
    acao: texts.recusas.falhaServidor.acaoSugerida,
  };
}
