// Rebuild both portal icon sets from the shared vector brand mark.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(path.join(root, 'packages/shared/src/assets/vivaai-icon.svg'));
const sizes = [16, 32, 48, 64];
const images = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...images]);
const apple = await sharp(svg).resize(180, 180).png().toBuffer();
for (const portal of ['student-web', 'faculty-web']) {
  const app = path.join(root, 'apps', portal, 'src/app');
  await writeFile(path.join(app, 'favicon.ico'), ico);
  await writeFile(path.join(app, 'icon.svg'), svg);
  await writeFile(path.join(app, 'apple-icon.png'), apple);
  // App metadata owns /favicon.ico; a duplicate public route causes conflicts.
  await unlink(path.join(root, 'apps', portal, 'public/favicon.ico')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}
console.log('Generated matching SVG, multi-size ICO, and Apple icons for both portals.');
