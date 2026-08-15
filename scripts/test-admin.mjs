/**
 * Testes do painel do estoque: autenticação, validação, endpoints da API e o
 * fluxo do admin num DOM real.
 *
 * O GitHub é simulado — nenhum commit de verdade é feito.
 *
 *   npm run test:admin
 */
import jsdom from 'jsdom';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

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

/** Repositório falso, em memória. */
const repositorio = new Map();
const commits = [];
let proximoSha = 1;

repositorio.set('data/vehicles.json', {
  conteudo: await readFile(join(root, 'data/vehicles.json'), 'utf8'),
  sha: 'sha-inicial'
});

// Intercepta as chamadas ao GitHub antes de qualquer módulo importá-lo.
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opcoes = {}) => {
  const endereco = String(url);
  if (!endereco.startsWith('https://api.github.com')) return fetchReal(url, opcoes);

  const caminho = decodeURIComponent(
    endereco
      .replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//, '')
      .split('?')[0]
  );

  const resposta = (corpo, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

  if (!opcoes.method || opcoes.method === 'GET') {
    const arquivo = repositorio.get(caminho);
    if (!arquivo) return resposta({ message: 'Not Found' }, 404);
    return resposta({
      content: Buffer.from(arquivo.conteudo).toString('base64'),
      sha: arquivo.sha
    });
  }

  if (opcoes.method === 'PUT') {
    const corpo = JSON.parse(opcoes.body);
    const atual = repositorio.get(caminho);

    // Conflito: sha enviado não bate com o atual.
    if (atual && corpo.sha !== atual.sha) {
      return resposta({ message: 'does not match' }, 409);
    }

    const novoSha = `sha-${proximoSha++}`;
    repositorio.set(caminho, {
      conteudo: Buffer.from(corpo.content, 'base64').toString('utf8'),
      sha: novoSha
    });
    commits.push({ caminho, mensagem: corpo.message });
    return resposta({ content: { sha: novoSha }, commit: { sha: `commit-${novoSha}` } });
  }

  return resposta({ message: 'Método não suportado no teste' }, 405);
};

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
const { validarEstoque, normalizarVeiculo, gerarSlug } = await import('../lib/vehicle-schema.mjs');

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
const [payloadOriginal, assinatura] = TOKEN.split('.');
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
check('GET devolve o sha para controle de versão', leitura.body.sha === 'sha-inicial');

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
    sha: 'sha-inicial'
  }
});
check('PUT com preço negativo é recusado', invalido.status === 400, `status ${invalido.status}`);
check('erro lista os problemas encontrados', Array.isArray(invalido.body.problemas));
check(
  'problema é descrito em português',
  invalido.body.problemas.some((p) => /preço/.test(p)),
  invalido.body.problemas?.join(' | ')
);

// Marca o primeiro carro como vendido — o caso de uso principal.
const vendido = estoque.map((v, i) => (i === 0 ? { ...v, sold: true } : v));
const gravou = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: vendido, sha: 'sha-inicial', resumo: 'marca Compass como vendido' }
});
check('PUT válido grava com sucesso', gravou.status === 200, JSON.stringify(gravou.body));
check('devolve o novo sha', Boolean(gravou.body.sha));
check('gerou commit com mensagem descritiva', commits.at(-1).mensagem.includes('vendido'));

const persistido = JSON.parse(repositorio.get('data/vehicles.json').conteudo);
check('alteração ficou gravada no arquivo', persistido[0].sold === true);
check('os outros veículos não foram afetados', persistido.filter((v) => v.sold).length === 1);

// Tenta gravar de novo com o sha antigo: simula duas pessoas editando.
const conflito = await chamar(vehicles, {
  method: 'PUT',
  token: TOKEN,
  body: { vehicles: estoque, sha: 'sha-inicial' }
});
check('edição concorrente devolve 409 em vez de sobrescrever', conflito.status === 409);
check(
  'mensagem de conflito é compreensível',
  /Recarregue a página/.test(conflito.body.erro),
  conflito.body.erro
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
check(
  'campo desconhecido é descartado na normalização',
  !('campoEstranho' in JSON.parse(repositorio.get('data/vehicles.json').conteudo)[0])
);

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
console.log('\n5. Regras de validação');
/* ================================================================== */

check(
  'slug tira acento e espaço',
  gerarSlug('Citroën', 'C3 Aircross', 2024) === 'citroen-c3-aircross-2024'
);
check('estoque válido não gera problema', validarEstoque(persistido).length === 0);
check(
  'id repetido é detectado',
  validarEstoque([persistido[0], persistido[0]]).some((p) => /repetido/.test(p))
);
check(
  'tipo inválido é detectado',
  validarEstoque([{ ...persistido[0], type: 'Moto' }]).some((p) => /tipo/.test(p))
);
check(
  'veículo sem foto é detectado',
  validarEstoque([{ ...persistido[0], images: [] }]).some((p) => /foto/.test(p))
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

/* Serve os arquivos do admin do disco e responde às chamadas de /api com o
   backend real que já testamos acima. */
const interceptor = requestInterceptor(async (request) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    const nome = url.pathname.replace('/api/', '');
    const handlers = { login, vehicles, upload };
    const corpo = request.method === 'GET' ? undefined : await request.clone().json();
    const resultado = await chamar(handlers[nome], {
      method: request.method,
      body: corpo,
      token: (request.headers.get('authorization') || '').replace('Bearer ', '')
    });
    return new Response(JSON.stringify(resultado.body), {
      status: resultado.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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
  url: `${ORIGEM}/admin/`,
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
 * precisa de um substituto. Ele encaminha /api/* para os mesmos handlers
 * testados acima — ou seja, a interface conversa com o backend de verdade.
 *
 * Sem isto os testes de interface passariam por engano: toda chamada
 * falharia com "fetch is not defined" e o admin mostraria esse texto no
 * mesmo lugar onde mostraria "Senha incorreta".
 */
window.fetch = async (endereco, opcoes = {}) => {
  const url = new URL(endereco, `${ORIGEM}/admin/`);
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

check('painel começa escondido, login visível', q('#painel').hidden && !q('#telaLogin').hidden);
check('página do admin pede para não ser indexada', !!q('meta[name="robots"][content*="noindex"]'));
check('menus foram preenchidos', qq('#f-type option').length === 4);
check('menu de selos inclui a opção vazia', qq('#f-badge option').length === 5);

// Login pela interface
q('#senha').value = 'errada';
q('#formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(1200);
// Confere o texto exato: um aviso genérico esconderia uma falha de infra
// (por exemplo "fetch is not defined") passando como se fosse senha errada.
check(
  'senha errada mostra exatamente "Senha incorreta."',
  q('#avisoLogin').textContent === 'Senha incorreta.',
  JSON.stringify(q('#avisoLogin').textContent)
);
check('continua na tela de login', !q('#telaLogin').hidden);

q('#senha').value = SENHA;
q('#formLogin').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(400);

check('login correto abre o painel', !q('#painel').hidden && q('#telaLogin').hidden);
check('senha é apagada do campo após entrar', q('#senha').value === '');
check('lista carrega os veículos', qq('#lista .item').length === 6, `${qq('#lista .item').length}`);
check('botão publicar começa desabilitado', q('#botaoSalvar').disabled);

const primeiro = qq('#lista .item')[0];
check('card mostra preço formatado', /R\$/.test(primeiro.textContent));

// Conta a partir do repositório em vez de fixar um número: as seções
// anteriores já mexeram no estado.
const vendidosNoRepo = JSON.parse(repositorio.get('data/vehicles.json').conteudo).filter(
  (v) => v.sold
).length;
check(
  'quantidade de vendidos na tela bate com o repositório',
  qq('#lista .item.vendido').length === vendidosNoRepo,
  `tela=${qq('#lista .item.vendido').length} repo=${vendidosNoRepo}`
);

// Interruptor de disponível/vendido
const interruptor = q('#lista input[data-disponivel]');
const idAlvo = Number(interruptor.dataset.disponivel);
const estavaVendido = !interruptor.checked;
interruptor.checked = !interruptor.checked;
interruptor.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick();

check('mexer no interruptor habilita "Publicar"', !q('#botaoSalvar').disabled);
check('aparece o aviso de alterações pendentes', !q('#pendencias').hidden);
check(
  'contagem do resumo se atualiza',
  /à venda/.test(q('#resumo').textContent),
  q('#resumo').textContent
);

// Publicar
q('#botaoSalvar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(300);

check('publicar limpa o estado de pendência', q('#botaoSalvar').disabled);
check('mostra confirmação de sucesso', /Publicado/.test(q('#faixaStatus').textContent));

const depoisDePublicar = JSON.parse(repositorio.get('data/vehicles.json').conteudo);
const alvo = depoisDePublicar.find((v) => v.id === idAlvo);
check(
  'a mudança do interruptor chegou ao repositório',
  alvo.sold === !estavaVendido,
  `sold=${alvo.sold}`
);

// Editor: novo veículo
q('#botaoNovo').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('editor abre para novo veículo', !q('#modalEditor').hidden);
check('título indica cadastro novo', q('#tituloEditor').textContent === 'Novo veículo');
check('botão excluir fica escondido no cadastro novo', q('#botaoExcluir').hidden);

// Tenta salvar vazio
q('#formVeiculo').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
check('formulário vazio mostra os erros', !q('#avisoFormulario').hidden);
check('erro cita a falta de foto', /foto/i.test(q('#avisoFormulario').textContent));

// Máscara de preço
q('#f-price').value = '145900';
q('#f-price').dispatchEvent(new window.Event('input', { bubbles: true }));
await tick();
check('preço ganha separador de milhar', q('#f-price').value === '145.900', q('#f-price').value);
check(
  'dica mostra o valor em reais',
  /R\$/.test(q('#dicaPreco').textContent),
  q('#dicaPreco').textContent
);

// Preenche e salva
q('#f-brand').value = 'Fiat';
q('#f-model').value = 'Toro Freedom';
q('#f-year').value = '2023';
q('#f-km').value = '32000';
q('#f-km').dispatchEvent(new window.Event('input', { bubbles: true }));
q('#f-type').value = 'Picape';

// Adiciona foto por link (o caminho de upload usa canvas, ausente no jsdom)
window.prompt = () => 'assets/veiculos/toro.webp';
q('#botaoUrl').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('foto adicionada aparece na galeria', qq('#galeria .foto').length === 1);
check('primeira foto é marcada como capa', qq('#galeria .foto')[0].classList.contains('capa'));

q('#formVeiculo').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick();

check('editor fecha ao aplicar', q('#modalEditor').hidden);
check('veículo novo entra na lista', qq('#lista .item').length === 7);
check('publicar volta a ficar habilitado', !q('#botaoSalvar').disabled);

q('#botaoSalvar').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(300);

const comNovo = JSON.parse(repositorio.get('data/vehicles.json').conteudo);
const toro = comNovo.find((v) => v.model === 'Toro Freedom');
check('veículo novo foi gravado', Boolean(toro));
check('slug foi gerado sozinho', toro?.slug === 'fiat-toro-freedom-2023', toro?.slug);
check('preço foi gravado como número', toro?.price === 145900, String(toro?.price));

// Sair
q('#botaoSair').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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
