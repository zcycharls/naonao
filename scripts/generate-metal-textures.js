const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const outDir = path.resolve(__dirname, '..', 'app', 'assets')
fs.mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let crc = ~0
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function png(width, height, rgba) {
  const scanline = width * 4 + 1
  const raw = Buffer.alloc(scanline * height)
  for (let y = 0; y < height; y++) {
    raw[y * scanline] = 0
    rgba.copy(raw, y * scanline + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function rng(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function makeTexture(name, opts) {
  const size = 1024
  const rand = rng(opts.seed)
  const row = Array.from({ length: size }, (_, y) => {
    const grain = (rand() - 0.5) * opts.rowNoise
    const band = Math.sin(y * opts.bandScale + opts.phase) * opts.bandStrength
    const fine = Math.sin(y * 0.91 + opts.phase * 2) * opts.fineStrength
    return grain + band + fine
  })
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const xSpec = Math.sin((x / size) * Math.PI * 2 + opts.phase) * opts.xSpec
      const diagonal = Math.sin((x + y * 0.35) * 0.018 + opts.phase) * opts.diagonal
      const scratch = ((x + y * 13) % opts.scratchEvery === 0) ? opts.scratch : 0
      const pixel = (rand() - 0.5) * opts.pixelNoise
      const shade = row[y] + xSpec + diagonal + scratch + pixel
      rgba[i] = clamp(opts.base[0] + shade * opts.tint[0])
      rgba[i + 1] = clamp(opts.base[1] + shade * opts.tint[1])
      rgba[i + 2] = clamp(opts.base[2] + shade * opts.tint[2])
      rgba[i + 3] = 255
    }
  }
  fs.writeFileSync(path.join(outDir, name), png(size, size, rgba))
}

makeTexture('metal-brushed-light.png', {
  seed: 1107,
  base: [184, 188, 181],
  tint: [1.06, 1.08, 1.0],
  rowNoise: 26,
  bandScale: 0.036,
  bandStrength: 16,
  fineStrength: 5,
  xSpec: 12,
  diagonal: 4,
  scratchEvery: 263,
  scratch: 25,
  pixelNoise: 8,
  phase: 0.4,
})

makeTexture('metal-brushed-dark.png', {
  seed: 2107,
  base: [39, 42, 38],
  tint: [0.7, 0.74, 0.66],
  rowNoise: 18,
  bandScale: 0.041,
  bandStrength: 11,
  fineStrength: 4,
  xSpec: 8,
  diagonal: 3,
  scratchEvery: 311,
  scratch: 18,
  pixelNoise: 7,
  phase: 1.6,
})

makeTexture('metal-brushed-button.png', {
  seed: 3107,
  base: [178, 181, 172],
  tint: [0.95, 0.98, 0.9],
  rowNoise: 22,
  bandScale: 0.052,
  bandStrength: 18,
  fineStrength: 6,
  xSpec: 16,
  diagonal: 4,
  scratchEvery: 229,
  scratch: 22,
  pixelNoise: 9,
  phase: 2.4,
})

makeTexture('metal-brushed-copper.png', {
  seed: 4107,
  base: [168, 67, 28],
  tint: [1.08, 0.7, 0.46],
  rowNoise: 25,
  bandScale: 0.05,
  bandStrength: 19,
  fineStrength: 6,
  xSpec: 14,
  diagonal: 4,
  scratchEvery: 241,
  scratch: 24,
  pixelNoise: 9,
  phase: 3.1,
})
