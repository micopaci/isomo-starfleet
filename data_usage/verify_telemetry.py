import json
import os
import time
from playwright.sync_api import sync_playwright

def verify_starlink_telemetry():
    ACCOUNT_ID = "ACC-3049739-23188-22"
    SERVICE_LINE = "AST-2688115-60060-41"
    STATE_FILE = "auth/state.json"

    if not os.path.exists(STATE_FILE):
        print(f"❌ Error: {STATE_FILE} not found. Please run auth_generator.py first.")
        return

    print("📡 Launching secure browser context to verify telemetry...")

    with sync_playwright() as p:
        # Run headless, but with normal desktop footprints
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=STATE_FILE)
        page = context.new_page()

        # Park the browser tab on the main domain so it loads your cookies naturally
        page.goto("https://starlink.com/")
        time.sleep(1)

        # Define apex domain target endpoints
        webagg_url = f"https://starlink.com/api/webagg/v2/accounts/service-line/{SERVICE_LINE}"
        telemetry_url = f"https://starlink.com/api/telemetryagg/v1/data-usage/account/{ACCOUNT_ID}/service-line/{SERVICE_LINE}"

        # JavaScript execution payload to run natively inside the browser context
        fetch_js = """
        async (targetUrl) => {
            try {
                const response = await fetch(targetUrl);
                if (!response.ok) {
                    return { error: true, status: response.status };
                }
                const data = await response.json();
                return { error: false, status: response.status, payload: data };
            } catch (err) {
                return { error: true, message: err.message };
            }
        }
        """

        print("\n--- 1. Checking Real-Time Connection State ---")
        result = page.evaluate(fetch_js, webagg_url)
        if not result.get("error"):
            data = result["payload"]
            terminal_data = data["content"]["userTerminals"][0]
            status = "Offline" if terminal_data.get("isOffline") is True else "Online"
            print("✅ Success!")
            print(f"📍 Terminal: {data['content'].get('nickname')}")
            print(f"🟢 Real-time Status: {status}")
            print(f"🕒 Last Seen UTC: {terminal_data.get('lastConnected')}")
        else:
            print(f"❌ Failed to reach WebAgg endpoint. Status/Error: {result.get('status') or result.get('message')}")

        print("\n--- 2. Checking Historical Data Usage ---")
        result = page.evaluate(fetch_js, telemetry_url)
        if not result.get("error"):
            data = result["payload"]
            cycles = data["content"]["billingCyclesAnnotated"]
            current_cycle = cycles[-1]
            print("✅ Success!")
            print(f"📅 Cycle Bounds: {current_cycle['startDate'].split('T')[0]} to {current_cycle['endDate'].split('T')[0]}")
            print(f"📊 Total Cycle Consumption: {round(current_cycle['totalAmountGB'], 2)} GB")

            actual_days = [d[0] for d in current_cycle["dailyData"] if d and d[0] > 0]
            print(f"📈 Recent Daily Usage Samples (Last 3 days): {[f'{round(g, 2)} GB' for g in actual_days[-3:]]}")
        else:
            print(f"❌ Failed to reach Telemetry endpoint. Status/Error: {result.get('status') or result.get('message')}")

        browser.close()

if __name__ == "__main__":
    verify_starlink_telemetry()