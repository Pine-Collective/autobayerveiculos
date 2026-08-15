/**
 * Configuração central da Autobayer Veículos.
 *
 * ESTE É O ÚNICO LUGAR para alterar telefone, WhatsApp, endereço e domínio.
 * Ao mudar algo aqui, atualize também o texto de fallback em index.html
 * (marcado com o comentário "fallback sem JS") para quem abre o site sem
 * JavaScript e para os buscadores.
 */
window.AUTOBAYER_CONFIG = {
  // TODO: trocar pelos dados reais antes de publicar.
  nome: 'Autobayer Veículos',

  // Somente dígitos, com DDI + DDD. Usado para montar os links do WhatsApp.
  whatsapp: '5511999990000',

  // Formatado para exibição ao usuário.
  telefoneExibicao: '(11) 99999-0000',

  // Usado em tel: (link clicável no celular).
  telefoneLink: '+5511999990000',

  atendimento: 'Seg–Sex, 8h às 18h',

  endereco: {
    rua: 'Av. Exemplo, 1000',
    bairro: 'Centro',
    cidade: 'São Paulo',
    estado: 'SP',
    cep: '01000-000',
    pais: 'BR'
  },

  // Domínio público do site — fonte ÚNICA: o build injeta este valor no
  // canonical, Open Graph, JSON-LD, robots.txt e sitemap.xml.
  // Quando o domínio próprio for registrado, basta trocar esta linha.
  siteUrl: 'https://autobayerveiculos.vercel.app',

  // ID de medição do Google Analytics 4 (formato G-XXXXXXXXXX).
  // Deixe vazio para manter o analytics desligado.
  ga4Id: '',

  /** Mensagem padrão ao clicar no WhatsApp sem um veículo específico. */
  mensagemPadrao: 'Olá! Vi o catálogo da Autobayer e quero encontrar meu próximo carro.'
};
