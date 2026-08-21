/**
 * Regras do estoque, compartilhadas entre o build e a API do admin.
 *
 * A mesma validação roda nos dois lados de propósito: o admin dá o retorno
 * rápido ao usuário, e a API não confia no que chega do navegador.
 */

export const TIPOS = ['SUV', 'Sedan', 'Hatch', 'Picape', 'Perua', 'Moto'];
export const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Diesel', 'Etanol', 'Híbrido', 'Elétrico'];
export const CAMBIOS = ['Automático', 'Manual', 'Automatizado', 'CVT'];
export const SELOS = ['', 'Destaque', 'Oferta', 'Único dono', 'Novidade', 'Sem sinistro'];

/** Motos não têm portas — o campo é omitido para elas. */
export const TIPO_MOTO = 'Moto';

const ANO_MIN = 1950;
const ANO_MAX = new Date().getFullYear() + 2;

/** Transforma "Jeep Compass Limited" + 2022 em "jeep-compass-limited-2022". */
export function gerarSlug(brand, model, year) {
  return `${brand} ${model} ${year}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // tira acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Devolve `base` ou, se já estiver em `ocupados`, a primeira variação livre
 * com sufixo numérico (base-2, base-3, ...). É o que permite cadastrar dois
 * carros idênticos sem travar a publicação com "slug repetido".
 */
export function slugUnico(base, ocupados) {
  const usados = new Set(ocupados);
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Garante que nenhum slug se repita na lista, preservando o primeiro de cada
 * duplicata. Como veículos novos entram no fim da lista, o slug antigo (que
 * pode estar em links compartilhados) nunca muda — o novo é que ganha sufixo.
 */
export function garantirSlugsUnicos(vehicles) {
  const vistos = new Set();
  return vehicles.map((vehicle) => {
    const slug = slugUnico(vehicle.slug, vistos);
    vistos.add(slug);
    return slug === vehicle.slug ? vehicle : { ...vehicle, slug };
  });
}

/**
 * Valida a lista inteira. Devolve um array de mensagens de erro em português;
 * vazio significa que está tudo certo.
 */
export function validarEstoque(vehicles) {
  const problemas = [];

  if (!Array.isArray(vehicles)) {
    return ['O estoque precisa ser uma lista de veículos.'];
  }

  const idsVistos = new Set();
  const slugsVistos = new Set();

  vehicles.forEach((v, index) => {
    const onde = v && v.slug ? `"${v.slug}"` : `veículo na posição ${index + 1}`;
    const erro = (mensagem) => problemas.push(`${onde}: ${mensagem}`);

    if (!v || typeof v !== 'object') {
      problemas.push(`${onde}: registro inválido`);
      return;
    }

    if (!Number.isInteger(v.id) || v.id <= 0) erro('id precisa ser um número inteiro positivo');
    else if (idsVistos.has(v.id)) erro(`id ${v.id} está repetido`);
    idsVistos.add(v.id);

    if (!v.slug || typeof v.slug !== 'string' || !/^[a-z0-9-]+$/.test(v.slug)) {
      erro('slug precisa ter só letras minúsculas, números e hífens');
    } else if (slugsVistos.has(v.slug)) {
      erro(`slug "${v.slug}" está repetido`);
    }
    slugsVistos.add(v.slug);

    if (!v.brand || typeof v.brand !== 'string') erro('marca é obrigatória');
    if (!v.model || typeof v.model !== 'string') erro('modelo é obrigatório');

    if (!Number.isInteger(v.year) || v.year < ANO_MIN || v.year > ANO_MAX) {
      erro(`ano precisa estar entre ${ANO_MIN} e ${ANO_MAX}`);
    }

    if (!TIPOS.includes(v.type)) erro(`tipo precisa ser um de: ${TIPOS.join(', ')}`);

    if (typeof v.km !== 'number' || !Number.isFinite(v.km) || v.km < 0) {
      erro('quilometragem precisa ser um número maior ou igual a zero');
    }

    if (typeof v.price !== 'number' || !Number.isFinite(v.price) || v.price <= 0) {
      erro('preço à vista precisa ser um número maior que zero');
    }

    // Preço na troca é opcional (0 = não informado), mas quando existe precisa
    // fazer sentido: na prática a loja cobra mais na troca, nunca menos.
    if (v.priceTroca !== undefined && v.priceTroca !== 0) {
      if (typeof v.priceTroca !== 'number' || !Number.isFinite(v.priceTroca) || v.priceTroca < 0) {
        erro('preço na troca precisa ser um número');
      } else if (typeof v.price === 'number' && v.priceTroca < v.price) {
        erro('preço na troca está menor que o à vista — confira os valores');
      }
    }

    if (!Array.isArray(v.images) || v.images.length === 0) {
      erro('é preciso ao menos uma foto');
    } else if (v.images.some((img) => typeof img !== 'string' || !img.trim())) {
      erro('há uma foto com endereço vazio');
    } else if (v.images.some((img) => String(img).startsWith('data:'))) {
      // Uma foto em data: significa que o upload não aconteceu antes do PUT —
      // gravar isso incharia o JSON e quebraria o site.
      erro('há uma foto que ainda não subiu para o servidor — publique de novo');
    }

    if (v.badge !== undefined && !SELOS.includes(v.badge)) {
      erro(`selo precisa ser um de: ${SELOS.filter(Boolean).join(', ')} (ou vazio)`);
    }
    if (v.fuel !== undefined && !COMBUSTIVEIS.includes(v.fuel)) {
      erro(`combustível precisa ser um de: ${COMBUSTIVEIS.join(', ')}`);
    }
    if (v.gear !== undefined && !CAMBIOS.includes(v.gear)) {
      erro(`câmbio precisa ser um de: ${CAMBIOS.join(', ')}`);
    }
    if (typeof v.sold !== 'boolean') erro('o campo "vendido" precisa ser verdadeiro ou falso');
    if (v.featured !== undefined && typeof v.featured !== 'boolean') {
      erro('o campo "destaque" precisa ser verdadeiro ou falso');
    }

    // Moto não tem portas; para os demais o campo é um inteiro.
    if (v.type === TIPO_MOTO) {
      if (v.doors !== undefined && v.doors !== null) erro('moto não deve ter número de portas');
    } else if (v.doors !== undefined && v.doors !== null && !Number.isInteger(v.doors)) {
      erro('número de portas precisa ser inteiro');
    }

    if (v.features !== undefined) {
      if (!Array.isArray(v.features)) {
        erro('a lista de itens precisa ser uma lista');
      } else if (v.features.some((item) => typeof item !== 'string' || !item.trim())) {
        erro('há um item em branco na lista de opcionais');
      }
    }
  });

  return problemas;
}

/**
 * Normaliza um veículo vindo do formulário: remove campos desconhecidos,
 * converte números e garante os valores padrão.
 */
export function normalizarVeiculo(entrada) {
  const numero = (valor) => {
    const n = typeof valor === 'string' ? Number(valor.replace(/\D/g, '')) : Number(valor);
    return Number.isFinite(n) ? n : 0;
  };

  const brand = String(entrada.brand || '').trim();
  const model = String(entrada.model || '').trim();
  const year = Math.trunc(numero(entrada.year));
  const type = TIPOS.includes(entrada.type) ? entrada.type : TIPOS[0];

  const veiculo = {
    id: Number.isInteger(entrada.id) && entrada.id > 0 ? entrada.id : Date.now(),
    slug: entrada.slug ? String(entrada.slug).trim() : gerarSlug(brand, model, year),
    brand,
    model,
    year,
    type,
    km: Math.trunc(numero(entrada.km)),
    price: Math.trunc(numero(entrada.price)),
    priceTroca: Math.trunc(numero(entrada.priceTroca)),
    images: Array.isArray(entrada.images)
      ? entrada.images.map((i) => String(i).trim()).filter(Boolean)
      : [],
    features: Array.isArray(entrada.features)
      ? entrada.features.map((i) => String(i).trim()).filter(Boolean)
      : [],
    badge: SELOS.includes(entrada.badge) ? entrada.badge : '',
    featured: Boolean(entrada.featured),
    sold: Boolean(entrada.sold),
    fuel: COMBUSTIVEIS.includes(entrada.fuel) ? entrada.fuel : COMBUSTIVEIS[0],
    gear: CAMBIOS.includes(entrada.gear) ? entrada.gear : CAMBIOS[0],
    color: String(entrada.color || '').trim()
  };

  // Portas só existem para quem tem portas.
  if (type !== TIPO_MOTO) {
    veiculo.doors = Number.isInteger(entrada.doors) ? entrada.doors : 4;
  }

  return veiculo;
}
