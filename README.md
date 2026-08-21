# Autobayer Veículos

Site institucional e catálogo de estoque. Site estático — HTML, CSS e JavaScript
puro, sem framework. O build só gera assets derivados (sitemap, imagens) e copia
os arquivos para `public/`; não há bundler nem transpilação.

São duas páginas públicas, e as duas rodam o mesmo `js/app.js`:

| Página          | O que mostra                                                         |
| --------------- | -------------------------------------------------------------------- |
| `index.html`    | home: hero, **vitrine** com até 6 destaques, confiança e contato     |
| `veiculos.html` | estoque completo com busca, filtros, abas de tipo e a ficha do carro |

O que decide o modo é o próprio HTML: o grid da home tem `data-limit="6"`, e é
esse atributo que liga a vitrine (sem filtros, sem vendidos, cortada no limite).
A ficha de cada veículo é `veiculos.html?veiculo=<slug>` — a URL que vai no
sitemap, no JSON-LD e na canonical enquanto a ficha está aberta.

## Rodando localmente

```bash
npm install      # só na primeira vez (Prettier + gerador de imagens)
npm run dev      # abre em http://localhost:3000
```

Também funciona abrindo `index.html` direto no navegador: os dados do estoque são
carregados por `<script>`, não por `fetch`, justamente para não depender de servidor.

## Estrutura

```
index.html              home: hero + vitrine de destaques (placeholders do build)
veiculos.html           estoque completo: busca, filtros e ficha do veículo
data/vehicles.json      o estoque — fonte da verdade
css/styles.css          estilos (seções numeradas no topo do arquivo)
js/config.js            telefone, WhatsApp, endereço, DOMÍNIO, ID do GA4
js/app.js               vitrine, catálogo, filtros, ficha do veículo, favoritos
js/vehicles.js          GERADO a partir do JSON — fora do Git
admin/                  painel do estoque (ver ADMIN.md)
admin/schema.js         GERADO de lib/vehicle-schema.mjs — fora do Git
admin/parser.js         GERADO de lib/parse-anuncio.mjs — fora do Git
api/                    funções serverless que gravam no GitHub
lib/vehicle-schema.mjs  validação e regras de slug (build + API + painel)
lib/parse-anuncio.mjs   lê anúncio em texto e devolve rascunho de veículo
assets/                 logo, favicon, imagem de compartilhamento
scripts/                build, geradores, testes unitários e e2e/
vercel.json             headers de segurança/cache e diretório de saída
public/                 saída do build (gerada; fora do Git)
```

## Publicação

O deploy é automático a cada push na `main` — e o CI (GitHub Actions) roda a
suíte inteira em cada push, incluindo os testes de navegador real.

```bash
npm run build       # gera dados + sitemap + imagens e monta public/
npm run test:build  # faz o build e roda os testes contra public/
npm run test:e2e    # build + Chromium de verdade contra o public/
```

O build também injeta no `public/` o **domínio** (de `js/config.js`, campo
`siteUrl`) em canonical/Open Graph/robots/sitemap, e o **JSON-LD do estoque**
em `veiculos.html` — a página que de fato lista os veículos. Quando o domínio
próprio for registrado, troque só o `siteUrl`.

O topo, o rodapé e o botão flutuante do WhatsApp são repetidos nos dois HTML
(o site não tem motor de templates). O smoke test compara os três blocos entre
os arquivos e falha se alguém mudar o telefone só num deles.

`public/` é o diretório de saída padrão do Vercel (pinado em `vercel.json`).
Ficam de fora do que é publicado: `node_modules`, `scripts/`, `package.json`
e os arquivos de configuração.

## Painel do estoque

A equipe da loja cadastra carros e marca vendidos em **`/admin/`**, sem GitHub e
sem mexer em código. A configuração (variáveis de ambiente, token do GitHub) e as
considerações de segurança estão em **[ADMIN.md](ADMIN.md)**.

## Tarefas do dia a dia

### Cadastrar ou vender um carro

Pelo painel: **[/admin/](ADMIN.md)** — inclusive colando o texto do anúncio
pronto, que preenche o formulário sozinho. Direto no repositório: edite
**`data/vehicles.json`** — `npm run data` valida e regenera o arquivo que o site
consome. Não é preciso mexer em nenhum outro lugar: contadores das abas, filtro
de marca, ordenação, sitemap e dados estruturados do Google se ajustam sozinhos
no build.

Ao vender, prefira marcar `sold: true` em vez de apagar o carro — ele continua
aparecendo como VENDIDO por um tempo, o que gera contato de quem procura algo
parecido. Depois pode remover.

### Trocar telefone, endereço ou domínio

Edite **`js/config.js`**. O número aparece também em `index.html` e
`veiculos.html` como texto de fallback para quem abre o site sem JavaScript
(procure por `fallback sem JS`) — atualize os três.

### Mudar quantos carros a home mostra

O `data-limit` do grid em `index.html`. Não há mais nada a mexer: a ordem é a
mesma de "Destaques" (marcados primeiro, depois com selo, depois os mais novos)
e os vendidos ficam de fora.

### Trocar o logo

Substitua `assets/logo-autobayer.png` e rode:

```bash
npm run images
```

Isso regenera o WebP leve e a imagem de compartilhamento (`og-autobayer.jpg`).

### Formatar o código e rodar os testes

```bash
npm run format
npm test             # unitários: site + painel + consistência de CSS
npm run test:build   # faz o build e testa o public/ que vai para produção
npm run test:e2e     # Chromium de verdade contra o public/ (pega o que o jsdom não vê)
```

## Pendências de lançamento

- [ ] Trocar o telefone/WhatsApp placeholder (`5511999990000`) em `js/config.js`
- [ ] Preencher o endereço real em `js/config.js` e no JSON-LD de `index.html`
- [ ] Registrar o domínio próprio e trocar **uma linha**: `siteUrl` em
      `js/config.js` (o build propaga para canonical, OG, robots e sitemap)
- [ ] Substituir as fotos do Unsplash pelas fotos reais do estoque
      (pelo painel, em `/admin/` — elas já saem comprimidas em WebP)
- [ ] Preencher `ga4Id` em `js/config.js` para ligar o Google Analytics
- [ ] Cadastrar o site no Google Search Console e enviar o `sitemap.xml`
- [ ] Configurar as variáveis de ambiente do painel — ver [ADMIN.md](ADMIN.md)

## Eventos de analytics já instrumentados

Com `ga4Id` configurado vão para o GA4; sem ele, para o `dataLayer` (GTM):

| Evento            | Quando                                      |
| ----------------- | ------------------------------------------- |
| `view_vehicle`    | abre os detalhes de um veículo              |
| `click_whatsapp`  | clica em qualquer CTA de WhatsApp           |
| `filter_type`     | filtra por tipo de veículo                  |
| `add_favorite`    | favorita um veículo                         |
| `remove_favorite` | desfavorita um veículo                      |
| `deep_link_morto` | link compartilhado de carro fora do estoque |
