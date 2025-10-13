// 🟠 server/index.js — REST API that returns JSON earthquake data from PHIVOLCS

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const PHIVOLCS_URL = 'https://earthquake.phivolcs.dost.gov.ph/';

// ✅ Ignore invalid SSL certificate (fixes: unable to verify the first certificate)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let cache = [];

async function fetchData() {
	try {
		const { data } = await axios.get(PHIVOLCS_URL, {
			headers: { 'User-Agent': 'Mozilla/5.0 (Earthquake Monitor)' },
			httpsAgent,
		});

		const $ = cheerio.load(data);

		// The earthquakes table usually has a header like 'Date/Time Latitude Longitude Depth Magnitude Location'
		const rows = $('table tr');
		const events = [];

		rows.each((_, row) => {
			const cells = $(row).find('td');
			if (cells.length < 6) return;

			const dateText = $(cells[0]).text().trim();
			const lat = parseFloat($(cells[1]).text());
			const lon = parseFloat($(cells[2]).text());
			const depth = parseFloat($(cells[3]).text());
			const mag = parseFloat($(cells[4]).text());
			const place = $(cells[5]).text().trim();

			if (!isFinite(lat) || !isFinite(lon) || !isFinite(mag)) return;

			const time = new Date(dateText).getTime();
			events.push({ date: dateText, lat, lon, depth, mag, place });
		});

		cache = events.sort((a, b) => b.time - a.time);
		console.log(`✅ Fetched ${cache.length} events from PHIVOLCS`);
	} catch (e) {
		console.error('⚠️ Error fetching PHIVOLCS data:', e.message);
	}
}

fetchData();
setInterval(fetchData, REFRESH_INTERVAL_MS);

app.get('/api/earthquakes', (req, res) => {
	res.json({ count: cache.length, earthquakes: cache });
});

app.listen(PORT, () =>
	console.log(`🚀 REST API running on http://localhost:${PORT}`)
);
