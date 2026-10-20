/**
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * TeamsLogic: render every branded image from the two icon masters in brand/.
 *
 * Writes upstream's file names (img/talk-icon-*.svg, img/talk-logo*.svg, img/icons/*, the WiX,
 * Squirrel and DMG images), so the code that uses them stays as upstream has it. Replaces
 * `npm run generate-icons` in this fork: Windows icons use the small glyph up to 32 px, as the
 * other Aegean Office apps do.
 *
 * Usage: npm run generate-branding
 */

const icongen = require('icon-gen')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const IMG = path.join(ROOT, 'img')
const ICONS = path.join(IMG, 'icons')

const INK = '#0A2A3B'
const SEA = '#12718C'
const AQUA = '#2FC6C0'
const FONT = '"Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif'

/**
 * Inner markup of an SVG file, without its outer element and comments
 *
 * @param {string} file - SVG file path
 */
async function svgBody(file) {
	const text = await fs.readFile(file, 'utf-8')
	return text.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim()
}

/**
 * Monochrome glyph (no tile) in a 512 box: the bubble, its header band, the T and its node
 *
 * @param {string} color - Fill and stroke colour
 */
function plainGlyph(color) {
	const bubble = 'M80 56 H432 A40 40 0 0 1 472 96 V340 A40 40 0 0 1 432 380 H232 L112 468 L136 380 H80 A40 40 0 0 1 40 340 V96 A40 40 0 0 1 80 56 Z'
	return `<path d="${bubble}" fill="none" stroke="${color}" stroke-width="40" stroke-linejoin="round"/>`
		+ `<path d="M40 96 A40 40 0 0 1 80 56 H432 A40 40 0 0 1 472 96 V136 H40 Z" fill="${color}"/>`
		+ `<path d="M160 232 H352 M256 232 V324" fill="none" stroke="${color}" stroke-width="52" stroke-linecap="round"/>`
		+ `<circle cx="352" cy="232" r="44" fill="${color}"/>`
}

const svg = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${body}\n</svg>\n`
const scaled = (body, scale, size = 512) => `<g transform="translate(${size * (1 - scale) / 2} ${size * (1 - scale) / 2}) scale(${scale})">${body}</g>`

/**
 * PNG buffer of an SVG string at a square size
 *
 * @param {string} text - SVG
 * @param {number} size - Size in pixels
 */
function png(text, size) {
	return sharp(Buffer.from(text), { density: 72 * Math.max(1, size / 128) }).resize(size, size).png().toBuffer()
}

/**
 * Write an ICO: 32-bit DIB entries below 256 px, PNG at 256
 *
 * @param {string} file - Output path
 * @param {number[]} sizes - Icon sizes
 * @param {(size: number) => string} source - SVG for a size
 */
async function writeIco(file, sizes, source) {
	const images = []
	for (const size of sizes) {
		if (size >= 256) {
			images.push({ size, data: await png(source(size), size) })
			continue
		}
		const { data } = await sharp(await png(source(size), size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
		const maskRow = Math.ceil(size / 32) * 4
		const dib = Buffer.alloc(40 + size * size * 4 + maskRow * size)
		dib.writeUInt32LE(40, 0)
		dib.writeInt32LE(size, 4)
		dib.writeInt32LE(size * 2, 8)
		dib.writeUInt16LE(1, 12)
		dib.writeUInt16LE(32, 14)
		dib.writeUInt32LE(size * size * 4 + maskRow * size, 20)
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const src = ((size - 1 - y) * size + x) * 4
				const dst = 40 + (y * size + x) * 4
				dib[dst] = data[src + 2]
				dib[dst + 1] = data[src + 1]
				dib[dst + 2] = data[src]
				dib[dst + 3] = data[src + 3]
			}
		}
		images.push({ size, data: dib })
	}
	const header = Buffer.alloc(6 + 16 * images.length)
	header.writeUInt16LE(1, 2)
	header.writeUInt16LE(images.length, 4)
	let offset = header.length
	images.forEach(({ size, data }, i) => {
		const entry = 6 + 16 * i
		header[entry] = size >= 256 ? 0 : size
		header[entry + 1] = size >= 256 ? 0 : size
		header.writeUInt16LE(1, entry + 4)
		header.writeUInt16LE(32, entry + 6)
		header.writeUInt32LE(data.length, entry + 8)
		header.writeUInt32LE(offset, entry + 12)
		offset += data.length
	})
	await fs.writeFile(file, Buffer.concat([header, ...images.map(({ data }) => data)]))
}

/**
 * Write a 24-bit BMP (the WiX dialog images) from an SVG
 *
 * @param {string} file - Output path
 * @param {string} text - SVG
 * @param {number} width - Width in pixels
 * @param {number} height - Height in pixels
 */
async function writeBmp(file, text, width, height) {
	const { data } = await sharp(Buffer.from(text)).resize(width, height).flatten({ background: '#FFFFFF' }).raw().toBuffer({ resolveWithObject: true })
	const row = Math.ceil(width * 3 / 4) * 4
	const bmp = Buffer.alloc(54 + row * height)
	bmp.write('BM', 0)
	bmp.writeUInt32LE(bmp.length, 2)
	bmp.writeUInt32LE(54, 10)
	bmp.writeUInt32LE(40, 14)
	bmp.writeInt32LE(width, 18)
	bmp.writeInt32LE(height, 22)
	bmp.writeUInt16LE(1, 26)
	bmp.writeUInt16LE(24, 28)
	bmp.writeUInt32LE(row * height, 34)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const src = ((height - 1 - y) * width + x) * 3
			const dst = 54 + y * row + x * 3
			bmp[dst] = data[src + 2]
			bmp[dst + 1] = data[src + 1]
			bmp[dst + 2] = data[src]
		}
	}
	await fs.writeFile(file, bmp)
}

/**
 * Write name.png at sizes[0] and name@2x.png at sizes[1]
 *
 * @param {string} name - File name without extension
 * @param {number[]} sizes - One or two sizes
 * @param {string} source - SVG
 */
async function writePngs(name, sizes, source) {
	await fs.writeFile(path.join(ICONS, `${name}.png`), await png(source, sizes[0]))
	if (sizes[1]) {
		await fs.writeFile(path.join(ICONS, `${name}@2x.png`), await png(source, sizes[1]))
	}
}

/**
 * Render everything
 */
async function generateBranding() {
	const main = await svgBody(path.join(ROOT, 'brand/teamslogic.svg'))
	const small = await svgBody(path.join(ROOT, 'brand/teamslogic-small.svg'))
	const gradient = `<defs><linearGradient id="brand" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${INK}"/><stop offset="1" stop-color="${SEA}"/></linearGradient></defs>`
	const text = (x, y, size, content, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" font-family='${FONT}' font-size="${size}" fill="#FFFFFF" ${extra}>${content}</text>`

	// --- SVG variants, under upstream's names ---

	const rounded = svg('0 0 512 512', main)
	const roundedSmall = svg('0 0 512 512', small)
	const mac = svg('0 0 1024 1024', '<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/></filter></defs>'
		+ `<g filter="url(#shadow)"><g transform="translate(100 100) scale(1.609375)">${main}</g></g>`)
	// Splash logo: the icon over the name, white text for the brand gradient
	const logo = (width, height, pad) => svg(`0 0 ${width} ${height}`, `<g transform="translate(${(width - 88) / 2} ${pad}) scale(0.171875)">${main}</g>`
		+ text(width / 2, pad + 128, 30, 'TeamsLogic', 'font-weight="600"'))

	const files = {
		'talk-icon-rounded.svg': rounded,
		'talk-icon-square.svg': svg('0 0 512 512', main.replace('rx="112"', 'rx="0"')),
		'talk-icon-rounded-spaced.svg': svg('0 0 512 512', scaled(main, 0.875)),
		'talk-icon-mac.svg': svg('0 0 1024 1024', `<g transform="translate(100 100) scale(1.609375)">${main}</g>`),
		'talk-icon-mac-shadow.svg': mac,
		'talk-icon-plain-light.svg': svg('0 0 512 512', plainGlyph('#000000')),
		'talk-icon-plain-dark.svg': svg('0 0 512 512', plainGlyph('#FFFFFF')),
		'talk-icon-plain-spaced-light.svg': svg('0 0 512 512', scaled(plainGlyph('#000000'), 0.875)),
		'talk-icon-plain-spaced-dark.svg': svg('0 0 512 512', scaled(plainGlyph('#FFFFFF'), 0.875)),
		'talk-logo.svg': logo(224, 146, 0),
		'talk-logo-spaced.svg': logo(224, 176, 15),
		// The login window's logo, white on the plain background
		'server-logo-plain.svg': svg('0 0 256 128', `<g transform="translate(64 0) scale(0.25)">${plainGlyph('#FFFFFF')}</g>`),
	}
	for (const [name, content] of Object.entries(files)) {
		await fs.writeFile(path.join(IMG, name), content)
	}

	// --- App and tray icons ---

	await fs.rm(ICONS, { recursive: true, force: true })
	await fs.mkdir(ICONS)

	const WINDOWS_ICON_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
	const WINDOWS_TRAY_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64]
	const bySize = (size) => (size <= 32 ? roundedSmall : rounded)

	await writeIco(path.join(ICONS, 'icon.ico'), WINDOWS_ICON_SIZES, bySize)
	await writeIco(path.join(ICONS, 'IconTrayWin32.ico'), WINDOWS_TRAY_ICON_SIZES, bySize)
	await writeIco(path.join(ICONS, 'IconTrayWin32Light.ico'), WINDOWS_ICON_SIZES, () => files['talk-icon-plain-spaced-light.svg'])
	await writeIco(path.join(ICONS, 'IconTrayWin32Dark.ico'), WINDOWS_ICON_SIZES, () => files['talk-icon-plain-spaced-dark.svg'])

	await writePngs('icon', [512], files['talk-icon-rounded-spaced.svg'])
	await writePngs('IconTrayLinux', [32], svg('0 0 512 512', scaled(small, 0.875)))
	await writePngs('IconTrayLinuxLight', [32], files['talk-icon-plain-spaced-light.svg'])
	await writePngs('IconTrayLinuxDark', [32], files['talk-icon-plain-spaced-dark.svg'])
	await writePngs('IconTrayMac', [16, 32], roundedSmall)
	await writePngs('IconTrayMacTemplate', [16, 32], files['talk-icon-plain-light.svg'])

	// macOS .icns through icon-gen, from a temporary SVG
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'teamslogic-'))
	await fs.writeFile(path.join(tmp, 'mac.svg'), mac)
	await icongen(path.join(tmp, 'mac.svg'), ICONS, { report: false, icns: { name: 'icon', sizes: [16, 32, 64, 128, 256, 512, 1024] } })
	await fs.rm(tmp, { recursive: true, force: true })

	// --- Installer images ---

	// WiX dialog background (493x312): the brand panel on the left, white on the right
	await writeBmp(path.join(IMG, 'wix-background.bmp'), svg('0 0 493 312', gradient
	+ '<rect width="493" height="312" fill="#FFFFFF"/><rect width="164" height="312" fill="url(#brand)"/>'
	+ `<g transform="translate(46 36) scale(0.140625)">${main}</g>`
	+ text(82, 134, 17, 'TeamsLogic', 'font-weight="600"')
	+ text(82, 296, 10, 'Aegean Logic', 'fill-opacity="0.75"')), 493, 312)
	// WiX banner (493x58): white with the icon on the right
	await writeBmp(path.join(IMG, 'wix-banner.bmp'), svg('0 0 493 58', '<rect width="493" height="58" fill="#FFFFFF"/>'
	+ `<g transform="translate(441 7) scale(0.0859375)">${main}</g>`), 493, 58)

	// Squirrel.Windows install splash (312x504)
	const splash = svg('0 0 312 504', gradient + '<rect width="312" height="504" fill="url(#brand)"/>'
		+ `<g transform="translate(96 100) scale(0.234375)">${main}</g>`
		+ text(156, 270, 30, 'TeamsLogic', 'font-weight="600"')
		+ text(156, 300, 13, 'Aegean Logic', 'fill-opacity="0.75"')
		+ text(156, 488, 14, 'Installing'))
	await sharp(Buffer.from(splash)).resize(312, 504).gif().toFile(path.join(IMG, 'squirrel-install-loading.gif'))

	// macOS DMG background (658x498 and @2x): the app on the left, Applications on the right
	const dmg = svg('0 0 658 498', gradient + '<rect width="658" height="498" fill="url(#brand)"/>'
		+ '<rect x="129" y="295" width="126" height="124" rx="10" fill="#FFFFFF" fill-opacity="0.18"/>'
		+ '<rect x="385" y="295" width="126" height="124" rx="10" fill="#FFFFFF" fill-opacity="0.18"/>'
		+ `<path d="M309 333 L331 357 L309 381" fill="none" stroke="${AQUA}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
		+ text(329, 150, 40, 'TeamsLogic', 'font-weight="600"')
		+ text(329, 186, 17, 'Aegean Logic', 'fill-opacity="0.75"'))
	await sharp(Buffer.from(dmg)).resize(658, 498).png().toFile(path.join(IMG, 'dmg-background.png'))
	await sharp(Buffer.from(dmg), { density: 144 }).resize(1316, 996).png().toFile(path.join(IMG, 'dmg-background@2x.png'))
}

generateBranding()
	.then(() => console.log('✅ Done'))
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
