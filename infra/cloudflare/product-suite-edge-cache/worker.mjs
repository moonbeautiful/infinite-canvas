const HOST = "ic.xinglinhui.com";
const CACHE_VERSION = "v4-20260820";

const BYPASS_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "origin",
  "range",
  "if-match",
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
const TRACKING_PARAMETERS = new Set(["gclid", "fbclid"]);

export function getPolicy(url) {
  if (url.pathname === "/product-suite") {
    if (!hasOnlyTrackingParameters(url)) return null;
    return {
      type: "page",
      edgeTtl: 86400,
      clientCacheControl:
        "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      allowedVary: PAGE_VARY_HEADERS,
    };
  }

  if (url.search) return null;

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

export function getEdgeRedirect(request, url) {
  if (
    request.method !== "GET" ||
    url.protocol !== "https:" ||
    url.hostname !== HOST ||
    url.pathname !== "/" ||
    !hasOnlyTrackingParameters(url) ||
    request.headers.has("authorization") ||
    request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree")
  ) {
    return null;
  }

  return Response.redirect(`https://${HOST}/product-suite${url.search}`, 307);
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
  keyUrl.search = "";
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

export function createOriginRequest(request, url) {
  const originUrl = new URL(url);
  originUrl.search = "";
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(originUrl.toString(), {
    method: "GET",
    headers,
    redirect: "manual",
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
    const redirect = getEdgeRedirect(request, url);
    if (redirect) {
      return redirect;
    }
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

    const originResponse = await fetch(createOriginRequest(request, url));
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

function hasOnlyTrackingParameters(url) {
  return [...url.searchParams.keys()].every(
    (name) => name.startsWith("utm_") || TRACKING_PARAMETERS.has(name),
  );
}
