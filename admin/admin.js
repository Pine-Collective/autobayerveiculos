/**
 * Painel do estoque — Autobayer Veículos.
 *
 * Fluxo: edita aqui -> "Publicar" grava data/vehicles.json no GitHub ->
 * o Vercel reconstrói o site sozinho.
 *
 * Nada de senha ou token do GitHub roda neste arquivo: o navegador só guarda
 * um token de sessão temporário, e quem fala com o GitHub são as funções
 * em /api.
 */
(function () {
  'use strict';

  const CHAVE_TOKEN = 'autobayer:admin:token';

  /* Estes valores espelham lib/vehicle-schema.mjs. A API valida de novo do
     lado do servidor — aqui é só para montar os menus e dar retorno rápido. */
  const TIPOS = ['SUV', 'Sedan', 'Hatch', 'Picape'];
  const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Diesel', 'Etanol', 'Híbrido', 'Elétrico'];
  const CAMBIOS = ['Automático', 'Manual', 'Automatizado', 'CVT'];
  const SELOS = ['', 'Destaque', 'Oferta', 'Único dono', 'Novidade'];

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
   * porque quem consome é o index.html na raiz. Como o painel mora em /admin/,
   * ele precisa de "../" só na hora de exibir. Links completos (http) passam
   * direto.
   */
  function urlExibicao(src) {
    return /^(https?:)?\/\//.test(src) ? src : `../${src}`;
  }

  function gerarSlug(brand, model, year) {
    return `${brand} ${model} ${year}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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

    // 401 vindo do próprio login significa senha errada, não sessão vencida —
    // derrubar a sessão aqui trocaria "Senha incorreta" por uma mensagem
    // confusa para quem só errou a digitação.
    if (resposta.status === 401 && caminho !== 'login') {
      sair(true);
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (!resposta.ok) {
      const erro = new Error(dados.erro || `Falha na requisição (${resposta.status}).`);
      erro.problemas = dados.problemas;
      erro.status = resposta.status;
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
      await abrirPainel();
    } catch (erro) {
      aviso.textContent = erro.message;
      aviso.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  function sair(expirou) {
    estado.token = '';
    estado.alterado = false;
    sessionStorage.removeItem(CHAVE_TOKEN);
    $('#painel').hidden = true;
    $('#telaLogin').hidden = false;
    if (expirou) {
      const aviso = $('#avisoLogin');
      aviso.textContent = 'Sua sessão expirou. Entre novamente.';
      aviso.hidden = false;
    }
  }

  $('#botaoSair').addEventListener('click', () => {
    if (estado.alterado && !confirm('Há alterações não publicadas. Sair mesmo assim?')) return;
    sair(false);
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
                  <strong class="item-preco">${brl.format(v.price)}</strong>
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
  /* Editor                                                             */
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
          images: [],
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
    $('#f-km').value = veiculo.km ? numero.format(veiculo.km) : '';
    $('#f-fuel').value = veiculo.fuel;
    $('#f-gear').value = veiculo.gear;
    $('#f-color').value = veiculo.color || '';
    $('#f-doors').value = veiculo.doors ?? 4;
    $('#f-badge').value = veiculo.badge || '';
    $('#f-featured').checked = Boolean(veiculo.featured);
    $('#f-sold').checked = Boolean(veiculo.sold);

    atualizarDicas();
    renderizarGaleria();
    $('#avisoFormulario').hidden = true;
    $('#modalEditor').hidden = false;
    $('#f-brand').focus();
  }

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
    const km = Number(soDigitos($('#f-km').value));
    $('#dicaPreco').textContent = preco ? brl.format(preco) : ' ';
    $('#dicaKm').textContent = km ? `${numero.format(km)} km` : ' ';
  }

  ['#f-price', '#f-km'].forEach((seletor) => {
    $(seletor).addEventListener('input', function () {
      const digitos = soDigitos(this.value);
      this.value = digitos ? numero.format(Number(digitos)) : '';
      atualizarDicas();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Fotos                                                               */
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

  /**
   * Reduz e comprime a imagem no próprio navegador antes de enviar.
   *
   * Foto de celular tem 4–12 MB; depois disso fica em torno de 150 KB. Isso
   * mantém o repositório enxuto, o envio rápido no 4G do pátio e dispensa
   * biblioteca de imagem no servidor. `imageOrientation` corrige fotos que
   * sairiam deitadas por causa do EXIF.
   */
  async function comprimir(arquivo, larguraMaxima = 1600, qualidade = 0.82) {
    const bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, larguraMaxima / bitmap.width);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', qualidade));
    return await new Promise((resolve) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result);
      leitor.readAsDataURL(blob);
    });
  }

  $('#arquivoFoto').addEventListener('change', async function () {
    const arquivos = Array.from(this.files || []);
    this.value = '';
    if (arquivos.length === 0) return;

    const progresso = $('#progressoUpload');
    progresso.hidden = false;

    const base = gerarSlug($('#f-brand').value, $('#f-model').value, $('#f-year').value) || 'foto';

    for (let i = 0; i < arquivos.length; i++) {
      progresso.textContent = `Enviando foto ${i + 1} de ${arquivos.length}...`;
      try {
        const dados = await comprimir(arquivos[i]);
        const { caminho } = await api('upload', {
          method: 'POST',
          body: JSON.stringify({ nome: base, dados })
        });
        fotosEditor.push(caminho);
        renderizarGaleria();
      } catch (erro) {
        progresso.textContent = `Erro ao enviar: ${erro.message}`;
        return;
      }
    }

    progresso.textContent = `${arquivos.length} foto(s) enviada(s).`;
    setTimeout(() => {
      progresso.hidden = true;
    }, 3000);
  });

  $('#botaoUrl').addEventListener('click', () => {
    const url = prompt('Cole o endereço da imagem:');
    if (url && url.trim()) {
      fotosEditor.push(url.trim());
      renderizarGaleria();
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
    if (Number(soDigitos($('#f-price').value)) <= 0) problemas.push('Informe o preço.');
    if (fotosEditor.length === 0) problemas.push('Adicione ao menos uma foto.');

    if (problemas.length) {
      aviso.innerHTML = `<ul>${problemas.map((p) => `<li>${escapar(p)}</li>`).join('')}</ul>`;
      aviso.hidden = false;
      return;
    }

    const novo = estado.editandoId === null;
    const existente = novo ? null : estado.vehicles.find((v) => v.id === estado.editandoId);

    const veiculo = {
      id: existente ? existente.id : Date.now(),
      slug: existente ? existente.slug : gerarSlug(brand, model, year),
      brand,
      model,
      year,
      type: $('#f-type').value,
      km: Number(soDigitos($('#f-km').value)),
      price: Number(soDigitos($('#f-price').value)),
      images: [...fotosEditor],
      badge: $('#f-badge').value,
      featured: $('#f-featured').checked,
      sold: $('#f-sold').checked,
      fuel: $('#f-fuel').value,
      gear: $('#f-gear').value,
      color: $('#f-color').value.trim(),
      doors: Number($('#f-doors').value) || 4
    };

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

  $('#botaoSalvar').addEventListener('click', async () => {
    const botao = $('#botaoSalvar');
    botao.disabled = true;
    botao.textContent = 'Publicando...';

    try {
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
      atualizarBotaoPublicar();
      mostrarFaixa(
        'Publicado. O site é reconstruído automaticamente e as mudanças aparecem em cerca de 1 minuto.',
        'sucesso'
      );
    } catch (erro) {
      const detalhes = erro.problemas ? `\n\n${erro.problemas.join('\n')}` : '';
      mostrarFaixa(erro.message + detalhes, 'erro');
      if (erro.status === 409) {
        setTimeout(() => location.reload(), 4000);
      }
    } finally {
      botao.textContent = 'Publicar';
      atualizarBotaoPublicar();
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
