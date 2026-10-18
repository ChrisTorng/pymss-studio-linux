// Linux packaging overlay: WebKitGTK cannot stream media from Tauri's asset:
// scheme (tauri-apps/tauri#8654). Fetch a Blob only when native playback fails.
// Keep normal HTTP/Blob playback unchanged and release owned URLs with the cache.
if (navigator.userAgent.includes('Linux')) {
  const proto = HTMLMediaElement.prototype
  const nativePlay = proto.play
  const nativeRemoveAttribute = proto.removeAttribute
  const src = Object.getOwnPropertyDescriptor(proto, 'src')
  const pending = new WeakMap()

  function release(media) {
    const entry = pending.get(media)
    if (!entry) return
    pending.delete(media)
    entry.controller.abort()
    if (entry.url) URL.revokeObjectURL(entry.url)
  }

  Object.defineProperty(proto, 'src', {
    ...src,
    set(value) {
      release(this)
      src.set.call(this, value)
    },
  })
  proto.removeAttribute = function (name) {
    if (String(name).toLowerCase() === 'src') release(this)
    return nativeRemoveAttribute.call(this, name)
  }
  proto.play = async function () {
    try {
      return await nativePlay.call(this)
    } catch (error) {
      const source = this.currentSrc || this.src
      if (error?.name !== 'NotSupportedError' || !/^(asset:|https?:\/\/asset\.localhost\/)/.test(source)) throw error
      let entry = pending.get(this)
      if (!entry) {
        entry = { controller: new AbortController(), url: '', promise: null }
        pending.set(this, entry)
        entry.promise = (async () => {
          const response = await fetch(source, { signal: entry.controller.signal })
          if (!response.ok) throw new Error(`Audio preview read failed: ${response.status}`)
          const blob = await response.blob()
          if (pending.get(this) !== entry) throw new DOMException('Preview released', 'AbortError')
          entry.url = URL.createObjectURL(blob)
          src.set.call(this, entry.url)
          this.load()
        })()
        entry.promise.catch(() => {})
      }
      try {
        await entry.promise
        return await nativePlay.call(this)
      } catch (failure) {
        release(this)
        throw failure
      }
    }
  }
}
