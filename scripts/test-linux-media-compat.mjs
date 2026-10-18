import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./linux-media-compat.js', import.meta.url), 'utf8')
function fixture(platform = 'Linux') {
  let reads = 0
  const revoked = []
  class Media {
    _src = ''
    plays = 0
    get src() { return this._src }
    set src(value) { this._src = value }
    get currentSrc() { return this._src }
    load() {}
    removeAttribute(name) { if (name === 'src') this._src = '' }
    play() {
      this.plays++
      return this.src.startsWith('blob:') ? Promise.resolve() : Promise.reject(new DOMException('unsupported', 'NotSupportedError'))
    }
  }
  const original = Media.prototype.play
  vm.runInNewContext(source, {
    navigator: { userAgent: platform }, HTMLMediaElement: Media, AbortController, DOMException,
    fetch: async () => { reads++; return { ok: true, blob: async () => ({}) } },
    URL: { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) },
  })
  return { Media, original, revoked, reads: () => reads }
}
const linux = fixture()
const media = new linux.Media()
media.src = 'asset://localhost/test.wav'
await media.play()
assert.equal(media.src, 'blob:preview')
assert.equal(media.plays, 2)
assert.equal(linux.reads(), 1)
await media.play()
assert.equal(linux.reads(), 1)
media.removeAttribute('src')
assert.deepEqual(linux.revoked, ['blob:preview'])
const remote = new linux.Media()
remote.src = 'https://example.com/test.wav'
await assert.rejects(remote.play(), { name: 'NotSupportedError' })
assert.equal(linux.reads(), 1)
const other = fixture('Windows')
assert.equal(other.Media.prototype.play, other.original)
console.log('PASS: Linux asset fallback, reuse, URL cleanup, HTTP failure and non-Linux isolation')
