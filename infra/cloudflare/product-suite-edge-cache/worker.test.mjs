import assert from "node:assert/strict";
import test from "node:test";

import {
  createCacheKey,
  createOriginRequest,
  getEdgeRedirect,
  getPolicy,
  responseIsSafe,
  shouldBypass,
} from "./worker.mjs";

const pageUrl = new URL("https://ic.xinglinhui.com/product-suite");

test("only public cache paths receive a policy", () => {
  assert.equal(getPolicy(pageUrl)?.type, "page");
  assert.equal(getPolicy(pageUrl)?.edgeTtl, 86400);
  assert.equal(
    getPolicy(new URL("https://ic.xinglinhui.com/_next/static/app.js"))
      ?.edgeTtl,
    31536000,
  );
  assert.equal(
    getPolicy(new URL("https://ic.xinglinhui.com/wasm/model.wasm"))?.edgeTtl,
    86400,
  );
  assert.equal(
    getPolicy(new URL("https://ic.xinglinhui.com/product-suite?_rsc=1")),
    null,
  );
  assert.equal(
    getPolicy(
      new URL(
        "https://ic.xinglinhui.com/product-suite?utm_source=review&utm_id=42&utm_source_platform=partner",
      ),
    )?.type,
    "page",
  );
  assert.equal(
    getPolicy(new URL("https://ic.xinglinhui.com/api/gotocc/models")),
    null,
  );
});

test("API, non-GET, identity and RSC requests bypass", () => {
  const policy = getPolicy(pageUrl);

  assert.equal(
    shouldBypass(new Request(pageUrl, { method: "POST" }), pageUrl, policy),
    true,
  );
  assert.equal(
    shouldBypass(
      new Request(pageUrl, {
        headers: { Cookie: "session=secret" },
      }),
      pageUrl,
      policy,
    ),
    true,
  );
  assert.equal(
    shouldBypass(
      new Request(pageUrl, {
        headers: { Authorization: "Bearer secret" },
      }),
      pageUrl,
      policy,
    ),
    true,
  );
  assert.equal(
    shouldBypass(
      new Request(pageUrl, {
        headers: { RSC: "1" },
      }),
      pageUrl,
      policy,
    ),
    true,
  );
  assert.equal(shouldBypass(new Request(pageUrl), pageUrl, policy), false);
  assert.equal(
    shouldBypass(
      new Request(pageUrl, {
        headers: {
          "If-None-Match": '"cached"',
          "If-Modified-Since": "Wed, 19 Aug 2026 00:00:00 GMT",
        },
      }),
      pageUrl,
      policy,
    ),
    false,
  );
});

test("only expected HTML responses are cached as pages", () => {
  const policy = getPolicy(pageUrl);

  assert.equal(
    responseIsSafe(
      new Response("<main>ready</main>", {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          Vary: "RSC, Accept-Encoding",
        },
      }),
      policy,
    ),
    true,
  );
  assert.equal(
    responseIsSafe(
      new Response("component", {
        status: 200,
        headers: {
          "Content-Type": "text/x-component",
        },
      }),
      policy,
    ),
    false,
  );
  assert.equal(
    responseIsSafe(
      new Response("<main>private</main>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "private, no-store",
        },
      }),
      policy,
    ),
    false,
  );
  assert.equal(
    responseIsSafe(
      new Response("<main>cookie</main>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": "session=secret",
        },
      }),
      policy,
    ),
    false,
  );
  assert.equal(
    responseIsSafe(
      new Response("<main>bad vary</main>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          Vary: "Cookie",
        },
      }),
      policy,
    ),
    false,
  );
});

test("cache key is versioned and varies on content encoding", () => {
  const gzipKey = createCacheKey(
    new Request(pageUrl, {
      headers: { "Accept-Encoding": "gzip" },
    }),
    pageUrl,
  );
  const brKey = createCacheKey(
    new Request(pageUrl, {
      headers: { "Accept-Encoding": "br" },
    }),
    pageUrl,
  );

  assert.match(
    new URL(gzipKey.url).pathname,
    /^\/__product_suite_edge_cache\/v4-20260820\//,
  );
  assert.equal(gzipKey.headers.get("accept-encoding"), "gzip");
  assert.equal(brKey.headers.get("accept-encoding"), "br");
});

test("tracking links share the canonical page cache and origin request", () => {
  const trackingUrl = new URL(
    "https://ic.xinglinhui.com/product-suite?utm_source=review&gclid=123",
  );
  const request = new Request(trackingUrl, {
    headers: {
      "If-None-Match": '"old"',
      "If-Modified-Since": "Wed, 19 Aug 2026 00:00:00 GMT",
    },
  });
  const key = createCacheKey(request, trackingUrl);
  const origin = createOriginRequest(request, trackingUrl);

  assert.equal(new URL(key.url).search, "");
  assert.equal(new URL(origin.url).search, "");
  assert.equal(origin.headers.has("if-none-match"), false);
  assert.equal(origin.headers.has("if-modified-since"), false);
});

test("root navigation redirects at the edge without Render", () => {
  const rootUrl = new URL("https://ic.xinglinhui.com/?utm_source=review");
  const response = getEdgeRedirect(new Request(rootUrl), rootUrl);

  assert.equal(response?.status, 307);
  assert.equal(
    response?.headers.get("location"),
    "https://ic.xinglinhui.com/product-suite?utm_source=review",
  );
});
