import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const artwork = readFileSync(join(webRoot, 'app-icon.png'));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!artwork.subarray(0, 8).equals(pngSignature)) throw new Error('app-icon.png must be a PNG.');
const width = artwork.readUInt32BE(16);
const height = artwork.readUInt32BE(20);
if (width !== height || artwork[24] !== 8 || artwork[25] !== 6) {
    throw new Error('app-icon.png must be square, 8-bit RGBA.');
}

// Framing is deterministic: the brand artwork is not regenerated or repainted.
// The current master has roughly 1.6% empty space around its straight edges.
const crop = Math.round(width * 0.016);
const croppedSize = width - crop * 2;
const canvasSize = 1024;
const profiles = [
    { name: 'windows', tileSize: 1024 },
    // A project-specific starting point for Dock balance, not an Apple mandate.
    { name: 'macos', tileSize: 824 },
];
const tempParent = resolve(tmpdir());
const scratch = mkdtempSync(join(tempParent, 'storyark-icons-'));
const iconRoot = join(webRoot, 'src-tauri', 'icons');
const macIconRoot = join(iconRoot, 'macos');

function runIconCommand(input, output, pngOnly = false) {
    const args = [tauriCli, 'icon', input, '--output', output];
    if (pngOnly) args.push('--png', String(canvasSize));
    const result = spawnSync(process.execPath, args, { cwd: webRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Tauri icon conversion failed (${result.status}).`);
}

function framedArtwork({ name, tileSize }) {
    const margin = (canvasSize - tileSize) / 2;
    const radius = tileSize * 0.18;
    // The vector contour clips stray outer pixels. An opaque underlay prevents
    // tiny alpha variations inside the generated artwork becoming visible holes.
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>StoryArk ${name} export frame</title>
  <defs><clipPath id="tile"><rect x="${margin}" y="${margin}" width="${tileSize}" height="${tileSize}" rx="${radius}"/></clipPath></defs>
  <g clip-path="url(#tile)">
    <rect x="${margin}" y="${margin}" width="${tileSize}" height="${tileSize}" fill="#DDF5EE"/>
    <svg x="${margin}" y="${margin}" width="${tileSize}" height="${tileSize}" viewBox="${crop} ${crop} ${croppedSize} ${croppedSize}">
      <image width="${width}" height="${height}" xlink:href="data:image/png;base64,${artwork.toString('base64')}"/>
    </svg>
  </g>
</svg>\n`;
}

function copyIcns(input, output) {
    const data = readFileSync(input);
    if (data.toString('ascii', 0, 4) !== 'icns' || data.readUInt32BE(4) !== data.length) {
        throw new Error('Invalid ICNS container.');
    }
    const layers = [];
    for (let offset = 8; offset < data.length;) {
        if (offset + 8 > data.length) throw new Error('Truncated ICNS layer header.');
        const length = data.readUInt32BE(offset + 4);
        if (length < 8 || offset + length > data.length) throw new Error('Invalid ICNS layer size.');
        layers.push(data.subarray(offset, offset + length));
        offset += length;
    }
    // Tauri's ICNS encoder may emit identical layers in a different order.
    // Sorting by their four-byte type makes regeneration stable in Git.
    layers.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
    writeFileSync(output, Buffer.concat([data.subarray(0, 8), ...layers]));
}

try {
    mkdirSync(iconRoot, { recursive: true });
    mkdirSync(macIconRoot, { recursive: true });
    for (const profile of profiles) {
        const wrapper = join(scratch, `${profile.name}.svg`);
        const sourceOutput = join(scratch, `${profile.name}-source`);
        const platformOutput = join(scratch, profile.name);
        writeFileSync(wrapper, framedArtwork(profile));
        runIconCommand(wrapper, sourceOutput, true);
        const sourceName = `app-icon.${profile.name}.png`;
        const sourcePath = join(webRoot, sourceName);
        copyFileSync(join(sourceOutput, '1024x1024.png'), sourcePath);
        runIconCommand(sourcePath, platformOutput);
        if (profile.name === 'windows') {
            // Only desktop files; mobile directories are not part of this project.
            for (const entry of readdirSync(platformOutput, { withFileTypes: true })) {
                if (entry.isFile() && !entry.name.endsWith('.icns')) {
                    copyFileSync(join(platformOutput, entry.name), join(iconRoot, entry.name));
                }
            }
        } else {
            copyIcns(join(platformOutput, 'icon.icns'), join(iconRoot, 'icon.icns'));
            for (const name of ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png']) {
                copyFileSync(join(platformOutput, name), join(macIconRoot, name));
            }
        }
        console.log(`Updated ${sourceName}: tile ${profile.tileSize}/${canvasSize}px.`);
    }
} finally {
    // Verify the recursive cleanup target stays in the explicitly selected temp
    // directory and has the prefix created by this script.
    if (dirname(resolve(scratch)) !== tempParent || !basename(scratch).startsWith('storyark-icons-')) {
        throw new Error('Refusing to remove an unexpected scratch directory.');
    }
    rmSync(scratch, { recursive: true, force: true });
}
