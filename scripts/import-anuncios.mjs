/**
 * Importa vários anúncios de uma vez para o estoque.
 *
 * Espera um arquivo de texto com os anúncios separados por LINHA EM BRANCO —
 * que é como a loja já escreve. Interpreta cada um, mostra o que ficou
 * faltando e (com --gravar) acrescenta a data/vehicles.json.
 *
 *   node scripts/import-anuncios.mjs anuncios.txt            # só mostra
 *   node scripts/import-anuncios.mjs anuncios.txt --gravar   # grava
 *
 * IMPORTANTE: nenhum veículo entra sem ano, km, preço e ao menos uma foto.
 * Os incompletos aparecem no relatório para você completar — no arquivo de
 * texto ou depois, pelo painel.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAnuncio, separarAnuncios } from '../lib/parse-anuncio.mjs';
import { validarEstoque, normalizarVeiculo, garantirSlugsUnicos } from '../lib/vehicle-schema.mjs';
import { raizDoProjeto as root } from './lib/load-config.mjs';

const arquivo = process.argv[2];
const gravar = process.argv.includes('--gravar');

if (!arquivo) {
  console.error('Uso: node scripts/import-anuncios.mjs <arquivo.txt> [--gravar]');
  process.exit(1);
}

const texto = await readFile(arquivo, 'utf8');
const blocos = separarAnuncios(texto);

console.log(`${blocos.length} anúncio(s) encontrado(s) em ${arquivo}\n`);

const prontos = [];
const incompletos = [];

blocos.forEach((bloco, i) => {
  const { veiculo, faltando } = parseAnuncio(bloco);
  const titulo = bloco.split('\n')[0];

  if (!veiculo) {
    incompletos.push({ titulo, faltando: ['texto ilegível'] });
    return;
  }

  // Cor e fotos nunca vêm no anúncio; só bloqueiam o que é essencial.
  const bloqueadores = faltando.filter((c) => c !== 'color' && c !== 'images');

  console.log(`${String(i + 1).padStart(2)}. ${titulo}`);
  console.log(
    `    ${veiculo.brand || '???'} · ${veiculo.type} · ${veiculo.year || '????'} · ` +
      `${veiculo.km ? veiculo.km.toLocaleString('pt-BR') + ' km' : 'km ?'} · ` +
      `R$ ${veiculo.price.toLocaleString('pt-BR')}` +
      `${veiculo.priceTroca ? ` (troca R$ ${veiculo.priceTroca.toLocaleString('pt-BR')})` : ''} · ` +
      `${veiculo.features.length} itens`
  );

  if (bloqueadores.length) {
    console.log(`    FALTA: ${bloqueadores.join(', ')}`);
    incompletos.push({ titulo, faltando: bloqueadores });
  } else {
    prontos.push(veiculo);
  }
  console.log('');
});

console.log('─'.repeat(60));
console.log(`Completos o bastante para importar: ${prontos.length}`);
console.log(`Faltando dados essenciais:          ${incompletos.length}`);

if (incompletos.length) {
  console.log('\nPara completar (acrescente as linhas no arquivo de texto):');
  for (const item of incompletos) {
    console.log(`  · ${item.titulo}`);
    if (item.faltando.includes('year')) console.log('      Ano 2015');
    if (item.faltando.includes('km')) console.log('      Km:120.000');
    if (item.faltando.includes('price')) console.log('      Avista R$00.000,00');
    if (item.faltando.includes('brand'))
      console.log('      (modelo não reconhecido — cadastre pelo painel)');
  }
}

if (!gravar) {
  console.log('\nNada foi gravado. Rode de novo com --gravar para importar.');
  process.exit(0);
}

if (prontos.length === 0) {
  console.log('\nNenhum veículo completo — nada a gravar.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Gravação                                                            */
/* ------------------------------------------------------------------ */

const caminhoEstoque = join(root, 'data/vehicles.json');
const atual = JSON.parse(await readFile(caminhoEstoque, 'utf8'));

const maiorId = atual.reduce((maior, v) => Math.max(maior, v.id), 0);

const novos = prontos.map((veiculo, i) =>
  normalizarVeiculo({
    ...veiculo,
    id: maiorId + i + 1,
    // Sem foto real ainda: entra como VENDIDO para não ir ao ar sem imagem.
    // Ao adicionar as fotos pelo painel, desmarque.
    sold: true,
    images: ['assets/logo-autobayer.png']
  })
);

const combinado = garantirSlugsUnicos([...atual, ...novos]);
const problemas = validarEstoque(combinado);

if (problemas.length) {
  console.error('\nO resultado não passou na validação — nada foi gravado:');
  problemas.forEach((p) => console.error(`  · ${p}`));
  process.exit(1);
}

await writeFile(caminhoEstoque, `${JSON.stringify(combinado, null, 2)}\n`, 'utf8');

console.log(`\n${novos.length} veículo(s) acrescentado(s) a data/vehicles.json.`);
console.log('Eles entraram marcados como VENDIDO e com foto provisória —');
console.log('abra o /admin, envie as fotos reais e desmarque "Vendido" para publicar.');
console.log('\nDepois rode: npm run data');
