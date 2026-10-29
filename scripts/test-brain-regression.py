#!/usr/bin/env python3
"""Regression + edge-case tests for the HALO brain after the intel upgrade."""
import json
import urllib.request

BASE = "http://localhost:3000/api/halo/brain"


def ask(q, mode="voice"):
    body = json.dumps({"message": q, "mode": mode, "source": "voice"}).encode()
    req = urllib.request.Request(BASE, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


CASES = [
    # regression — existing capabilities must still work
    ("Open the dashboard", "regression/navigation"),
    ("What's my account summary?", "regression/read"),
    ("Pause new automated entries", "regression/consequential→confirm"),
    # external-intel edge cases
    ("Read this article from https://edition.cnn.com/markets and summarize it", "edge/arbitrary-link→decline"),
    ("What time is the ECB press conference?", "intel/calendar-indirect"),
]

for q, tag in CASES:
    try:
        d = ask(q)
        say = d.get("say", d.get("error", ""))
        conf = d.get("confirmation", {})
        acts = d.get("actions", [])
        print(f"[{tag}] Q: {q}")
        print(f"  SAY: {say[:300]}")
        if conf:
            print(f"  CONFIRM: {conf.get('action')} — {conf.get('question')}")
        if acts:
            print(f"  ACTIONS: {json.dumps(acts)[:220]}")
        print()
    except Exception as e:  # noqa: BLE001
        print(f"[{tag}] Q: {q}\n  ERROR: {e}\n")
