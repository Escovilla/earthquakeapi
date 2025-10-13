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

// URLs
const PHIVOLCS_LATEST_URL = 'https://earthquake.phivolcs.dost.gov.ph/';
const PHIVOLCS_MONTHLY_URL = (year, month) =>
	`https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/${year}/${year}_${month}.html`;

// Ignore invalid SSL certificate
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let cache = {
	combined: [], // latest + previous month
};

// Helper to get month names
const monthNames = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

async function fetchEarthquakePage(url) {
	try {
		const { data } = await axios.get(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (Earthquake Monitor)' },
			httpsAgent,
		});

		const $ = cheerio.load(data);
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
			events.push({ date: dateText, time, lat, lon, depth, mag, place });
		});

		return events.sort((a, b) => b.time - a.time);
	} catch (e) {
		console.error('⚠️ Error fetching PHIVOLCS data:', e.message);
		return [];
	}
}

async function fetchData() {
	// 1️⃣ Latest earthquakes
	const latestEvents = await fetchEarthquakePage(PHIVOLCS_LATEST_URL);

	// 2️⃣ Previous month
	const now = new Date();
	let year = now.getFullYear();
	let monthIndex = now.getMonth() - 1; // previous month
	if (monthIndex < 0) {
		// handle January
		monthIndex = 11;
		year -= 1;
	}
	const prevMonthName = monthNames[monthIndex];
	const prevMonthEvents = await fetchEarthquakePage(
		PHIVOLCS_MONTHLY_URL(year, prevMonthName)
	);

	// 3️⃣ Combine both
	cache.combined = [...latestEvents, ...prevMonthEvents].sort(
		(a, b) => b.time - a.time
	);

	console.log(
		`✅ Combined ${cache.combined.length} events (latest + previous month)`
	);
}

fetchData();
setInterval(fetchData, REFRESH_INTERVAL_MS);

// API endpoint
app.get('/api/earthquakes', (req, res) => {
	res.json({ count: cache.combined.length, earthquakes: cache.combined });
});

app.listen(PORT, () =>
	console.log(`🚀 REST API running on http://localhost:${PORT}`)
);
