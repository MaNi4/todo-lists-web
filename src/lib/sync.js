// One sync round with the file on GitHub, as bin/todo-lists does it: fetch,
// merge, and push when either side has something new. GitHub refuses a push
// made over a file changed meanwhile (its sha), and the round starts again.

import * as C from "./crypto.js"
import { tidy, merge, prune, same } from "./model.js"

// ctx: {model, dek, macKey, gh, dirty, etag, saveLocal()}; returns {dirty,
// etag, changed: whether the lists here changed}.
export async function syncRound(ctx) {
  const { model, dek, macKey, gh } = ctx
  let { dirty, etag } = ctx
  let changed = false
  for (let round = 0; round < 4; round++) {
    const got = await gh.fetchFile(etag)
    if (got.status === 304 && !dirty) break
    if (got.status === 304) { etag = null; continue }
    let sha = null
    if (got.status === 200) {
      C.checkEnvelope(got.env)
      const remoteHeader = C.cleanHeader(got.env.header)
      const plain = await C.openEnvelope(got.env, dek)
      if (!plain) throw new Error("The file on GitHub holds other lists (another key)")
      const remote = tidy(plain)
      // Only a header signed with the data key is taken (or, from before
      // signing, one no newer than the header known here).
      if (!(await C.headerOk(macKey, remoteHeader, model.header)))
        throw new Error("The header of the file on GitHub was changed outside To-Do Lists; it is not used")
      // A master password or recovery key changed elsewhere: its header is newer.
      const headerChanged = remoteHeader.at > model.header.at
      if (headerChanged) model.header = remoteHeader
      const merged = merge(model.doc, remote)
      prune(merged, Date.now())
      const changedHere = !same(merged, model.doc)
      model.doc = merged
      // A lock changed elsewhere: keys here move along, and what they open
      // is sealed again.
      const healed = await model.settleKeys()
      if (changedHere || healed || headerChanged) {
        await ctx.saveLocal()
        changed = true
      }
      if (same(model.doc, remote) && same(C.unsigned(model.header), C.unsigned(remoteHeader)) && remoteHeader.mac) {
        etag = got.etag
        dirty = false
        break
      }
      sha = got.sha
    }
    const pushed = C.canonical([model.doc, C.unsigned(model.header)])
    const put = await gh.putFile(await C.envelope(model.doc, dek, model.header, macKey), sha)
    if (put.status === 200 || put.status === 201) {
      etag = null
      if (C.canonical([model.doc, C.unsigned(model.header)]) === pushed) dirty = false
      break
    }
    // 409/422: changed there meanwhile; again.
  }
  return { dirty, etag, changed }
}
