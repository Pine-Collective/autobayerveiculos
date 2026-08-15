/**
 * Autenticação do admin — sem banco de dados.
 *
 * Como funciona: o login confere a senha (que vive numa variável de ambiente
 * do Vercel) e devolve um token assinado com HMAC-SHA256. O token carrega a
 * própria validade, então o servidor não precisa guardar sessão em lugar
 * nenhum — ele só verifica a assinatura a cada requisição.
 *
 * A senha e a chave de assinatura nunca chegam ao navegador.
 */
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas: uma jornada de trabalho

/** Chave de assinatura. Deriva da senha se ADMIN_SECRET não for definida —
 *  assim trocar a senha invalida as sessões abertas, que é o desejado. */
function chaveDeAssinatura() {
  const senha = process.env.ADMIN_PASSWORD;
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  return createHash('sha256').update(`autobayer-sessao:${senha}`).digest('hex');
}

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

function assinar(dados) {
  return createHmac('sha256', chaveDeAssinatura()).update(dados).digest('base64url');
}

/** Comparação de tempo constante: não vaza informação pelo tempo de resposta. */
function iguaisEmTempoConstante(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function senhaConfigurada() {
  const senha = process.env.ADMIN_PASSWORD;
  return typeof senha === 'string' && senha.length >= 12;
}

export function conferirSenha(tentativa) {
  if (!senhaConfigurada()) return false;
  // Compara os hashes para que senhas de tamanhos diferentes não vazem o
  // tamanho da senha real pela comparação de comprimento.
  const hash = (valor) => createHash('sha256').update(String(valor)).digest('hex');
  return iguaisEmTempoConstante(hash(tentativa), hash(process.env.ADMIN_PASSWORD));
}

export function criarToken() {
  const payload = base64url(JSON.stringify({ exp: Date.now() + DURACAO_SESSAO_MS }));
  return `${payload}.${assinar(payload)}`;
}

/** Devolve true se o token for autêntico e ainda estiver dentro da validade. */
export function tokenValido(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;

  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return false;
  if (!iguaisEmTempoConstante(assinatura, assinar(payload))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

/**
 * Guarda de rota. Devolve true se autorizado; caso contrário já responde 401
 * e devolve false — quem chama só precisa de `if (!exigirLogin(req, res)) return;`
 */
export function exigirLogin(req, res) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';

  if (!tokenValido(token)) {
    res.status(401).json({ erro: 'Sessão expirada ou inválida. Entre novamente.' });
    return false;
  }
  return true;
}

/**
 * Freio simples contra tentativa de força bruta, na memória da instância.
 *
 * Limitação honesta: o Vercel roda várias instâncias e as recicla, então isto
 * não é um limite global — é só um atrito a mais. A proteção que realmente
 * conta é uma senha longa (exigimos 12+ caracteres) somada ao atraso fixo
 * aplicado a toda tentativa errada.
 */
const tentativas = new Map();
const JANELA_MS = 10 * 60 * 1000;
const LIMITE = 10;

export function excedeuTentativas(identificador) {
  const agora = Date.now();
  const registro = tentativas.get(identificador);

  if (!registro || agora > registro.expiraEm) {
    tentativas.set(identificador, { contagem: 1, expiraEm: agora + JANELA_MS });
    return false;
  }

  registro.contagem += 1;
  return registro.contagem > LIMITE;
}

export function limparTentativas(identificador) {
  tentativas.delete(identificador);
}
