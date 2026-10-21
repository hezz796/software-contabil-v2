import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com **Argon2id** (`@node-rs/argon2`: binários NAPI
 * pré-compilados, sem node-gyp — requisito do ambiente com `allow-scripts`).
 *
 * Parâmetros padrão do pacote, usados aqui explicitamente por decisão:
 * `m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, 32 bytes de saída, `v=0x13`
 * (PHC: `$argon2id$v=19$m=19456,t=2,p=1$...`). O hash já embute o salt aleatório
 * de 16 bytes, então é autossuficiente para verificação e rehash futuro
 * (`parseOptions`).
 */

/** Gera o hash armazenado em `usuario.senha_hash`. */
export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha);
}

/**
 * Confere a senha contra o hash. Hash malformado ou parâmetro incompatível
 * também resulta em `false` (nunca derruba o login com erro 500).
 */
export async function conferirSenha(senhaHash: string, senha: string): Promise<boolean> {
  try {
    return await verify(senhaHash, senha);
  } catch {
    return false;
  }
}
