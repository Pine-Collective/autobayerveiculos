/**
 * Testes do painel do estoque: autenticação, validação, endpoints da API e o
 * fluxo do admin num DOM real.
 *
 * O GitHub é simulado (scripts/lib/mock-github.mjs) — nenhum commit real.
 *
 *   npm run test:admin
 */
import jsdom from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { instalarMockGitHub } from './lib/mock-github.mjs';

const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

/* ================================================================== */
/* Ambiente simulado                                                   */
/* ================================================================== */

const SENHA = 'senha-de-teste-bem-longa';
process.env.ADMIN_PASSWORD = SENHA;
process.env.GITHUB_TOKEN = 'token-falso';
process.env.GITHUB_REPO = 'Pine-Collective/autobayerveiculos';
process.env.GITHUB_BRANCH = 'main';

const { repositorio, commits } = instalarMockGitHub({
  'data/vehicles.json': await readFile(join(root, 'data/vehicles.json'), 'utf8')
});
const SHA_INICIAL = repositorio.get('data/vehicles.json').sha;

const lerRepoJson = () => JSON.parse(repositorio.get('data/vehicles.json').conteudo);

/* Utilitário: chama um handler da API como o Vercel chamaria. */
async function chamar(handler, { method = 'GET', body, token } = {}) {
  const req = {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '10.0.0.1' }
  };

  let statusCode = 200;
  let payload;
  const res = {
    status(codigo) {
      statusCode = codigo;
      return this;
    },
    json(dados) {
      payload = dados;
      return this;
    },
    setHeader() {
      return this;
    }
  };

  await handler(req, res);
  return { status: statusCode, body: payload };
}

const login = (await import('../api/login.js')).default;
const vehicles = (await import('../api/vehicles.js')).default;
const upload = (await import('../api/upload.js')).default;
const { validarEstoque, normalizarVeiculo, gerarSlug, slugUnico, garantirSlugsUnicos } =
  await import('../lib/vehicle-schema.mjs');

/* ================================================================== */
console.log('\n1. Login e sessão');
/* ================================================================== */

const semSenha = await chamar(login, { method: 'POST', body: { senha: 'errada' } });
check('senha errada é recusada com 401', semSenha.status === 401, `status ${semSenha.status}`);
check('mensagem não revela detalhes', semSenha.body.erro === 'Senha incorreta.');

const getNoLogin = await chamar(login, { method: 'GET' });
check('GET no login devolve 405', getNoLogin.status === 405);

const certo = await chamar(login, { method: 'POST', body: { senha: SENHA } });
check('senha correta devolve 200 e token', certo.status === 200 && Boolean(certo.body.token));

const TOKEN = certo.body.token;
check('token tem validade futura', certo.body.validoAte > Date.now());

const semToken = await chamar(vehicles, { method: 'GET' });
check('API recusa acesso sem token', semToken.status === 401, `status ${semToken.status}`);

const tokenFalso = await chamar(vehicles, { method: 'GET', token: 'abc.def' });
check('API recusa token forjado', tokenFalso.status === 401);

// Token com payload alterado, mas assinatura da sessão original.
const [, assinatura] = TOKEN.split('.');
const payloadAlterado = Buffer.from(JSON.stringify({ exp: Date.now() + 999999999 })).toString(
  'base64url'
);
const adulterado = await chamar(vehicles, {
  method: 'GET',
  token: `${payloadAlterado}.${assinatura}`
});
check('API recusa token adulterado (assinatura não confere)', adulterado.status === 401);

// Token assinado corretamente, mas com validade no passado.
const chaveSessao = createHash('sha256').update(`autobayer-sessao:${SENHA}`).digest('hex');
const payloadVencido = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString(
  'base64url'
);
const tokenVencido = `${payloadVencido}.${createHmac('sha256', chaveSessao)
  .update(payloadVencido)
  .digest('base64url')}`;

check(
  'token com assinatura boa mas vencido é recusado',
  (await chamar(vehicles, { method: 'GET', token: tokenVencido })).status === 401
);
check(
  'token válido é aceito',
  (await chamar(vehicles, { method: 'GET', token: TOKEN })).status === 200
);

/* ================================================================== */
console.log('\n2. Leitura do estoque');
/* ================================================================== */

const leitura = await chamar(vehicles, { method: 'GET', token: TOKEN });
check('GET devolve a lista de veículos', Array.isArray(leitura.body.vehicles));
check('GET devolve 6 veículos', leitura.body.vehicles.length === 6);
check('GET devolve o sha para controle de versão', leitura.body.sha === SHA_INICIAL);

/* ================================================================== */
console.log('\n3. Gravação, validação e concorrência');
/* ================================================================== */

const estoque = leitura.body.vehicles;

const semSha = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: estoque }
});
check('PUT sem sha é recusado', semSha.status === 400);

const invalido = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: {
    vehicles: [{ ...estoque[0], price: -50, images: [] }],
    sha: SHA_INICIAL
  }
});
check('PUT com preço negativo é recusado', invalido.status === 400, `status ${invalido.status}`);
check('erro lista os problemas encontrados', Array.isArray(invalido.body.problemas));
check(
  'problema é descrito em português',
  invalido.body.problemas.some((p) => /preço/.test(p)),
  invalido.body.problemas?.join(' | ')
);

// Foto que ficou em data: (upload não aconteceu) não pode ir para o JSON.
const comDataUrl = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: {
    vehicles: [{ ...estoque[0], images: ['data:image/webp;base64,AAAA'] }, ...estoque.slice(1)],
    sha: SHA_INICIAL
  }
});
check('PUT com foto em data: é recusado', comDataUrl.status === 400, `status ${comDataUrl.status}`);
check(
  'erro explica que a foto não subiu',
  (comDataUrl.body.problemas || []).some((p) => /não subiu/.test(p)),
  comDataUrl.body.problemas?.join(' | ')
);

// Dois carros com o mesmo slug: a API resolve com sufixo em vez de recusar.
const clone = { ...estoque[1], id: 999888 };
const comClone = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: [...estoque, clone], sha: SHA_INICIAL, resumo: 'clona corolla' }
});
check('PUT com slug duplicado é aceito', comClone.status === 200, JSON.stringify(comClone.body));
const aposClone = lerRepoJson();
check(
  'o duplicado ganhou sufixo -2 e o original ficou intacto',
  aposClone.filter((v) => v.slug.startsWith('toyota-corolla-xei-2021')).length === 2 &&
    aposClone.some((v) => v.slug === 'toyota-corolla-xei-2021') &&
    aposClone.some((v) => v.slug === 'toyota-corolla-xei-2021-2'),
  aposClone.map((v) => v.slug).join(', ')
);

// Restaura o estoque para os 6 originais.
let shaAtual = repositorio.get('data/vehicles.json').sha;
const restaura = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: estoque, sha: shaAtual, resumo: 'restaura' }
});
shaAtual = restaura.body.sha;

// Marca o primeiro carro como vendido — o caso de uso principal.
const vendido = estoque.map((v, i) => (i === 0 ? { ...v, sold: true } : v));
const gravou = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: vendido, sha: shaAtual, resumo: 'marca Compass como vendido' }
});
check('PUT válido grava com sucesso', gravou.status === 200, JSON.stringify(gravou.body));
check('devolve o novo sha', Boolean(gravou.body.sha));
check('gerou commit com mensagem descritiva', commits.at(-1).mensagem.includes('vendido'));
check(
  'commit sai em nome do painel',
  commits.at(-1).committer?.name === 'Painel Autobayer',
  JSON.stringify(commits.at(-1).committer)
);

const persistido = lerRepoJson();
check('alteração ficou gravada no arquivo', persistido[0].sold === true);
check('os outros veículos não foram afetados', persistido.filter((v) => v.sold).length === 1);

// Tenta gravar de novo com o sha antigo: simula duas pessoas editando.
const conflito = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: estoque, sha: SHA_INICIAL }
});
check('edição concorrente devolve 409 em vez de sobrescrever', conflito.status === 409);
check(
  '409 informa qual foi a última publicação',
  Boolean(conflito.body.ultimaAlteracao?.mensagem),
  JSON.stringify(conflito.body.ultimaAlteracao)
);

/* Campos desconhecidos vindos do navegador não passam. */
const comLixo = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: {
    vehicles: [{ ...persistido[0], campoEstranho: 'x', sold: false }, ...persistido.slice(1)],
    sha: repositorio.get('data/vehicles.json').sha
  }
});
check('PUT com campo desconhecido é aceito', comLixo.status === 200);
check('campo desconhecido é descartado na normalização', !('campoEstranho' in lerRepoJson()[0]));

/* ================================================================== */
console.log('\n4. Upload de fotos');
/* ================================================================== */

const semAuth = await chamar(upload, { method: 'POST', body: { dados: 'x' } });
check('upload exige login', semAuth.status === 401);

// PNG mínimo válido (assinatura correta).
const pngValido = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const enviou = await chamar(upload, {
  method: 'POST',
  token: TOKEN,
  body: { nome: 'Jeep Compass 2022', dados: pngValido.toString('base64') }
});
check('upload de PNG válido funciona', enviou.status === 200, JSON.stringify(enviou.body));
check(
  'caminho gerado é relativo à raiz',
  enviou.body.caminho.startsWith('assets/veiculos/'),
  enviou.body.caminho
);
check(
  'nome do arquivo é higienizado',
  /^assets\/veiculos\/jeep-compass-2022-[a-z0-9]+\.png$/.test(enviou.body.caminho),
  enviou.body.caminho
);
check('foto foi commitada no repositório', repositorio.has(enviou.body.caminho));

const naoImagem = await chamar(upload, {
  method: 'POST',
  token: TOKEN,
  body: { nome: 'x', dados: Buffer.from('<?php system($_GET[0]); ?>').toString('base64') }
});
check(
  'arquivo que não é imagem é recusado',
  naoImagem.status === 400,
  `status ${naoImagem.status}`
);

const nomeMalicioso = await chamar(upload, {
  method: 'POST',
  token: TOKEN,
  body: { nome: '../../../etc/passwd', dados: pngValido.toString('base64') }
});
check(
  'travessia de diretório no nome é neutralizada',
  nomeMalicioso.status === 200 && !nomeMalicioso.body.caminho.includes('..'),
  nomeMalicioso.body.caminho
);

/* ================================================================== */
console.log('\n5. Regras de validação e slugs');
/* ================================================================== */

check(
  'slug tira acento e espaço',
  gerarSlug('Citroën', 'C3 Aircross', 2024) === 'citroen-c3-aircross-2024'
);
check('slugUnico devolve a base quando livre', slugUnico('a-b', ['x']) === 'a-b');
check('slugUnico sufixa quando ocupado', slugUnico('a-b', ['a-b']) === 'a-b-2');
check('slugUnico pula sufixos já usados', slugUnico('a-b', ['a-b', 'a-b-2']) === 'a-b-3');

const listaComDuplicatas = [
  { slug: 'x', id: 1 },
  { slug: 'x', id: 2 },
  { slug: 'x', id: 3 }
];
check(
  'garantirSlugsUnicos preserva o primeiro e sufixa os demais',
  garantirSlugsUnicos(listaComDuplicatas)
    .map((v) => v.slug)
    .join(',') === 'x,x-2,x-3'
);

const estoqueValido = lerRepoJson();
check('estoque válido não gera problema', validarEstoque(estoqueValido).length === 0);
check(
  'id repetido é detectado',
  validarEstoque([estoqueValido[0], estoqueValido[0]]).some((p) => /repetido/.test(p))
);
check(
  'tipo inválido é detectado',
  validarEstoque([{ ...estoqueValido[0], type: 'Trator' }]).some((p) => /tipo/.test(p))
);
check(
  'Moto agora é um tipo válido',
  validarEstoque([{ ...estoqueValido[0], type: 'Moto', doors: undefined }]).length === 0
);
check(
  'moto com número de portas é recusada',
  validarEstoque([{ ...estoqueValido[0], type: 'Moto', doors: 4 }]).some((p) => /moto/.test(p))
);
check(
  'item em branco na lista de opcionais é recusado',
  validarEstoque([{ ...estoqueValido[0], features: ['Ar', '  '] }]).some((p) => /branco/.test(p))
);
check(
  'veículo sem foto é detectado',
  validarEstoque([{ ...estoqueValido[0], images: [] }]).some((p) => /foto/.test(p))
);

const normalizado = normalizarVeiculo({
  brand: 'Fiat',
  model: 'Toro Freedom',
  year: '2023',
  price: 'R$ 145.900',
  km: '32.000',
  type: 'Picape',
  images: ['assets/veiculos/a.webp'],
  sold: false
});
check('preço com máscara vira número', normalizado.price === 145900, String(normalizado.price));
check('quilometragem com ponto vira número', normalizado.km === 32000, String(normalizado.km));
check(
  'slug é gerado quando ausente',
  normalizado.slug === 'fiat-toro-freedom-2023',
  normalizado.slug
);
check('normalizado passa na validação', validarEstoque([normalizado]).length === 0);

/* ================================================================== */
console.log('\n6. Interface do admin (DOM real)');
/* ================================================================== */

const virtualConsole = new VirtualConsole();
const errosConsole = [];
virtualConsole.on('jsdomError', (e) => errosConsole.push(e.message));

const ORIGEM = 'https://autobayer.test';
const MIME = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png' };

/* Serve os arquivos do admin do disco. */
const interceptor = requestInterceptor(async (request) => {
  const url = new URL(request.url);
  const relativo = url.pathname.replace(/^\/+/, '');
  try {
    const conteudo = await readFile(join(root, relativo));
    const ext = relativo.split('.').pop();
    return new Response(conteudo, {
      headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
    });
  } catch {
    return new Response('', { status: 404 });
  }
});

const htmlAdmin = await readFile(join(root, 'admin/index.html'), 'utf8');
const dom = new JSDOM(htmlAdmin, {
  // SEM barra final, de propósito: é assim que o Vercel serve /admin. Com a
  // barra, um caminho relativo como "admin.css" funcionaria no teste e daria
  // 404 em produção — foi exatamente o que aconteceu na primeira publicação.
  url: `${ORIGEM}/admin`,
  runScripts: 'dangerously',
  resources: { interceptors: [interceptor] },
  pretendToBeVisual: true,
  virtualConsole
});

const { window } = dom;
const doc = window.document;
await new Promise((r) => window.addEventListener('load', r));
await tick();

/**
 * O jsdom não implementa window.fetch (só XMLHttpRequest), então o admin
 * precisa de um substituto que encaminha /api/* aos handlers reais testados
 * acima. `window.__proximaResposta` força uma resposta única (401/409) para
 * exercitar os fluxos de sessão expirada e de conflito.
 */
window.__proximaResposta = null;
window.fetch = async (endereco, opcoes = {}) => {
  const url = new URL(endereco, `${ORIGEM}/admin`);

  if (window.__proximaResposta) {
    const forcada = window.__proximaResposta;
    window.__proximaResposta = null;
    return {
      ok: false,
      status: forcada.status,
      json: async () => forcada.body
    };
  }

  const handlers = { login, vehicles, upload };
  const handler = handlers[url.pathname.replace('/api/', '')];
  if (!handler) {
    return { ok: false, status: 404, json: async () => ({ erro: 'Rota inexistente.' }) };
  }

  const cabecalhos = opcoes.headers || {};
  const resultado = await chamar(handler, {
    method: opcoes.method || 'GET',
    body: opcoes.body ? JSON.parse(opcoes.body) : undefined,
    token: String(cabecalhos.Authorization || '').replace('Bearer ', '')
  });

  return {
    ok: resultado.status >= 200 && resultado.status < 300,
    status: resultado.status,
    json: async () => resultado.body
  };
};

const q = (s) => doc.querySelector(s);
const qq = (s) => Array.from(doc.querySelectorAll(s));
const clicar = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const submeter = (el) =>
  el.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

check('painel começa escondido, login visível', q('#painel').hidden && !q('#telaLogin').hidden);
check('página do admin pede para não ser indexada', !!q('meta[name="robots"][content*="noindex"]'));

// Guarda contra a regressão de caminhos: qualquer referência local relativa
// quebra quando o Vercel serve /admin sem barra final.
const referencias = [
  ...qq('link[href]').map((el) => el.getAttribute('href')),
  ...qq('script[src]').map((el) => el.getAttribute('src')),
  ...qq('img[src]').map((el) => el.getAttribute('src'))
];
const relativas = referencias.filter((ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith('/'));
check(
  'todo asset local usa caminho absoluto',
  relativas.length === 0,
  `relativos: ${relativas.join(', ')}`
);
check('folha de estilo do admin carregou', Boolean(q('link[href="/admin/admin.css"]')));
check('schema.js gerado está referenciado', Boolean(q('script[src="/admin/schema.js"]')));
check('menus vêm da fonte única (6 tipos, com Moto e Perua)', qq('#f-type option').length === 6);
check(
  'tipo Moto disponível no menu',
  qq('#f-type option').some((o) => o.value === 'Moto')
);
check('menu de selos inclui "Sem sinistro"', qq('#f-badge option').length === 6);
check('parser.js gerado está referenciado', Boolean(q('script[src="/admin/parser.js"]')));
check(
  'login tem campo de usuário para gerenciador de senha',
  !!q('input[autocomplete="username"]')
);

// Login pela interface
q('#senha').value = 'errada';
submeter(q('#formLogin'));
await tick(1200);
check(
  'senha errada mostra exatamente "Senha incorreta."',
  q('#avisoLogin').textContent === 'Senha incorreta.',
  JSON.stringify(q('#avisoLogin').textContent)
);
check('continua na tela de login', !q('#telaLogin').hidden);

q('#senha').value = SENHA;
submeter(q('#formLogin'));
await tick(400);

check('login correto abre o painel', !q('#painel').hidden && q('#telaLogin').hidden);
check('senha é apagada do campo após entrar', q('#senha').value === '');
check('lista carrega os veículos', qq('#lista .item').length === 6, `${qq('#lista .item').length}`);
check('botão publicar começa desabilitado', q('#botaoSalvar').disabled);
check('card mostra preço formatado', /R\$/.test(qq('#lista .item')[0].textContent));

const vendidosNoRepo = lerRepoJson().filter((v) => v.sold).length;
check(
  'quantidade de vendidos na tela bate com o repositório',
  qq('#lista .item.vendido').length === vendidosNoRepo,
  `tela=${qq('#lista .item.vendido').length} repo=${vendidosNoRepo}`
);

/* --- Interruptor + publicar ------------------------------------------ */

const interruptor = q('#lista input[data-disponivel]');
const idAlvo = Number(interruptor.dataset.disponivel);
const estavaVendido = !interruptor.checked;
interruptor.checked = !interruptor.checked;
interruptor.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();

check('mexer no interruptor habilita "Publicar"', !q('#botaoSalvar').disabled);
check('aparece o aviso de alterações pendentes', !q('#pendencias').hidden);

clicar(q('#botaoSalvar'));
await tick(300);

check('publicar limpa o estado de pendência', q('#botaoSalvar').disabled);
check('mostra confirmação de sucesso', /Publicado/.test(q('#faixaStatus').textContent));
check(
  'a mudança do interruptor chegou ao repositório',
  lerRepoJson().find((v) => v.id === idAlvo).sold === !estavaVendido
);

/* --- Sessão expirada no meio do trabalho ------------------------------ */

const interruptor2 = q('#lista input[data-disponivel]');
interruptor2.checked = !interruptor2.checked;
interruptor2.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();
const itensAntes = qq('#lista .item').length;

window.__proximaResposta = { status: 401, body: { erro: 'Sessão expirada ou inválida.' } };
clicar(q('#botaoSalvar'));
await tick(200);

check('sessão vencida volta para a tela de login', !q('#telaLogin').hidden && q('#painel').hidden);
check(
  'aviso deixa claro que nada foi perdido',
  /NÃO foram perdidas/.test(q('#avisoLogin').textContent),
  JSON.stringify(q('#avisoLogin').textContent)
);

q('#senha').value = SENHA;
submeter(q('#formLogin'));
await tick(400);

check('reentrar traz o painel de volta', !q('#painel').hidden);
check(
  'as edições pendentes sobreviveram à reautenticação',
  !q('#botaoSalvar').disabled && qq('#lista .item').length === itensAntes,
  `publicar disabled=${q('#botaoSalvar').disabled}`
);

clicar(q('#botaoSalvar'));
await tick(300);
check(
  'publicar depois da reautenticação funciona',
  /Publicado/.test(q('#faixaStatus').textContent)
);

/* --- Conflito de edição simultânea (409) ------------------------------ */

const interruptor3 = q('#lista input[data-disponivel]');
interruptor3.checked = !interruptor3.checked;
interruptor3.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();

window.__proximaResposta = {
  status: 409,
  body: {
    erro: 'Alguém publicou o estoque enquanto você editava.',
    ultimaAlteracao: { mensagem: 'admin: teste de conflito', data: new Date().toISOString() }
  }
};
clicar(q('#botaoSalvar'));
await tick(200);

check(
  'conflito mostra a faixa com contexto',
  /teste de conflito/.test(q('#faixaStatus').textContent)
);
check('conflito oferece publicar mesmo assim', !!q('[data-conflito="manter"]'));
check('conflito oferece descartar', !!q('[data-conflito="descartar"]'));
check('painel continua visível (sem reload automático)', !q('#painel').hidden);

clicar(q('[data-conflito="manter"]'));
await tick(400);
check(
  'publicar minha versão resolve o conflito',
  /Publicado/.test(q('#faixaStatus').textContent),
  q('#faixaStatus').textContent
);

/* --- Editor: novo veículo com link de foto ---------------------------- */

clicar(q('#botaoNovo'));
await tick();
check('editor abre para novo veículo', !q('#modalEditor').hidden);
check('botão excluir fica escondido no cadastro novo', q('#botaoExcluir').hidden);

submeter(q('#formVeiculo'));
await tick();
check('formulário vazio mostra os erros', !q('#avisoFormulario').hidden);
check('erro cita a falta de foto', /foto/i.test(q('#avisoFormulario').textContent));

q('#f-price').value = '145900';
q('#f-price').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('preço ganha separador de milhar', q('#f-price').value === '145.900', q('#f-price').value);

q('#f-brand').value = 'Fiat';
q('#f-model').value = 'Toro Freedom';
q('#f-year').value = '2023';
q('#f-km').value = '32000';
q('#f-km').dispatchEvent(new window.Event('input', { bubbles: true }));
q('#f-type').value = 'Picape';

// Foto por link — o campo inline substituiu o prompt().
clicar(q('#botaoUrl'));
await tick();
check('campo de link aparece', !q('#colarLink').hidden);
q('#campoUrlFoto').value = 'assets/veiculos/toro.webp';
clicar(q('#botaoAdicionarUrl'));
await tick();
check('foto adicionada aparece na galeria', qq('#galeria .foto').length === 1);
check('primeira foto é marcada como capa', qq('#galeria .foto')[0].classList.contains('capa'));

submeter(q('#formVeiculo'));
await tick();
check('editor fecha ao aplicar', q('#modalEditor').hidden);
check('veículo novo entra na lista', qq('#lista .item').length === 7);

clicar(q('#botaoSalvar'));
await tick(300);
const toro = lerRepoJson().find((v) => v.model === 'Toro Freedom');
check('veículo novo foi gravado', Boolean(toro));
check('slug foi gerado sozinho', toro?.slug === 'fiat-toro-freedom-2023', toro?.slug);
check('preço foi gravado como número', toro?.price === 145900, String(toro?.price));

/* --- Colar anúncio preenche o formulário ------------------------------ */

clicar(q('#botaoNovo'));
await tick();
clicar(q('#botaoColarAnuncio'));
await tick();
check('caixa de colar anúncio abre', !q('#colarAnuncioCaixa').hidden);

q('#textoAnuncio').value = [
  'Corsa classic 1.0 VHC',
  'Desembaçador',
  'Vidros manuais',
  'Ano 2003',
  'Km:267.000',
  '4 portas',
  'Avista R$15.900,00',
  'Na troca R$16.900,00',
  'Faço financiamento'
].join('\n');
clicar(q('#botaoInterpretar'));
await tick();

check('marca deduzida chega ao campo', q('#f-brand').value === 'Chevrolet', q('#f-brand').value);
check('ano preenchido', q('#f-year').value === '2003', q('#f-year').value);
check('tipo deduzido (Sedan, não Hatch)', q('#f-type').value === 'Sedan', q('#f-type').value);
check('km com máscara', q('#f-km').value === '267.000', q('#f-km').value);
check('preço à vista preenchido', q('#f-price').value === '15.900', q('#f-price').value);
check('preço na troca preenchido', q('#f-priceTroca').value === '16.900', q('#f-priceTroca').value);
check('itens viraram linhas do textarea', q('#f-features').value.split('\n').length === 2);
check('"faço financiamento" não virou item', !/financiamento/i.test(q('#f-features').value));
check('avisos do parser aparecem', !q('#avisosParser').hidden);
check(
  'aviso cita cor e fotos',
  /Cor e fotos/.test(q('#avisosParser').textContent),
  q('#avisosParser').textContent.slice(0, 80)
);
check('caixa de colar fecha após interpretar', q('#colarAnuncioCaixa').hidden);

// Completa e publica o que veio do anúncio.
q('#f-color').value = 'Prata';
clicar(q('#botaoUrl'));
q('#campoUrlFoto').value = 'assets/veiculos/corsa.webp';
clicar(q('#botaoAdicionarUrl'));
await tick();
submeter(q('#formVeiculo'));
await tick();
check('veículo do anúncio entra na lista', qq('#lista .item').length === 8);
check(
  'card do painel mostra o preço na troca',
  /troca/i.test(q('#lista').textContent),
  'sem menção a troca'
);

clicar(q('#botaoSalvar'));
await tick(300);
const corsa = lerRepoJson().find((v) => v.model.startsWith('Corsa'));
check('anúncio colado foi publicado', Boolean(corsa));
check('priceTroca gravado', corsa?.priceTroca === 16900, String(corsa?.priceTroca));
check('features gravadas', corsa?.features.length === 2, JSON.stringify(corsa?.features));
check('doors do texto respeitado', corsa?.doors === 4, String(corsa?.doors));

/* --- Moto: sem portas ------------------------------------------------- */

clicar(q('#botaoNovo'));
await tick();
check('campo portas visível por padrão', !q('#campoPortas').hidden);

q('#f-type').value = 'Moto';
q('#f-type').dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();
check('escolher Moto esconde o campo portas', q('#campoPortas').hidden);

q('#f-brand').value = 'Honda';
q('#f-model').value = 'CG 125 KS';
q('#f-year').value = '2003';
q('#f-price').value = '7200';
q('#f-price').dispatchEvent(new window.Event('input', { bubbles: true }));
q('#f-priceTroca').value = '8200';
q('#f-priceTroca').dispatchEvent(new window.Event('input', { bubbles: true }));
clicar(q('#botaoUrl'));
q('#campoUrlFoto').value = 'assets/veiculos/cg125.webp';
clicar(q('#botaoAdicionarUrl'));
await tick();
submeter(q('#formVeiculo'));
await tick();
check('moto entra na lista', qq('#lista .item').length === 9);

clicar(q('#botaoSalvar'));
await tick(300);
const moto = lerRepoJson().find((v) => v.type === 'Moto');
check('moto foi publicada', Boolean(moto));
check('moto gravada sem portas', moto && moto.doors === undefined, String(moto?.doors));

/* --- Troca menor que à vista é barrada -------------------------------- */

clicar(q('#botaoNovo'));
await tick();
q('#f-brand').value = 'Fiat';
q('#f-model').value = 'Uno';
q('#f-year').value = '2010';
q('#f-price').value = '20000';
q('#f-price').dispatchEvent(new window.Event('input', { bubbles: true }));
q('#f-priceTroca').value = '15000';
q('#f-priceTroca').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check(
  'dica avisa que a troca ficou menor',
  /menor que o à vista/.test(q('#dicaPrecoTroca').textContent),
  q('#dicaPrecoTroca').textContent
);

clicar(q('#botaoUrl'));
q('#campoUrlFoto').value = 'assets/veiculos/uno.webp';
clicar(q('#botaoAdicionarUrl'));
await tick();
submeter(q('#formVeiculo'));
await tick();
check('formulário barra troca menor que à vista', !q('#avisoFormulario').hidden);
check('editor continua aberto', !q('#modalEditor').hidden);
clicar(q('#botaoCancelar'));
await tick();

/* --- Segundo carro idêntico: slug ganha sufixo ------------------------ */

clicar(q('#botaoNovo'));
await tick();
q('#f-brand').value = 'Fiat';
q('#f-model').value = 'Toro Freedom';
q('#f-year').value = '2023';
q('#f-price').value = '139900';
q('#f-price').dispatchEvent(new window.Event('input', { bubbles: true }));
q('#f-type').value = 'Picape';
clicar(q('#botaoUrl'));
q('#campoUrlFoto').value = 'assets/veiculos/toro-2.webp';
clicar(q('#botaoAdicionarUrl'));
await tick();
submeter(q('#formVeiculo'));
await tick();
clicar(q('#botaoSalvar'));
await tick(300);

const toros = lerRepoJson().filter((v) => v.model === 'Toro Freedom');
check(
  'dois carros iguais publicam com slugs distintos',
  toros.length === 2 && new Set(toros.map((v) => v.slug)).size === 2,
  toros.map((v) => v.slug).join(', ')
);
check(
  'o segundo ganhou o sufixo -2',
  toros.some((v) => v.slug === 'fiat-toro-freedom-2023-2'),
  toros.map((v) => v.slug).join(', ')
);

/* --- Sair -------------------------------------------------------------- */

clicar(q('#botaoSair'));
await tick();
check('sair volta para a tela de login', !q('#telaLogin').hidden && q('#painel').hidden);
check('token é removido da sessão', !window.sessionStorage.getItem('autobayer:admin:token'));

check('nenhum erro de script no admin', errosConsole.length === 0, errosConsole.join(' | '));

/* ================================================================== */

console.log(`\n${'─'.repeat(56)}\n${passed} verificações passaram, ${failures.length} falharam.`);
if (failures.length) {
  console.log('\nFalhas:');
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exitCode = 1;
}
dom.window.close();
