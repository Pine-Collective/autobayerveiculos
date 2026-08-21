/**
 * Painel do estoque — Autobayer Veículos.
 *
 * Fluxo: edita aqui -> "Publicar" envia as fotos novas e grava
 * data/vehicles.json no GitHub -> o Vercel reconstrói o site sozinho.
 *
 * As fotos NÃO sobem na hora da escolha: ficam no navegador (comprimidas em
 * WebP) e só são enviadas junto do "Publicar". Cancelou o cadastro? Nada
 * ficou para trás no repositório.
 *
 * Nada de senha ou token do GitHub roda neste arquivo: o navegador só guarda
 * um token de sessão temporário, e quem fala com o GitHub são as funções
 * em /api.
 *
 * Depende de /admin/schema.js (gerado de lib/vehicle-schema.mjs — a fonte
 * única das listas de tipos/combustíveis e das regras de slug).
 */
(function () {
  'use strict';

  const CHAVE_TOKEN = 'autobayer:admin:token';

  const SCHEMA = window.AUTOBAYER_SCHEMA;
  const PARSER = window.AUTOBAYER_PARSER;
  if (!SCHEMA || !PARSER) {
    document.body.textContent =
      'Arquivos gerados do painel não carregaram. Rode "npm run data" e publique de novo.';
    return;
  }
  const { TIPOS, COMBUSTIVEIS, CAMBIOS, SELOS, gerarSlug, slugUnico } = SCHEMA;
  const TIPO_MOTO = 'Moto';

  const $ = (seletor) => document.querySelector(seletor);

  const brl = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  });
  const numero = new Intl.NumberFormat('pt-BR');

  const estado = {
    token: sessionStorage.getItem(CHAVE_TOKEN) || '',
    vehicles: [],
    sha: '',
    alterado: false,
    carregado: false,
    editandoId: null
  };

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                          */
  /* ------------------------------------------------------------------ */

  const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

  function escapar(texto) {
    const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(texto ?? '').replace(/[&<>"']/g, (c) => mapa[c]);
  }

  /**
   * O caminho guardado é sempre relativo à raiz ("assets/veiculos/x.webp"),
   * porque quem consome é o index.html na raiz. Para exibir aqui usamos a
   * barra inicial. Links completos (http) e pré-visualizações locais (data:)
   * passam direto.
   */
  function urlExibicao(src) {
    if (!src) return '';
    if (src.startsWith('data:') || /^(https?:)?\/\//.test(src)) return src;
    return `/${src.replace(/^\/+/, '')}`;
  }

  function mostrarFaixa(mensagem, tipo) {
    const faixa = $('#faixaStatus');
    faixa.textContent = mensagem;
    faixa.className = `faixa ${tipo || 'info'}`;
    faixa.hidden = false;
    if (tipo === 'sucesso') {
      setTimeout(() => {
        faixa.hidden = true;
      }, 8000);
    }
  }

  function preencherSelect(seletor, opcoes, rotuloVazio) {
    $(seletor).innerHTML = opcoes
      .map(
        (opcao) =>
          `<option value="${escapar(opcao)}">${escapar(opcao || rotuloVazio || 'Nenhum')}</option>`
      )
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* Comunicação com a API                                               */
  /* ------------------------------------------------------------------ */

  async function api(caminho, opcoes = {}) {
    const resposta = await fetch(`/api/${caminho}`, {
      ...opcoes,
      headers: {
        'Content-Type': 'application/json',
        ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}),
        ...opcoes.headers
      }
    });

    let dados = {};
    try {
      dados = await resposta.json();
    } catch {
      /* resposta sem corpo */
    }

    // 401 vindo do próprio login significa senha errada, não sessão vencida.
    // Nos demais casos a sessão expirou — pede o login de novo SEM descartar
    // o que está sendo editado (ver pedirNovoLogin).
    if (resposta.status === 401 && caminho !== 'login') {
      pedirNovoLogin();
      throw new Error('Sessão expirada. Entre novamente — suas alterações continuam aqui.');
    }
    if (!resposta.ok) {
      const erro = new Error(dados.erro || `Falha na requisição (${resposta.status}).`);
      erro.problemas = dados.problemas;
      erro.status = resposta.status;
      erro.corpo = dados;
      throw erro;
    }

    return dados;
  }

  /* ------------------------------------------------------------------ */
  /* Login                                                               */
  /* ------------------------------------------------------------------ */

  $('#formLogin').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const aviso = $('#avisoLogin');
    const botao = $('#botaoEntrar');

    aviso.hidden = true;
    botao.disabled = true;
    botao.textContent = 'Entrando...';

    try {
      const { token } = await api('login', {
        method: 'POST',
        body: JSON.stringify({ senha: $('#senha').value })
      });
      estado.token = token;
      sessionStorage.setItem(CHAVE_TOKEN, token);
      $('#senha').value = '';

      if (estado.carregado) {
        // Sessão renovada no meio do trabalho: volta exatamente onde estava,
        // sem re-buscar do servidor (o que apagaria as edições pendentes).
        $('#telaLogin').hidden = true;
        $('#painel').hidden = false;
        if (estado.alterado) {
          mostrarFaixa('Sessão renovada. Suas alterações continuam aqui — publique quando quiser.');
        }
      } else {
        await abrirPainel();
      }
    } catch (erro) {
      aviso.textContent = erro.message;
      aviso.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  /**
   * Sessão expirou no meio do uso: some com o painel mas PRESERVA todo o
   * estado (veículos editados, fotos pendentes). Depois do novo login, o
   * usuário volta para onde estava. Antes disto, uma sessão de 8h vencida
   * descartava uma manhã inteira de cadastro sem aviso.
   */
  function pedirNovoLogin() {
    estado.token = '';
    sessionStorage.removeItem(CHAVE_TOKEN);
    $('#painel').hidden = true;
    $('#telaLogin').hidden = false;
    const aviso = $('#avisoLogin');
    aviso.textContent = estado.alterado
      ? 'Sua sessão expirou. Entre de novo — suas alterações NÃO foram perdidas.'
      : 'Sua sessão expirou. Entre novamente.';
    aviso.hidden = false;
  }

  /** Saída manual: aqui sim o estado é zerado (com confirmação se houver pendências). */
  function sair() {
    estado.token = '';
    estado.vehicles = [];
    estado.sha = '';
    estado.alterado = false;
    estado.carregado = false;
    sessionStorage.removeItem(CHAVE_TOKEN);
    $('#painel').hidden = true;
    $('#telaLogin').hidden = false;
    $('#avisoLogin').hidden = true;
  }

  $('#botaoSair').addEventListener('click', () => {
    if (estado.alterado && !confirm('Há alterações não publicadas. Sair mesmo assim?')) return;
    sair();
  });

  /* ------------------------------------------------------------------ */
  /* Carregar e listar                                                   */
  /* ------------------------------------------------------------------ */

  async function abrirPainel() {
    $('#telaLogin').hidden = true;
    $('#painel').hidden = false;
    $('#lista').innerHTML = '<li class="vazio">Carregando estoque...</li>';

    try {
      const dados = await api('vehicles');
      estado.vehicles = dados.vehicles;
      estado.sha = dados.sha;
      estado.alterado = false;
      estado.carregado = true;
      $('#faixaStatus').hidden = true;
      renderizar();
    } catch (erro) {
      $('#lista').innerHTML = `<li class="vazio">${escapar(erro.message)}</li>`;
    }
  }

  function marcarAlterado() {
    estado.alterado = true;
    atualizarBotaoPublicar();
  }

  function atualizarBotaoPublicar() {
    $('#botaoSalvar').disabled = !estado.alterado;
    $('#pendencias').hidden = !estado.alterado;
    $('#pendencias').textContent = 'alterações não publicadas';
  }

  function renderizar() {
    const lista = $('#lista');

    if (estado.vehicles.length === 0) {
      lista.innerHTML =
        '<li class="vazio">Nenhum veículo cadastrado.<br>Use "+ Novo veículo" para começar.</li>';
    } else {
      lista.innerHTML = estado.vehicles
        .map((v) => {
          const etiquetas =
            (v.sold ? '<span class="etiqueta etiqueta-vendido">Vendido</span>' : '') +
            (v.featured && !v.sold
              ? '<span class="etiqueta etiqueta-destaque">Destaque</span>'
              : '');

          return `
            <li class="item${v.sold ? ' vendido' : ''}" data-id="${v.id}">
              <img class="item-foto" src="${escapar(urlExibicao(v.images[0] || ''))}" alt="" loading="lazy">
              <div class="item-dados">
                <h3 class="item-nome">${escapar(v.brand)} ${escapar(v.model)}${etiquetas}</h3>
                <p class="item-sub">
                  ${v.year} · ${escapar(v.type)} · ${numero.format(v.km)} km
                  <strong class="item-preco">
                    ${brl.format(v.price)}
                    ${v.priceTroca ? `<span class="item-troca">troca ${brl.format(v.priceTroca)}</span>` : ''}
                  </strong>
                </p>
              </div>
              <div class="item-acoes">
                <label class="interruptor">
                  <input type="checkbox" data-disponivel="${v.id}" ${v.sold ? '' : 'checked'}>
                  <span class="trilho"></span>
                  <span>${v.sold ? 'Vendido' : 'Disponível'}</span>
                </label>
                <button class="btn btn-ghost" type="button" data-editar="${v.id}">Editar</button>
              </div>
            </li>`;
        })
        .join('');
    }

    const disponiveis = estado.vehicles.filter((v) => !v.sold).length;
    $('#resumo').innerHTML =
      `<strong>${estado.vehicles.length}</strong> no cadastro · ` +
      `<strong>${disponiveis}</strong> à venda · ` +
      `<strong>${estado.vehicles.length - disponiveis}</strong> vendidos`;

    atualizarBotaoPublicar();
  }

  // Interruptor de vendido: a ação mais comum, resolvida em um toque.
  $('#lista').addEventListener('change', (evento) => {
    const interruptor = evento.target.closest('[data-disponivel]');
    if (!interruptor) return;

    const veiculo = estado.vehicles.find((v) => v.id === Number(interruptor.dataset.disponivel));
    if (!veiculo) return;

    veiculo.sold = !interruptor.checked;
    marcarAlterado();
    renderizar();
  });

  $('#lista').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-editar]');
    if (botao) abrirEditor(Number(botao.dataset.editar));
  });

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */

  let fotosEditor = [];

  function abrirEditor(id) {
    const novo = id === null;
    const veiculo = novo
      ? {
          id: Date.now(),
          brand: '',
          model: '',
          year: new Date().getFullYear(),
          type: TIPOS[0],
          km: 0,
          price: 0,
          priceTroca: 0,
          images: [],
          features: [],
          badge: '',
          featured: false,
          sold: false,
          fuel: COMBUSTIVEIS[0],
          gear: CAMBIOS[0],
          color: '',
          doors: 4
        }
      : estado.vehicles.find((v) => v.id === id);

    if (!veiculo) return;

    estado.editandoId = novo ? null : id;
    fotosEditor = [...veiculo.images];

    $('#tituloEditor').textContent = novo ? 'Novo veículo' : 'Editar veículo';
    $('#botaoExcluir').hidden = novo;

    $('#f-brand').value = veiculo.brand;
    $('#f-model').value = veiculo.model;
    $('#f-year').value = veiculo.year;
    $('#f-type').value = veiculo.type;
    $('#f-price').value = veiculo.price ? numero.format(veiculo.price) : '';
    $('#f-priceTroca').value = veiculo.priceTroca ? numero.format(veiculo.priceTroca) : '';
    $('#f-km').value = veiculo.km ? numero.format(veiculo.km) : '';
    $('#f-fuel').value = veiculo.fuel;
    $('#f-gear').value = veiculo.gear;
    $('#f-color').value = veiculo.color || '';
    $('#f-doors').value = veiculo.doors ?? 4;
    $('#f-badge').value = veiculo.badge || '';
    $('#f-featured').checked = Boolean(veiculo.featured);
    $('#f-sold').checked = Boolean(veiculo.sold);
    $('#f-features').value = (veiculo.features || []).join('\n');

    atualizarDicas();
    atualizarContagemItens();
    aplicarTipo();
    renderizarGaleria();
    $('#avisoFormulario').hidden = true;
    $('#colarLink').hidden = true;
    $('#colarAnuncioCaixa').hidden = true;
    $('#avisosParser').hidden = true;
    $('#textoAnuncio').value = '';
    $('#modalEditor').hidden = false;
    $('#f-brand').focus();
  }

  /** Moto não tem portas: o campo some em vez de guardar um valor sem sentido. */
  function aplicarTipo() {
    $('#campoPortas').hidden = $('#f-type').value === TIPO_MOTO;
  }

  $('#f-type').addEventListener('change', aplicarTipo);

  function atualizarContagemItens() {
    const n = $('#f-features')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length;
    $('#contagemFeatures').textContent = n ? `${n} ${n === 1 ? 'item' : 'itens'}` : ' ';
  }

  $('#f-features').addEventListener('input', atualizarContagemItens);

  function fecharEditor() {
    $('#modalEditor').hidden = true;
    estado.editandoId = null;
    fotosEditor = [];
    $('#progressoUpload').hidden = true;
  }

  $('#botaoNovo').addEventListener('click', () => abrirEditor(null));
  $('#botaoFechar').addEventListener('click', fecharEditor);
  $('#botaoCancelar').addEventListener('click', fecharEditor);

  $('#modalEditor').addEventListener('click', (evento) => {
    if (evento.target === $('#modalEditor')) fecharEditor();
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !$('#modalEditor').hidden) fecharEditor();
  });

  /* Dicas de formatação embaixo de preço e quilometragem */

  function atualizarDicas() {
    const preco = Number(soDigitos($('#f-price').value));
    const troca = Number(soDigitos($('#f-priceTroca').value));
    const km = Number(soDigitos($('#f-km').value));

    $('#dicaPreco').textContent = preco ? brl.format(preco) : ' ';
    $('#dicaKm').textContent = km ? `${numero.format(km)} km` : ' ';

    // Troca menor que à vista costuma ser dígito trocado — avisa na hora,
    // antes de a API recusar a publicação inteira.
    const dicaTroca = $('#dicaPrecoTroca');
    if (!troca) {
      dicaTroca.textContent = 'opcional';
      dicaTroca.classList.remove('dica-erro');
    } else if (preco && troca < preco) {
      dicaTroca.textContent = 'menor que o à vista — confira';
      dicaTroca.classList.add('dica-erro');
    } else {
      dicaTroca.textContent = brl.format(troca);
      dicaTroca.classList.remove('dica-erro');
    }
  }

  ['#f-price', '#f-priceTroca', '#f-km'].forEach((seletor) => {
    $(seletor).addEventListener('input', function () {
      const digitos = soDigitos(this.value);
      this.value = digitos ? numero.format(Number(digitos)) : '';
      atualizarDicas();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Colar anúncio: preenche o formulário a partir do texto              */
  /* ------------------------------------------------------------------ */

  $('#botaoColarAnuncio').addEventListener('click', () => {
    const caixa = $('#colarAnuncioCaixa');
    caixa.hidden = !caixa.hidden;
    if (!caixa.hidden) $('#textoAnuncio').focus();
  });

  $('#botaoCancelarAnuncio').addEventListener('click', () => {
    $('#colarAnuncioCaixa').hidden = true;
    $('#textoAnuncio').value = '';
  });

  $('#botaoInterpretar').addEventListener('click', () => {
    const texto = $('#textoAnuncio').value.trim();
    if (!texto) return;

    const { veiculo, avisos } = PARSER.parseAnuncio(texto);
    if (!veiculo) {
      mostrarAvisosParser(['Não consegui ler nada desse texto.'], true);
      return;
    }

    // Preenche só o que veio do anúncio; o resto o usuário completa.
    if (veiculo.brand) $('#f-brand').value = veiculo.brand;
    if (veiculo.model) $('#f-model').value = veiculo.model;
    if (veiculo.year) $('#f-year').value = veiculo.year;
    $('#f-type').value = veiculo.type;
    if (veiculo.km) $('#f-km').value = numero.format(veiculo.km);
    if (veiculo.price) $('#f-price').value = numero.format(veiculo.price);
    if (veiculo.priceTroca) $('#f-priceTroca').value = numero.format(veiculo.priceTroca);
    $('#f-fuel').value = veiculo.fuel;
    $('#f-gear').value = veiculo.gear;
    $('#f-badge').value = veiculo.badge || '';
    if (veiculo.doors !== undefined) $('#f-doors').value = veiculo.doors;
    if (veiculo.features.length) $('#f-features').value = veiculo.features.join('\n');

    aplicarTipo();
    atualizarDicas();
    atualizarContagemItens();
    mostrarAvisosParser(avisos, false);

    $('#colarAnuncioCaixa').hidden = true;
    $('#textoAnuncio').value = '';

    // Leva o usuário direto ao primeiro campo que ficou em branco.
    const alvo = !veiculo.brand ? '#f-brand' : !veiculo.year ? '#f-year' : '#f-color';
    $(alvo).focus();
  });

  function mostrarAvisosParser(avisos, erro) {
    const caixa = $('#avisosParser');
    caixa.className = `avisos-parser${erro ? ' erro' : ''}`;
    caixa.innerHTML =
      `<strong>Confira antes de salvar:</strong><ul>` +
      avisos.map((a) => `<li>${escapar(a)}</li>`).join('') +
      `</ul>`;
    caixa.hidden = false;
  }

  /* ------------------------------------------------------------------ */
  /* Fotos — pré-visualização local; o envio acontece só no Publicar     */
  /* ------------------------------------------------------------------ */

  function renderizarGaleria() {
    $('#galeria').innerHTML = fotosEditor
      .map(
        (src, indice) => `
        <div class="foto${indice === 0 ? ' capa' : ''}">
          <img src="${escapar(urlExibicao(src))}" alt="Foto ${indice + 1}">
          ${indice === 0 ? '<span class="foto-capa-marca">Capa</span>' : ''}
          <div class="foto-botoes">
            ${
              indice > 0
                ? `<button class="foto-botao" type="button" data-capa="${indice}" title="Tornar capa" aria-label="Tornar foto ${indice + 1} a capa">★</button>`
                : ''
            }
            <button class="foto-botao" type="button" data-remover="${indice}" title="Remover" aria-label="Remover foto ${indice + 1}">×</button>
          </div>
        </div>`
      )
      .join('');
  }

  $('#galeria').addEventListener('click', (evento) => {
    const capa = evento.target.closest('[data-capa]');
    if (capa) {
      const indice = Number(capa.dataset.capa);
      fotosEditor.unshift(fotosEditor.splice(indice, 1)[0]);
      renderizarGaleria();
      return;
    }

    const remover = evento.target.closest('[data-remover]');
    if (remover) {
      fotosEditor.splice(Number(remover.dataset.remover), 1);
      renderizarGaleria();
    }
  });

  /* --- Compressão no navegador ---------------------------------------
   * Foto de celular tem 4–12 MB; aqui ela vira WebP de ~150 KB antes de
   * qualquer envio — o repositório fica enxuto e o upload é rápido no 4G.
   *
   * Fallbacks, na ordem:
   *   - Safari < 15 não tem createImageBitmap(File) -> decodifica via <img>
   *   - Safari não gera WebP no canvas -> re-encoda como JPEG (nunca PNG,
   *     que para foto fica gigante)
   *   - Se ainda passar do limite -> reduz qualidade e depois dimensão
   */

  const LIMITE_FOTO_BYTES = 1.8 * 1024 * 1024; // margem sob os 2 MB da API

  async function carregarImagem(arquivo) {
    if (typeof createImageBitmap === 'function') {
      try {
        // from-image corrige fotos "deitadas" pela orientação EXIF.
        return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
      } catch {
        /* cai para o <img> */
      }
    }
    const url = URL.createObjectURL(arquivo);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const paraBlob = (canvas, tipo, qualidade) =>
    new Promise((resolve) => canvas.toBlob(resolve, tipo, qualidade));

  const blobParaDataUrl = (blob) =>
    new Promise((resolve) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result);
      leitor.readAsDataURL(blob);
    });

  async function comprimir(arquivo) {
    const origem = await carregarImagem(arquivo);
    const larguraOrigem = origem.naturalWidth || origem.width;
    const alturaOrigem = origem.naturalHeight || origem.height;

    let largura = Math.min(1600, larguraOrigem);
    let qualidade = 0.82;

    try {
      for (let tentativa = 0; tentativa < 6; tentativa++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, largura);
        canvas.height = Math.max(1, Math.round((alturaOrigem / larguraOrigem) * largura));
        canvas.getContext('2d').drawImage(origem, 0, 0, canvas.width, canvas.height);

        let blob = await paraBlob(canvas, 'image/webp', qualidade);
        if (!blob || blob.type !== 'image/webp') {
          blob = await paraBlob(canvas, 'image/jpeg', qualidade);
        }

        if (blob && blob.size <= LIMITE_FOTO_BYTES) {
          return await blobParaDataUrl(blob);
        }

        if (qualidade > 0.6) qualidade -= 0.12;
        else largura = Math.round(largura * 0.75);
      }
      throw new Error('A foto ficou grande demais mesmo depois de comprimida.');
    } finally {
      if (origem.close) origem.close();
    }
  }

  $('#arquivoFoto').addEventListener('change', async function () {
    const arquivos = Array.from(this.files || []);
    this.value = '';
    if (arquivos.length === 0) return;

    const progresso = $('#progressoUpload');
    progresso.hidden = false;

    for (let i = 0; i < arquivos.length; i++) {
      progresso.textContent = `Otimizando foto ${i + 1} de ${arquivos.length}...`;
      try {
        fotosEditor.push(await comprimir(arquivos[i]));
        renderizarGaleria();
      } catch (erro) {
        progresso.textContent = `Erro na foto ${i + 1}: ${erro.message}`;
        return;
      }
    }

    progresso.textContent = `${arquivos.length} foto(s) prontas. Elas sobem quando você publicar.`;
  });

  /* Colar link de imagem — campo inline no lugar do prompt() antigo */

  $('#botaoUrl').addEventListener('click', () => {
    const caixa = $('#colarLink');
    caixa.hidden = !caixa.hidden;
    if (!caixa.hidden) $('#campoUrlFoto').focus();
  });

  $('#botaoAdicionarUrl').addEventListener('click', () => {
    const campo = $('#campoUrlFoto');
    const url = campo.value.trim();
    if (!url) return;
    fotosEditor.push(url);
    campo.value = '';
    $('#colarLink').hidden = true;
    renderizarGaleria();
  });

  $('#campoUrlFoto').addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      $('#botaoAdicionarUrl').click();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Aplicar edição                                                      */
  /* ------------------------------------------------------------------ */

  $('#formVeiculo').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const aviso = $('#avisoFormulario');

    const brand = $('#f-brand').value.trim();
    const model = $('#f-model').value.trim();
    const year = Number($('#f-year').value);

    const problemas = [];
    if (!brand) problemas.push('Informe a marca.');
    if (!model) problemas.push('Informe o modelo.');
    if (!year || year < 1950) problemas.push('Informe um ano válido.');

    const precoAvista = Number(soDigitos($('#f-price').value));
    const precoTroca = Number(soDigitos($('#f-priceTroca').value));
    if (precoAvista <= 0) problemas.push('Informe o preço à vista.');
    if (precoTroca && precoTroca < precoAvista) {
      problemas.push('O preço na troca está menor que o à vista — confira os valores.');
    }
    if (fotosEditor.length === 0) problemas.push('Adicione ao menos uma foto.');

    if (problemas.length) {
      aviso.innerHTML = `<ul>${problemas.map((p) => `<li>${escapar(p)}</li>`).join('')}</ul>`;
      aviso.hidden = false;
      return;
    }

    const novo = estado.editandoId === null;
    const existente = novo ? null : estado.vehicles.find((v) => v.id === estado.editandoId);

    const tipo = $('#f-type').value;

    const veiculo = {
      id: existente ? existente.id : Date.now(),
      // Slug de carro novo já nasce único: dois "Compass 2022" viram
      // ...-2022 e ...-2022-2, em vez de travarem a publicação.
      slug: existente
        ? existente.slug
        : slugUnico(
            gerarSlug(brand, model, year),
            estado.vehicles.map((v) => v.slug)
          ),
      brand,
      model,
      year,
      type: tipo,
      km: Number(soDigitos($('#f-km').value)),
      price: Number(soDigitos($('#f-price').value)),
      priceTroca: Number(soDigitos($('#f-priceTroca').value)),
      images: [...fotosEditor],
      features: $('#f-features')
        .value.split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      badge: $('#f-badge').value,
      featured: $('#f-featured').checked,
      sold: $('#f-sold').checked,
      fuel: $('#f-fuel').value,
      gear: $('#f-gear').value,
      color: $('#f-color').value.trim()
    };

    if (tipo !== TIPO_MOTO) veiculo.doors = Number($('#f-doors').value) || 4;

    if (novo) {
      estado.vehicles.push(veiculo);
    } else {
      estado.vehicles[estado.vehicles.indexOf(existente)] = veiculo;
    }

    marcarAlterado();
    renderizar();
    fecharEditor();
    mostrarFaixa('Alteração aplicada. Clique em "Publicar" para colocar no ar.', 'info');
  });

  $('#botaoExcluir').addEventListener('click', () => {
    const veiculo = estado.vehicles.find((v) => v.id === estado.editandoId);
    if (!veiculo) return;

    const mensagem =
      `Excluir ${veiculo.brand} ${veiculo.model} do cadastro?\n\n` +
      'Se o carro foi vendido, prefira marcar como "Vendido": ele continua ' +
      'no site como referência e ainda gera contato de quem procura algo parecido.';

    if (!confirm(mensagem)) return;

    estado.vehicles = estado.vehicles.filter((v) => v.id !== estado.editandoId);
    marcarAlterado();
    renderizar();
    fecharEditor();
  });

  /* ------------------------------------------------------------------ */
  /* Publicar                                                            */
  /* ------------------------------------------------------------------ */

  /** Sobe as fotos que ainda estão só no navegador (data:) e troca pelo caminho real. */
  async function enviarFotosPendentes(aoProgredir) {
    const pendentes = [];
    estado.vehicles.forEach((veiculo) => {
      veiculo.images.forEach((imagem, indice) => {
        if (imagem.startsWith('data:')) pendentes.push({ veiculo, indice });
      });
    });

    for (let n = 0; n < pendentes.length; n++) {
      const { veiculo, indice } = pendentes[n];
      aoProgredir(n + 1, pendentes.length);
      const { caminho } = await api('upload', {
        method: 'POST',
        body: JSON.stringify({
          nome: gerarSlug(veiculo.brand, veiculo.model, veiculo.year) || 'foto',
          dados: veiculo.images[indice]
        })
      });
      veiculo.images[indice] = caminho;
    }
  }

  async function publicar() {
    const botao = $('#botaoSalvar');
    botao.disabled = true;

    try {
      await enviarFotosPendentes((n, total) => {
        botao.textContent = `Enviando foto ${n} de ${total}...`;
      });

      botao.textContent = 'Publicando...';
      const disponiveis = estado.vehicles.filter((v) => !v.sold).length;
      const { sha } = await api('vehicles', {
        method: 'PUT',
        body: JSON.stringify({
          vehicles: estado.vehicles,
          sha: estado.sha,
          resumo: `${estado.vehicles.length} veículos (${disponiveis} à venda)`
        })
      });

      estado.sha = sha;
      estado.alterado = false;
      renderizar();
      mostrarFaixa(
        'Publicado. O site é reconstruído automaticamente e as mudanças aparecem em cerca de 1 minuto.',
        'sucesso'
      );
    } catch (erro) {
      if (erro.status === 409) {
        mostrarConflito(erro);
      } else {
        const detalhes = erro.problemas ? ` ${erro.problemas.join(' · ')}` : '';
        mostrarFaixa(erro.message + detalhes, 'erro');
      }
    } finally {
      botao.textContent = 'Publicar';
      atualizarBotaoPublicar();
    }
  }

  $('#botaoSalvar').addEventListener('click', publicar);

  /**
   * Conflito de edição simultânea: nada de recarregar sozinho (o reload
   * antigo descartava as edições e ainda disparava o diálogo de "sair sem
   * salvar" por cima do aviso). O usuário decide, informado de quem publicou.
   */
  function mostrarConflito(erro) {
    const ultima = erro.corpo && erro.corpo.ultimaAlteracao;
    const quando = ultima && ultima.data ? new Date(ultima.data).toLocaleString('pt-BR') : '';
    const contexto = ultima
      ? `Última publicação: "${escapar(ultima.mensagem)}"${quando ? ` em ${escapar(quando)}` : ''}.`
      : '';

    const faixa = $('#faixaStatus');
    faixa.className = 'faixa erro';
    faixa.innerHTML =
      `Alguém publicou o estoque enquanto você editava. ${contexto}<br>` +
      `<span class="faixa-acoes">` +
      `<button type="button" class="btn btn-secundario" data-conflito="manter">Publicar minha versão mesmo assim</button>` +
      `<button type="button" class="btn btn-ghost" data-conflito="descartar">Descartar minhas alterações</button>` +
      `</span>`;
    faixa.hidden = false;
  }

  $('#faixaStatus').addEventListener('click', async (evento) => {
    const botao = evento.target.closest('[data-conflito]');
    if (!botao) return;

    if (botao.dataset.conflito === 'manter') {
      try {
        // Pega o sha atual do servidor e publica a versão local por cima —
        // escolha explícita e informada, não um clobber silencioso.
        const { sha } = await api('vehicles');
        estado.sha = sha;
        $('#faixaStatus').hidden = true;
        await publicar();
      } catch (erro) {
        mostrarFaixa(erro.message, 'erro');
      }
    } else {
      $('#faixaStatus').hidden = true;
      await abrirPainel();
    }
  });

  window.addEventListener('beforeunload', (evento) => {
    if (estado.alterado) evento.preventDefault();
  });

  /* ------------------------------------------------------------------ */
  /* Início                                                              */
  /* ------------------------------------------------------------------ */

  preencherSelect('#f-type', TIPOS);
  preencherSelect('#f-fuel', COMBUSTIVEIS);
  preencherSelect('#f-gear', CAMBIOS);
  preencherSelect('#f-badge', SELOS, 'Sem selo');

  if (estado.token) {
    abrirPainel();
  }
})();
