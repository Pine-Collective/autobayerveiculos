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

### Renovar o token

O token tem prazo de validade (você escolheu ao criar — anote!). Quando
vencer, o painel passa a responder **"O GitHub recusou o acesso — o token
provavelmente venceu"** em qualquer publicação. Para renovar:

1. Gere um token novo repetindo o passo 1 (ou use **Regenerate** no token
   existente em GitHub → Settings → Developer settings)
2. No Vercel, edite a variável `GITHUB_TOKEN` com o valor novo
3. Faça um redeploy (Deployments → ⋯ → Redeploy)

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

**+ Novo veículo** → preencher → **Adicionar fotos** → **Aplicar** → **Publicar**.

Preço e quilometragem aceitam digitação livre: o campo formata sozinho e mostra
o valor final embaixo.

### Colar anúncio pronto (o atalho)

Dentro do editor há o botão **📋 Colar anúncio pronto**. Cole o texto do
anúncio como ele já está escrito no WhatsApp e clique em **Preencher
formulário** — marca, modelo, tipo, ano, km, os dois preços e a lista de itens
são extraídos sozinhos.

```
Corsa classic 1.0 VHC        →  Marca: Chevrolet (deduzida do modelo)
Ano 2003                        Tipo: Sedan
Km:267.000                      Ano: 2003 · Km: 267.000
4 portas                        À vista: 15.900 · Na troca: 16.900
Avista R$15.900,00              Itens: Desembaçador, Vidros manuais
Na troca R$16.900,00
Faço financiamento           →  (ignorado: é condição de pagamento)
```

**O que ele NÃO consegue adivinhar:** cor e fotos nunca aparecem no anúncio, e
o ano falta na maioria deles. O painel avisa em amarelo o que ficou faltando —
complete antes de aplicar.

Confira sempre **câmbio e combustível**: quando o anúncio não diz, o sistema
chuta (Manual/Flex) e o chute pode estar errado.

### Dois preços

Todo anúncio da loja tem "à vista" e "na troca". O site mostra o **à vista como
preço principal** e o da troca numa linha menor embaixo. O preço na troca é
opcional — deixe em branco se não se aplica.

Se você digitar um valor de troca **menor** que o à vista, o painel avisa na
hora: quase sempre é dígito trocado.

### Motos

Motos entram no catálogo normalmente: escolha **Moto** no tipo e o campo
"portas" desaparece. Elas ganham aba própria na listagem do site.

### Itens e opcionais

Um por linha. É o que o comprador procura — "ar condicionado", "direção
hidráulica", "vidros elétricos" — e aparece numa lista com ✓ no detalhe do
veículo. Quem cola um anúncio já recebe essa lista preenchida.

### Fotos

- A **primeira foto é a capa**; use a estrela (★) para promover outra
- Podem ser adicionadas várias de uma vez
- As imagens são reduzidas para no máximo 1600px e convertidas em **WebP no
  próprio navegador** (formato ~35% menor que JPEG). Uma foto de 8 MB do
  celular vira cerca de 150 KB. Em navegadores sem suporte a gerar WebP
  (Safari antigo), o formato cai para JPEG — nunca PNG
- **As fotos só sobem quando você clica em Publicar.** Cancelou o cadastro?
  Nada ficou para trás no servidor
- Fotos deitadas por causa do sensor do celular são corrigidas automaticamente

### Sessão expirada no meio do trabalho

A sessão dura 8 horas. Se vencer com alterações pendentes, o painel pede a
senha de novo **sem descartar nada** — você entra e continua de onde parou.

### Duas pessoas editando ao mesmo tempo

Se alguém publicar enquanto você edita, sua publicação é **recusada** com um
aviso dizendo qual foi a última publicação, e você escolhe: **publicar a sua
versão mesmo assim** (sobrescreve a da outra pessoa, com consciência) ou
**descartar as suas alterações** e recarregar o que está no ar.

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
  para saber quem da equipe fez cada alteração — os commits saem todos como
  "Painel Autobayer". Se isso passar a importar, o próximo passo é login por
  usuário.
- **O freio contra tentativas de senha é fraco.** Ele vive na memória da
  instância, e o Vercel roda várias e as recicla, então não é um limite global.
  O que realmente protege é uma senha longa somada ao atraso fixo em toda
  tentativa errada. **Use uma senha de verdade** — nada de `autobayer123`.
- **`/admin/` é público.** Qualquer um consegue abrir a tela de login; o que
  protege são as funções da API, que não fazem nada sem senha. O `robots.txt`
  só evita que a página apareça em busca — não é proteção.
- **As fotos ficam no histórico do Git para sempre.** Excluir um carro não
  apaga as fotos dos commits antigos. Com a compressão aplicada isso leva anos
  para virar problema; `node scripts/prune-photos.mjs` lista e remove as que
  ficaram sem referência na versão atual.

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
`npm run data` gera `js/vehicles.js` (dados para o site) e `admin/schema.js`
(listas e regras de slug para o painel) a partir dele e de
`lib/vehicle-schema.mjs` — os dois gerados ficam fora do Git.

```bash
npm test               # unitários: parser + site + painel + consistência de CSS
npm run test:e2e       # navegador real (Chromium) contra o public/ do build
npm run data           # regenera os arquivos derivados
node scripts/prune-photos.mjs   # lista fotos órfãs (--apagar para remover)
```

### Importar vários anúncios de uma vez

Para popular o estoque a partir de um arquivo de texto com vários anúncios
separados por linha em branco:

```bash
node scripts/import-anuncios.mjs anuncios.txt            # só mostra o que daria
node scripts/import-anuncios.mjs anuncios.txt --gravar   # acrescenta ao estoque
```

O importador **recusa** quem estiver sem ano, km ou preço, e lista exatamente
as linhas que faltam para você completar no arquivo. Os que entram vêm
marcados como **vendido** e com foto provisória — abra o painel, envie as
fotos reais e desmarque para publicar. É proposital: veículo sem foto no ar é
pior que veículo nenhum.

### Ensinar modelos novos ao interpretador

As tabelas de marca e tipo vivem em `lib/parse-anuncio.mjs`
(`MODELOS_POR_MARCA` e `TIPO_POR_MODELO`). Para reconhecer um modelo novo,
acrescente a palavra-chave na marca certa. Em `TIPO_POR_MODELO` **a ordem
importa**: o primeiro padrão que casa vence, então o mais específico vem
antes — é por isso que "Corsa Classic" é lido como o sedan Classic e não como
o hatch Corsa.

Os testes usam anúncios reais da loja (`scripts/fixtures/anuncios-reais.txt`).
Se o jeito de escrever mudar, é ali que o desencontro aparece primeiro.

As regras de validação vivem em `lib/vehicle-schema.mjs` e rodam nos dois
lados: no build e na API. Os testes simulam o GitHub em memória — nenhum
commit real é feito. O upload com canvas de verdade (compressão WebP) é
coberto pelo e2e, que o jsdom não alcança.

**Desenvolvimento local do painel:** `npm run dev` serve só o site estático —
as funções de `/api` não rodam nele, então o login local falha. Para o painel
completo use `vercel dev` (com as variáveis num `.env`), ou rode o mesmo
servidor dos testes: `npm run build && node scripts/e2e/server.mjs` (senha de
teste no topo do arquivo, GitHub simulado).

**Trabalho local × painel:** o painel commita direto na `main`. Antes de
trabalhar e de dar push, **sempre `git pull`** — ou o push vai conflitar com
publicações da equipe.
