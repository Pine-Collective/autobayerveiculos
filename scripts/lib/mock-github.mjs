/**
 * GitHub simulado em memória, compartilhado pelo test-admin e pelo servidor
 * e2e. Intercepta globalThis.fetch para api.github.com — nenhum commit real
 * acontece nos testes.
 */

/**
 * Instala o mock e devolve { repositorio, commits, restaurar }.
 * `arquivos` é um mapa caminho -> conteúdo inicial (string).
 */
export function instalarMockGitHub(arquivos = {}) {
  const repositorio = new Map();
  const commits = [];
  let proximoSha = 1;

  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    repositorio.set(caminho, { conteudo, sha: `sha-inicial-${caminho}` });
  }

  const fetchReal = globalThis.fetch;

  globalThis.fetch = async (url, opcoes = {}) => {
    const endereco = String(url);
    if (!endereco.startsWith('https://api.github.com')) return fetchReal(url, opcoes);

    const resposta = (corpo, status = 200) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });

    // Listagem de commits (usada pelo contexto do 409).
    if (/\/commits\?/.test(endereco)) {
      const ultimo = commits[commits.length - 1];
      return resposta(
        ultimo
          ? [
              {
                commit: {
                  message: ultimo.mensagem,
                  committer: { date: new Date().toISOString() }
                }
              }
            ]
          : []
      );
    }

    const caminho = decodeURIComponent(
      endereco
        .replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\//, '')
        .split('?')[0]
    );

    if (!opcoes.method || opcoes.method === 'GET') {
      const arquivo = repositorio.get(caminho);
      if (!arquivo) return resposta({ message: 'Not Found' }, 404);
      return resposta({
        content: Buffer.from(arquivo.conteudo).toString('base64'),
        sha: arquivo.sha
      });
    }

    if (opcoes.method === 'PUT') {
      const corpo = JSON.parse(opcoes.body);
      const atual = repositorio.get(caminho);

      // Conflito: sha enviado não bate com o atual (edição simultânea).
      if (atual && corpo.sha !== atual.sha) {
        return resposta({ message: 'does not match' }, 409);
      }

      const novoSha = `sha-${proximoSha++}`;
      repositorio.set(caminho, {
        conteudo: Buffer.from(corpo.content, 'base64').toString('utf8'),
        sha: novoSha
      });
      commits.push({ caminho, mensagem: corpo.message, committer: corpo.committer });
      return resposta({ content: { sha: novoSha }, commit: { sha: `commit-${novoSha}` } });
    }

    return resposta({ message: 'Método não suportado no mock' }, 405);
  };

  return {
    repositorio,
    commits,
    restaurar() {
      globalThis.fetch = fetchReal;
    }
  };
}
