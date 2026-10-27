"""Writes tests/fixtures/plugin-v3.json: a file made by the Omarchy plugin's
bin/todo-lists, with the passwords and recovery key that open it, for the
compatibility tests (node --test tests/).

  python3 scripts/make-fixture.py ~/.config/omarchy/plugins/mani4.todo-lists/bin/todo-lists

Nothing of yours is read or written: the plugin runs in a temporary folder,
with a keyring of its own in memory.
"""
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "tests", "fixtures", "plugin-v3.json")


def main(script):
    with tempfile.TemporaryDirectory() as home:
        os.environ["XDG_CONFIG_HOME"] = os.path.join(home, "config")
        os.environ["XDG_DATA_HOME"] = os.path.join(home, "data")
        loader = importlib.machinery.SourceFileLoader("todo_lists", script)
        spec = importlib.util.spec_from_loader("todo_lists", loader)
        m = importlib.util.module_from_spec(spec)
        loader.exec_module(m)
        ring = {}
        m.keyring_get = lambda kind, service=None: ring.get(kind)
        m.keyring_set = lambda kind, secret, label: ring.__setitem__(kind, secret) or "keyring"
        m.keyring_clear = lambda kind, service=None: ring.pop(kind, None)
        # Light enough for tests; the file says which, so both sides agree.
        m.ARGON = {"name": "Argon2id", "t": 1, "m": 8192, "p": 1}

        s = m.Store()
        assert s.create("correct horse battery")
        code = s.recovery_shown
        lid = s.view()["lists"][0]["id"]
        s.apply({"op": "renameList", "list": lid, "name": "Nákup"})
        for text in ("Mlieko", "Vajcia (10 ks)", "Chlieb"):
            s.apply({"op": "add", "list": lid, "text": text})
        milk = s.view()["lists"][0]["items"][0]["id"]
        s.apply({"op": "done", "list": lid, "item": milk, "done": True})
        s.apply({"op": "addList", "name": "Darčeky"})
        gifts = s.view()["lists"][1]["id"]
        s.apply({"op": "add", "list": gifts, "text": "Kniha pre mamu"})
        assert s.set_lock(gifts, "1234")
        s.save()
        s.write_token("test_token_not_real_" + "x" * 20)
        with open(m.STORE) as f:
            env = json.load(f)
        with open(m.TOKEN) as f:
            token = f.read().strip()
        s.list_keys = {}
        fixture = {
            "env": env,
            "password": "correct horse battery",
            "recovery": code,
            "listPassword": "1234",
            "token": token,
            "tokenText": "test_token_not_real_" + "x" * 20,
            "view": s.view()["lists"],
        }
    with open(OUT, "w") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(OUT))
    demo(m)


def demo(m):
    """tests/fixtures/demo.json: English lists for screenshots (npm run dev,
    then #demo); the same test passwords."""
    with tempfile.TemporaryDirectory() as home:
        m.STORE = os.path.join(home, "todo-lists.enc")
        m.TOKEN = os.path.join(home, "token.enc")
        s = m.Store()
        assert s.create("correct horse battery")
        lid = s.view()["lists"][0]["id"]
        s.apply({"op": "renameList", "list": lid, "name": "Shopping"})
        for text in ("Milk", "Eggs (10)", "Sourdough bread", "Bananas and apples", "Olive oil", "Coffee beans"):
            s.apply({"op": "add", "list": lid, "text": text})
        items = s.view()["lists"][0]["items"]
        for done in (items[4]["id"], items[5]["id"]):
            s.apply({"op": "done", "list": lid, "item": done, "done": True})
        s.apply({"op": "addList", "name": "Work"})
        work = s.view()["lists"][1]["id"]
        for text in ("Send the weekly report", "Review pull request #3", "Book the team lunch"):
            s.apply({"op": "add", "list": work, "text": text})
        s.apply({"op": "addList", "name": "Home"})
        home_list = s.view()["lists"][2]["id"]
        for text in ("Call the plumber", "Water the plants"):
            s.apply({"op": "add", "list": home_list, "text": text})
        s.apply({"op": "addList", "name": "Gifts"})
        gifts = s.view()["lists"][3]["id"]
        s.apply({"op": "add", "list": gifts, "text": "A book for mum"})
        assert s.set_lock(gifts, "1234")
        s.save()
        with open(m.STORE) as f:
            env = json.load(f)
    out = os.path.join(HERE, "..", "tests", "fixtures", "demo.json")
    with open(out, "w") as f:
        json.dump({"env": env, "password": "correct horse battery", "listPassword": "1234"}, f, ensure_ascii=False, indent=1)
    print("wrote", os.path.relpath(out))


if __name__ == "__main__":
    main(sys.argv[1])
