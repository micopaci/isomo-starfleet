/**
 * aiMitigation.js — AI-generated mitigation guidance for Defender TVM
 * vulnerabilities, via the OpenAI / Codex API.
 *
 * For each exposed vulnerability we generate a plain-English risk explanation,
 * prioritized mitigation steps, the matching Starfleet remediation action, and
 * an urgency rating — cached on vulnerabilities.ai_guidance (JSONB).
 *
 * Grounding: the model is given ONLY the fields Defender reports (CVE id,
 * product/version, severity, CVSS, fixing KB, exposed count, description) plus a
 * fixed description of Starfleet's remediation actions and fleet context. It is
 * told not to invent CVE specifics it doesn't know — many of these CVEs postdate
 * the model's training data, so guidance is about the product/patch path, not
 * the CVE internals.
 *
 * Config:
 *   OPENAI_API_KEY        required; guidance is skipped (logged) when absent
 *   AI_MITIGATION_ENABLED 'false' to disable (default enabled)
 *   AI_MITIGATION_MODEL   model id (default gpt-4o)
 *   OPENAI_BASE_URL       optional override (Azure OpenAI / gateway / proxy)
 *
 * All failures are logged and swallowed — never blocks the sync or the API.
 */
const pool = require('../db');

const MODEL = process.env.AI_MITIGATION_MODEL || 'gpt-4o';

function logJson(level, event, payload = {}) {
  const line = { timestamp: new Date().toISOString(), level, agent: 'ai-mitigation', event, payload };
  const write = level === 'ERROR' || level === 'FATAL' ? console.error : console.log;
  write(JSON.stringify(line));
}

function isEnabled() {
  if (process.env.AI_MITIGATION_ENABLED === 'false') return false;
  return Boolean(process.env.OPENAI_API_KEY);
}

// Lazy-load the SDK (optional dependency; mirrors notifier.js's nodemailer load)
// so the backend boots even if `openai` isn't installed.
let openaiClient = null;
let OpenAiSdk = null;
function getClient() {
  if (openaiClient) return openaiClient;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    OpenAiSdk = require('openai');
    openaiClient = new OpenAiSdk({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return openaiClient;
  } catch (err) {
    logJson('WARN', 'sdk_unavailable', { error: err.message });
    return null;
  }
}

const SYSTEM_PROMPT = [
  'You are a security operations assistant for Starfleet, a fleet-management platform run by Isomo EdTech.',
  'The fleet is ~236 managed devices (Windows laptops + Chromebooks) across ~40 school sites in Rwanda, plus Starlink terminals.',
  '',
  'Starfleet can trigger exactly two automated remediation actions via Microsoft Intune, both Windows-only:',
  '- update_chrome: force-updates Google Chrome to the latest stable release on Windows devices.',
  '- update_windows: runs Windows Update to install pending security/critical updates (never auto-reboots).',
  'Chromebooks update Chrome through ChromeOS (managed in the Google Admin console) and are out of Starfleet\'s automated reach.',
  '',
  'You are given ONLY the vulnerability facts Microsoft Defender reported. Many CVEs are recent and may postdate your knowledge.',
  'Do NOT invent CVE-specific technical details you are not certain of. When you lack specifics, give guidance grounded in the affected product and the standard patch path (update the product / apply the fixing KB).',
  'Keep language clear and non-alarmist — the reader is a school IT operator, not a security specialist.',
  '',
  'Respond with ONLY a single JSON object (no prose, no markdown fences) with exactly these keys:',
  '- summary: string — one-sentence headline.',
  '- risk_plain_english: string — what the risk means for the fleet, in plain language.',
  '- mitigation_steps: array of strings — prioritized, concrete steps.',
  '- starfleet_action: one of "update_chrome" | "update_windows" | "manual" | "none_available".',
  '    update_chrome only for Google Chrome vulnerabilities with an available fix;',
  '    update_windows only for Microsoft Windows/OS vulnerabilities with an available fixing KB;',
  '    none_available when no fix exists yet (e.g. an unpatched zero-day);',
  '    manual otherwise (a different product, or a fix that needs a human).',
  '- urgency: one of "immediate" | "this_week" | "monitor".',
  '- caveats: string — uncertainty or context the operator should know (may be empty).',
].join('\n');

function buildUserPrompt(v) {
  const lines = [
    'Generate mitigation guidance for this vulnerability.',
    '',
    `CVE / id: ${v.id}`,
    `Name: ${v.name || '(not provided)'}`,
    `Affected product: ${v.product_name || '(unknown)'}${v.product_vendor ? ` (${v.product_vendor})` : ''}`,
    `Severity: ${v.severity || 'unknown'}`,
    `CVSS v3: ${v.cvss_v3 ?? '(not provided)'}`,
    `Zero-day (no CVE assigned yet): ${v.is_zero_day ? 'yes' : 'no'}`,
    `Fixing KB / patch: ${v.fixing_kb_id || '(none reported — may be unpatched)'}`,
    `Exposed devices in the fleet: ${v.exposed_count ?? 0}`,
  ];
  if (v.description) lines.push('', `Defender description: ${v.description}`);
  return lines.join('\n');
}

const ALLOWED_ACTIONS = new Set(['update_chrome', 'update_windows', 'manual', 'none_available']);
const ALLOWED_URGENCY = new Set(['immediate', 'this_week', 'monitor']);

function parseGuidance(text) {
  if (!text) throw new Error('empty model response');
  // Tolerate markdown fences or surrounding prose by slicing to the JSON object.
  let cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);

  // Normalize to the expected shape so the UI can render it safely.
  return {
    summary: String(parsed.summary || ''),
    risk_plain_english: String(parsed.risk_plain_english || ''),
    mitigation_steps: Array.isArray(parsed.mitigation_steps) ? parsed.mitigation_steps.map(String) : [],
    starfleet_action: ALLOWED_ACTIONS.has(parsed.starfleet_action) ? parsed.starfleet_action : 'manual',
    urgency: ALLOWED_URGENCY.has(parsed.urgency) ? parsed.urgency : 'monitor',
    caveats: String(parsed.caveats || ''),
  };
}

// GPT-5 / o-series reasoning models take `max_completion_tokens` and reject the
// older `max_tokens`; GPT-4o-family takes `max_tokens`. Pick by model family and
// keep a headroom for reasoning tokens on the reasoning models.
function isReasoningModel(model) {
  return /^(gpt-5|o\d)/i.test(model);
}

async function createCompletion(client, userPrompt) {
  const base = {
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  };
  const reasoning = isReasoningModel(MODEL);
  const withTokens = reasoning
    ? { ...base, max_completion_tokens: 4000 }
    : { ...base, max_tokens: 2000 };
  try {
    return await client.chat.completions.create(withTokens);
  } catch (err) {
    // Some model families flip the token-param requirement; retry once swapping
    // it before giving up (guards against the model-family heuristic being wrong).
    if (err?.status === 400 && /max_tokens|max_completion_tokens/i.test(String(err?.message || ''))) {
      const swapped = reasoning
        ? { ...base, max_tokens: 2000 }
        : { ...base, max_completion_tokens: 4000 };
      return client.chat.completions.create(swapped);
    }
    throw err;
  }
}

// Generate + persist guidance for a single vulnerability row. Returns the
// guidance object.
async function generateAndStore(v) {
  const client = getClient();
  if (!client) throw new Error('OpenAI client not configured');

  const response = await createCompletion(client, buildUserPrompt(v));

  const guidance = parseGuidance(response.choices?.[0]?.message?.content);
  await pool.query(
    `UPDATE vulnerabilities
     SET ai_guidance = $2::jsonb, ai_guidance_model = $3, ai_guidance_at = NOW()
     WHERE id = $1`,
    [v.id, JSON.stringify(guidance), response.model || MODEL]
  );
  return guidance;
}

const GUIDANCE_INPUT_SQL = `
  SELECT v.id, v.name, v.description, v.severity, v.cvss_v3, v.is_zero_day,
         COUNT(dv.id) FILTER (WHERE dv.status = 'active')::INT AS exposed_count,
         MAX(dv.product_name)   AS product_name,
         MAX(dv.product_vendor) AS product_vendor,
         MAX(dv.fixing_kb_id)   AS fixing_kb_id
  FROM vulnerabilities v
  LEFT JOIN device_vulnerabilities dv ON dv.vulnerability_id = v.id
  WHERE v.id = $1
  GROUP BY v.id`;

// Force (re)generation for one CVE id, regardless of cache state. Used by the
// admin "Regenerate" endpoint.
async function generateForId(id) {
  if (!isEnabled()) {
    const err = new Error('AI mitigation guidance is disabled or OPENAI_API_KEY is not set');
    err.disabled = true;
    throw err;
  }
  const { rows } = await pool.query(GUIDANCE_INPUT_SQL, [id]);
  if (!rows.length) {
    const err = new Error(`Vulnerability ${id} not found`);
    err.notFound = true;
    throw err;
  }
  return generateAndStore(rows[0]);
}

// Post-sync batch: fill guidance for exposed vulnerabilities that lack it.
// Sequential, capped, and rate-limit aware.
async function generateMissingGuidance(cap = 20) {
  if (!isEnabled()) {
    logJson('INFO', 'skipped', { reason: process.env.OPENAI_API_KEY ? 'disabled' : 'no OPENAI_API_KEY' });
    return 0;
  }
  if (!getClient()) return 0;

  // Auto-generate only for zero-days and critical/high findings — the full TVM
  // feed carries thousands of medium/low CVEs and backfilling guidance for all
  // of them would cost real money for guidance nobody reads. The Security
  // drawer's "Generate" button covers any specific CVE on demand.
  const { rows } = await pool.query(
    `SELECT v.id, v.name, v.description, v.severity, v.cvss_v3, v.is_zero_day,
            COUNT(dv.id) FILTER (WHERE dv.status = 'active')::INT AS exposed_count,
            MAX(dv.product_name)   AS product_name,
            MAX(dv.product_vendor) AS product_vendor,
            MAX(dv.fixing_kb_id)   AS fixing_kb_id
     FROM vulnerabilities v
     JOIN device_vulnerabilities dv ON dv.vulnerability_id = v.id
     WHERE v.ai_guidance IS NULL
       AND (v.is_zero_day OR lower(v.severity) IN ('critical', 'high'))
     GROUP BY v.id
     HAVING COUNT(dv.id) FILTER (WHERE dv.status = 'active') > 0
     ORDER BY CASE lower(v.severity) WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
              v.is_zero_day DESC
     LIMIT $1`,
    [cap]
  );

  let generated = 0;
  for (const v of rows) {
    try {
      await generateAndStore(v);
      generated += 1;
    } catch (err) {
      // Stop the batch on rate limits; the next sync cycle catches up.
      if (OpenAiSdk && err instanceof OpenAiSdk.RateLimitError) {
        logJson('WARN', 'rate_limited', { generated, remaining: rows.length - generated });
        break;
      }
      logJson('WARN', 'generate_failed', { id: v.id, error: err.message });
    }
  }
  if (generated) logJson('INFO', 'guidance_generated', { generated });
  return generated;
}

module.exports = {
  isEnabled,
  generateForId,
  generateMissingGuidance,
};
