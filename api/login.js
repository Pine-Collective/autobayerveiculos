/**
 * POST /api/login  { senha }  ->  { token, validoAte }
 *
 * Único ponto onde a senha é conferida. Erra a senha: atraso fixo e mensagem
 * genérica, para não ajudar quem estiver tentando adivinhar.
 */
import {
  conferirSenha,
  criarToken,
  senhaConfigurada,
  excedeuTentativas,
  limparTentativas
} from './_lib/auth.js';

const ATRASO_ERRO_MS = 900;
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  if (!senhaConfigurada()) {
    return res.status(500).json({
      erro: 'Admin não configurado: defina ADMIN_PASSWORD (mínimo 12 caracteres) no Vercel.'
    });
  }

  const origem =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'desconhecida';

  if (excedeuTentativas(origem)) {
    await espera(ATRASO_ERRO_MS);
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  const senha = req.body?.senha;

  if (!conferirSenha(senha)) {
    await espera(ATRASO_ERRO_MS);
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }

  limparTentativas(origem);

  const token = criarToken();
  const { exp } = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));

  return res.status(200).json({ token, validoAte: exp });
}
