#!/usr/bin/env python3
"""Test HALO brain intel actions end-to-end (voice-mode prompts)."""
import json
import sys
import urllib.request

BASE = "http://localhost:3000/api/halo/brain"

PROMPTS = [
    "What is the S&P 500 doing?",
    "Any headlines on gold?",
    "Show me tomorrow's EUR calendar",
    "What's the latest market news from Yahoo Finance?",
    "How is bitcoin trading?",
]

for q in PROMPTS:
    body = json.dumps({"message": q, "mode": "voice", "source": "voice"}).encode()
    req = urllib.request.Request(
        BASE, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.load(r)
        print(f"Q: {q}")
        print(f"SAY: {d.get('say', d.get('error', ''))[:360]}")
        if d.get("actions"):
            print(f"ACTIONS: {json.dumps(d['actions'])[:200]}")
        print()
    except Exception as e:  # noqa: BLE001
        print(f"Q: {q}\nERROR: {e}\n")
        sys.exit_code = 1
