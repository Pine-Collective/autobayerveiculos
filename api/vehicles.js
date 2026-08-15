/**
 * GET  /api/vehicles  ->  { vehicles, sha }
 * PUT  /api/vehicles  { vehicles, sha }  ->  { sha, commit }
 *
 * O `sha` é o controle de concorrência: quem salva precisa devolver o mesmo
 * sha que leu. Se outra pessoa salvou nesse meio-tempo, a gravação é recusada
 * em vez de apagar o trabalho dela.
 */
import { exigirLogin } from './_lib/auth.js';
import { lerArquivo, gravarArquivo } from './_lib/github.js';
import { validarEstoque, normalizarVeiculo } from '../lib/vehicle-schema.mjs';

const CAMINHO = 'data/vehicles.json';

export default async function handler(req, res) {
  if (!exigirLogin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { texto, sha } = await lerArquivo(CAMINHO);
      return res.status(200).json({ vehicles: JSON.parse(texto), sha });
    }

    if (req.method === 'PUT') {
      const { vehicles, sha, resumo } = req.body || {};

      if (!Array.isArray(vehicles)) {
        return res.status(400).json({ erro: 'Envie a lista completa de veículos.' });
      }
      if (!sha) {
        return res.status(400).json({ erro: 'Referência da versão ausente. Recarregue a página.' });
      }

      // Nunca confia no que veio do navegador: normaliza e valida de novo.
      const normalizados = vehicles.map(normalizarVeiculo);
      const problemas = validarEstoque(normalizados);

      if (problemas.length) {
        return res.status(400).json({ erro: 'Estoque inválido.', problemas });
      }

      const resultado = await gravarArquivo({
        caminho: CAMINHO,
        conteudo: `${JSON.stringify(normalizados, null, 2)}\n`,
        sha,
        mensagem: resumo ? `admin: ${resumo}` : 'admin: atualiza estoque'
      });

      return res.status(200).json(resultado);
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        erro: 'Alguém salvou alterações enquanto você editava. Recarregue a página e refaça a mudança.'
      });
    }
    console.error('Erro em /api/vehicles:', error);
    return res.status(500).json({ erro: 'Não foi possível salvar. Tente de novo.' });
  }
}
