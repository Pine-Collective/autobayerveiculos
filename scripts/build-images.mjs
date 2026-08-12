/**
 * Gera os assets de imagem derivados:
 *   - assets/og-autobayer.jpg    prévia 1200x630 usada ao compartilhar o link
 *   - assets/logo-autobayer.webp versão leve do logo (fallback PNG continua)
 *
 * Rode após trocar o logo:  npm run images
 */
import sharp from 'sharp';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = join(root, 'assets/logo-autobayer.png');
const kb = (file) => `${(statSync(file).size / 1024).toFixed(1)} KB`;

/* ------------------------------------------------------------------ */
/* 1. Imagem de Open Graph                                             */
/* ------------------------------------------------------------------ */

const WIDTH = 1200;
const HEIGHT = 630;

const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="78%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#2a2d33" />
      <stop offset="42%" stop-color="#111318" />
      <stop offset="100%" stop-color="#090a0c" />
    </radialGradient>
    <radialGradient id="redGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d21f2b" stop-opacity="0.22" />
      <stop offset="55%" stop-color="#d21f2b" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#d21f2b" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)" />
  <ellipse cx="890" cy="300" rx="360" ry="250" fill="url(#redGlow)" />

  <rect x="90" y="300" width="46" height="4" fill="#d21f2b" />
  <text x="152" y="308" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="19" font-weight="700" letter-spacing="4" fill="#a7a9ad">
    O SEU PRÓXIMO CARRO ESTÁ AQUI
  </text>

  <text x="90" y="392" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="66" font-weight="700" letter-spacing="-1" fill="#f3f3f1">
    Escolha seu
  </text>
  <text x="90" y="462" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="66" font-weight="700" letter-spacing="-1" fill="#d21f2b">
    próximo destino.
  </text>

  <text x="90" y="524" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="23" font-weight="400" fill="#9b9da2">
    Seminovos revisados · Procedência garantida · São Paulo, SP
  </text>

  <rect x="0" y="${HEIGHT - 8}" width="${WIDTH}" height="8" fill="#d21f2b" />
</svg>`);

const logo = await sharp(logoPath).resize({ width: 360 }).toBuffer();

const ogPath = join(root, 'assets/og-autobayer.jpg');
await sharp(background)
  .composite([{ input: logo, top: 92, left: 90 }])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(ogPath);

console.log(`assets/og-autobayer.jpg  ${WIDTH}x${HEIGHT}  ${kb(ogPath)}`);

/* ------------------------------------------------------------------ */
/* 2. Logo em WebP                                                     */
/* ------------------------------------------------------------------ */

const webpPath = join(root, 'assets/logo-autobayer.webp');
await sharp(logoPath).webp({ quality: 90, effort: 6 }).toFile(webpPath);

console.log(`assets/logo-autobayer.webp                ${kb(webpPath)}`);
console.log(`assets/logo-autobayer.png  (original)     ${kb(logoPath)}`);

/* ------------------------------------------------------------------ */
/* 3. Ícone para iOS (o iOS não aceita SVG em apple-touch-icon)         */
/* ------------------------------------------------------------------ */

const touchIconPath = join(root, 'assets/apple-touch-icon.png');
await sharp(join(root, 'assets/favicon.svg'), { density: 384 })
  .resize(180, 180)
  .png({ compressionLevel: 9 })
  .toFile(touchIconPath);

console.log(`assets/apple-touch-icon.png  180x180       ${kb(touchIconPath)}`);
