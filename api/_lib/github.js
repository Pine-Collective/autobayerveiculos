/**
 * Cliente mínimo da API de conteúdo do GitHub.
 *
 * É este módulo que faz o repositório funcionar como banco de dados: ler um
 * arquivo, gravar um arquivo, cada gravação virando um commit com histórico.
 *
 * O token nunca sai do servidor.
 */
const API = 'https://api.github.com';

function configuracao() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token) throw new Error('GITHUB_TOKEN não configurado no ambiente.');
  if (!repo) throw new Error('GITHUB_REPO não configurado no ambiente (ex.: usuario/projeto).');

  return { token, repo, branch };
}

async function requisicao(caminho, opcoes = {}) {
  const { token } = configuracao();

  const resposta = await fetch(`${API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'autobayer-admin',
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...opcoes.headers
    }
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    const erro = new Error(`GitHub respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
    erro.status = resposta.status;
    throw erro;
  }

  return resposta.status === 204 ? null : resposta.json();
}

/**
 * Lê um arquivo do repositório.
 * Devolve { texto, sha } — o sha é necessário para gravar por cima depois.
 */
export async function lerArquivo(caminho) {
  const { repo, branch } = configuracao();
  const dados = await requisicao(
    `/repos/${repo}/contents/${encodeURI(caminho)}?ref=${encodeURIComponent(branch)}`
  );

  return {
    texto: Buffer.from(dados.content, 'base64').toString('utf8'),
    sha: dados.sha
  };
}

/**
 * Grava (cria ou substitui) um arquivo, gerando um commit.
 *
 * `sha` é o do conteúdo que se está substituindo. Se outra pessoa tiver
 * salvado nesse meio-tempo, o GitHub devolve 409 e a alteração é recusada em
 * vez de sobrescrever silenciosamente o trabalho alheio.
 */
export async function gravarArquivo({ caminho, conteudo, sha, mensagem }) {
  const { repo, branch } = configuracao();

  const corpo = {
    message: mensagem,
    content: Buffer.isBuffer(conteudo)
      ? conteudo.toString('base64')
      : Buffer.from(conteudo, 'utf8').toString('base64'),
    branch,
    // Identifica os commits do painel no histórico — sem isto eles sairiam
    // em nome do dono do token, indistinguíveis do trabalho manual.
    committer: { name: 'Painel Autobayer', email: 'painel-autobayer@users.noreply.github.com' },
    ...(sha ? { sha } : {})
  };

  const dados = await requisicao(`/repos/${repo}/contents/${encodeURI(caminho)}`, {
    method: 'PUT',
    body: JSON.stringify(corpo)
  });

  return { sha: dados.content.sha, commit: dados.commit.sha };
}

/**
 * Última alteração de um arquivo — usada para dizer ao usuário QUEM/QUANDO
 * publicou quando a gravação dele conflita (409).
 */
export async function ultimoCommit(caminho) {
  const { repo, branch } = configuracao();
  const commits = await requisicao(
    `/repos/${repo}/commits?path=${encodeURIComponent(caminho)}&sha=${encodeURIComponent(branch)}&per_page=1`
  );
  if (!Array.isArray(commits) || !commits[0]) return null;
  return {
    mensagem: commits[0].commit.message,
    data: commits[0].commit.committer?.date || null
  };
}

/** True quando o erro veio do GitHub recusando o token (vencido/sem permissão). */
export function tokenRecusado(error) {
  return error && (error.status === 401 || error.status === 403);
}
