# Painel do estoque

Endereço: **`https://seu-dominio.com.br/admin/`**

O painel deixa a equipe marcar carro como vendido, cadastrar veículos novos e
enviar fotos, sem mexer em código e sem conta no GitHub.

---

## Como funciona (e por que não tem banco de dados)

```
Equipe abre /admin  →  entra com a senha
                          │
                          ▼
              edita o estoque na tela
                          │
                   clica em "Publicar"
                          │
                          ▼
        função em /api grava data/vehicles.json no GitHub
                          │
                          ▼
            Vercel reconstrói  →  site no ar (~1 min)
```

O repositório é o banco de dados. Cada publicação vira um commit, então existe
histórico completo — dá para ver o que mudou, quando, e voltar atrás.

Nem a senha nem o token do GitHub chegam ao navegador: ficam só nas variáveis
de ambiente do Vercel, usadas pelas funções do lado do servidor.

---

## Configuração (uma vez só)

São dois lugares diferentes, e é fácil confundir: as **permissões** ficam no
GitHub, na tela onde o token é criado. No Vercel vai só a **string do token**.

### 1. Criar o token no GitHub

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**
2. **Repository access → Only select repositories:**
   `Pine-Collective/autobayerveiculos`
3. **Permissions → Repository permissions → Contents:** mude para
   **Read and write** (só esta — nenhuma outra é necessária)
4. Defina uma validade e anote a data para renovar
5. **Generate token** e copie a string que aparecer

> O GitHub mostra o token **uma única vez**. Se fechar a página sem copiar,
> não dá para recuperar — só gerar outro.

### 2. Definir as variáveis no Vercel

Projeto → **Settings → Environment Variables**. Marque os três ambientes
(Production, Preview, Development):

| Variável         | O que colar no campo "Value"                          | Obrigatória         |
| ---------------- | ----------------------------------------------------- | ------------------- |
| `ADMIN_PASSWORD` | a senha da equipe, **mínimo 12 caracteres**           | sim                 |
| `GITHUB_TOKEN`   | a string copiada no passo 1, começa com `github_pat_` | sim                 |
| `GITHUB_REPO`    | `Pine-Collective/autobayerveiculos`                   | sim                 |
| `GITHUB_BRANCH`  | `main`                                                | não (padrão `main`) |
| `ADMIN_SECRET`   | um texto aleatório longo                              | não (veja abaixo)   |

Nada de "Contents: Read and write" vai aqui — isso foi configurado no passo 1,
dentro do GitHub. O campo "Value" do `GITHUB_TOKEN` recebe só o token:

```
github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ1234567890abcdefGHIJKL
```

`ADMIN_SECRET` assina os tokens de sessão. Se você não definir, ele é derivado
da própria senha — o que funciona bem e tem um efeito desejável: **trocar a
senha derruba todas as sessões abertas**.

### 3. Publicar

Depois de salvar as variáveis, faça um novo deploy (as variáveis só valem a
partir do próximo build). Acesse `/admin/` e entre com a senha.

---

## Uso no dia a dia

### Marcar um carro como vendido

É a operação mais comum e leva um toque: na lista, use o interruptor
**Disponível / Vendido**. Depois clique em **Publicar**.

O carro vendido continua no site, marcado como VENDIDO e jogado para o fim da
lista. Isso é proposital: quem se interessou por ele costuma perguntar se tem
algo parecido, e o botão do WhatsApp já muda para "Ver similares". Quando não
fizer mais sentido, é só excluir.

### Cadastrar um veículo

**+ Novo veículo** → preencher → **Enviar fotos** → **Aplicar** → **Publicar**.

Preço e quilometragem aceitam digitação livre: o campo formata sozinho e mostra
o valor final embaixo.

### Fotos

- A **primeira foto é a capa**; use a estrela (★) para promover outra
- Podem ser enviadas várias de uma vez
- As imagens são reduzidas para no máximo 1600px e convertidas em WebP **no
  próprio navegador**, antes de subir. Uma foto de 8 MB do celular vira cerca
  de 150 KB — o envio fica rápido no 4G e o repositório não incha
- Fotos deitadas por causa do sensor do celular são corrigidas automaticamente

### Duas pessoas editando ao mesmo tempo

Se alguém publicar enquanto você edita, sua publicação é **recusada** com um
aviso, em vez de apagar o trabalho da outra pessoa. A página recarrega e você
refaz a alteração.

---

## Segurança — o que está protegido e o que não está

**Protegido:**

- Senha e token do GitHub nunca saem do servidor
- Senha comparada em tempo constante (não vaza informação pelo tempo de resposta)
- Sessão de 8 horas, assinada com HMAC-SHA256 e verificada a cada requisição;
  token adulterado ou vencido é recusado
- Toda gravação é validada de novo no servidor — o navegador não é confiável
- Upload confere a assinatura binária do arquivo (não o nome nem o
  `Content-Type`), então um `.php` renomeado para `.jpg` é recusado
- Nome de arquivo é higienizado: `../../../etc/passwd` não escapa da pasta
- O token do GitHub só tem permissão de conteúdo, num único repositório

**Limitações que você deve conhecer:**

- **A senha é única e compartilhada.** Não há usuários separados, então não dá
  para saber quem fez cada alteração — os commits saem todos como "admin".
  Se isso passar a importar, o próximo passo é login por usuário.
- **O freio contra tentativas de senha é fraco.** Ele vive na memória da
  instância, e o Vercel roda várias e as recicla, então não é um limite global.
  O que realmente protege é uma senha longa somada ao atraso fixo em toda
  tentativa errada. **Use uma senha de verdade** — nada de `autobayer123`.
- **`/admin/` é público.** Qualquer um consegue abrir a tela de login; o que
  protege são as funções da API, que não fazem nada sem senha. O `robots.txt`
  só evita que a página apareça em busca — não é proteção.
- **As fotos ficam no histórico do Git para sempre.** Excluir um carro não
  apaga as fotos dos commits antigos. Com a compressão aplicada isso leva anos
  para virar problema, mas é bom saber.

---

## Problemas comuns

| Sintoma                                          | Causa provável                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| "Admin não configurado"                          | `ADMIN_PASSWORD` ausente ou com menos de 12 caracteres                                 |
| "Não foi possível salvar"                        | `GITHUB_TOKEN` vencido, com o valor errado no campo, ou sem `Contents: Read and write` |
| Publicou mas o site não mudou                    | o build leva ~1 min; confira os deploys no Vercel                                      |
| "Alguém salvou alterações enquanto você editava" | edição simultânea; recarregue e refaça                                                 |
| Login não aceita a senha certa                   | variáveis só valem a partir do deploy seguinte                                         |

---

## Para desenvolvedores

O estoque é `data/vehicles.json` — fonte da verdade, editável direto no repo.
O build gera `js/vehicles.js` a partir dele (por isso o gerado fica fora do Git).

```bash
npm run test:admin   # 78 verificações: auth, API, validação e interface
npm run data         # regenera js/vehicles.js a partir do JSON
```

As regras de validação vivem em `lib/vehicle-schema.mjs` e rodam nos dois
lados: no build e na API.

Os testes simulam o GitHub em memória — nenhum commit real é feito.

**Limitação conhecida dos testes:** o envio de foto pela interface não é
coberto, porque o jsdom não implementa `canvas`/`createImageBitmap`, usados na
compressão. A API de upload é testada diretamente; o caminho do navegador
precisa de conferência manual.
