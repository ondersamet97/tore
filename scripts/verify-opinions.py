#!/usr/bin/env python3
"""Exercise the embedded 0.8 UI and opinion API in an isolated temporary store.

No real conversations, credentials, model endpoints or production files are used.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
REPORT = {"version": "0.18.0", "syntheticDataOnly": True,
          "externalModelCalls": 0, "steps": [], "passed": False}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def step(name):
    REPORT["steps"].append({"name": name, "passed": True})
    print("PASS", name)


def run():
    with tempfile.TemporaryDirectory(prefix="tore-opinions-") as temp:
        root = Path(temp).resolve()
        archive, data = root / "archive", root / "data"
        archive.mkdir()
        data.mkdir()
        process = None
        runtime = None

        def call(op, payload=None, expected=200, headers=None):
            h = {"Authorization": "Bearer " + runtime["localToken"],
                 "Origin": runtime["url"], "Content-Type": "application/json"}
            h.update(headers or {})
            req = urllib.request.Request(runtime["url"] + "/api/private/tore/" + op,
                                         data=json.dumps(payload or {}).encode(), headers=h)
            try:
                response = opener.open(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                result = json.load(response)
                assert response.code == expected, (op, response.code, result)
                if expected == 200:
                    assert response.headers.get("Cache-Control") == "no-store"
                return result

        def start():
            nonlocal process, runtime
            process = subprocess.Popen([str(ROOT / "server/target/debug/tore-server"),
                "--archive", str(archive), "--data", str(data), "--listen", "127.0.0.1:0"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "en_US.UTF-8"})
            ready = data / ".tore-runtime/runtime.json"
            for _ in range(200):
                assert process.poll() is None, "Server exited before readiness"
                if ready.exists():
                    runtime = json.loads(ready.read_text())
                    if runtime["pid"] == process.pid:
                        assert call("status")["version"] == "0.18.0"
                        return
                time.sleep(0.05)
            raise AssertionError("Server readiness timed out")

        def stop():
            req = urllib.request.Request(runtime["url"] + "/api/private/shutdown", data=b"{}",
                headers={"Authorization": "Bearer " + runtime["localToken"],
                         "Origin": runtime["url"], "Content-Type": "application/json"})
            with opener.open(req, timeout=5) as response:
                assert json.load(response)["closing"]
            assert process.wait(timeout=10) == 0

        try:
            start()
            for path, needle in [("/", "return.js"), ("/gorusler", "opinions.css"),
                                 ("/calisma", "workspace.js"), ("/opinions.js", "opinion-review")]:
                with opener.open(runtime["url"] + path, timeout=5) as response:
                    assert needle in response.read().decode()
                    assert "default-src 'none'" in response.headers["Content-Security-Policy"]
            step("embedded_home_and_existing_workspace")
            call("opinions", expected=403, headers={"Authorization": "Bearer invalid"})
            call("opinion-create", expected=403, headers={"Origin": "https://example.test"})
            step("local_authorization_and_origin")
            assert call("opinions")["cards"] == []
            preview = call("import-preview", {"provider": "chatgpt", "fileName": "synthetic.json",
                "contentBase64": base64.b64encode((ROOT / "fixtures/chatgpt-branched.json").read_bytes()).decode()})
            c = call("import-commit", {"previewId": preview["previewId"],
                     "selectedIds": [preview["conversations"][0]["id"]]})["conversations"][0]
            m = next(m for m in c["messages"] if m["role"] == "user" and m["text"])
            original = hashlib.sha256((data / "conversations/workspace-v1.json").read_bytes()).hexdigest()
            create = {"topic": "life", "statement": m["text"], "reason": "Sentetik inceleme",
                "source": {"conversationId": c["id"], "messageId": m["id"], "excerpt": m["text"]},
                "attribution": "user_statement", "positionIds": ["life_basic"]}
            bad = {**create, "source": {**create["source"], "excerpt": "Kaynakta yok"}}
            call("opinion-create", bad, 400)
            card = call("opinion-create", create)["card"]
            assert card["status"] == "draft"
            assert call("opinions")["map"]["confirmedCount"] == 0
            step("source_validation_and_draft_exclusion")
            review = {"id": card["id"], "expectedRevision": card["revision"],
                "statement": card["statement"], "reason": card["reason"],
                "positionIds": card["positionIds"], "status": "confirmed",
                "changeType": "review", "changeReason": "Sentetik kullanıcı kontrolü"}
            call("opinion-review", review, 400)
            card = call("opinion-review", {**review, "confirmedByUser": True})["card"]
            assert call("opinions")["map"]["confirmedCount"] == 1
            call("opinion-review", {**review, "confirmedByUser": True}, 400)
            step("explicit_confirmation_and_stale_revision_protection")
            review.update(expectedRevision=card["revision"], statement="SENTETİK düzeltilmiş ifade",
                          status="confirmed", changeType="correction", confirmedByUser=True)
            card = call("opinion-review", review)["card"]
            assert card["source"]["excerpt"] == m["text"] and len(card["history"]) >= 2
            review.update(expectedRevision=card["revision"], status="uncertain",
                          changeType="opinion_change", changeReason="SENTETİK yeniden düşünme")
            card = call("opinion-review", review)["card"]
            assert call("opinions")["map"]["confirmedCount"] == 0
            step("revision_history_and_withdrawal_from_map")
            stop()
            start()
            recovered = next(x for x in call("opinions")["cards"] if x["id"] == card["id"])
            assert recovered == card
            assert original == hashlib.sha256((data / "conversations/workspace-v1.json").read_bytes()).hexdigest()
            step("restart_persistence_and_original_source_unchanged")
            stop()
            REPORT["passed"] = True
        finally:
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
    REPORT["temporaryDataRemoved"] = True


if __name__ == "__main__":
    try:
        run()
    finally:
        (ROOT / "docs/opinions-http-report.json").write_text(json.dumps(REPORT, indent=2) + "\n")
