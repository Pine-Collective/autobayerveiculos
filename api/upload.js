/**
 * POST /api/upload  { nome, dados }  ->  { caminho }
 *
 * `dados` é a imagem em base64, já redimensionada e comprimida pelo navegador
 * (ver admin/admin.js). Fazer isso no cliente mantém o repositório enxuto e
 * evita depender de biblioteca de imagem na função.
 */
import { exigirLogin } from './_lib/auth.js';
import { gravarArquivo, tokenRecusado } from './_lib/github.js';

const PASTA = 'assets/veiculos';
const TAMANHO_MAXIMO = 2 * 1024 * 1024; // 2 MB já comprimido é bastante

/** Deixa só o que é seguro num nome de arquivo. */
function nomeSeguro(nome) {
  return String(nome || 'foto')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default async function handler(req, res) {
  if (!exigirLogin(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  try {
    const { nome, dados } = req.body || {};

    if (typeof dados !== 'string' || !dados) {
      return res.status(400).json({ erro: 'Nenhuma imagem recebida.' });
    }

    // Aceita tanto "data:image/webp;base64,XXXX" quanto o base64 puro.
    const base64 = dados.includes(',') ? dados.slice(dados.indexOf(',') + 1) : dados;
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length === 0) {
      return res.status(400).json({ erro: 'Imagem vazia ou corrompida.' });
    }
    if (buffer.length > TAMANHO_MAXIMO) {
      return res.status(413).json({ erro: 'Imagem muito grande, mesmo depois de comprimida.' });
    }

    // Confere a assinatura do arquivo em vez de confiar no nome ou no
    // content-type informado pelo navegador.
    const ehWebp =
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP';
    const ehJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const ehPng = buffer.slice(1, 4).toString('ascii') === 'PNG';

    if (!ehWebp && !ehJpeg && !ehPng) {
      return res.status(400).json({ erro: 'Formato não suportado. Envie JPG, PNG ou WebP.' });
    }

    const extensao = ehWebp ? 'webp' : ehJpeg ? 'jpg' : 'png';
    const carimbo = Date.now().toString(36);
    const caminho = `${PASTA}/${nomeSeguro(nome)}-${carimbo}.${extensao}`;

    await gravarArquivo({
      caminho,
      conteudo: buffer,
      mensagem: `admin: envia foto ${caminho.split('/').pop()}`
    });

    return res.status(200).json({ caminho });
  } catch (error) {
    if (tokenRecusado(error)) {
      return res.status(502).json({
        erro:
          'O GitHub recusou o acesso — o token provavelmente venceu. ' +
          'Renove seguindo o ADMIN.md, seção "Renovar o token".'
      });
    }
    console.error('Erro em /api/upload:', error);
    return res.status(500).json({ erro: 'Não foi possível enviar a foto. Tente de novo.' });
  }
}
