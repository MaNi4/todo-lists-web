// node --test tests/ — the lists' model against the plugin's file, and a
// file for the plugin to read back (tests/fixtures/web-v3.json).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import * as C from "../src/lib/crypto.js"
import { Model, tidy, merge, same, markdown } from "../src/lib/model.js"

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plugin-v3.json", import.meta.url), "utf8"))

async function open() {
  const header = C.cleanHeader(fixture.env.header)
  const dek = await C.dekFromPassword(header, fixture.password)
  const doc = tidy(await C.openEnvelope(fixture.env, dek))
  return { model: new Model(doc, header, "webtest1"), dek }
}

const texts = list => list.items.map(x => x.text)

test("the view is the plugin's view", async () => {
  const { model } = await open()
  const view = await model.view()
  assert.deepEqual(view.map(l => [l.name, l.locked, l.open]), fixture.view.map(l => [l.name, l.locked, l.open]))
  assert.deepEqual(view[0].items, fixture.view[0].items)
  assert.equal(view[1].items, null)
})

test("tidy reads the plugin's document as it wrote it", async () => {
  const header = C.cleanHeader(fixture.env.header)
  const dek = await C.dekFromPassword(header, fixture.password)
  const raw = await C.openEnvelope(fixture.env, dek)
  assert.ok(same(tidy(raw), raw), "nothing the plugin writes is dropped or changed")
})

test("changes, ticks and moves", async () => {
  const { model } = await open()
  const lid = (await model.view())[0].id
  assert.ok(await model.apply({ op: "add", list: lid, text: "  Maslo\n" }))
  let l = (await model.view())[0]
  assert.deepEqual(texts(l), ["Vajcia (10 ks)", "Chlieb", "Maslo", "Mlieko"])
  const maslo = l.items[2].id
  assert.ok(await model.apply({ op: "move", list: lid, item: maslo, by: -2 }))
  assert.ok(await model.apply({ op: "done", list: lid, item: maslo, done: true }))
  l = (await model.view())[0]
  assert.deepEqual(texts(l), ["Vajcia (10 ks)", "Chlieb", "Maslo", "Mlieko"])
  assert.ok(l.items[2].done)
  assert.ok(await model.apply({ op: "clearDone", list: lid }))
  assert.deepEqual(texts((await model.view())[0]), ["Vajcia (10 ks)", "Chlieb"])
})

test("a locked list: list password, recovery key, a new list password", async () => {
  const { model } = await open()
  const lid = (await model.view())[1].id
  assert.equal(await model.unlockList(lid, "0000"), false)
  await model.unlockList(lid, fixture.listPassword)
  assert.deepEqual(texts((await model.view())[1]), ["Kniha pre mamu"])
  assert.ok(await model.apply({ op: "add", list: lid, text: "Šál" }))
  assert.ok(await model.changeListPassword(lid, "5678"))
  model.lockAll()
  assert.equal((await model.view())[1].items, null)
  await model.recoverList(lid, fixture.recovery, "9999")
  assert.deepEqual(texts((await model.view())[1]), ["Kniha pre mamu", "Šál"])
  model.lockAll()
  await model.unlockList(lid, "9999")
  assert.deepEqual(texts((await model.view())[1]), ["Kniha pre mamu", "Šál"])
})

test("a to-do moves to another list, into and out of a locked one while it is open", async () => {
  const { model } = await open()
  let [shop, gifts] = await model.view()
  const bread = shop.items.find(x => x.text === "Chlieb").id
  // Locked and not open: nothing goes in.
  assert.equal(await model.apply({ op: "moveTo", list: shop.id, item: bread, to: gifts.id }), false)
  await model.unlockList(gifts.id, fixture.listPassword)
  assert.ok(await model.apply({ op: "moveTo", list: shop.id, item: bread, to: gifts.id }))
  ;[shop, gifts] = await model.view()
  assert.ok(!texts(shop).includes("Chlieb"))
  assert.deepEqual(texts(gifts).slice(-1), ["Chlieb"])
  const rec = Object.values(model.doc.items).find(r => r.list === gifts.id && !r.deleted && !("text" in r) && r.sealed)
  assert.ok(rec, "sealed with the locked list's key")
  // And back out, plain again; not to itself, not nowhere.
  const back = gifts.items.find(x => x.text === "Chlieb").id
  assert.equal(await model.apply({ op: "moveTo", list: gifts.id, item: back, to: gifts.id }), false)
  assert.equal(await model.apply({ op: "moveTo", list: gifts.id, item: back, to: "nowhere" }), false)
  assert.ok(await model.apply({ op: "moveTo", list: gifts.id, item: back, to: shop.id }))
  ;[shop] = await model.view()
  assert.deepEqual(shop.items.filter(x => !x.done).map(x => x.text).slice(-1), ["Chlieb"])
})

test("a move is undone to the same place", async () => {
  const { model } = await open()
  let [shop, , home] = await model.view()
  if (!home) { await model.apply({ op: "addList", name: "Home" }); [shop, , home] = await model.view() }
  const before = shop.items.filter(x => !x.done).map(x => x.text)
  const second = shop.items.filter(x => !x.done)[1]
  assert.ok(await model.apply({ op: "moveTo", list: shop.id, item: second.id, to: home.id, as: "fedcba9876543210" }))
  ;[shop, , home] = await model.view()
  assert.ok(home.items.some(x => x.id === "fedcba9876543210"))
  assert.ok(await model.apply({ op: "moveTo", list: home.id, item: "fedcba9876543210", to: shop.id, at: 1 }))
  ;[shop] = await model.view()
  assert.deepEqual(shop.items.filter(x => !x.done).map(x => x.text), before)
})

test("the export is the plugin's Markdown", () => {
  const lists = [
    { name: "Shopping", items: [{ text: "milk", done: false }, { text: "bread", done: true }] },
    { name: "Gifts", items: null },
    { name: "Empty", items: [] },
  ]
  assert.equal(markdown(lists, "2026-10-27"), "# To-Do Lists\n\n_Exported 2026-10-27_\n\n## Shopping\n\n- [ ] milk\n- [x] bread\n\n"
    + "## Gifts\n\n_Locked: unlock it, then export again to include it._\n\n## Empty\n\n_Nothing to do._\n")
})

test("merge is the same both ways, and keeps both devices' changes", async () => {
  const a = (await open()).model
  const b = (await open()).model
  b.device = "webtest2"
  const lid = (await a.view())[0].id
  await a.apply({ op: "add", list: lid, text: "z telefónu" })
  await b.apply({ op: "renameList", list: lid, name: "Potraviny" })
  const ab = merge(a.doc, b.doc)
  assert.ok(same(ab, merge(b.doc, a.doc)))
  a.doc = ab
  const view = await a.view()
  assert.equal(view[0].name, "Potraviny")
  assert.ok(texts(view[0]).includes("z telefónu"))
})

test("a file written here, for the plugin to read back", async () => {
  const { model, dek } = await open()
  const lists = await model.view()
  await model.apply({ op: "add", list: lists[0].id, text: "Pridané webom" })
  await model.unlockList(lists[1].id, fixture.listPassword)
  await model.apply({ op: "add", list: lists[1].id, text: "Tajné z webu" })
  await model.apply({ op: "addList", name: "Z telefónu" })
  const env = await C.envelope(model.doc, dek, model.header, await C.macKeyFrom(dek))
  writeFileSync(new URL("./fixtures/web-v3.json", import.meta.url), JSON.stringify({
    env, password: fixture.password, recovery: fixture.recovery, listPassword: fixture.listPassword,
    expect: { names: ["Nákup", "Darčeky", "Z telefónu"], added: "Pridané webom", sealed: "Tajné z webu" },
  }, null, 1))
  assert.equal(env.format, "mani4.todo-lists")
})
