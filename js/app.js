/**
 * Autobayer Veículos — catálogo de estoque.
 *
 * Depende de config.js e vehicles.js, carregados antes deste arquivo.
 */
(function () {
  'use strict';

  const CONFIG = window.AUTOBAYER_CONFIG || {};
  const VEHICLES = window.AUTOBAYER_VEHICLES || [];
  const FAVORITES_KEY = 'autobayer:favoritos';

  /* ---------------------------------------------------------------------
   * Utilitários
   * ------------------------------------------------------------------ */

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  const brlFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  });
  const numberFormatter = new Intl.NumberFormat('pt-BR');

  const formatPrice = (value) => brlFormatter.format(value);
  const formatKm = (value) => `${numberFormatter.format(value)} km`;

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Escapa texto antes de injetar em HTML. Hoje os dados vêm de vehicles.js
   * (confiável), mas isto evita XSS no dia em que o estoque vier de uma API,
   * planilha ou CMS.
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
  }

  function debounce(fn, wait) {
    let timer;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Envia um evento para o GA4/dataLayer, se houver. Silencioso se não houver. */
  function track(eventName, params) {
    const payload = Object.assign({ event: eventName }, params || {});
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  }

  function whatsappLink(message) {
    const text = encodeURIComponent(message || CONFIG.mensagemPadrao || '');
    return `https://wa.me/${CONFIG.whatsapp}?text=${text}`;
  }

  /**
   * Altera a URL sem recarregar. Envolvido em try/catch porque pushState
   * lança SecurityError quando a página é aberta direto do disco (file://),
   * o que quebraria o modal em quem só deu duplo clique no index.html.
   */
  function pushUrl(url, historyState) {
    try {
      history.pushState(historyState || {}, '', url);
    } catch (error) {
      /* sem deep link neste contexto; o modal segue funcionando */
    }
  }

  /* ---------------------------------------------------------------------
   * Favoritos (persistidos entre visitas)
   * ------------------------------------------------------------------ */

  const favorites = {
    ids: new Set(),

    load() {
      try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (raw) this.ids = new Set(JSON.parse(raw));
      } catch (error) {
        // Navegação anônima ou storage bloqueado: segue sem persistir.
        this.ids = new Set();
      }
    },

    save() {
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(this.ids)));
      } catch (error) {
        /* sem persistência disponível */
      }
    },

    has(id) {
      return this.ids.has(id);
    },

    toggle(id) {
      if (this.ids.has(id)) this.ids.delete(id);
      else this.ids.add(id);
      this.save();
      return this.ids.has(id);
    }
  };

  /* ---------------------------------------------------------------------
   * Estado dos filtros
   * ------------------------------------------------------------------ */

  const DEFAULT_STATE = {
    search: '',
    type: 'all',
    brand: 'all',
    maxPrice: 'all',
    sort: 'featured',
    onlyFavorites: false
  };

  let state = Object.assign({}, DEFAULT_STATE);

  const elements = {
    grid: $('#vehicleGrid'),
    empty: $('#emptyState'),
    resultCount: $('#resultCount'),
    search: $('#searchInput'),
    brand: $('#brandFilter'),
    price: $('#priceFilter'),
    sort: $('#sortFilter'),
    clear: $('#clearFilters'),
    categoryRow: $('#categoryRow'),
    favToggle: $('#favToggle'),
    favCount: $('#favCount')
  };

  /* ---------------------------------------------------------------------
   * Filtragem e ordenação
   * ------------------------------------------------------------------ */

  function getFilteredVehicles() {
    const query = state.search.trim().toLowerCase();

    const result = VEHICLES.filter((vehicle) => {
      if (state.type !== 'all' && vehicle.type !== state.type) return false;
      if (state.brand !== 'all' && vehicle.brand !== state.brand) return false;

      // CORREÇÃO: 'all' precisa ser tratado explicitamente. Antes o código
      // fazia Number('all') => NaN, e toda comparação virava falsa, deixando
      // o catálogo vazio no carregamento da página.
      if (state.maxPrice !== 'all' && vehicle.price > Number(state.maxPrice)) return false;

      if (state.onlyFavorites && !favorites.has(vehicle.id)) return false;

      if (query) {
        const haystack = `${vehicle.brand} ${vehicle.model} ${vehicle.year} ${vehicle.type}`;
        if (!haystack.toLowerCase().includes(query)) return false;
      }
      return true;
    });

    // Veículos vendidos sempre por último, qualquer que seja a ordenação.
    const bySold = (a, b) => Number(a.sold) - Number(b.sold);

    if (state.sort === 'lower') {
      result.sort((a, b) => bySold(a, b) || a.price - b.price);
    } else if (state.sort === 'higher') {
      result.sort((a, b) => bySold(a, b) || b.price - a.price);
    } else {
      // "Destaques": marcados como featured primeiro, depois com selo, depois
      // os mais novos. Antes esta opção não reordenava nada.
      result.sort(
        (a, b) =>
          bySold(a, b) ||
          Number(b.featured) - Number(a.featured) ||
          Number(Boolean(b.badge)) - Number(Boolean(a.badge)) ||
          b.year - a.year
      );
    }

    return result;
  }

  /* ---------------------------------------------------------------------
   * Renderização do catálogo
   * ------------------------------------------------------------------ */

  function vehicleCardHtml(vehicle) {
    const isFavorite = favorites.has(vehicle.id);
    const name = `${vehicle.brand} ${vehicle.model}`;
    const badge = vehicle.sold ? 'Vendido' : vehicle.badge;

    return `
      <article class="vehicle-card${vehicle.sold ? ' is-sold' : ''}"
               data-id="${vehicle.id}"
               tabindex="0"
               role="button"
               aria-label="Ver detalhes do ${escapeHtml(name)} ${vehicle.year}">
        <div class="vehicle-image">
          <img src="${escapeHtml(vehicle.images[0])}"
               alt="${escapeHtml(name)} ${vehicle.year}"
               width="900" height="600" loading="lazy" decoding="async">
          ${badge ? `<span class="badge${vehicle.sold ? ' badge-sold' : ''}">${escapeHtml(badge)}</span>` : ''}
          <button type="button" class="heart${isFavorite ? ' saved' : ''}"
                  data-heart="${vehicle.id}"
                  aria-pressed="${isFavorite}"
                  aria-label="${isFavorite ? 'Remover' : 'Adicionar'} ${escapeHtml(name)} ${isFavorite ? 'dos' : 'aos'} favoritos">
            <span aria-hidden="true">${isFavorite ? '♥' : '♡'}</span>
          </button>
        </div>
        <div class="vehicle-info">
          <div class="vehicle-title">
            <h3>${escapeHtml(name)}</h3>
            <span class="vehicle-year">${vehicle.year}</span>
          </div>
          <p class="vehicle-sub">${escapeHtml(vehicle.type)} · ${formatKm(vehicle.km)} · ${escapeHtml(vehicle.gear)}</p>
          <div class="vehicle-meta">
            <div>
              <span>A partir de</span>
              <strong class="price">${formatPrice(vehicle.price)}</strong>
            </div>
            <span class="card-arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </article>`;
  }

  function render() {
    const data = getFilteredVehicles();

    elements.grid.innerHTML = data.map(vehicleCardHtml).join('');
    elements.empty.hidden = data.length > 0;

    // Região aria-live: avisa quem usa leitor de tela que os resultados mudaram.
    elements.resultCount.textContent =
      data.length === 0
        ? 'Nenhum veículo encontrado.'
        : `${data.length} ${data.length === 1 ? 'veículo encontrado' : 'veículos encontrados'}.`;

    updateCategoryCounts();
    updateFavoritesUi();
  }

  /* ---------------------------------------------------------------------
   * Abas de categoria (única fonte de verdade para o filtro de tipo)
   * ------------------------------------------------------------------ */

  function buildCategoryTabs() {
    const types = Array.from(new Set(VEHICLES.map((v) => v.type))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );

    const tabs = [{ value: 'all', label: 'Todos' }].concat(
      types.map((type) => ({ value: type, label: type }))
    );

    elements.categoryRow.innerHTML = tabs
      .map(
        (tab) => `
        <button type="button" class="category${tab.value === 'all' ? ' active' : ''}"
                data-category="${escapeHtml(tab.value)}"
                aria-pressed="${tab.value === 'all'}">
          ${escapeHtml(tab.label)} <small data-count-for="${escapeHtml(tab.value)}"></small>
        </button>`
      )
      .join('');
  }

  /** Contadores calculados a partir dos dados — antes estavam fixos no HTML. */
  function updateCategoryCounts() {
    $$('[data-count-for]', elements.categoryRow).forEach((el) => {
      const type = el.dataset.countFor;
      const count = VEHICLES.filter((v) => !v.sold && (type === 'all' || v.type === type)).length;
      el.textContent = String(count).padStart(2, '0');
    });
  }

  function buildBrandOptions() {
    const brands = Array.from(new Set(VEHICLES.map((v) => v.brand))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
    elements.brand.insertAdjacentHTML(
      'beforeend',
      brands.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')
    );
  }

  function updateFavoritesUi() {
    const count = favorites.ids.size;
    elements.favCount.textContent = count ? `(${count})` : '';
    elements.favToggle.hidden = count === 0 && !state.onlyFavorites;
    elements.favToggle.setAttribute('aria-pressed', String(state.onlyFavorites));
    elements.favToggle.classList.toggle('active', state.onlyFavorites);
  }

  /* ---------------------------------------------------------------------
   * Modal do veículo (com deep link, foco preso e retorno de foco)
   * ------------------------------------------------------------------ */

  const modal = {
    backdrop: $('#modalBackdrop'),
    dialog: $('#vehicleModal'),
    content: $('#modalContent'),
    closeButton: $('#modalClose'),
    lastFocused: null,
    current: null
  };

  const FOCUSABLE =
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function modalHtml(vehicle) {
    const name = `${vehicle.brand} ${vehicle.model}`;
    const message = vehicle.sold
      ? `Olá! Vi que o ${name} ${vehicle.year} foi vendido. Vocês têm algo parecido?`
      : `Olá! Tenho interesse no ${name} ${vehicle.year}, anunciado por ${formatPrice(vehicle.price)}.`;

    const gallery =
      vehicle.images.length > 1
        ? `<div class="modal-thumbs" role="group" aria-label="Fotos do veículo">
             ${vehicle.images
               .map(
                 (src, index) => `
               <button type="button" class="modal-thumb${index === 0 ? ' active' : ''}"
                       data-thumb="${escapeHtml(src)}"
                       aria-label="Ver foto ${index + 1} de ${vehicle.images.length}">
                 <img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">
               </button>`
               )
               .join('')}
           </div>`
        : '';

    const specs = [
      ['Combustível', vehicle.fuel],
      ['Câmbio', vehicle.gear],
      ['Cor', vehicle.color],
      ['Portas', vehicle.doors],
      ['Quilometragem', formatKm(vehicle.km)],
      ['Categoria', vehicle.type]
    ];

    return `
      <div class="modal-layout">
        <div class="modal-media">
          <img id="modalMainImage" src="${escapeHtml(vehicle.images[0])}"
               alt="${escapeHtml(name)} ${vehicle.year}" width="900" height="600" decoding="async">
          ${gallery}
        </div>
        <div class="modal-details">
          <span class="modal-badge${vehicle.sold ? ' badge-sold' : ''}">
            ${escapeHtml(vehicle.sold ? 'Vendido' : vehicle.badge || 'Disponível agora')}
          </span>
          <h2 id="modalTitle">${escapeHtml(vehicle.brand)}<br><em>${escapeHtml(vehicle.model)}</em></h2>
          <p class="vehicle-sub">${escapeHtml(vehicle.type)} · ${vehicle.year} · ${formatKm(vehicle.km)}</p>

          <dl class="detail-list">
            ${specs
              .map(
                ([label, value]) =>
                  `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
              )
              .join('')}
          </dl>

          <div class="modal-price">
            <span class="vehicle-sub">${vehicle.sold ? 'Valor anunciado' : 'Preço à vista'}</span>
            <strong class="price">${formatPrice(vehicle.price)}</strong>
          </div>

          <a class="btn btn-primary" target="_blank" rel="noopener"
             data-cta="whatsapp-modal" data-vehicle="${escapeHtml(vehicle.slug)}"
             href="${escapeHtml(whatsappLink(message))}">
            ${vehicle.sold ? 'Ver similares' : 'Tenho interesse'} <b aria-hidden="true">↗</b>
          </a>
          <p class="modal-note">Resposta rápida pelo WhatsApp do vendedor</p>
        </div>
      </div>`;
  }

  function openModal(vehicle, options) {
    if (!vehicle) return;
    const skipHistory = options && options.skipHistory;

    modal.current = vehicle;
    modal.lastFocused = document.activeElement;
    modal.content.innerHTML = modalHtml(vehicle);
    modal.backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Deep link: permite compartilhar o veículo direto no WhatsApp.
    if (!skipHistory) {
      pushUrl(`${location.pathname}?veiculo=${encodeURIComponent(vehicle.slug)}`, {
        veiculo: vehicle.slug
      });
    }

    modal.closeButton.focus();
    track('view_vehicle', { vehicle: vehicle.slug, price: vehicle.price });
  }

  function closeModal(options) {
    if (!modal.backdrop.classList.contains('open')) return;
    const skipHistory = options && options.skipHistory;

    modal.backdrop.classList.remove('open');
    modal.content.innerHTML = '';
    document.body.style.overflow = '';
    modal.current = null;

    if (!skipHistory && location.search) {
      pushUrl(location.pathname);
    }

    // Devolve o foco para o card de onde o usuário veio.
    if (modal.lastFocused && document.contains(modal.lastFocused)) {
      modal.lastFocused.focus();
    }
    modal.lastFocused = null;
  }

  /** Prende o Tab dentro do modal enquanto ele estiver aberto. */
  function trapFocus(event) {
    if (event.key !== 'Tab' || !modal.backdrop.classList.contains('open')) return;

    const focusable = $$(FOCUSABLE, modal.dialog).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openFromUrl(options) {
    const slug = new URLSearchParams(location.search).get('veiculo');
    if (!slug) {
      closeModal({ skipHistory: true });
      return;
    }
    const vehicle = VEHICLES.find((v) => v.slug === slug);
    if (vehicle) openModal(vehicle, Object.assign({ skipHistory: true }, options));
  }

  /* ---------------------------------------------------------------------
   * Menu mobile
   * ------------------------------------------------------------------ */

  function setupMobileMenu() {
    const toggle = $('#menuToggle');
    const nav = $('#mainNav');
    if (!toggle || !nav) return;

    const setOpen = (open) => {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    };

    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));

    // Fecha ao navegar, ao apertar Esc e ao voltar para o desktop.
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
    // Volta para o desktop com o menu aberto: fecha o painel.
    // addEventListener em MediaQueryList só existe a partir do Safari 14,
    // por isso o fallback para addListener.
    const desktop = window.matchMedia && window.matchMedia('(min-width: 801px)');
    const onChange = (event) => {
      if (event.matches) setOpen(false);
    };
    if (desktop && desktop.addEventListener) desktop.addEventListener('change', onChange);
    else if (desktop && desktop.addListener) desktop.addListener(onChange);
  }

  /* ---------------------------------------------------------------------
   * Destaque do link ativo no menu conforme a rolagem
   * ------------------------------------------------------------------ */

  function setupScrollSpy() {
    const links = $$('#mainNav a[href^="#"]');
    const sections = links
      .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
      .filter(Boolean);
    if (sections.length === 0 || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            const isActive = link.getAttribute('href') === `#${entry.target.id}`;
            link.classList.toggle('active', isActive);
            if (isActive) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );

    sections.forEach((section) => observer.observe(section));
  }

  /* ---------------------------------------------------------------------
   * Dados estruturados para o Google (schema.org)
   * ------------------------------------------------------------------ */

  function injectVehicleSchema() {
    const available = VEHICLES.filter((v) => !v.sold);
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Estoque Autobayer Veículos',
      numberOfItems: available.length,
      itemListElement: available.map((vehicle, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Car',
          name: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
          brand: { '@type': 'Brand', name: vehicle.brand },
          model: vehicle.model,
          vehicleModelDate: String(vehicle.year),
          bodyType: vehicle.type,
          color: vehicle.color,
          fuelType: vehicle.fuel,
          vehicleTransmission: vehicle.gear,
          numberOfDoors: vehicle.doors,
          mileageFromOdometer: { '@type': 'QuantitativeValue', value: vehicle.km, unitCode: 'KMT' },
          image: vehicle.images,
          url: `${CONFIG.siteUrl}/?veiculo=${vehicle.slug}`,
          offers: {
            '@type': 'Offer',
            price: vehicle.price,
            priceCurrency: 'BRL',
            availability: 'https://schema.org/InStock',
            seller: { '@type': 'AutoDealer', name: CONFIG.nome }
          }
        }
      }))
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }

  /* ---------------------------------------------------------------------
   * Preenche telefone/WhatsApp a partir do config.js
   * ------------------------------------------------------------------ */

  function hydrateContactInfo() {
    $$('[data-wa-link]').forEach((el) => {
      el.href = whatsappLink(el.dataset.waMessage || CONFIG.mensagemPadrao);
    });
    $$('[data-phone-text]').forEach((el) => {
      el.textContent = CONFIG.telefoneExibicao;
    });
    $$('[data-phone-link]').forEach((el) => {
      el.href = `tel:${CONFIG.telefoneLink}`;
    });
    $$('[data-year]').forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ---------------------------------------------------------------------
   * Eventos
   * ------------------------------------------------------------------ */

  function setupCatalogEvents() {
    // Clique e teclado nos cards (antes só funcionava com mouse).
    const activateCard = (card) => {
      const vehicle = VEHICLES.find((v) => v.id === Number(card.dataset.id));
      openModal(vehicle);
    };

    elements.grid.addEventListener('click', (event) => {
      const heart = event.target.closest('[data-heart]');
      if (heart) {
        event.stopPropagation();
        const id = Number(heart.dataset.heart);
        const isFavorite = favorites.toggle(id);
        track(isFavorite ? 'add_favorite' : 'remove_favorite', { vehicle_id: id });
        render();
        // Devolve o foco ao coração equivalente após o re-render.
        const again = $(`[data-heart="${id}"]`, elements.grid);
        if (again) again.focus();
        return;
      }
      const card = event.target.closest('.vehicle-card');
      if (card) activateCard(card);
    });

    elements.grid.addEventListener('keydown', (event) => {
      const card = event.target.closest('.vehicle-card');
      if (!card || event.target.closest('[data-heart]')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateCard(card);
      }
    });

    // Abas de categoria.
    elements.categoryRow.addEventListener('click', (event) => {
      const button = event.target.closest('.category');
      if (!button) return;
      state.type = button.dataset.category;
      $$('.category', elements.categoryRow).forEach((tab) => {
        const isActive = tab === button;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
      });
      track('filter_type', { type: state.type });
      render();
    });

    elements.search.addEventListener(
      'input',
      debounce(function () {
        state.search = this.value;
        render();
      }, 200)
    );

    elements.brand.addEventListener('change', function () {
      state.brand = this.value;
      render();
    });
    elements.price.addEventListener('change', function () {
      state.maxPrice = this.value;
      render();
    });
    elements.sort.addEventListener('change', function () {
      state.sort = this.value;
      render();
    });

    elements.favToggle.addEventListener('click', () => {
      state.onlyFavorites = !state.onlyFavorites;
      render();
    });

    elements.clear.addEventListener('click', () => {
      state = Object.assign({}, DEFAULT_STATE);
      elements.search.value = '';
      elements.brand.value = 'all';
      elements.price.value = 'all';
      elements.sort.value = 'featured';
      $$('.category', elements.categoryRow).forEach((tab) => {
        const isActive = tab.dataset.category === 'all';
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-pressed', String(isActive));
      });
      render();
    });
  }

  function setupModalEvents() {
    modal.closeButton.addEventListener('click', () => closeModal());

    modal.backdrop.addEventListener('click', (event) => {
      if (event.target === modal.backdrop) closeModal();
    });

    // Troca a foto principal ao clicar na miniatura.
    modal.content.addEventListener('click', (event) => {
      const thumb = event.target.closest('[data-thumb]');
      if (!thumb) return;
      $('#modalMainImage').src = thumb.dataset.thumb;
      $$('.modal-thumb', modal.content).forEach((el) => el.classList.remove('active'));
      thumb.classList.add('active');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
      trapFocus(event);
    });

    // Botão voltar do navegador fecha o modal / reabre o veículo do link.
    window.addEventListener('popstate', () => openFromUrl());
  }

  function setupAnalytics() {
    // Carrega o GA4 apenas se um ID estiver configurado em config.js.
    if (CONFIG.ga4Id) {
      const gtagScript = document.createElement('script');
      gtagScript.async = true;
      gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${CONFIG.ga4Id}`;
      document.head.appendChild(gtagScript);

      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', CONFIG.ga4Id);
    }

    document.addEventListener('click', (event) => {
      const cta = event.target.closest('[data-cta]');
      if (cta) {
        track('click_whatsapp', {
          origem: cta.dataset.cta,
          vehicle: cta.dataset.vehicle || null
        });
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Inicialização
   * ------------------------------------------------------------------ */

  function init() {
    favorites.load();
    hydrateContactInfo();
    buildCategoryTabs();
    buildBrandOptions();
    setupCatalogEvents();
    setupModalEvents();
    setupMobileMenu();
    setupScrollSpy();
    setupAnalytics();
    injectVehicleSchema();
    render();
    openFromUrl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
