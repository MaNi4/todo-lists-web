// node --test tests/ — the web app's encryption against a file the Omarchy
// plugin wrote (tests/fixtures/plugin-v3.json, see scripts/make-fixture.py).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as C from "../src/lib/crypto.js"

const fixture = JSON.parse(readFileSync(new URL("./fixtures/plugin-v3.json", import.meta.url), "utf8"))
const header = C.cleanHeader(fixture.env.header)

test("Argon2id gives the plugin's key: the master password opens the file", async () => {
  C.checkEnvelope(fixture.env)
  const dek = await C.dekFromPassword(header, fixture.password)
  assert.ok(dek, "the master password opens the data key")
  const doc = await C.openEnvelope(fixture.env, dek)
  assert.ok(doc && doc.lists && doc.items)
  assert.equal(await C.dekFromPassword(header, "wrong password!"), null)
})

test("the recovery key opens it too, typed sloppily", async () => {
  const dek = await C.dekFromPassword(header, fixture.password)
  const sloppy = fixture.recovery.toLowerCase().replace(/-/g, " ").replace(/0/g, "o")
  assert.ok(C.equalBytes(await C.dekFromRecovery(header, sloppy), dek))
  assert.equal(await C.dekFromRecovery(header, "0000-0000-0000-0000-0000-0000-0000-0000"), null)
})

test("a locked list opens with its list password, and with the recovery key", async () => {
  const dek = await C.dekFromPassword(header, fixture.password)
  const doc = await C.openEnvelope(fixture.env, dek)
  const [lid, list] = Object.entries(doc.lists).find(([, l]) => l.lock)
  const lock = list.lock
  const byPassword = await C.unseal(await C.derive(fixture.listPassword, lock.kdf), C.b64d(lock.pw), C.L.listPassword)
  assert.ok(byPassword)
  const priv = await C.recoveryPrivate(header, fixture.recovery)
  assert.ok(C.equalBytes(await C.unwrapWith(priv, lock.rec, C.L.recWrap), byPassword))
  assert.equal(lock.rp, await C.recoveryId(header))
  const item = Object.values(doc.items).find(it => it.list === lid && it.sealed)
  const text = JSON.parse(C.decodeText(await C.unseal(byPassword, C.b64d(item.sealed), C.L.list))).text
  assert.equal(text, "Kniha pre mamu")
})

test("the GitHub token sealed by the plugin opens with the data key", async () => {
  const dek = await C.dekFromPassword(header, fixture.password)
  const token = await C.unseal(dek, C.b64d(fixture.token), C.L.token)
  assert.equal(C.decodeText(token), fixture.tokenText)
})

test("a recovery key reads back as the bytes it was made from", () => {
  for (let i = 0; i < 50; i++) {
    const { code, raw } = C.recoveryCode()
    assert.match(code, /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    assert.ok(C.equalBytes(C.parseRecovery(code), raw))
  }
})

test("the plugin's header signature checks out here, and a changed header does not", async () => {
  const dek = await C.dekFromPassword(header, fixture.password)
  const macKey = await C.macKeyFrom(dek)
  assert.ok(header.mac, "the plugin signs its headers")
  assert.equal(await C.headerOk(macKey, header), true)
  assert.equal(await C.headerOk(macKey, { ...header, at: header.at + 1 }), false)
  const bare = C.unsigned(header)
  assert.equal(await C.headerOk(macKey, bare), false)
  assert.equal(await C.headerOk(macKey, bare, header), true)
  assert.equal(await C.headerOk(macKey, { ...bare, at: header.at + 1 }, header), false)
})

test("Argon2 settings past the limits are refused", () => {
  const ok = { name: "Argon2id", t: 3, m: 65536, p: 1, salt: "abcdefghijklmnop" }
  assert.ok(C.cleanKdf(ok))
  assert.equal(C.cleanKdf({ ...ok, m: 1048576 }), null)
  assert.equal(C.cleanKdf({ ...ok, t: 10 }), null)
})

test("an older file is turned down with a reason", () => {
  assert.throws(() => C.checkEnvelope({ format: "mani4.reminders", v: 2 }), /older version/)
  assert.throws(() => C.checkEnvelope({ format: "something", v: 3 }), /not a To-Do Lists file/)
})
