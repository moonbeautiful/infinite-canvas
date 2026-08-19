import assert from "node:assert/strict";
import test from "node:test";

import {
  createCacheKey,
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
    /^\/__product_suite_edge_cache\/v2-7cff0a8\//,
  );
  assert.equal(gzipKey.headers.get("accept-encoding"), "gzip");
  assert.equal(brKey.headers.get("accept-encoding"), "br");
});
