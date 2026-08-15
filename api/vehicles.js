/**
 * GET  /api/vehicles  ->  { vehicles, sha }
 * PUT  /api/vehicles  { vehicles, sha }  ->  { sha, commit }
 *
 * O `sha` é o controle de concorrência: quem salva precisa devolver o mesmo
 * sha que leu. Se outra pessoa salvou nesse meio-tempo, a gravação é recusada
 * em vez de apagar o trabalho dela — e a resposta 409 informa qual foi a
 * última publicação, para o usuário decidir o que fazer.
 */
import { exigirLogin } from './_lib/auth.js';
import { lerArquivo, gravarArquivo, ultimoCommit, tokenRecusado } from './_lib/github.js';
import { validarEstoque, normalizarVeiculo, garantirSlugsUnicos } from '../lib/vehicle-schema.mjs';

const CAMINHO = 'data/vehicles.json';

const ERRO_TOKEN =
  'O GitHub recusou o acesso — o token provavelmente venceu. ' +
  'Renove seguindo o ADMIN.md, seção "Renovar o token".';

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

      // Nunca confia no que veio do navegador: normaliza, resolve slugs
      // duplicados (dois carros iguais ganham sufixo -2, -3...) e valida.
      const normalizados = garantirSlugsUnicos(vehicles.map(normalizarVeiculo));
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
      // Busca quem publicou por último para o aviso ser útil, não só "deu conflito".
      let ultimaAlteracao = null;
      try {
        ultimaAlteracao = await ultimoCommit(CAMINHO);
      } catch {
        /* segue sem o detalhe */
      }
      return res.status(409).json({
        erro: 'Alguém publicou o estoque enquanto você editava.',
        ultimaAlteracao
      });
    }
    if (tokenRecusado(error)) {
      return res.status(502).json({ erro: ERRO_TOKEN });
    }
    console.error('Erro em /api/vehicles:', error);
    return res.status(500).json({ erro: 'Não foi possível salvar. Tente de novo.' });
  }
}
