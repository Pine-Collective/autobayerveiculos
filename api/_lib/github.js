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
    ...(sha ? { sha } : {})
  };

  const dados = await requisicao(`/repos/${repo}/contents/${encodeURI(caminho)}`, {
    method: 'PUT',
    body: JSON.stringify(corpo)
  });

  return { sha: dados.content.sha, commit: dados.commit.sha };
}
