#!/usr/bin/env python3
"""Exercise Töre 0.10's real HTTP/manual flow using synthetic data only.

No AI service, model process, account login, or public model catalog is used.
On macOS the test server runs with outbound networking restricted to loopback.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
REPORT = {"version": "0.12.1", "syntheticDataOnly": True, "realModelCalls": 0,
          "externalRequests": 0, "externalNetworkBlocked": False,
          "httpRequests": 0, "steps": [], "passed": False,
          "limitations": ["Model quality and live provider access are not tested.",
                          "Unknown well-formed ChatGPT model IDs are only prepared locally; live catalog validation is not invoked."]}
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
EMAIL = "synthetic@example.test"
EXCLUDED_REPORT = "SENTETIK_REPORT_MUST_NOT_BE_SHARED"
EXCLUDED_CARD = "SENTETIK_UNREVIEWED_MUST_NOT_BE_SHARED"


def step(name):
    REPORT["steps"].append({"name": name, "passed": True})
    print("PASS", name, flush=True)


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def sample_analysis(source):
    # Quotes cite exactly the reviewed snapshot, never unselected report text.
    evidence = [{"sourceId": source["id"], "quote": source["text"][:70]}]
    return {"title": "SENTETİK bütünlüklü yorum",
            "summary": "Yalnız HTTP, kaynak doğrulama ve kalıcılık sınaması; gerçek model yorumu değildir.",
            "pillars": [{"title": "SENTETİK güvence", "text": "SENTETİK kaynaklı açıklama.", "evidence": evidence},
                        {"title": "SENTETİK seçim", "text": "SENTETİK ikinci açıklama.", "evidence": evidence}],
            "affinities": [{"name": "SENTETİK karşılaştırma", "why": "SENTETİK belirli bir benzerlik.",
                            "limits": "Yapay veri; bir siyasi programı benimseme iddiası değildir.", "evidence": evidence}],
            "tensions": [],
            "questions": [{"question": "SENTETİK hangi koşulda?", "why": "SENTETİK koşulu netleştirmek için.", "sourceIds": [source["id"]]},
                          {"question": "SENTETİK nasıl uygulanır?", "why": "SENTETİK uygulamayı netleştirmek için.", "sourceIds": [source["id"]]}]}


def run(binary):
    if not binary.is_file():
        raise AssertionError("Build the 0.10 server before running this verification")
    sandbox = Path("/usr/bin/sandbox-exec")
    if not sandbox.is_file():
        raise AssertionError("This regression requires macOS sandbox-exec to enforce offline execution")
    with tempfile.TemporaryDirectory(prefix="tore-ideology-http-") as tmp:
        root = Path(tmp).resolve()
        archive, data = root / "archive", root / "data"
        (archive / "raporlar").mkdir(parents=True)
        store = data / "conversations"
        store.mkdir(parents=True)
        report_id = str(uuid.uuid4())
        report_bytes = ("# SENTETİK rapor\n\n" + EXCLUDED_REPORT + "\nÖnceki asistan bağlamı; kişinin onaylı görüşü değildir.\n").encode()
        report_file = archive / "raporlar" / (report_id + ".md")
        report_file.write_bytes(report_bytes)
        manifest = {"schemaVersion": 1, "appVersion": "0.1.1", "revision": 1, "reports": [
            {"id": report_id, "title": "SENTETİK rapor", "originalName": "synthetic.md",
             "path": "raporlar/" + report_id + ".md", "sha256": hashlib.sha256(report_bytes).hexdigest(),
             "addedAt": "2026-11-15T00:00:00.000Z", "trashed": False}]}
        manifest_file = archive / "arsiv.json"
        manifest_file.write_bytes(encoded(manifest))
        archive_before = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in [report_file, manifest_file]}
        sentinel = root / "legacy_worker_must_not_run"
        worker = root / "synthetic_legacy_worker.py"
        worker.write_text("from pathlib import Path\nPath(" + repr(str(sentinel)) + ").write_text('UNEXPECTED_LEGACY_EXECUTION')\n")
        python = str(Path(sys.executable).resolve())
        (store / "ideology-config.json").write_bytes(encoded({"schemaVersion": 1, "workerPath": str(worker),
            "pythonPath": python, "runtimePath": python, "modelPath": str(worker), "modelName": "SENTETİK sentinel; model değildir"}))
        profile = root / "offline.sb"
        profile.write_text('(version 1)\n(allow default)\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n')
        process = None
        runtime = None

        def call(op, payload=None, expected=200, headers=None, authenticated=True):
            parsed = urllib.parse.urlsplit(runtime["url"])
            assert parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
            h = {"Origin": runtime["url"], "Content-Type": "application/json"}
            if authenticated:
                h["Authorization"] = "Bearer " + runtime["localToken"]
            h.update(headers or {})
            req = urllib.request.Request(runtime["url"] + "/api/private/tore/" + op, data=encoded(payload or {}), headers=h)
            REPORT["httpRequests"] += 1
            try:
                response = OPENER.open(req, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                result = json.load(response)
                assert response.code == expected, (op, response.code, result)
                return result

        def start():
            nonlocal process, runtime
            # Only explicit app paths and a small non-secret process environment.
            env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL", "TMPDIR"] if key in os.environ}
            command = [str(sandbox), "-f", str(profile), str(binary), "--archive", str(archive), "--data", str(data), "--listen", "127.0.0.1:0"]
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
            for _ in range(200):
                assert process.poll() is None, "Offline test server exited before readiness"
                ready = data / ".tore-runtime/runtime.json"
                if ready.exists():
                    runtime = json.loads(ready.read_text())
                    if runtime["pid"] == process.pid:
                        assert call("status")["version"] == "0.12.1"
                        REPORT["externalNetworkBlocked"] = True
                        return
                time.sleep(.05)
            raise AssertionError("Readiness timed out")

        def stop():
            req = urllib.request.Request(runtime["url"] + "/api/private/shutdown", data=b"{}", headers={"Authorization": "Bearer " + runtime["localToken"], "Origin": runtime["url"], "Content-Type": "application/json"})
            with OPENER.open(req, timeout=5) as response:
                assert json.load(response)["closing"]
            assert process.wait(timeout=10) == 0

        def prepare(target=None, source_ids=None, edits=None, expected=200):
            body = {"reportIds": [report_id], "target": target or {"connection": "manual", "developer": "anthropic", "modelId": "SENTETİK elle getirilen model"}}
            if source_ids is not None:
                body["sourceIds"] = source_ids
            if edits is not None:
                body["edits"] = edits
            return call("ideology-prepare", body, expected)

        def manual_request(draft, analysis, **overrides):
            return {"draftId": draft["id"], "draftHash": draft["hash"], "confirmed": True,
                    "requestId": str(uuid.uuid4()), "text": json.dumps(analysis, ensure_ascii=False), **overrides}

        try:
            start()
            call("connections", expected=403, authenticated=False)
            call("ideology-preview", expected=403, headers={"Origin": "https://example.test"})
            call("ideology-prepare", {}, 403, headers={"Host": "example.test"})
            connections = call("connections")
            assert connections["localEnabled"] is False
            assert not connections["chatgpt"]["connected"] and not connections["openrouter"]["configured"]
            step("authenticated_loopback_only_and_no_connected_accounts")

            card = call("opinion-create", {"topic": "life", "statement": "SENTETİK: Herkesin barınma ve öğrenme imkânına erişmesini savunuyorum.",
                "reason": "SENTETİK iletişim " + EMAIL, "attribution": "user_authored", "positionIds": ["life_basic"]})["card"]
            call("opinion-create", {"topic": "life", "statement": EXCLUDED_CARD,
                "reason": "İncelenmemiş yapay kayıt.", "attribution": "user_authored", "positionIds": []})
            assert call("ideology-preview")["confirmedCount"] == 0
            body = {key: card[key] for key in ["id", "statement", "reason", "positionIds"]}
            body.update(expectedRevision=card["revision"], status="confirmed", changeType="review", changeReason="Sentetik test", confirmedByUser=True)
            card = call("opinion-review", body)["card"]
            preview = call("ideology-preview")
            assert preview["confirmedCount"] == 1 and preview["excludedCount"] == 1
            assert preview["engine"]["localInferenceDisabled"] is True and preview["engine"]["ready"] is False
            assert {s["kind"] for s in preview["sources"]} == {"confirmed_card", "report_context"}
            assert len(call("ideology-preview", {"reportIds": []})["sources"]) == 1
            assert EXCLUDED_CARD not in json.dumps(preview["sources"])
            source = next(s for s in preview["sources"] if s["kind"] == "confirmed_card")
            step("current_reviewed_sources_report_scope_and_unreviewed_exclusion")

            old_request = {"inputHash": preview["inputHash"], "reportIds": [report_id], "requestId": str(uuid.uuid4()), "confirmed": True}
            error = call("ideology-generate", old_request, 400)
            assert "kapalı" in error["error"] and call("ideology-status")["job"] is None
            assert not sentinel.exists() and not (store / "ideology-jobs").exists()
            step("legacy_generate_rejected_even_with_valid_legacy_worker_configuration")

            blocked = prepare()["draft"]
            assert not blocked["canSend"] and blocked["status"] == "blocked"
            assert any(f["kind"] == "E-posta" for f in blocked["findings"])
            call("ideology-manual", manual_request(blocked, sample_analysis(source)), 400)
            assert call("ideology-status")["job"] is None
            step("pii_blocks_manual_acceptance_before_any_job")

            cleaned = source["text"].replace(EMAIL, "[E-POSTA]")
            edits = [{"id": source["id"], "text": cleaned}]
            ready = prepare(source_ids=[source["id"]], edits=edits)["draft"]
            assert ready["canSend"] and ready["confirmedCount"] == 1 and ready["reportsCount"] == 0
            assert ready["cost"]["mode"] == "manual" and ready["cost"]["paidFallback"] is False
            assert ready["cost"]["automaticRetry"] is False and ready["privacy"]["external"] is True
            assert ready["sources"] == [{**source, "text": cleaned}]
            assert EMAIL not in ready["prompt"] and EXCLUDED_REPORT not in ready["prompt"] and EXCLUDED_CARD not in ready["prompt"]
            assert str(root) not in ready["prompt"] and runtime["localToken"] not in ready["prompt"]
            assert ready["hash"] != blocked["hash"] and ready["outputSchema"]["type"] == "object"
            assert prepare(source_ids=[source["id"]], edits=edits)["draft"]["id"] == ready["id"]
            assert EMAIL in next(s for s in call("ideology-preview")["sources"] if s["id"] == source["id"])["text"]
            step("exact_selected_edited_snapshot_excludes_original_pii_paths_and_unselected_text")

            for ids in [[], [source["id"], source["id"]], ["unknown-source"]]:
                prepare(source_ids=ids, expected=400)
            prepare(source_ids=[source["id"]], edits=[{"id": "unknown", "text": "SENTETİK"}], expected=400)
            prepare(source_ids=[source["id"]], edits=edits + edits, expected=400)
            step("empty_duplicate_unknown_sources_and_edits_rejected")

            for target in [
                {"connection": "chatgpt", "developer": "anthropic", "modelId": "synthetic-model"},
                {"connection": "chatgpt", "developer": "openai", "modelId": "invalid model identifier"},
                {"connection": "chatgpt", "developer": "openai", "modelId": ""},
                {"connection": "openrouter", "developer": "nvidia", "modelId": "openai/synthetic:free"},
                {"connection": "local", "developer": "openai", "modelId": "synthetic-model"},
            ]:
                prepare(target, [source["id"]], edits, 400)
            unknown = prepare({"connection": "chatgpt", "developer": "openai", "modelId": "synthetic-unknown-model"}, [source["id"]], edits)["draft"]
            assert unknown["cost"]["mode"] == "subscription" and call("ideology-status")["job"] is None
            # A well-formed model ID is only syntax-checked at prepare; do not send it.
            step("target_family_and_model_syntax_validation_without_catalog_or_inference")

            analysis = sample_analysis(ready["sources"][0])
            request = manual_request(ready, analysis)
            call("ideology-manual", {**request, "confirmed": False}, 400)
            missing_consent = {key: value for key, value in request.items() if key != "confirmed"}
            call("ideology-manual", missing_consent, 400)
            call("ideology-manual", {**request, "draftHash": "stale"}, 400)
            call("ideology-manual", {**request, "requestId": "not-a-uuid"}, 400)
            call("ideology-send", {key: value for key, value in request.items() if key != "text"}, 400)
            assert call("ideology-status")["job"] is None
            step("manual_requires_explicit_consent_current_hash_valid_request_and_correct_route")

            bad = copy.deepcopy(analysis)
            bad["pillars"][0]["evidence"][0]["sourceId"] = "unknown-source"
            call("ideology-manual", {**request, "text": json.dumps(bad)}, 400)
            bad = copy.deepcopy(analysis)
            bad["pillars"][0]["evidence"][0]["quote"] = "An invented quotation outside the source."
            call("ideology-manual", {**request, "text": json.dumps(bad)}, 400)
            call("ideology-manual", {**request, "text": '{"title":"first","title":"second"}'}, 400)
            assert call("ideology-status")["job"] is None
            step("manual_schema_source_ids_exact_quotes_and_duplicate_json_keys_validated")

            completed = call("ideology-manual", request)
            assert completed["job"]["status"] == "completed" and not completed["stale"]
            saved = completed["latest"]
            assert saved["analysis"] == analysis and saved["sources"] == ready["sources"]
            assert saved["engine"]["provenance"] == "user_attested" and saved["engine"]["provider"] is None
            assert saved["engine"]["connection"] == "manual" and saved["engine"]["localOnly"] is False
            assert call("ideology-manual", request)["job"]["id"] == completed["job"]["id"]
            call("ideology-manual", {**request, "requestId": str(uuid.uuid4())}, 400)
            assert call("ideology-status")["latest"] == saved
            step("validated_manual_result_saved_as_user_attested_with_idempotent_receipt")

            stale_draft = prepare(source_ids=[source["id"]], edits=edits)["draft"]
            changed_body = {key: card[key] for key in ["id", "statement", "reason", "positionIds"]}
            changed_body.update(expectedRevision=card["revision"], status="confirmed", changeType="opinion_change",
                                changeReason="Yapay yeniden değerlendirme", confirmedByUser=True)
            changed_body["reason"] = "SENTETİK yeni ve farklı gerekçe."
            call("opinion-review", changed_body)
            call("ideology-manual", manual_request(stale_draft, analysis), 400)
            status = call("ideology-status")
            assert status["stale"] and status["latest"] == saved
            step("changed_views_invalidate_prepared_snapshot_and_preserve_previous_result")

            stop()
            start()
            status = call("ideology-status")
            assert status["latest"] == saved and status["stale"] and status["job"]["status"] == "completed"
            assert not sentinel.exists() and not (store / "ideology-jobs").exists()
            assert call("connections")["localEnabled"] is False
            assert {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in [report_file, manifest_file]} == archive_before
            step("restart_preserves_result_without_inference_and_original_archive_is_unchanged")
            stop()
            REPORT["passed"] = True
        finally:
            if process and process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
    REPORT["temporaryDataRemoved"] = True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=ROOT / "server/target/debug/tore-server")
    args = parser.parse_args()
    try:
        run(args.binary.resolve())
    finally:
        (ROOT / "docs/ideology-http-report.json").write_text(json.dumps(REPORT, indent=2) + "\n")
