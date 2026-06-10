/**
 * Example adapter for scripts/starlink_portal_usage_worker.js.
 *
 * Copy this file outside git-tracked code on the always-on server, inspect the
 * Starlink portal once with Playwright, then replace the selectors/parsing below.
 * The worker fails closed unless STARLINK_PORTAL_ADAPTER points at a calibrated
 * adapter that returns exact portal totals.
 */

async function extractStarlinkUsage({ page, siteMap, today }) {
  await page.waitForLoadState('networkidle');

  // Replace this with calibrated selectors after inspecting the portal while
  // signed in as support@icircles.rw. Each returned row must map to a site_id.
  //
  // Preferred output for residential portal cycle totals:
  // [
  //   {
  //     site_id: 41,
  //     gb_used_cumulative: 433.7,
  //     service_line_id: 'SL-123456',
  //     starlink_identifier: 'KIT123456',
  //     billing_period_start: '2026-06-01',
  //     billing_period_end: '2026-06-30',
  //     metadata: { portal_label: 'GS Example', collected_for: today }
  //   }
  // ]
  //
  // If Starlink exposes true daily totals instead, set
  // STARLINK_PORTAL_USAGE_MODE=daily and return gb_total/mb_total/bytes_total.
  void page;
  void siteMap;
  void today;
  throw new Error('Calibrate this adapter against the signed-in Starlink portal before importing usage.');
}

module.exports = { extractStarlinkUsage };
