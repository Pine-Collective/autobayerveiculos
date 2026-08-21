/**
 * Lê o texto de um anúncio (do jeito que a loja escreve no WhatsApp/Facebook)
 * e devolve um rascunho de veículo já no formato do schema.
 *
 * IMPORTANTE: isto preenche um RASCUNHO, nunca publica sozinho. Anúncio de
 * carro escrito à mão omite coisa demais — nos anúncios reais analisados, o
 * ano aparecia em 2 de 7 e a cor em nenhum. O retorno traz `faltando` e
 * `avisos` justamente para o humano completar antes de publicar.
 *
 * Usado pelo painel (Colar anúncio) e pelo importador em lote
 * (scripts/import-anuncios.mjs).
 */
import { TIPOS, COMBUSTIVEIS, gerarSlug } from './vehicle-schema.mjs';

/* ------------------------------------------------------------------ */
/* Tabelas de conhecimento do mercado brasileiro                       */
/* ------------------------------------------------------------------ */

/**
 * A marca quase nunca é escrita no anúncio ("Corsa classic", não "Chevrolet
 * Corsa"), mas é dedutível do modelo. Para incluir um modelo novo, basta
 * acrescentar a palavra-chave na marca correspondente.
 */
export const MODELOS_POR_MARCA = {
  Chevrolet: [
    'corsa',
    'classic',
    'celta',
    'onix',
    'prisma',
    'cruze',
    's10',
    's-10',
    'montana',
    'tracker',
    'spin',
    'cobalt',
    'agile',
    'astra',
    'vectra',
    'zafira',
    'blazer',
    'captiva',
    'meriva',
    'joy',
    'omega',
    'kadett',
    'monza',
    'ipanema',
    'opala'
  ],
  Fiat: [
    'uno',
    'palio',
    'siena',
    'strada',
    'toro',
    'argo',
    'cronos',
    'mobi',
    'punto',
    'idea',
    'doblo',
    'doblô',
    'fiorino',
    'bravo',
    'linea',
    'freemont',
    'tempra',
    'tipo',
    'premio',
    'elba',
    'weekend',
    'pulse',
    'fastback'
  ],
  Ford: [
    'ka',
    'fiesta',
    'focus',
    'ecosport',
    'ranger',
    'fusion',
    'edge',
    'territory',
    'escort',
    'courier',
    'maverick',
    'bronco',
    'f-250',
    'f250',
    'del rey',
    'belina'
  ],
  Volkswagen: [
    'gol',
    'voyage',
    'saveiro',
    'fox',
    'polo',
    'virtus',
    't-cross',
    'tcross',
    'nivus',
    'jetta',
    'golf',
    'amarok',
    'tiguan',
    'parati',
    'santana',
    'kombi',
    'passat',
    'spacefox',
    'crossfox',
    'up',
    'quantum',
    'logus',
    'apollo'
  ],
  Renault: [
    'sandero',
    'logan',
    'duster',
    'captur',
    'kwid',
    'clio',
    'megane',
    'mégane',
    'scenic',
    'fluence',
    'oroch',
    'master',
    'symbol',
    'grandtour',
    'stepway'
  ],
  Honda: [
    'civic',
    'fit',
    'city',
    'hr-v',
    'hrv',
    'wr-v',
    'wrv',
    'cr-v',
    'crv',
    'accord',
    // motos
    'cg125',
    'cg 125',
    'cg150',
    'cg 150',
    'cg160',
    'cg 160',
    'cg',
    'cb300',
    'cb500',
    'cb',
    'biz',
    'pop',
    'titan',
    'fan',
    'bros',
    'xre',
    'twister',
    'hornet',
    'falcon',
    'pcx',
    'elite',
    'shadow'
  ],
  Toyota: ['corolla', 'etios', 'hilux', 'sw4', 'yaris', 'rav4', 'camry', 'bandeirante'],
  Hyundai: [
    'hb20',
    'hb20s',
    'creta',
    'tucson',
    'ix35',
    'elantra',
    'santa fe',
    'azera',
    'i30',
    'hr'
  ],
  Nissan: ['march', 'versa', 'kicks', 'frontier', 'sentra', 'livina', 'tiida'],
  Peugeot: ['206', '207', '208', '307', '308', '2008', '3008', 'partner', 'hoggar', '405'],
  Citroën: ['c3', 'c4', 'aircross', 'xsara', 'berlingo', 'cactus'],
  Jeep: ['renegade', 'compass', 'commander', 'cherokee'],
  Mitsubishi: ['l200', 'pajero', 'asx', 'outlander', 'lancer', 'eclipse'],
  Kia: ['sportage', 'cerato', 'picanto', 'soul', 'bongo', 'sorento'],
  Yamaha: [
    'factor',
    'fazer',
    'ybr',
    'xtz',
    'lander',
    'crosser',
    'neo',
    'nmax',
    'tenere',
    'ténéré',
    'mt-03',
    'mt-07',
    'mt-09',
    'r3',
    'crypton',
    'rd'
  ],
  Suzuki: ['intruder', 'burgman', 'gsx', 'bandit', 'v-strom', 'vitara', 'jimny', 's-cross', 'yes'],
  Kawasaki: ['ninja', 'z400', 'z900', 'versys'],
  Volvo: ['xc60', 'xc40', 'xc90'],
  Audi: ['a3', 'a4', 'q3', 'q5'],
  BMW: ['320i', 'x1', 'x3'],
  Chery: ['tiggo', 'qq', 'celer'],
  JAC: ['j3', 'j5', 't40'],
  Troller: ['t4']
};

/**
 * Tipo deduzido do modelo. A ORDEM IMPORTA: o primeiro padrão que casar vence,
 * então o mais específico vem antes. Exemplo: "Corsa Classic" é o sedan
 * Classic, não o hatch Corsa — por isso "classic" aparece antes de "corsa".
 */
export const TIPO_POR_MODELO = [
  // Motos primeiro: são inconfundíveis e mudam o resto do formulário.
  {
    tipo: 'Moto',
    padrao:
      /\b(cg\s?\d{2,3}|cb\s?\d{2,4}|biz|pop\s?\d*|titan|fan|bros|xre|twister|hornet|falcon|pcx|elite|shadow|factor|fazer|ybr|xtz|lander|crosser|nmax|tenere|ténéré|mt-?\d{2}|crypton|intruder|burgman|bandit|ninja|z\d{3}|versys|harley|dafra|shineray)\b/
  },
  {
    tipo: 'Perua',
    padrao: /\b(grandtour|grand tour|parati|spacefox|quantum|ipanema|belina|variant|sw|weekend)\b/
  },
  {
    tipo: 'Picape',
    padrao:
      /\b(strada|toro|saveiro|montana|oroch|s10|s-10|hilux|ranger|frontier|l200|amarok|courier|hoggar|f-?250|maverick|bongo|dakota|rampage)\b/
  },
  {
    tipo: 'SUV',
    padrao:
      /\b(ecosport|renegade|compass|commander|cherokee|creta|kicks|tracker|duster|captur|hr-?v|wr-?v|cr-?v|tucson|ix35|sw4|rav4|pajero|asx|outlander|sportage|sorento|t-?cross|nivus|tiguan|aircross|2008|3008|territory|edge|jimny|vitara|blazer|captiva|santa fe|xc\d{2}|q[35]|x[13]|tiggo|t4|bronco)\b/
  },
  {
    tipo: 'Sedan',
    padrao:
      /\b(classic|corolla|civic|voyage|prisma|siena|cronos|virtus|jetta|versa|sentra|logan|fluence|cruze|city|hb20s|cobalt|linea|vectra|elantra|cerato|azera|accord|camry|monza|tempra|premio|symbol|a[34]|320i|j5)\b/
  },
  {
    tipo: 'Hatch',
    padrao:
      /\b(gol|uno|palio|celta|onix|ka|fiesta|focus|fox|up|polo|argo|mobi|sandero|kwid|march|hb20|i30|c3|c4|208|207|206|punto|bravo|golf|clio|corsa|fit|etios|picanto|soul|agile|astra|stilo|206|joy|qq|celer|j3|pulse|fastback)\b/
  }
];

/* ------------------------------------------------------------------ */
/* Utilidades de texto                                                 */
/* ------------------------------------------------------------------ */

const semAcento = (texto) =>
  String(texto)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** "15.900,00" -> 15900 · "267.000" -> 267000 (centavos são descartados) */
function paraNumero(texto) {
  const limpo = String(texto).replace(/[^\d,.]/g, '');
  const inteiro = limpo.split(',')[0];
  const n = Number(inteiro.replace(/\./g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Casa uma palavra-chave respeitando limites, mesmo com dígitos e hífens. */
function contem(textoNormalizado, chave) {
  const escapada = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escapada}([^a-z0-9]|$)`).test(textoNormalizado);
}

/**
 * Linhas que NÃO são características do veículo: preço, forma de pagamento e
 * dados que já viram campo próprio. As condições de pagamento repetiam nos 7
 * anúncios analisados — são da loja, não do carro, e vivem em js/config.js.
 */
const LINHAS_IGNORADAS = [
  /r\$/,
  /\bavista\b|\ba vista\b|\bna troca\b|\bvalor\b/,
  /financiamento|financio|financia/,
  /cart[aã]o|\d+\s*x\b/,
  /analiso troca|pego troca|aceito troca|troca por carro|troca por moto/,
  /^\s*km\s*[:.]?\s*[\d.]+\s*$/,
  /^\s*ano\s*[:.]?\s*\d{4}\s*$/,
  /^\s*\d\s*portas\s*$/,
  /^\s*$/
];

/* ------------------------------------------------------------------ */
/* Extratores                                                          */
/* ------------------------------------------------------------------ */

function extrairMarca(tituloNormalizado) {
  for (const [marca, modelos] of Object.entries(MODELOS_POR_MARCA)) {
    // Palavras-chave mais longas primeiro: "cg125" deve ganhar de "cg".
    const ordenados = [...modelos].sort((a, b) => b.length - a.length);
    for (const modelo of ordenados) {
      if (contem(tituloNormalizado, semAcento(modelo))) return marca;
    }
  }
  return null;
}

function extrairTipo(tituloNormalizado) {
  for (const regra of TIPO_POR_MODELO) {
    if (regra.padrao.test(tituloNormalizado)) return regra.tipo;
  }
  return null;
}

function extrairAno(texto, titulo) {
  const anoAtual = new Date().getFullYear();
  const valido = (n) => n >= 1950 && n <= anoAtual + 1;

  const rotulado = texto.match(/\bano\s*[:.]?\s*(\d{4})\b/i);
  if (rotulado && valido(Number(rotulado[1]))) return Number(rotulado[1]);

  // "2003" solto no título, ou "2011/2012" (fica com o ano-modelo).
  const barra = titulo.match(/\b(\d{4})\s*\/\s*(\d{4})\b/);
  if (barra && valido(Number(barra[2]))) return Number(barra[2]);

  const noTitulo = titulo.match(/\b(19\d{2}|20\d{2})\b/);
  if (noTitulo && valido(Number(noTitulo[1]))) return Number(noTitulo[1]);

  return null;
}

function extrairKm(texto) {
  const rotulado = texto.match(/\bkm\s*[:.]?\s*([\d.]+)/i);
  if (rotulado) return paraNumero(rotulado[1]);

  const posfixado = texto.match(/([\d.]{4,})\s*km\b/i);
  if (posfixado) return paraNumero(posfixado[1]);

  return null;
}

function extrairPrecos(texto) {
  const t = semAcento(texto);
  // "Avista R$15.900,00" e "Valor avista R$ 15.900,00"
  const avista = t.match(/a\s?vista[^\d]*([\d.,]+)/);
  const troca = t.match(/na\s+troca[^\d]*([\d.,]+)/);

  return {
    price: avista ? paraNumero(avista[1]) : 0,
    priceTroca: troca ? paraNumero(troca[1]) : 0
  };
}

function extrairCambio(t) {
  if (/\bautomatizad/.test(t)) return 'Automatizado';
  if (/\bcvt\b/.test(t)) return 'CVT';
  if (/\bautomatic/.test(t)) return 'Automático';
  if (/\bmanual\b/.test(t)) return 'Manual';
  return null;
}

/**
 * @param {string} t          anúncio inteiro, normalizado
 * @param {string} tituloNorm só o título, normalizado
 *
 * "Elétrico" e "Híbrido" só valem no TÍTULO. No corpo do anúncio,
 * "vidros elétricos", "trava elétrica" e "banco elétrico" são opcionais — e
 * casar com eles fazia o parser anunciar um Ecosport 1.6 como carro elétrico.
 */
function extrairCombustivel(t, tituloNorm) {
  if (/\bdiesel\b/.test(t)) return 'Diesel';
  if (/\bhibrid/.test(tituloNorm)) return 'Híbrido';
  if (/\beletric/.test(tituloNorm)) return 'Elétrico';
  if (/\bflex\b|\bvhce\b/.test(t)) return 'Flex';
  if (/\betanol\b|\balcool\b/.test(t)) return 'Etanol';
  if (/\bgasolina\b/.test(t)) return 'Gasolina';
  return null;
}

/** Remove o ano e a marca do título para sobrar o nome do modelo. */
function limparModelo(titulo, marca) {
  let modelo = titulo
    .replace(/\b(19\d{2}|20\d{2})\s*(\/\s*(19\d{2}|20\d{2}))?\b/g, '')
    .replace(/\bano\s*[:.]?\s*\d{4}\b/gi, '')
    .trim();

  if (marca) {
    modelo = modelo.replace(new RegExp(`^\\s*${marca}\\s+`, 'i'), '').trim();
  }

  return modelo
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;-]\s*$/, '')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Função principal                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {string} texto  anúncio completo, uma linha por informação
 * @returns {{ veiculo: object, faltando: string[], avisos: string[] }}
 */
export function parseAnuncio(texto) {
  const linhas = String(texto || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (linhas.length === 0) {
    return { veiculo: null, faltando: [], avisos: ['O texto está vazio.'] };
  }

  const titulo = linhas[0];
  const corpo = linhas.slice(1);
  const tudo = linhas.join('\n');
  const t = semAcento(tudo);
  const tituloNorm = semAcento(titulo);

  const marca = extrairMarca(tituloNorm);
  const tipo = extrairTipo(tituloNorm);
  const ano = extrairAno(tudo, titulo);
  const km = extrairKm(tudo);
  const { price, priceTroca } = extrairPrecos(tudo);
  const cambio = extrairCambio(t);
  const combustivel = extrairCombustivel(t, tituloNorm);
  const portas = tudo.match(/(\d)\s*portas/i);

  // "Sem leilão e sem sinistro" é argumento de procedência, não item de série:
  // vira selo em vez de entrar na lista de opcionais.
  const semSinistro = /sem\s+sinistro|sem\s+leil[aã]o/.test(t);

  const features = corpo
    .filter((linha) => {
      const ln = semAcento(linha);
      if (LINHAS_IGNORADAS.some((padrao) => padrao.test(ln))) return false;
      if (semSinistro && /sem\s+sinistro|sem\s+leil[aã]o/.test(ln)) return false;
      return true;
    })
    .map((linha) => linha.charAt(0).toUpperCase() + linha.slice(1));

  const modelo = limparModelo(titulo, marca);
  const tipoFinal = tipo || TIPOS[0];

  const veiculo = {
    brand: marca || '',
    model: modelo,
    year: ano || 0,
    type: tipoFinal,
    km: km === null ? 0 : km,
    price,
    priceTroca,
    features,
    badge: semSinistro ? 'Sem sinistro' : '',
    featured: false,
    sold: false,
    fuel: combustivel || COMBUSTIVEIS[0],
    // Quando o anúncio não diz, "Manual" é o palpite certo para este estoque:
    // seminovo popular no Brasil é manual na esmagadora maioria. O padrão do
    // schema é "Automático", que erraria num Corsa 2003.
    gear: cambio || 'Manual',
    color: '',
    images: []
  };

  if (tipoFinal !== 'Moto') {
    veiculo.doors = portas ? Number(portas[1]) : 4;
  }

  if (marca && modelo && ano) {
    veiculo.slug = gerarSlug(marca, modelo, ano);
  }

  /* --- o que o humano ainda precisa completar --- */

  const faltando = [];
  const avisos = [];

  if (!marca) {
    faltando.push('brand');
    avisos.push('Marca não reconhecida pelo modelo — preencha à mão.');
  }
  if (!ano) {
    faltando.push('year');
    avisos.push('Ano não encontrado no anúncio — é obrigatório.');
  }
  if (km === null) {
    faltando.push('km');
    avisos.push('Quilometragem não encontrada no anúncio.');
  }
  if (!price) {
    faltando.push('price');
    avisos.push('Preço à vista não encontrado.');
  }
  if (!tipo) {
    avisos.push(`Tipo não deduzido do modelo — assumi "${tipoFinal}", confira.`);
  }
  if (!cambio) {
    avisos.push('Câmbio não informado — assumi "Manual", confira.');
  }
  if (!combustivel) {
    avisos.push(`Combustível não informado — assumi "${COMBUSTIVEIS[0]}", confira.`);
  }
  faltando.push('color', 'images');
  avisos.push('Cor e fotos nunca vêm no anúncio — precisam ser preenchidas.');

  return { veiculo, faltando, avisos };
}

/**
 * Separa um texto com vários anúncios (colados em sequência) em blocos.
 * O separador é a linha em branco, que é como a loja já escreve.
 */
export function separarAnuncios(texto) {
  return String(texto || '')
    .split(/\n\s*\n/)
    .map((bloco) => bloco.trim())
    .filter((bloco) => bloco.length > 0);
}
