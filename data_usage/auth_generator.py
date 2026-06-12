import os
import time
from playwright.sync_api import sync_playwright

def generate_starlink_session():
    print("🚀 Launching secure browser session for Starlink Portal...")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--start-maximized"
            ]
        )

        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080}
        )

        page = context.new_page()

        # 1. Hit the primary homepage first
        print("🌐 Establishing base connection to Starlink homepage...")
        page.goto("https://www.starlink.com/")
        time.sleep(2)

        # 2. Redirect to login
        print("🔒 Navigating to authentication gateway...")
        page.goto("https://www.starlink.com/auth/login")

        print("\n" + "="*60)
        print("🔒 [ACTION REQUIRED]: Go to the opened browser window and log in.")
        print("👉 Complete your credentials and any Email/SMS/Authenticator 2FA steps.")
        print("="*60 + "\n")

        # Pause execution here and wait for the user to confirm in terminal
        input("👉 ONCE YOU ARE FULLY LOGGED IN AND SEE YOUR DASHBOARD, come back here and press [ENTER]...")

        print("\n💾 Capturing authenticated state...")
        time.sleep(2)  # Short pause to ensure final storage tokens are written

        os.makedirs("auth", exist_ok=True)
        context.storage_state(path="auth/state.json")
        print("✅ Session context safely exported to 'auth/state.json'.")

        browser.close()

if __name__ == "__main__":
    generate_starlink_session()