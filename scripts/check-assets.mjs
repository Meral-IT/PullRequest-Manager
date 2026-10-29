import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(path.join(root, file))
const config = yaml.load(read('electron-builder.yml').toString())
const iconDirectory = config.directories.buildResources
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')

function checkPng(data, size) {
  assert.deepEqual(data.subarray(0, 8), pngSignature)
  assert.equal(data.toString('ascii', 12, 16), 'IHDR')
  assert.equal(data.readUInt32BE(16), size)
  assert.equal(data.readUInt32BE(20), size)
}

checkPng(read('resources/icon.png'), 1024)
assert.match(read(`${iconDirectory}/icon.svg`).toString(), /viewBox="0 0 1024 1024"/)

const ico = read(`${iconDirectory}/icon.ico`)
assert.equal(ico.readUInt32LE(0), 0x00010000)
const icoSizes = []
for (let index = 0; index < ico.readUInt16LE(4); index++) {
  const entry = 6 + index * 16
  const size = ico[entry] || 256
  assert.equal(ico[entry + 1] || 256, size)
  assert.equal(ico.readUInt16LE(entry + 6), 32)
  const length = ico.readUInt32LE(entry + 8)
  const offset = ico.readUInt32LE(entry + 12)
  assert.ok(offset + length <= ico.length)
  checkPng(ico.subarray(offset, offset + length), size)
  icoSizes.push(size)
}
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256])

const icns = read(`${iconDirectory}/icon.icns`)
assert.equal(icns.toString('ascii', 0, 4), 'icns')
assert.equal(icns.readUInt32BE(4), icns.length)
const icnsSizes = new Set()
let offset = 8
while (offset < icns.length) {
  const type = icns.toString('ascii', offset, offset + 4)
  const length = icns.readUInt32BE(offset + 4)
  assert.ok(length > 8 && offset + length <= icns.length)
  icnsSizes.add(type)
  offset += length
}
assert.equal(offset, icns.length)
for (const type of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) {
  assert.ok(icnsSizes.has(type), `Missing macOS icon representation: ${type}`)
}

assert.equal(config.win.icon, `${iconDirectory}/icon.ico`)
assert.equal(config.win.target, 'nsis')
assert.equal(config.nsis.installerIcon, config.win.icon)
assert.equal(config.nsis.uninstallerIcon, config.win.icon)
assert.equal(config.mac.icon, `${iconDirectory}/icon.icns`)
assert.equal(config.dmg.icon, config.mac.icon)
assert.ok(read('lib/main/main.ts').toString().includes(`setAppUserModelId('${config.appId}')`))
assert.ok(read('lib/main/app.ts').toString().includes('@/resources/icon.png?asset'))
assert.match(read('lib/main/app.ts').toString(), /icon: appIcon/)
assert.ok(read('app/renderer.tsx').toString().includes('@/resources/build/icon.svg'))
assert.match(read('app/index.html').toString(), /<title>PullRequest-Manager<\/title>/)

console.log('App assets and installer icon configuration passed.')
