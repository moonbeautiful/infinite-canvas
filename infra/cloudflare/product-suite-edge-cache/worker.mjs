const HOST = "ic.xinglinhui.com";
const CACHE_VERSION = "v2-7cff0a8";

const BYPASS_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "origin",
  "range",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "x-api-key",
  "x-gotocc-api-key",
  "cf-access-jwt-assertion",
  "forwarded",
  "x-forwarded-host",
  "x-original-host",
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "x-middleware-prefetch",
  "purpose",
  "sec-purpose",
];

const PAGE_VARY_HEADERS = new Set([
  "accept-encoding",
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
]);

const STATIC_VARY_HEADERS = new Set(["accept-encoding"]);
const SUPPORT_ASSET_PREFIXES = ["/ocr/", "/models/", "/wasm/", "/demo/"];

export function getPolicy(url) {
  if (url.search) return null;

  if (url.pathname === "/product-suite") {
    return {
      type: "page",
      edgeTtl: 86400,
      clientCacheControl:
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      allowedVary: PAGE_VARY_HEADERS,
    };
  }

  if (url.pathname.startsWith("/_next/static/")) {
    return {
      type: "asset",
      edgeTtl: 31536000,
      clientCacheControl: "public, max-age=31536000, immutable",
      allowedVary: STATIC_VARY_HEADERS,
    };
  }

  if (
    SUPPORT_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return {
      type: "asset",
      edgeTtl: 86400,
      clientCacheControl:
        "public, max-age=86400, stale-while-revalidate=604800",
      allowedVary: STATIC_VARY_HEADERS,
    };
  }

  return null;
}

export function hasBypassHeader(headers) {
  return BYPASS_HEADERS.some((name) => headers.has(name));
}

export function shouldBypass(request, url, policy) {
  return (
    request.method !== "GET" ||
    url.protocol !== "https:" ||
    url.hostname !== HOST ||
    url.pathname.startsWith("/api/") ||
    !policy ||
    hasBypassHeader(request.headers)
  );
}

export function responseIsSafe(response, policy) {
  if (response.status !== 200 || response.headers.has("set-cookie")) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control") || "";
  if (/(?:^|,)\s*(?:private|no-store)\b/i.test(cacheControl)) {
    return false;
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    policy.type === "page"
      ? !contentType.toLowerCase().startsWith("text/html")
      : contentType.toLowerCase().startsWith("text/html")
  ) {
    return false;
  }

  const vary = (response.headers.get("vary") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return (
    !vary.includes("*") &&
    vary.every((header) => policy.allowedVary.has(header))
  );
}

export function createCacheKey(request, url) {
  const keyUrl = new URL(url);
  keyUrl.pathname =
    `/__product_suite_edge_cache/${CACHE_VERSION}` + url.pathname;

  const headers = new Headers();
  const acceptEncoding = request.headers.get("accept-encoding");
  if (acceptEncoding) {
    headers.set("accept-encoding", acceptEncoding);
  }

  return new Request(keyUrl.toString(), {
    method: "GET",
    headers,
  });
}

function responseForClient(response, policy, status) {
  const clientResponse = new Response(response.body, response);
  clientResponse.headers.set("Cache-Control", policy.clientCacheControl);
  clientResponse.headers.set("X-Worker-Cache", status);
  clientResponse.headers.set("X-Worker-Cache-Version", CACHE_VERSION);
  return clientResponse;
}

export default {
  async fetch(request, _env, ctx) {
    const url = new URL(request.url);
    const policy = getPolicy(url);

    if (shouldBypass(request, url, policy)) {
      return fetch(request);
    }

    const cache = caches.default;
    const key = createCacheKey(request, url);

    try {
      const hit = await cache.match(key);
      if (hit) {
        return responseForClient(hit, policy, "HIT");
      }
    } catch (error) {
      console.error("cache.match failed", error);
    }

    const originResponse = await fetch(request);
    if (!responseIsSafe(originResponse, policy)) {
      return originResponse;
    }

    const storedResponse = new Response(originResponse.body, originResponse);
    storedResponse.headers.set(
      "Cache-Control",
      `public, max-age=${policy.edgeTtl}`,
    );
    storedResponse.headers.set("X-Worker-Cache-Version", CACHE_VERSION);

    const clientResponse = responseForClient(
      storedResponse.clone(),
      policy,
      "MISS",
    );

    ctx.waitUntil(
      cache
        .put(key, storedResponse)
        .catch((error) => console.error("cache.put failed", error)),
    );

    return clientResponse;
  },
};
