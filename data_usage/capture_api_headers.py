#!/usr/bin/env python3
"""Capture Starlink portal API headers from an existing Playwright auth state.

The authenticated browser session still comes from auth_generator.py. This
script only refreshes/writes auth/api_headers.json for the backend worker.
Secret values are never printed.
"""
import argparse
import json
import logging
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "auth" / "state.json"
HEADERS_FILE = BASE_DIR / "auth" / "api_headers.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("capture")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Capture Starlink API Cookie/Authorization headers without printing secrets."
    )
    parser.add_argument("--state", type=Path, default=STATE_FILE)
    parser.add_argument("--output", type=Path, default=HEADERS_FILE)
    parser.add_argument("--headless", action="store_true", help="Run Chromium headless.")
    parser.add_argument(
        "--show-browser",
        action="store_false",
        dest="headless",
        help="Run visible Chromium. This is the default because it is less fragile on macOS.",
    )
    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument(
        "--no-cookie-fallback",
        action="store_true",
        help="Fail if no API request is intercepted instead of falling back to cookies from state.json.",
    )
    parser.set_defaults(headless=False)
    return parser.parse_args()


def load_state(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing auth state: {path}. Run auth_generator.py first.")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def cookie_header_from_state(state):
    pairs = []
    for cookie in state.get("cookies", []):
        domain = str(cookie.get("domain") or "").lower()
        name = cookie.get("name")
        value = cookie.get("value")
        if not name or value is None:
            continue
        if "starlink.com" not in domain:
            continue
        pairs.append(f"{name}={value}")
    return "; ".join(pairs) if pairs else None


def safe_goto(page, url, timeout_ms, timeout_error):
    log.info("loading %s ...", url)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    except timeout_error:
        log.info("navigation timed out after DOM load wait; continuing to inspect requests")
    time.sleep(3)


def redact_lengths(headers):
    return ", ".join(f"{key}={len(str(value))} chars" for key, value in headers.items())


def load_playwright():
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
        return sync_playwright, PlaywrightTimeoutError
    except ModuleNotFoundError:
        return None, None


def write_headers(path, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"headers": {"User-Agent": USER_AGENT, **headers}}
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    log.info("wrote %s", path)
    log.info("captured header lengths: %s", redact_lengths(payload["headers"]))


def main():
    args = parse_args()
    state_path = args.state if args.state.is_absolute() else (Path.cwd() / args.state)
    if not state_path.exists() and not args.state.is_absolute():
        repo_relative = BASE_DIR.parent / args.state
        if repo_relative.exists():
            state_path = repo_relative
    output_path = args.output if args.output.is_absolute() else (Path.cwd() / args.output)
    if not output_path.parent.exists() and not args.output.is_absolute():
        output_path = BASE_DIR.parent / args.output

    state = load_state(state_path)
    captured = {}
    sync_playwright, timeout_error = load_playwright()

    if sync_playwright is None:
        if args.no_cookie_fallback:
            log.error(
                "Python Playwright is not installed. Install with: "
                "python3 -m pip install playwright && python3 -m playwright install chromium"
            )
            return 1
        cookie = cookie_header_from_state(state)
        if not cookie:
            log.error(
                "Python Playwright is not installed and no Starlink cookies were found in %s.",
                state_path,
            )
            return 1
        log.info("Python Playwright is not installed; falling back to Cookie header from storage state")
        write_headers(output_path, {"Cookie": cookie})
        return 0

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=args.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--start-maximized",
            ],
        )
        context = browser.new_context(
            storage_state=str(state_path),
            user_agent=USER_AGENT,
            viewport={"width": 1920, "height": 1080},
        )
        page = context.new_page()

        def handle_request(request):
            url = request.url
            if "/api/" not in url:
                return
            if not any(part in url for part in ("webagg", "service-line", "service-lines", "accounts")):
                return
            headers = request.headers
            interesting = {}
            for key in ("cookie", "authorization", "x-csrf-token", "x-requested-with"):
                if key in headers:
                    canonical = {
                        "cookie": "Cookie",
                        "authorization": "Authorization",
                        "x-csrf-token": "X-Csrf-Token",
                        "x-requested-with": "X-Requested-With",
                    }[key]
                    interesting[canonical] = headers[key]
            if interesting and ("Cookie" in interesting or "Authorization" in interesting):
                if not captured:
                    log.info("captured headers from %s", url.split("?")[0])
                captured.update(interesting)

        page.on("request", handle_request)

        safe_goto(page, "https://starlink.com/account/home", args.timeout_ms, timeout_error)
        if not captured:
            safe_goto(page, "https://starlink.com/account/subscriptions", args.timeout_ms, timeout_error)
        if not captured:
            safe_goto(page, "https://www.starlink.com/account/home", args.timeout_ms, timeout_error)

        context.storage_state(path=str(state_path))
        browser.close()

    if not captured and not args.no_cookie_fallback:
        cookie = cookie_header_from_state(load_state(state_path))
        if cookie:
            log.info("no API request intercepted; falling back to Cookie header from storage state")
            captured["Cookie"] = cookie

    if not captured:
        log.error("FAILED: no authenticated API headers found. Refresh login with auth_generator.py.")
        return 1

    write_headers(output_path, captured)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
