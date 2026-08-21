/**
 * Testes do interpretador de anúncios.
 *
 * A fixture scripts/fixtures/anuncios-reais.txt são anúncios DE VERDADE da
 * loja. Manter os testes presos a eles é proposital: quando o Thiago mudar o
 * jeito de escrever, é aqui que o desencontro aparece primeiro.
 *
 *   npm run test:parser
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseAnuncio, separarAnuncios } from '../lib/parse-anuncio.mjs';
import { validarEstoque, normalizarVeiculo } from '../lib/vehicle-schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

const texto = await readFile(join(root, 'scripts/fixtures/anuncios-reais.txt'), 'utf8');
const blocos = separarAnuncios(texto);

/* ================================================================== */
console.log('\n1. Separação de anúncios');
/* ================================================================== */

check('linha em branco separa os 6 anúncios', blocos.length === 6, `${blocos.length}`);
check(
  'nenhum bloco vazio',
  blocos.every((b) => b.trim().length > 0)
);

const resultados = blocos.map((b) => parseAnuncio(b));
const [corsa, cg125, strada, ecosport, megane, s10] = resultados.map((r) => r.veiculo);

/* ================================================================== */
console.log('\n2. Marca deduzida do modelo (nunca vem escrita)');
/* ================================================================== */

check('Corsa -> Chevrolet', corsa.brand === 'Chevrolet', corsa.brand);
check('Cg125 -> Honda', cg125.brand === 'Honda', cg125.brand);
check('Strada -> Fiat', strada.brand === 'Fiat', strada.brand);
check('Ecosport -> Ford', ecosport.brand === 'Ford', ecosport.brand);
check('Megane -> Renault', megane.brand === 'Renault', megane.brand);
check('S10 -> Chevrolet', s10.brand === 'Chevrolet', s10.brand);

/* ================================================================== */
console.log('\n3. Tipo deduzido');
/* ================================================================== */

// "Corsa Classic" é o sedan Classic, não o hatch Corsa: a ordem das regras
// em TIPO_POR_MODELO garante que "classic" ganhe de "corsa".
check('Corsa classic -> Sedan (não Hatch)', corsa.type === 'Sedan', corsa.type);
check('Cg125 -> Moto', cg125.type === 'Moto', cg125.type);
check('Strada -> Picape', strada.type === 'Picape', strada.type);
check('Ecosport -> SUV', ecosport.type === 'SUV', ecosport.type);
check('Megane GrandTour -> Perua', megane.type === 'Perua', megane.type);
check('S10 -> Picape', s10.type === 'Picape', s10.type);

check('moto não recebe número de portas', cg125.doors === undefined, String(cg125.doors));
check('carro recebe portas', corsa.doors === 4, String(corsa.doors));
check('"4 portas" do texto é respeitado', corsa.doors === 4);

/* ================================================================== */
console.log('\n4. Dois preços (o padrão mais consistente dos anúncios)');
/* ================================================================== */

check('Corsa à vista 15.900', corsa.price === 15900, String(corsa.price));
check('Corsa na troca 16.900', corsa.priceTroca === 16900, String(corsa.priceTroca));
check('CG125 à vista 7.200', cg125.price === 7200, String(cg125.price));
check('S10 à vista 63.900', s10.price === 63900, String(s10.price));
check('S10 na troca 67.900', s10.priceTroca === 67900, String(s10.priceTroca));
check(
  '"Valor avista" (com prefixo) também é lido',
  ecosport.price === 35900,
  String(ecosport.price)
);
check(
  'todos os 6 trazem os dois preços',
  resultados.every((r) => r.veiculo.price > 0 && r.veiculo.priceTroca > 0)
);
check(
  'na troca é sempre maior que à vista',
  resultados.every((r) => r.veiculo.priceTroca > r.veiculo.price)
);

/* ================================================================== */
console.log('\n5. Ano e quilometragem');
/* ================================================================== */

check('ano rotulado "Ano 2003"', corsa.year === 2003, String(corsa.year));
check('ano no título "Cg125 KS 2003"', cg125.year === 2003, String(cg125.year));
check('Strada sem ano -> 0 e marcado como faltando', strada.year === 0);
check('Strada lista year em faltando', resultados[2].faltando.includes('year'));

check('km "Km:267.000" -> 267000', corsa.km === 267000, String(corsa.km));
check('km "Km:175.175" -> 175175', ecosport.km === 175175, String(ecosport.km));
check('CG125 sem km -> 0', cg125.km === 0);
check('CG125 lista km em faltando', resultados[1].faltando.includes('km'));

/* ================================================================== */
console.log('\n6. Combustível e câmbio (onde estavam os bugs)');
/* ================================================================== */

// "Vidros elétricos" e "Trava elétrica" faziam o parser anunciar o Ecosport
// 1.6 como carro ELÉTRICO. Elétrico/híbrido agora só valem no título.
check(
  'Ecosport com vidros elétricos NÃO vira elétrico',
  ecosport.fuel !== 'Elétrico',
  ecosport.fuel
);
check('Megane com trava elétrica NÃO vira elétrico', megane.fuel !== 'Elétrico', megane.fuel);
check('S10 "Diesel" no título -> Diesel', s10.fuel === 'Diesel', s10.fuel);
check('S10 com banco elétrico continua Diesel', s10.fuel === 'Diesel');

check('Ecosport "Manual" no título -> Manual', ecosport.gear === 'Manual', ecosport.gear);
check('Megane -> Manual', megane.gear === 'Manual', megane.gear);
// Automático como padrão anunciaria um Corsa 2003 com câmbio que ele não tem.
check('Corsa sem câmbio informado -> Manual (não Automático)', corsa.gear === 'Manual', corsa.gear);

/* ================================================================== */
console.log('\n7. Lista de itens e selo de procedência');
/* ================================================================== */

check(
  'Ecosport extrai 18 itens',
  ecosport.features.length === 18,
  String(ecosport.features.length)
);
check('itens preservam o texto da loja', ecosport.features.includes('Direção hidráulica'));
check(
  'primeira letra é maiúscula',
  ecosport.features.every((f) => /^[A-ZÀ-Ú0-9]/.test(f))
);

const todosItens = resultados
  .flatMap((r) => r.veiculo.features)
  .join(' | ')
  .toLowerCase();
check('preço não vira item', !/r\$/.test(todosItens));
check('"faço financiamento" não vira item', !/financiamento/.test(todosItens));
check('"21x no cartão" não vira item', !/cart[aã]o/.test(todosItens));
check('"analiso troca" não vira item', !/analiso|pego troca/.test(todosItens));
check('linha de km não vira item', !/^km/m.test(todosItens));

// "Sem leilão e sem sinistro" é procedência, não equipamento.
check('Strada ganha selo "Sem sinistro"', strada.badge === 'Sem sinistro', strada.badge);
check(
  '"sem leilão e sem sinistro" sai da lista de itens',
  !strada.features.some((f) => /sinistro|leil/i.test(f)),
  strada.features.join(' | ')
);
check('quem não menciona fica sem selo', corsa.badge === '', corsa.badge);

/* ================================================================== */
console.log('\n8. Modelo limpo e slug');
/* ================================================================== */

check('ano sai do modelo', !/\d{4}/.test(cg125.model), cg125.model);
check('Cg125 KS 2003 -> "Cg125 KS"', cg125.model === 'Cg125 KS', cg125.model);
check('modelo do Corsa preservado', corsa.model === 'Corsa classic 1.0 VHC', corsa.model);
check('slug gerado quando marca+modelo+ano existem', Boolean(corsa.slug), corsa.slug);
check('sem ano não gera slug (seria enganoso)', strada.slug === undefined, strada.slug);

/* ================================================================== */
console.log('\n9. Avisos: o parser não finge que está pronto');
/* ================================================================== */

check(
  'todo anúncio avisa que faltam cor e fotos',
  resultados.every((r) => r.faltando.includes('color') && r.faltando.includes('images'))
);
check(
  'nenhum anúncio sai publicável sozinho',
  resultados.every((r) => r.faltando.length > 0)
);
check(
  'Strada acumula os avisos de ano e km',
  resultados[2].avisos.some((a) => /Ano/.test(a)) &&
    resultados[2].avisos.some((a) => /Quilometragem/.test(a))
);

/* ================================================================== */
console.log('\n10. Integração com o schema');
/* ================================================================== */

// Completa o que falta e confere que o resultado é publicável de verdade.
const completo = resultados.map((r, i) =>
  normalizarVeiculo({
    ...r.veiculo,
    id: i + 1,
    year: r.veiculo.year || 2015,
    km: r.veiculo.km || 100000,
    color: 'Prata',
    images: ['assets/veiculos/x.webp']
  })
);

const problemas = validarEstoque(completo);
check('rascunhos completados passam na validação', problemas.length === 0, problemas.join(' | '));
check(
  'moto continua sem portas depois de normalizar',
  completo[1].doors === undefined,
  String(completo[1].doors)
);
check('features sobrevivem à normalização', completo[3].features.length === 18);
check('priceTroca sobrevive à normalização', completo[0].priceTroca === 16900);

// A validação precisa reclamar de troca menor que à vista (erro de digitação).
const invertido = validarEstoque([{ ...completo[0], price: 20000, priceTroca: 15000 }]);
check(
  'troca menor que à vista é recusada',
  invertido.some((p) => /menor que o à vista/.test(p)),
  invertido.join(' | ')
);

/* ================================================================== */
console.log('\n11. Casos de borda');
/* ================================================================== */

const vazio = parseAnuncio('');
check('texto vazio não quebra', vazio.veiculo === null && vazio.avisos.length > 0);

const soTitulo = parseAnuncio('Gol 1.0 2015');
check('só o título já deduz marca', soTitulo.veiculo.brand === 'Volkswagen');
check('só o título já deduz tipo', soTitulo.veiculo.type === 'Hatch');
check('só o título já deduz ano', soTitulo.veiculo.year === 2015);
check('sem preço, avisa', soTitulo.faltando.includes('price'));

const anoBarra = parseAnuncio('Onix LT 2015/2016\nAvista R$40.000,00');
check(
  'ano "2015/2016" usa o ano-modelo',
  anoBarra.veiculo.year === 2016,
  String(anoBarra.veiculo.year)
);

const desconhecido = parseAnuncio('Nave Espacial X99\nAvista R$99.000,00');
check('modelo desconhecido não inventa marca', desconhecido.veiculo.brand === '');
check('modelo desconhecido avisa', desconhecido.faltando.includes('brand'));

/* ================================================================== */

console.log(`\n${'─'.repeat(56)}\n${passed} verificações passaram, ${failures.length} falharam.`);
if (failures.length) {
  console.log('\nFalhas:');
  failures.forEach((f) => console.log(`  · ${f}`));
  process.exitCode = 1;
}
