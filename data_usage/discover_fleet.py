import json
import os
import time
from playwright.sync_api import sync_playwright

STATE_FILE = "auth/state.json"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

if not os.path.exists(STATE_FILE):
    print("❌ Error: Run auth_generator.py first.")
    exit(1)

print("🛰️ Initiating full fleet discovery with real-time API status logging...")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars"
        ]
    )

    context = browser.new_context(
        storage_state=STATE_FILE,
        user_agent=USER_AGENT,
        viewport={"width": 1920, "height": 1080}
    )
    page = context.new_page()

    intercepted_accounts = None
    intercepted_terminals = None

    # --- VERBOSE NETWORK LIFECYCLE MONITOR ---
    def handle_response(response):
        global intercepted_accounts, intercepted_terminals
        url = response.url

        if "accounts/contact" in url:
            print(f"📡 [API TRACK] accounts/contact detected! HTTP Status: {response.status}")
            if response.status == 200:
                try:
                    intercepted_accounts = response.json()
                except Exception as e:
                    print(f"   ⚠️ Error parsing accounts JSON: {str(e)}")

        # Only capture the plural /service-lines list endpoint, not individual /service-line/{id} calls.
        # Individual service-line status responses have a different shape and would corrupt the parse.
        elif "/service-lines" in url and "telemetryagg" not in url:
            print(f"📡 [API TRACK] service-lines list detected! HTTP Status: {response.status}")
            if response.status == 200:
                try:
                    intercepted_terminals = response.json()
                except Exception:
                    pass

    page.on("response", handle_response)

    # --- STEP 1: LOAD MAIN ACCOUNT HOME ---
    print("🌐 Loading main home dashboard view...")
    page.goto("https://starlink.com/account/home", wait_until="networkidle")
    time.sleep(3)

    # Check if the baseline capture succeeded
    if not intercepted_accounts:
        print("\n⏳ Accounts payload not found yet. Forcing a refresh navigation to subscriptions view...")
        page.goto("https://starlink.com/account/subscriptions", wait_until="networkidle")
        time.sleep(5)

    if not intercepted_accounts:
        print("\n🚨 Stalled: Could not capture accounts dropdown dictionary list.")
        page.screenshot(path="auth/01_stalled_dashboard.png")
        print("📸 Snapshot of current loading state written to auth/01_stalled_dashboard.png")
        browser.close()
        exit(1)

    # Cleanly unwrap account nodes
    accounts_list = intercepted_accounts if isinstance(intercepted_accounts, list) else intercepted_accounts.get("content", [])
    if isinstance(accounts_list, dict) and "results" in accounts_list:
        accounts_list = accounts_list["results"]
    elif isinstance(intercepted_accounts, dict) and not accounts_list:
        accounts_list = intercepted_accounts.get("accounts", [intercepted_accounts])

    discovered_fleet = {}
    print(f"\n✅ Found {len(accounts_list)} linked profiles. Starting dropdown execution loop...")

    # --- STEP 2: MULTI-ACCOUNT PROFILE EXTRACTION LOOP ---
    for acc in accounts_list:
        acc_id = acc.get("accountNumber") or acc.get("accountId") or acc.get("id")
        acc_name = acc.get("accountName") or acc.get("name")

        if not acc_id:
            continue

        print(f"\n📂 Activating Account Context: {acc_name} [{acc_id}]...")
        intercepted_terminals = None

        page.goto(f"https://starlink.com/account/home?accountNumber={acc_id}", wait_until="networkidle")
        time.sleep(3)

        page.goto("https://starlink.com/account/subscriptions", wait_until="networkidle")

        # Wait up to 10s for the service-lines list response to arrive
        for _ in range(20):
            if intercepted_terminals is not None:
                break
            time.sleep(0.5)

        terminals_payload = []
        if intercepted_terminals:
            content_block = intercepted_terminals.get("content", {}) if isinstance(intercepted_terminals, dict) else {}
            results = content_block.get("results", []) if isinstance(content_block, dict) else []
            if not results and isinstance(intercepted_terminals, dict):
                results = intercepted_terminals.get("results", [])

            for item in results:
                if not isinstance(item, dict):
                    continue
                service_line = item.get("serviceLineNumber") or item.get("service_line_id")
                nickname = item.get("nickname") or (item.get("serviceAddress") or {}).get("formattedAddress")
                portal_status = item.get("status")
                # Starlink portal: status == 0 means active/online
                is_active = portal_status == 0 if isinstance(portal_status, int) else str(portal_status).lower() in ("active", "0", "")
                terminals_payload.append({
                    "service_line": service_line,
                    "nickname": nickname,
                    "status": "Active" if is_active else "Inactive",
                })

        if not terminals_payload:
            print(f"   ⚠️  No terminals captured for {acc_name} — subscriptions page may not have loaded in time.")

        discovered_fleet[acc_name] = {
            "account_id": acc_id,
            "terminals": terminals_payload
        }
        print(f"   📊 Discovered {len(terminals_payload)} terminals.")

    # --- STEP 3: MANIFEST FILE GENERATION ---
    with open("auth/fleet_map.json", "w") as f:
        json.dump(discovered_fleet, f, indent=4)

    print("\n💾 Discovery map processing complete -> Written to 'auth/fleet_map.json'")
    browser.close()
