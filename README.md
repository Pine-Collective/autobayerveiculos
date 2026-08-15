# Autobayer Veículos

Site institucional e catálogo de estoque. Site estático — HTML, CSS e JavaScript
puro, sem framework. O build só gera assets derivados (sitemap, imagens) e copia
os arquivos para `public/`; não há bundler nem transpilação.

## Rodando localmente

```bash
npm install      # só na primeira vez (Prettier + gerador de imagens)
npm run dev      # abre em http://localhost:3000
```

Também funciona abrindo `index.html` direto no navegador: os dados do estoque são
carregados por `<script>`, não por `fetch`, justamente para não depender de servidor.

## Estrutura

```
index.html              única página do site
data/vehicles.json      o estoque — fonte da verdade
css/styles.css          estilos (seções numeradas no topo do arquivo)
js/config.js            telefone, WhatsApp, endereço, domínio, ID do GA4
js/app.js               catálogo, filtros, modal, favoritos
js/vehicles.js          GERADO a partir do JSON — fora do Git
admin/                  painel do estoque (ver ADMIN.md)
api/                    funções serverless que gravam no GitHub
lib/vehicle-schema.mjs  validação, usada pelo build e pela API
assets/                 logo, favicon, imagem de compartilhamento
scripts/                build, geradores e testes
public/                 saída do build (gerada; fora do Git)
```

## Publicação

O deploy é automático a cada push na `main`.

```bash
npm run build       # gera sitemap + imagens e monta public/
npm run test:build  # faz o build e roda os testes contra public/
```

`public/` é o diretório de saída padrão do Vercel, Netlify e Cloudflare Pages —
não é preciso configurar nada no painel. Ficam de fora do que é publicado:
`node_modules`, `scripts/`, `package.json` e os arquivos de configuração.

Se algum dia o build for removido, lembre de apontar o Output Directory do
provedor para a raiz do projeto.

## Painel do estoque

A equipe da loja cadastra carros e marca vendidos em **`/admin/`**, sem GitHub e
sem mexer em código. A configuração (variáveis de ambiente, token do GitHub) e as
considerações de segurança estão em **[ADMIN.md](ADMIN.md)**.

## Tarefas do dia a dia

### Cadastrar ou vender um carro

Pelo painel: **[/admin/](ADMIN.md)**. Direto no repositório: edite
**`data/vehicles.json`** — `npm run data` valida e regenera o arquivo que o site
consome. Não é preciso mexer em nenhum outro lugar: contadores das abas, filtro
de marca, ordenação, sitemap e dados estruturados do Google se ajustam sozinhos
no build.

Ao vender, prefira marcar `sold: true` em vez de apagar o carro — ele continua
aparecendo como VENDIDO por um tempo, o que gera contato de quem procura algo
parecido. Depois pode remover.

### Trocar telefone, endereço ou domínio

Edite **`js/config.js`**. O número aparece também em `index.html` como texto de
fallback para quem abre o site sem JavaScript (procure por `fallback sem JS`) —
atualize os dois.

### Trocar o logo

Substitua `assets/logo-autobayer.png` e rode:

```bash
npm run images
```

Isso regenera o WebP leve e a imagem de compartilhamento (`og-autobayer.jpg`).

### Formatar o código e rodar os testes

```bash
npm run format
npm test             # 153 verificações: 75 do site + 78 do painel
npm run test:build   # faz o build e testa o public/ que vai para produção
```

## Antes de publicar

- [ ] Trocar o telefone/WhatsApp placeholder (`5511999990000`) em `js/config.js`
- [ ] Preencher o endereço real em `js/config.js` e no JSON-LD de `index.html`
- [ ] Trocar o domínio (`siteUrl` em `config.js`, `canonical` + Open Graph em
      `index.html`, `robots.txt`) e rodar `npm run sitemap`
- [ ] Substituir as fotos do Unsplash pelas fotos reais do estoque
      (agora dá para fazer pelo painel, em `/admin/`)
- [ ] Preencher `ga4Id` em `js/config.js` para ligar o Google Analytics
- [ ] Cadastrar o site no Google Search Console e enviar o `sitemap.xml`
- [ ] Configurar as variáveis de ambiente do painel — ver [ADMIN.md](ADMIN.md)

## Eventos de analytics já instrumentados

Disparam para `dataLayer` e para o GA4 quando `ga4Id` estiver configurado:

| Evento            | Quando                            |
| ----------------- | --------------------------------- |
| `view_vehicle`    | abre os detalhes de um veículo    |
| `click_whatsapp`  | clica em qualquer CTA de WhatsApp |
| `filter_type`     | filtra por tipo de veículo        |
| `add_favorite`    | favorita um veículo               |
| `remove_favorite` | desfavorita um veículo            |
