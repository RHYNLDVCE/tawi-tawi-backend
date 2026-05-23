const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const express = require('express');

const { asyncHandler }  = require('../../../lib/async-handler');
const { HttpError }     = require('../../../lib/http-error');
const { hanapgawaAuth } = require('../../../middleware/hanapgawa-auth.middleware');
const env = require('../../../config/env');

const router = express.Router();

// ─── Location fallback data ───────────────────────────────────────────────────

const DEFAULT_LOCATIONS = [
  'Bongao, Tawi-Tawi, Philippines',
  'Panglima Sugala, Tawi-Tawi, Philippines',
  'Sapa-Sapa, Tawi-Tawi, Philippines',
  'Languyan, Tawi-Tawi, Philippines',
  'Tandubas, Tawi-Tawi, Philippines',
  'Simunul, Tawi-Tawi, Philippines',
  'Sitangkai, Tawi-Tawi, Philippines',
  'South Ubian, Tawi-Tawi, Philippines',
  'Turtle Islands, Tawi-Tawi, Philippines',
  'Mapun, Tawi-Tawi, Philippines',
  'Sibutu, Tawi-Tawi, Philippines',
].map((displayName, index) => ({
  id: `local-${index}`,
  name: displayName.split(',')[0],
  displayName,
  latitude: null,
  longitude: null,
}));

function localLocations(query) {
  const q = (query || '').toLowerCase();
  return DEFAULT_LOCATIONS.filter((l) =>
    !q || l.displayName.toLowerCase().includes(q) || l.name.toLowerCase().includes(q),
  );
}

// ─── GET /media/gifs/search ───────────────────────────────────────────────────

router.get('/gifs/search', asyncHandler(async (req, res) => {
  if (!env.GIPHY_API_KEY) throw new HttpError(503, 'GIF search is not configured.');

  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ gifs: [] });

  const url = new URL('https://api.giphy.com/v1/gifs/search');
  url.searchParams.set('api_key', env.GIPHY_API_KEY);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', Math.min(parseInt(req.query.limit) || 12, 25).toString());
  url.searchParams.set('rating', 'pg');

  const response = await fetch(url);
  if (!response.ok) throw new HttpError(502, 'GIF provider is unavailable.');

  const data = await response.json();
  const gifs = (data.data || [])
    .map((gif) => ({
      id:         gif.id,
      title:      gif.title || 'GIF',
      previewUrl: gif.images?.fixed_width_small?.url || gif.images?.preview_gif?.url,
      url:        gif.images?.fixed_width?.url || gif.images?.original?.url,
    }))
    .filter((g) => g.url);

  res.json({ gifs });
}));

// ─── GET /media/stickers/search ───────────────────────────────────────────────

router.get('/stickers/search', asyncHandler(async (req, res) => {
  if (!env.GIPHY_API_KEY) throw new HttpError(503, 'Sticker search is not configured.');

  const q        = (req.query.q || '').toString().trim();
  const endpoint = q ? 'search' : 'trending';
  const url      = new URL(`https://api.giphy.com/v1/stickers/${endpoint}`);
  url.searchParams.set('api_key', env.GIPHY_API_KEY);
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('limit', Math.min(parseInt(req.query.limit) || 20, 50).toString());
  url.searchParams.set('rating', 'pg');

  const response = await fetch(url);
  if (!response.ok) throw new HttpError(502, 'Sticker provider is unavailable.');

  const data     = await response.json();
  const stickers = (data.data || [])
    .map((s) => ({
      id:         s.id,
      title:      s.title || 'Sticker',
      previewUrl: s.images?.fixed_width_small?.url || s.images?.preview_gif?.url,
      url:        s.images?.fixed_width?.url || s.images?.original?.url,
    }))
    .filter((s) => s.url);

  res.json({ stickers });
}));

// ─── GET /media/locations/search — free (Nominatim) with local fallback ───────

router.get('/locations/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ locations: localLocations('') });

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${q}, Philippines`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', Math.min(parseInt(req.query.limit) || 8, 10).toString());
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':      'HanapGawa/1.0 (support@hanapgawa.app)',
        'Accept-Language': 'en',
      },
    });
    if (!response.ok) throw new Error('Nominatim unavailable');

    const data      = await response.json();
    const locations = data.map((place) => ({
      id:          place.place_id?.toString() || place.osm_id?.toString() || place.display_name,
      name:        place.name || place.display_name,
      displayName: place.display_name,
      latitude:    place.lat,
      longitude:   place.lon,
    }));

    res.json({ locations: locations.length ? locations : localLocations(q) });
  } catch {
    res.json({ locations: localLocations(q) });
  }
}));

// ─── GET /media/music/search — free (Deezer) ─────────────────────────────────

router.get('/music/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ tracks: [] });

  const url = new URL('https://api.deezer.com/search');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', Math.min(parseInt(req.query.limit) || 10, 20).toString());

  const response = await fetch(url);
  if (!response.ok) throw new HttpError(502, 'Music search is unavailable.');

  const data   = await response.json();
  const tracks = (data.data || []).map((track) => ({
    id:         track.id?.toString(),
    title:      track.title || 'Track',
    artist:     track.artist?.name || '',
    album:      track.album?.title || '',
    imageUrl:   track.album?.cover_medium || track.album?.cover || '',
    previewUrl: track.preview || '',
    musicUrl:   track.link || '',
    source:     'deezer',
  }));

  res.json({ tracks });
}));

// ─── GET /media/cloudinary-signature — auth required ─────────────────────────

router.get('/cloudinary-signature', hanapgawaAuth, asyncHandler(async (req, res) => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new HttpError(503, 'Media upload is not configured.');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder    = 'hanapgawa/posts';
  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest('hex');

  res.json({
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey:    CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  });
}));

// ─── POST /media/livekit/token — auth required ────────────────────────────────

router.post('/livekit/token', hanapgawaAuth, asyncHandler(async (req, res) => {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new HttpError(503, 'Live video is not configured.');
  }

  const room = (req.body.room || '').toString().trim();
  if (!room) throw new HttpError(400, 'Room is required.');

  const identity = req.auth.sub;
  const name     = req.auth.fullName || req.auth.email || req.auth.sub;
  const now      = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      iss:   LIVEKIT_API_KEY,
      sub:   identity,
      name,
      nbf:   now,
      exp:   now + 3600,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true },
    },
    LIVEKIT_API_SECRET,
    { algorithm: 'HS256' },
  );

  res.json({ url: LIVEKIT_URL, room, token });
}));

module.exports = { mediaRoutes: router };
