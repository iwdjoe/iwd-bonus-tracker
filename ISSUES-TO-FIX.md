# Security Issues To Fix
_Based on Security Audit Report (Feb 16, 2026). `api/get-stats` auth already resolved._

---

## CRITICAL

1. ~~**`save-rate` endpoint has no authentication** (`functions/save-rate.js`)~~ ✅ FIXED
   ~~Anyone can POST to `/api/save-rate` and modify billing rates in GitHub. Add Netlify Identity JWT validation.~~

2. ~~**`send-slack` endpoint has no authentication** (`functions/send-slack.js`)~~ ✅ FIXED
   ~~Anyone can POST to `/api/send-slack` and spam the team Slack channel with arbitrary content. Add JWT validation + rate limiting (1 post per 5 min).~~

3. ~~**`get-pulse-seq` endpoint has no authentication** (`functions/get-pulse-seq.js`)~~ ✅ FIXED
   ~~Exposes employee names, billable hours, billing rates, and project revenue publicly. Add JWT validation.~~

4. ~~**Stack trace exposed in error responses** (`functions/get-pulse-seq.js:79`)~~ ✅ FIXED
   ~~`error.stack` is returned in 500 responses, leaking internal file paths and dependency structure. Remove `stack` from response; log server-side only.~~

---

## HIGH

5. ~~**DOM-based XSS in index.html** (`public/index.html:629-635, 670-681`)~~ ✅ FIXED
   ~~User/project names from API injected via `innerHTML` without sanitization. Switch to `textContent` or add an escape function.~~

6. ~~**DOM-based XSS in pulse.html** (`public/pulse.html:372-377`)~~ ✅ FIXED
   ~~Same XSS pattern — `item.name` injected via `innerHTML`. Apply same fix as above.~~

7. **No input validation on `save-rate` inputs** (`functions/save-rate.js:15-16, 36`)
   `projectId` is used directly as a JSON key with no validation, enabling prototype pollution. Validate against a regex allowlist; check `rate` is a positive integer within a sane range.

8. **PII and billing rates exposed in API responses** (`functions/get-stats.js:95-96`, `functions/get-pulse-seq.js:50-65`)
   Full employee names and all client billing rates returned in API responses. Authenticate endpoints first, then consider returning only first names and restricting rate data to admin endpoints.

9. **Hardcoded GitHub repo path in 4+ files** (`get-stats.js`, `send-slack.js`, `get-pulse-seq.js`, `scripts/fetch-pulse.js`)
   Repo path `iwdjoe/iwd-bonus-tracker` is hardcoded everywhere. Move to a `GITHUB_REPO` env variable. Verify repo is private. Consider moving `rates.json` out of the repo.

10. **Client-side-only authentication** (`public/index.html:284-305`)
    Login gate and `@iwdagency.com` domain check are purely CSS/JS on the client. Since API endpoints are unprotected, hiding the UI provides zero security. Server-side auth (see items 1–3) is the real fix.

---

## MEDIUM

11. **No CORS restrictions on serverless functions** (`get-stats.js`, `save-rate.js`, `send-slack.js`)
    All origins are allowed by default. Restrict with `Access-Control-Allow-Origin: https://iwd-bonus-tracker.netlify.app` on all function responses.

12. **Unbounded pagination can exhaust resources** (`get-stats.js:62-71`, `send-slack.js:222-230`)
    Pagination loop can make 20 × sequential Teamwork API calls per request. Add an entry limit, timeout, and function-level rate limiting.

13. **In-memory cache poisoning risk** (`functions/get-stats.js:4, 32-34, 114`)
    Module-level cache persists across warm Lambda invocations with no invalidation. Add a cache-bust parameter and validate cached data structure before serving.

14. **Insufficient query param validation** (`functions/get-stats.js:15-25`)
    `month` regex allows invalid values like month `99` or year `0001`. Add bounds checking (year 2020–2030, month 1–12).

15. **Sensitive data in public static files** (`public/data.json`, `rates.json`)
    `data.json` (employee names + hours) is publicly served. `rates.json` (all billing rates) is committed to the repo and NOT in `.gitignore`. Add `rates.json` to `.gitignore`; gate `data.json` behind Netlify Identity or move it out of `public/`.

16. **Missing HTTP security headers** (`netlify.toml`)
    No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or `Referrer-Policy` configured. Add to `netlify.toml`.

17. **Prototype pollution risk in stats accumulators** (`get-stats.js:76-93`, `send-slack.js:235-252`)
    Teamwork API user/project names used as object keys with no validation. Use `Object.create(null)` instead of `{}` for these accumulators.

---

## LOW

18. **Error messages leak internal API details** (`get-stats.js:119`, `save-rate.js:62`, `send-slack.js:348`)
    Catch blocks return `error.message` (e.g., "Teamwork API 401") to the client. Return generic messages; log details server-side.

19. **No rate limiting on any endpoint** (all `functions/*.js`)
    `save-rate` can be hammered to make thousands of GitHub commits; `send-slack` can flood the channel. Implement IP-based rate limiting via Netlify Edge Functions or in-memory limiter.

20. **Deprecated `node-fetch` v2** (`package.json`, `bonus-bot/package.json`)
    `node-fetch@^2` is in maintenance mode. Migrate to Node 18+ built-in `fetch`. Move `require()` calls to the top of each file (currently loaded inside handler on every cold start).

---

## Suggested Fix Order

1. Add JWT auth to `save-rate`, `send-slack`, and `get-pulse-seq` (items 1–3, also resolves 8, 10)
2. Remove stack trace from error response (item 4)
3. Fix XSS in `index.html` and `pulse.html` (items 5–6)
4. Validate `save-rate` inputs (item 7)
5. Add `rates.json` to `.gitignore`, gate `data.json` (item 15)
6. Add CORS headers and HTTP security headers (items 11, 16)
7. Add rate limiting (items 12, 19)
8. Remaining medium/low items (13, 14, 17, 18, 20)
