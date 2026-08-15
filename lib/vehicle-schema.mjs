/**
 * Regras do estoque, compartilhadas entre o build e a API do admin.
 *
 * A mesma validação roda nos dois lados de propósito: o admin dá o retorno
 * rápido ao usuário, e a API não confia no que chega do navegador.
 */

export const TIPOS = ['SUV', 'Sedan', 'Hatch', 'Picape'];
export const COMBUSTIVEIS = ['Flex', 'Gasolina', 'Diesel', 'Etanol', 'Híbrido', 'Elétrico'];
export const CAMBIOS = ['Automático', 'Manual', 'Automatizado', 'CVT'];
export const SELOS = ['', 'Destaque', 'Oferta', 'Único dono', 'Novidade'];

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
      erro('preço precisa ser um número maior que zero');
    }

    if (!Array.isArray(v.images) || v.images.length === 0) {
      erro('é preciso ao menos uma foto');
    } else if (v.images.some((img) => typeof img !== 'string' || !img.trim())) {
      erro('há uma foto com endereço vazio');
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
    if (v.doors !== undefined && !Number.isInteger(v.doors)) {
      erro('número de portas precisa ser inteiro');
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

  return {
    id: Number.isInteger(entrada.id) && entrada.id > 0 ? entrada.id : Date.now(),
    slug: entrada.slug ? String(entrada.slug).trim() : gerarSlug(brand, model, year),
    brand,
    model,
    year,
    type: TIPOS.includes(entrada.type) ? entrada.type : TIPOS[0],
    km: Math.trunc(numero(entrada.km)),
    price: Math.trunc(numero(entrada.price)),
    images: Array.isArray(entrada.images)
      ? entrada.images.map((i) => String(i).trim()).filter(Boolean)
      : [],
    badge: SELOS.includes(entrada.badge) ? entrada.badge : '',
    featured: Boolean(entrada.featured),
    sold: Boolean(entrada.sold),
    fuel: COMBUSTIVEIS.includes(entrada.fuel) ? entrada.fuel : COMBUSTIVEIS[0],
    gear: CAMBIOS.includes(entrada.gear) ? entrada.gear : CAMBIOS[0],
    color: String(entrada.color || '').trim(),
    doors: Number.isInteger(entrada.doors) ? entrada.doors : 4
  };
}
