# Product Suite Edge Cache

Cloudflare Worker for the public `/product-suite` shell and its static
assets. The Worker uses `caches.default` because a normal Cache Rule did
not persist responses through Render's Cloudflare for SaaS O2O path.

## Cache Boundary

Cached:

- Query-free `GET /product-suite` HTML.
- `/_next/static/*`.
- `/ocr/*`, `/models/*`, `/wasm/*`, and `/demo/*`.

Always bypassed:

- Every `/api/*` request.
- Non-GET requests and any query string.
- Cookie, authorization, gotocc key, Origin, Range, conditional, RSC,
  Next router prefetch, and middleware prefetch requests.
- Non-200, non-HTML page responses, HTML asset responses, `Set-Cookie`,
  `private`, `no-store`, or unknown `Vary` responses.

## Deploy

Run the unit tests before deployment:

```bash
node --test worker.test.mjs
```

Every Render release that changes the shell or unhashed support assets
must increment `CACHE_VERSION` in `worker.mjs`. Deploy with Wrangler or
the Cloudflare dashboard, then verify:

```bash
curl -sS -D - -o /dev/null https://ic.xinglinhui.com/product-suite
curl -sS -D - -o /dev/null https://ic.xinglinhui.com/product-suite
```

For a cold version key in the same Cloudflare edge location, the first
response includes `X-Worker-Cache: MISS` and a repeated request includes
`X-Worker-Cache: HIT`, an increasing `Age`, and the same `rndr-id`. A
warm cache may return `HIT` immediately; requests routed to different
`CF-Ray` location suffixes must be evaluated independently. Requests to
`/api/*`, RSC requests, and requests with Cookie or Authorization
headers must not include `X-Worker-Cache`.

Rollback by removing the exact `ic.xinglinhui.com/*` Worker route.
