import os
import time
from playwright.sync_api import sync_playwright

STATE_FILE = "auth/state.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

if not os.path.exists(STATE_FILE):
    print("❌ Error: Run auth_generator.py first.")
    exit(1)

print("🕵️ Starting Deep History and Request Tracer...")

def handle_request(request):
    if request.resource_type in ["document", "fetch", "xhr"]:
        if "api/" in request.url or "account" in request.url:
            print(f"📡 [NETWORK REQ] ({request.method}) {request.url}")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        args=["--disable-blink-features=AutomationControlled"]
    )

    context = browser.new_context(
        storage_state=STATE_FILE,
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 720}
    )
    page = context.new_page()

    # Route exposed console messages from inside the page to our Python console
    page.on("console", lambda msg: print(f"🖥️ [BROWSER CONSOLE] {msg.text}"))
    page.on("request", handle_request)

    # Inject client-side monkey-patches onto the window history tracking hooks BEFORE the page loads
    page.add_init_script("""
        const traceHistory = (type) => {
            const orig = history[type];
            return function () {
                const res = orig.apply(this, arguments);
                const url = arguments[2] || 'Unknown';
                console.log(`⚡ FLASH URL HIT (${type}): ` + window.location.origin + (url.startsWith('/') ? url : '/' + url));
                return res;
            };
        };
        history.pushState = traceHistory('pushState');
        history.replaceState = traceHistory('replaceState');
    """)

    print("\n🌐 Loading main home dashboard...")
    page.goto("https://starlink.com/account/home")

    print("\n============================================================")
    print("👉 ACTION: Go to the browser window and switch accounts using the dropdown.")
    print("👉 Watch for '⚡ FLASH URL HIT' in this terminal to see the exact temporary string.")
    print("============================================================\n")

    # Keep browser active for tracking session modifications
    for _ in range(60):
        time.sleep(1)

    browser.close()