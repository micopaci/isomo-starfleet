#!/usr/bin/env python3
"""
Starlink cloud data utility for the authenticated data_usage workspace.

Examples:
  python3 data_usage/sync_starfleet.py --usage --from 2026-06-01 --to 2026-06-12
  python3 data_usage/sync_starfleet.py --usage --service-line SL-606903-86751-28 --from 2026-06-01 --to 2026-06-12
  python3 data_usage/sync_starfleet.py --status-once --nickname "ES Gikonko"
  python3 data_usage/sync_starfleet.py --ping-loop --service-line SL-606903-86751-28 --interval-seconds 300

The production dashboard graph is fed by the backend Node worker:
  STARLINK_PORTAL_AUTH_STATE_FILE=data_usage/auth/state.json
  STARLINK_TERMINALS_FILE=data_usage/auth/fleet_map.json
  npm run starlink:portal:cloud-sync --workspace=packages/backend -- --daemon
"""
import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "auth" / "state.json"
FLEET_MAP_FILE = BASE_DIR / "auth" / "fleet_map.json"
DEFAULT_OUTPUT = BASE_DIR / "auth" / "latest_sync.json"
DEFAULT_PING_LOG = BASE_DIR / "auth" / "ping_samples.jsonl"
SERVICE_LINES_URL = "https://starlink.com/api/webagg/v2/accounts/service-lines"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

FETCH_JS = """
async (targetUrl) => {
  try {
    const response = await fetch(targetUrl, {
      headers: { "Accept": "application/json, text/plain, */*" }
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) return { error: true, status: response.status, payload };
    return { error: false, status: response.status, payload };
  } catch (err) {
    return { error: true, message: err.message };
  }
}
"""


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"{value} must be YYYY-MM-DD") from exc


def load_json(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_terminals(fleet_map_path=FLEET_MAP_FILE):
    raw = load_json(fleet_map_path)
    terminals = []
    for account_name, account in raw.items():
        account_id = account.get("account_id") or account.get("accountId")
        for terminal in account.get("terminals", []):
            service_line = terminal.get("service_line") or terminal.get("service_line_id")
            if not service_line or not account_id:
                continue
            terminals.append({
                "account_name": account_name,
                "account_id": account_id,
                "service_line_id": service_line,
                "nickname": terminal.get("nickname"),
                "status": terminal.get("status"),
            })
    return terminals


def select_terminals(terminals, args):
    selected = terminals
    if args.service_line:
        target = args.service_line.lower()
        selected = [t for t in selected if t["service_line_id"].lower() == target]
    if args.nickname:
        target = args.nickname.lower()
        selected = [t for t in selected if target in (t.get("nickname") or "").lower()]
    if args.account_id:
        target = args.account_id.lower()
        selected = [t for t in selected if t["account_id"].lower() == target]
    if args.active_only:
        selected = [
            t for t in selected
            if (t.get("status") or "").strip().lower() in ("", "active")
        ]
    if args.limit:
        selected = selected[:args.limit]
    return selected


def content(payload):
    return payload.get("content", payload) if isinstance(payload, dict) else {}


def number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return None
    return None


def first_number(obj, fields):
    if not isinstance(obj, dict):
        return None
    for field in fields:
        parsed = number(obj.get(field))
        if parsed is not None:
            return parsed
    return None


def parse_timestamp(value):
    if not value:
        return None
    raw = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def latest_timestamp_iso(*values):
    parsed_values = [parse_timestamp(value) for value in values if value]
    parsed_values = [value for value in parsed_values if value is not None]
    if not parsed_values:
        return None
    return max(parsed_values).isoformat()


def usage_gb_from_point(point):
    direct = number(point)
    if direct is not None:
        return direct
    if isinstance(point, list):
        return number(point[0]) if point else None
    if not isinstance(point, dict):
        return None
    gb = first_number(point, [
        "consumedGb", "consumedGB", "consumed_gb", "usageGb", "usageGB",
        "totalGb", "totalGB", "gb", "gigabytes", "dataUsageGb",
    ])
    if gb is not None:
        return gb
    mb = first_number(point, ["consumedMb", "consumedMB", "mb", "megabytes"])
    if mb is not None:
        return mb / 1024.0
    bytes_value = first_number(point, ["consumedBytes", "bytes", "totalBytes"])
    if bytes_value is not None:
        return bytes_value / (1024.0 * 1024.0 * 1024.0)
    return None


def parse_status_payload(payload, terminal):
    return parse_service_line_status_item(content(payload), terminal)


def parse_service_line_status_item(item, terminal):
    if not isinstance(item, dict):
        item = {}
    terminals = item.get("userTerminals") or []
    terminal_data = terminals[0] if terminals else {}
    routers = terminal_data.get("routers") or []
    is_offline = terminal_data.get("isOffline")
    service_line_status = item.get("status")
    ping_ms = first_number(terminal_data, [
        "popPingLatencyMs", "pop_ping_latency_ms", "pingLatencyMs",
        "ping_latency_ms", "avgPingLatencyMs", "popLatencyMs",
    ])
    drop_pct = first_number(terminal_data, ["pingDropPct", "ping_drop_pct", "packetLossPct"])
    drop_rate = first_number(terminal_data, ["pingDropRate", "ping_drop_rate", "packetLossRate"])
    if drop_pct is None and drop_rate is not None:
        drop_pct = drop_rate * 100 if 0 < drop_rate <= 1 else drop_rate

    if is_offline is True:
        current_status = "Offline"
    elif is_offline is False:
        current_status = "Online"
    elif service_line_status == 0:
        current_status = "Online"
    elif service_line_status is not None:
        current_status = "Offline"
    else:
        current_status = "Unknown"

    router_last_connected = [
        router.get("lastConnected")
        for router in routers
        if isinstance(router, dict)
    ]

    return {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "account_id": terminal["account_id"],
        "service_line_id": terminal["service_line_id"],
        "nickname": item.get("nickname") or terminal.get("nickname"),
        "current_status": current_status,
        "is_offline": is_offline if isinstance(is_offline, bool) else None,
        "last_seen_utc": latest_timestamp_iso(
            terminal_data.get("lastConnected"),
            *router_last_connected,
        ),
        "ping_latency_ms": ping_ms,
        "ping_drop_pct": drop_pct,
        "portal_service_line_status": service_line_status,
        "portal_status_source": "service-lines",
    }


def parse_usage_payload(payload, terminal, from_date, to_date):
    rows = []
    today_utc = datetime.now(timezone.utc).date()
    cycles = content(payload).get("billingCyclesAnnotated") or []
    for cycle_index, cycle in enumerate(cycles):
        start_raw = (cycle.get("startDate") or "").split("T")[0]
        if not start_raw:
            continue
        cycle_start = parse_date(start_raw)
        if not cycle_start:
            continue
        for day_index, point in enumerate(cycle.get("dailyData") or []):
            log_date = cycle_start + timedelta(days=day_index)
            if log_date > today_utc:
                continue
            if from_date and log_date < from_date:
                continue
            if to_date and log_date > to_date:
                continue
            usage_gb = usage_gb_from_point(point)
            if usage_gb is None:
                continue
            rows.append({
                "log_date": log_date.isoformat(),
                "account_id": terminal["account_id"],
                "service_line_id": terminal["service_line_id"],
                "nickname": terminal.get("nickname"),
                "consumed_gb": round(usage_gb, 4),
                "billing_cycle_start": cycle_start.isoformat(),
                "billing_cycle_index": cycle_index,
                "daily_data_index": day_index,
            })
    return rows


def fetch_json(page, url):
    result = page.evaluate(FETCH_JS, url)
    if result.get("error"):
        status = result.get("status") or result.get("message") or "unknown error"
        raise RuntimeError(f"{url} failed: {status}")
    return result["payload"]


def fetch_status(page, terminal):
    url = f"https://starlink.com/api/webagg/v2/accounts/service-line/{terminal['service_line_id']}"
    return parse_status_payload(fetch_json(page, url), terminal)


def set_account_context(page, account_id):
    page.context.add_cookies([{
        "name": "starlink.com.account_number",
        "value": account_id,
        "domain": "starlink.com",
        "path": "/",
        "httpOnly": False,
        "secure": True,
        "sameSite": "Lax",
    }])
    page.goto("https://starlink.com/account/subscriptions", wait_until="domcontentloaded")
    time.sleep(2)


def fetch_service_lines_for_account(page, account_id):
    set_account_context(page, account_id)
    try:
        return fetch_json(page, SERVICE_LINES_URL)
    except RuntimeError as exc:
        if "failed: 401" not in str(exc) and "failed: 403" not in str(exc):
            raise
        page.goto("https://starlink.com/account/subscriptions", wait_until="domcontentloaded")
        time.sleep(2)
        return fetch_json(page, SERVICE_LINES_URL)


def service_line_results(payload):
    block = content(payload)
    results = block.get("results") if isinstance(block, dict) else None
    return results if isinstance(results, list) else []


def unknown_status_row(terminal, error):
    return {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "account_id": terminal["account_id"],
        "service_line_id": terminal["service_line_id"],
        "nickname": terminal.get("nickname"),
        "current_status": "Unknown",
        "is_offline": None,
        "last_seen_utc": None,
        "ping_latency_ms": None,
        "ping_drop_pct": None,
        "portal_service_line_status": None,
        "portal_status_source": "service-lines",
        "error": str(error),
    }


def fetch_status_rows(page, terminals):
    rows = []
    terminals_by_account = {}
    for terminal in terminals:
        terminals_by_account.setdefault(terminal["account_id"], []).append(terminal)

    for account_id, account_terminals in terminals_by_account.items():
        payload = fetch_service_lines_for_account(page, account_id)
        by_service_line = {
            item.get("serviceLineNumber"): item
            for item in service_line_results(payload)
            if isinstance(item, dict) and item.get("serviceLineNumber")
        }
        for terminal in account_terminals:
            item = by_service_line.get(terminal["service_line_id"])
            if item:
                rows.append(parse_service_line_status_item(item, terminal))
                continue
            try:
                rows.append(fetch_status(page, terminal))
            except Exception as exc:
                rows.append(unknown_status_row(terminal, exc))
    return rows


def fetch_usage(page, terminal, from_date, to_date):
    url = (
        "https://starlink.com/api/telemetryagg/v1/data-usage/"
        f"account/{terminal['account_id']}/service-line/{terminal['service_line_id']}"
    )
    return parse_usage_payload(fetch_json(page, url), terminal, from_date, to_date)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def append_jsonl(path, row):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")


def write_inventory(path, terminals):
    inventory = [
        {
            "service_line_id": t["service_line_id"],
            "account_id": t["account_id"],
            "nickname": t.get("nickname"),
        }
        for t in terminals
    ]
    write_json(path, inventory)
    print(f"Wrote backend inventory: {path} ({len(inventory)} terminals)")


def load_playwright():
    try:
        from playwright.sync_api import sync_playwright
        return sync_playwright
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Python Playwright is required for Starlink API fetches. "
            "Install it with: python3 -m pip install playwright && python3 -m playwright install chromium"
        ) from exc


def build_arg_parser():
    parser = argparse.ArgumentParser(description="Fetch Starlink cloud status and date-range usage from data_usage/auth state.")
    parser.add_argument("--fleet-map", type=Path, default=FLEET_MAP_FILE)
    parser.add_argument("--state", type=Path, default=STATE_FILE)
    parser.add_argument("--service-line")
    parser.add_argument("--nickname")
    parser.add_argument("--account-id")
    parser.add_argument("--active-only", action="store_true", default=True)
    parser.add_argument("--include-inactive", action="store_false", dest="active_only")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--from", dest="from_date", type=parse_date)
    parser.add_argument("--to", dest="to_date", type=parse_date)
    parser.add_argument("--usage", action="store_true")
    parser.add_argument("--status-once", action="store_true")
    parser.add_argument("--ping-loop", action="store_true")
    parser.add_argument("--interval-seconds", type=int, default=300)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ping-log", type=Path, default=DEFAULT_PING_LOG)
    parser.add_argument("--write-inventory", type=Path)
    parser.add_argument("--headless", action="store_true", default=True)
    parser.add_argument("--show-browser", action="store_false", dest="headless")
    return parser


def main():
    args = build_arg_parser().parse_args()
    if not args.usage and not args.status_once and not args.ping_loop and not args.write_inventory:
        print("Choose --usage, --status-once, --ping-loop, or --write-inventory.", file=sys.stderr)
        return 2

    terminals = select_terminals(load_terminals(args.fleet_map), args)
    if not terminals:
        print("No terminals matched the requested filters.", file=sys.stderr)
        return 1

    if args.write_inventory:
        write_inventory(args.write_inventory, terminals)

    if not args.usage and not args.status_once and not args.ping_loop:
        return 0

    if not args.state.exists():
        print(f"Missing auth state: {args.state}. Run auth_generator.py first.", file=sys.stderr)
        return 1

    sync_playwright = load_playwright()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=args.headless,
            args=["--disable-blink-features=AutomationControlled", "--disable-infobars"],
        )
        context = browser.new_context(
            storage_state=str(args.state),
            user_agent=USER_AGENT,
            viewport={"width": 1920, "height": 1080},
        )
        page = context.new_page()
        page.goto("https://starlink.com/account/subscriptions", wait_until="domcontentloaded")

        if args.ping_loop:
            print(f"Starting ping loop for {len(terminals)} terminal(s), interval={args.interval_seconds}s. Ctrl-C to stop.")
            try:
                while True:
                    for row in fetch_status_rows(page, terminals):
                        append_jsonl(args.ping_log, row)
                        print(f"{row['recorded_at']} {row['service_line_id']} {row['current_status']} ping={row['ping_latency_ms']}")
                    time.sleep(args.interval_seconds)
            except KeyboardInterrupt:
                print("\nStopped ping loop.")
                browser.close()
                return 0

        output = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "from": args.from_date.isoformat() if args.from_date else None,
            "to": args.to_date.isoformat() if args.to_date else None,
            "terminal_count": len(terminals),
            "status": [],
            "usage": [],
        }

        if args.status_once:
            output["status"].extend(fetch_status_rows(page, terminals))

        if args.usage:
            for terminal in terminals:
                print(f"Fetching {terminal.get('nickname') or terminal['service_line_id']} [{terminal['service_line_id']}]")
                output["usage"].extend(fetch_usage(page, terminal, args.from_date, args.to_date))

        write_json(args.output, output)
        print(f"Wrote {args.output}")
        print(f"Status rows: {len(output['status'])}; usage rows: {len(output['usage'])}")
        browser.close()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
