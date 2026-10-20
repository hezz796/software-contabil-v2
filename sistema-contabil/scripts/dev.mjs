/**
 * Orquestrador de `npm run dev`: sobe API (apps/api) e web (apps/web) em
 * paralelo, com saída prefixada por app, encerramento conjunto e derrubada da
 * árvore de processos (no Windows, `taskkill /T` — matar só o shell do npm
 * deixa os filhos órfãos).
 *
 * Não há proxy entre os dois processos: a integração UI→API vem nas
 * próximas tarefas (ver README.md).
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const ehWindows = process.platform === 'win32';
const npm = ehWindows ? 'npm.cmd' : 'npm';

const alvos = [
  { nome: 'api', comando: `${npm} run dev --workspace apps/api` },
  { nome: 'web', comando: `${npm} run dev --workspace apps/web` },
];

const filhos = new Map();
let encerrando = false;

function encaminhar(nome, stream, destino) {
  let resto = '';
  stream.setEncoding('utf8');
  stream.on('data', (pedaco) => {
    const linhas = (resto + pedaco).split(/\r?\n/);
    resto = linhas.pop() ?? '';
    for (const linha of linhas) destino.write(`[${nome}] ${linha}\n`);
  });
  stream.on('end', () => {
    if (resto.length > 0) destino.write(`[${nome}] ${resto}\n`);
  });
}

function derrubar(filho) {
  if (filho.exitCode !== null || filho.signalCode !== null) return;
  if (ehWindows && filho.pid !== undefined) {
    spawn('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    filho.kill('SIGTERM');
  }
}

function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const filho of filhos.values()) derrubar(filho);
  process.exitCode = codigo;
  // Garante saída mesmo com pipes presos.
  setTimeout(() => process.exit(codigo), 2000);
}

for (const alvo of alvos) {
  const filho = spawn(alvo.comando, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  filhos.set(alvo.nome, filho);

  if (filho.stdout) encaminhar(alvo.nome, filho.stdout, process.stdout);
  if (filho.stderr) encaminhar(alvo.nome, filho.stderr, process.stderr);

  filho.on('error', (erro) => {
    process.stderr.write(`[${alvo.nome}] falha ao iniciar: ${erro.message}\n`);
    encerrar(1);
  });

  filho.on('exit', (codigo, sinal) => {
    if (encerrando) return;
    process.stderr.write(`[${alvo.nome}] encerrou (${sinal ?? codigo}); derrubando os demais.\n`);
    encerrar(codigo ?? 1);
  });
}

process.on('SIGINT', () => encerrar(0));
process.on('SIGTERM', () => encerrar(0));
