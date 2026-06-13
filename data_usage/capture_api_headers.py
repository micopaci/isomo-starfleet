"""Capture the auth headers the Starlink portal uses for webagg API calls.

Loads auth/state.json in a headless browser, lets the SSO session refresh,
intercepts the first authenticated API request, and writes:
  - auth/api_headers.json  (Cookie/Authorization headers for raw HTTP polling)
  - auth/state.json        (refreshed storage state)

No secret values are printed; only header names and lengths.
"""
import json
import logging
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("capture")

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "auth" / "state.json"
HEADERS_FILE = BASE_DIR / "auth" / "api_headers.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

captured = {}

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--disable-infobars"],
    )
    context = browser.new_context(
        storage_state=str(STATE_FILE),
        user_agent=USER_AGENT,
        viewport={"width": 1920, "height": 1080},
    )
    page = context.new_page()

    def handle_request(request):
        url = request.url
        if "/api/" in url and ("webagg" in url or "service-line" in url or "accounts" in url):
            headers = request.headers
            interesting = {}
            for key in ("cookie", "authorization", "x-csrf-token", "x-requested-with"):
                if key in headers:
                    interesting[key.title() if key != "x-csrf-token" else "X-Csrf-Token"] = headers[key]
            if interesting and ("Cookie" in interesting or "Authorization" in interesting):
                if not captured:
                    log.info("captured headers from %s", url.split("?")[0])
                captured.update(interesting)

    page.on("request", handle_request)

    log.info("loading account home ...")
    page.goto("https://starlink.com/account/home", wait_until="networkidle")
    time.sleep(3)
    if not captured:
        log.info("no API call seen yet, trying subscriptions view ...")
        page.goto("https://starlink.com/account/subscriptions", wait_until="networkidle")
        time.sleep(5)

    context.storage_state(path=str(STATE_FILE))
    browser.close()

if not captured:
    log.error("FAILED: no authenticated API request observed. Session may need a fresh login (auth_generator.py).")
    raise SystemExit(1)

HEADERS_FILE.parent.mkdir(parents=True, exist_ok=True)
with HEADERS_FILE.open("w", encoding="utf-8") as fh:
    json.dump({"headers": {"User-Agent": USER_AGENT, **captured}}, fh, indent=2)

log.info("wrote %s with header names: %s", HEADERS_FILE, ", ".join(captured))
for key, value in captured.items():
    log.info("  %s: %d chars", key, len(value))
