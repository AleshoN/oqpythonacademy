const CACHE_NAME = "oq-python-academy-v4.0.0-fix1";
const DATA_PARTS = [
  "./data/academy-data-00.b64part",
  "./data/academy-data-01.b64part",
  "./data/academy-data-02.b64part",
  "./data/academy-data-03.b64part",
  "./data/academy-data-04.b64part",
];
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./version.json",
  "./icons/icon.svg",
  ...DATA_PARTS,
];

let dataBundlePromise = null;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/data/curriculum.json")) {
    event.respondWith(createDataResponse("curriculum"));
    return;
  }

  if (url.pathname.endsWith("/data/glossary.json")) {
    event.respondWith(createDataResponse("glossary"));
    return;
  }

  const isFreshnessCritical = request.mode === "navigate"
    || url.pathname.endsWith("version.json")
    || url.pathname.includes("/data/")
    || url.pathname.endsWith("app.js")
    || url.pathname.endsWith("styles.css")
    || url.pathname.endsWith("service-worker.js");

  event.respondWith(isFreshnessCritical ? networkFirst(request) : cacheFirst(request));
});

async function createDataResponse(key) {
  try {
    const bundle = await loadDataBundle();
    return new Response(JSON.stringify(bundle[key]), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function loadDataBundle() {
  if (dataBundlePromise) return dataBundlePromise;

  dataBundlePromise = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const partTexts = await Promise.all(DATA_PARTS.map(async (path) => {
      let response = await cache.match(path, { ignoreSearch: true });
      if (!response) {
        response = await fetch(path, { cache: "no-store" });
        if (!response.ok) throw new Error(`Datenteil fehlt: ${path}`);
        await cache.put(path, response.clone());
      }
      return response.text();
    }));

    const base64 = partTexts.join("").replace(/\s/g, "");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    if (!("DecompressionStream" in self)) {
      throw new Error("Dieser Browser unterstützt die benötigte Daten-Dekomprimierung nicht.");
    }

    const decompressedStream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const jsonText = await new Response(decompressedStream).text();
    return JSON.parse(jsonText);
  })();

  try {
    return await dataBundlePromise;
  } catch (error) {
    dataBundlePromise = null;
    throw error;
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
