// node --test tests/ — syncing two devices through a fake GitHub that
// behaves like the real one: an ETag for "unchanged", a sha that a push
// must name, and 409 when the file changed meanwhile.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as C from "../src/lib/crypto.js"
import { Model, tidy } from "../src/lib/model.js"
import { syncRound } from "../src/lib/sync.js"

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plugin-v3.json", import.meta.url), "utf8"))

class FakeGitHub {
  constructor() { this.file = null; this.sha = null; this.n = 0; this.beforePut = null }
  async fetchFile(etag) {
    if (!this.file) return { status: 404 }
    if (etag && etag === this.sha) return { status: 304 }
    return { status: 200, env: JSON.parse(this.file), sha: this.sha, etag: this.sha }
  }
  async putFile(env, sha) {
    if (this.beforePut) { const f = this.beforePut; this.beforePut = null; await f() }
    if (this.file && sha !== this.sha) return { status: 409 }
    this.file = JSON.stringify(env)
    this.sha = "sha" + ++this.n
    return { status: this.n === 1 ? 201 : 200 }
  }
}

async function device(name) {
  const header = C.cleanHeader(structuredClone(fixture.env.header))
  const dek = await C.dekFromPassword(header, fixture.password)
  const doc = tidy(await C.openEnvelope(fixture.env, dek))
  return { model: new Model(doc, header, name), dek, macKey: await C.macKeyFrom(dek), dirty: true, etag: null, saves: 0 }
}

async function sync(d, gh) {
  const r = await syncRound({ model: d.model, dek: d.dek, macKey: d.macKey, gh, dirty: d.dirty, etag: d.etag, saveLocal: async () => { d.saves++ } })
  d.dirty = r.dirty
  d.etag = r.etag
  return r
}

const texts = async d => (await d.model.view())[0].items.map(x => x.text).sort()

test("two devices end with each other's changes", async () => {
  const gh = new FakeGitHub()
  const a = await device("aaaaaaaa")
  const b = await device("bbbbbbbb")
  await sync(a, gh)
  assert.equal(a.dirty, false)
  const lid = (await a.model.view())[0].id
  await a.model.apply({ op: "add", list: lid, text: "from A" }); a.dirty = true
  await b.model.apply({ op: "add", list: lid, text: "from B" }); b.dirty = true
  await sync(a, gh)
  await sync(b, gh)
  await sync(a, gh)
  assert.deepEqual(await texts(a), await texts(b))
  assert.ok((await texts(a)).includes("from A") && (await texts(a)).includes("from B"))
  // Nothing new: one request, answered "unchanged", and no push.
  const before = gh.n
  await sync(a, gh)
  assert.equal(gh.n, before)
})

test("a file changed between fetch and push: the push is refused, and the round starts again", async () => {
  const gh = new FakeGitHub()
  const a = await device("aaaaaaaa")
  const b = await device("bbbbbbbb")
  await sync(a, gh)
  await sync(b, gh)
  const lid = (await a.model.view())[0].id
  await a.model.apply({ op: "add", list: lid, text: "A, late" }); a.dirty = true
  await b.model.apply({ op: "add", list: lid, text: "B, first" }); b.dirty = true
  gh.beforePut = () => sync(b, gh) // B pushes while A is about to
  await sync(a, gh)
  await sync(b, gh)
  assert.deepEqual(await texts(a), await texts(b))
  assert.ok((await texts(b)).includes("A, late"))
  assert.equal(a.dirty, false)
})

test("a header changed on GitHub (not by a device with the key) is refused", async () => {
  const gh = new FakeGitHub()
  const a = await device("aaaaaaaa")
  await sync(a, gh)
  const env = JSON.parse(gh.file)
  env.header.at += 1e6 // "newer", but not signed by the data key
  gh.file = JSON.stringify(env)
  gh.sha = "forged"
  a.etag = null
  await assert.rejects(sync(a, gh), /header/)
})

test("a new master password made on one device reaches the other", async () => {
  const gh = new FakeGitHub()
  const a = await device("aaaaaaaa")
  const b = await device("bbbbbbbb")
  await sync(a, gh)
  await sync(b, gh)
  a.model.header.password = await C.passwordBlock(a.dek, "another master pw")
  a.model.header.at = Date.now() + 1000
  a.dirty = true
  await sync(a, gh)
  await sync(b, gh)
  assert.deepEqual(C.unsigned(b.model.header), C.unsigned(a.model.header))
  assert.ok(await C.dekFromPassword(b.model.header, "another master pw"))
})

test("a lock taken off on one device while the other added to it", async () => {
  const gh = new FakeGitHub()
  const a = await device("aaaaaaaa")
  const b = await device("bbbbbbbb")
  await sync(a, gh)
  await sync(b, gh)
  const gifts = (await a.model.view())[1].id
  await a.model.unlockList(gifts, fixture.listPassword)
  await b.model.unlockList(gifts, fixture.listPassword)
  await a.model.removeLock(gifts); a.dirty = true
  await b.model.apply({ op: "add", list: gifts, text: "from the phone" }); b.dirty = true
  await sync(a, gh)
  await sync(b, gh)   // B still holds the old key: the new to-do becomes plain text
  await sync(a, gh)
  const view = (await a.model.view())[1]
  assert.equal(view.locked, false)
  assert.equal(view.stale, 0)
  assert.deepEqual(view.items.map(x => x.text).sort(), ["Kniha pre mamu", "from the phone"])
})
