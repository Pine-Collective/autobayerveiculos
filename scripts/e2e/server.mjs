/**
 * Servidor local para os testes de navegador real (Playwright).
 *
 * Replica o comportamento do Vercel que interessa aos testes:
 *   - serve os arquivos estáticos de public/ (inclusive /admin SEM barra
 *     final — a diferença que derrubou o painel em produção)
 *   - roteia /api/* para os MESMOS handlers serverless do deploy
 *   - o GitHub é o mock em memória (scripts/lib/mock-github.mjs)
 *
 * Endpoint extra, só deste servidor: GET /api/_e2e/repo devolve o estado do
 * repositório simulado, para os specs conferirem o que foi "commitado".
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instalarMockGitHub } from '../lib/mock-github.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..', '..');
const publicDir = join(root, 'public');
const PORTA = Number(process.env.E2E_PORT || 4173);

/* Ambiente das funções — igual ao test-admin, definido ANTES dos imports. */
export const SENHA_E2E = 'senha-e2e-bem-comprida';
process.env.ADMIN_PASSWORD = SENHA_E2E;
process.env.GITHUB_TOKEN = 'token-falso';
process.env.GITHUB_REPO = 'Pine-Collective/autobayerveiculos';
process.env.GITHUB_BRANCH = 'main';

const { repositorio } = instalarMockGitHub({
  'data/vehicles.json': await readFile(join(root, 'data/vehicles.json'), 'utf8')
});

const handlers = {
  login: (await import('../../api/login.js')).default,
  vehicles: (await import('../../api/vehicles.js')).default,
  upload: (await import('../../api/upload.js')).default
};

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8'
};

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = '';
    req.on('data', (parte) => {
      dados += parte;
    });
    req.on('end', () => {
      try {
        resolve(dados ? JSON.parse(dados) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** Adapta (req, res) do Node para a assinatura estilo Vercel dos handlers. */
async function despacharApi(req, res, nome) {
  if (nome === '_e2e/repo') {
    const estadoRepo = {};
    for (const [caminho, arquivo] of repositorio.entries()) {
      estadoRepo[caminho] = caminho.endsWith('.json')
        ? JSON.parse(arquivo.conteudo)
        : `<binário ${arquivo.conteudo.length} bytes>`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(estadoRepo));
    return;
  }

  const handler = handlers[nome];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Rota inexistente.' }));
    return;
  }

  const reqVercel = {
    method: req.method,
    headers: req.headers,
    body: await lerCorpo(req),
    socket: { remoteAddress: req.socket.remoteAddress }
  };

  const resVercel = {
    statusCode: 200,
    setHeader: (chave, valor) => res.setHeader(chave, valor),
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(dados) {
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dados));
      return this;
    }
  };

  await handler(reqVercel, resVercel);
}

async function servirEstatico(res, caminhoUrl) {
  // /admin (sem barra) -> admin/index.html, como o Vercel faz.
  let relativo = caminhoUrl.replace(/^\/+/, '') || 'index.html';
  if (relativo === 'admin' || relativo === 'admin/') relativo = 'admin/index.html';

  const arquivo = normalize(join(publicDir, relativo));
  if (!arquivo.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const conteudo = await readFile(arquivo);
    const ext = arquivo.split('.').pop().toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await despacharApi(req, res, url.pathname.replace('/api/', ''));
    } else {
      await servirEstatico(res, url.pathname);
    }
  } catch (erro) {
    console.error('Erro no servidor e2e:', erro);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

servidor.listen(PORTA, () => {
  console.log(`Servidor e2e em http://localhost:${PORTA} (senha: ${SENHA_E2E})`);
});
