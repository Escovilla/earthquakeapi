const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const PHIVOLCS_LATEST_URL = 'https://earthquake.phivolcs.dost.gov.ph/';
const PHIVOLCS_MONTHLY_URL = (year, month) =>
  `https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${year}/${year}_${month}.html`;

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

let memoryCache = {
  combined: [],
  lastUpdated: 0,
  lastResponse: null,
};

// 🧠 Utility
function corsResponse(body, status = 200, headers = {}) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  };
  return new Response(body, { status, headers: corsHeaders });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsResponse(null, 204);

    if (url.pathname === "/") {
      return corsResponse(JSON.stringify({
        message: "🌏 PHIVOLCS Earthquake Worker",
        endpoint: "/api/earthquakes",
      }));
    }

    if (url.pathname === "/api/earthquakes") {
      // 1️⃣ Try in-memory cache
      if (memoryCache.lastResponse) {
        ctx.waitUntil(refreshData(env));
        return corsResponse(memoryCache.lastResponse);
      }

      // 2️⃣ If memory empty, try KV storage
      const kvData = await env.PHIVOLCS_CACHE.get("latestData");
      if (kvData) {
        const parsed = JSON.parse(kvData);
        memoryCache = parsed; // restore to memory
        ctx.waitUntil(refreshData(env)); // refresh quietly
        return corsResponse(parsed.lastResponse);
      }

      // 3️⃣ No cache at all (first run)
      await refreshData(env);
      return corsResponse(memoryCache.lastResponse || JSON.stringify({ earthquakes: [] }));
    }

    return corsResponse(JSON.stringify({ error: "Not Found" }), 404);
  },
};

// 🧩 Data fetching & KV caching
async function refreshData(env) {
  try {
    const now = new Date();

    const latestEvents = await fetchEarthquakePage(PHIVOLCS_LATEST_URL);

    let year = now.getFullYear();
    let monthIndex = now.getMonth() - 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
    const prevMonthName = monthNames[monthIndex];
    const prevMonthEvents = await fetchEarthquakePage(
      PHIVOLCS_MONTHLY_URL(year, prevMonthName)
    );

    const combined = [...latestEvents, ...prevMonthEvents].sort(
      (a, b) => b.time - a.time
    );
    const responseBody = JSON.stringify({
      count: combined.length,
      earthquakes: combined,
      lastUpdated: new Date().toISOString(),
    });

    // Update both memory + KV
    memoryCache = {
      combined,
      lastUpdated: Date.now(),
      lastResponse: responseBody,
    };
    await env.PHIVOLCS_CACHE.put("latestData", JSON.stringify(memoryCache));

    console.log(`✅ Updated KV cache: ${combined.length} earthquakes`);
  } catch (err) {
    console.error("❌ refreshData error:", err);
  }
}

// 🪴 Fetch PHIVOLCS HTML
async function fetchEarthquakePage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Earthquake Monitor Worker)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);

    const html = await res.text();
    const events = [];

    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/gs)];
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((c) =>
        c[1].replace(/<[^>]*>/g, "").trim()
      );
      if (cells.length < 6) continue;

      const dateText = cells[0];
      const lat = parseFloat(cells[1]);
      const lon = parseFloat(cells[2]);
      const depth = parseFloat(cells[3]);
      const mag = parseFloat(cells[4]);
      const place = cells[5];

      if (!isFinite(lat) || !isFinite(lon) || !isFinite(mag)) continue;

      const time = new Date(dateText).getTime();
      events.push({ date: dateText, time, lat, lon, depth, mag, place });
    }

    return events.sort((a, b) => b.time - a.time);
  } catch (err) {
    console.error("⚠️ Error fetching PHIVOLCS data:", err.message);
    return [];
  }
}

