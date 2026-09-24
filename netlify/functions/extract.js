const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

async function fetchFromRapidAPI(tiktokUrl) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;
  try {
    const host = 'tiktok-scraper7.p.rapidapi.com';
    const endpoint = 'https://' + host + '/video/info?url=' + encodeURIComponent(tiktokUrl);
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const author = d.author || {};
    return {
      username: author.unique_id || null,
      userId: author.id || null,
      secUid: author.sec_uid || null,
      nickname: author.nickname || null,
      followerCount: author.follower_count ?? null,
      videoId: d.id || null,
      title: d.title || null,
      thumbnailUrl: d.cover || d.origin_cover || null
    };
  } catch (e) { return null; }
}

async function resolveShortUrl(url) {
  const tryMethod = async (method) => {
    try {
      const res = await fetch(url, { method, redirect: 'manual', headers: { 'User-Agent': UA } });
      const loc = res.headers.get('location');
      if (loc) return loc.startsWith('http') ? loc : new URL(loc, url).href;
    } catch (_) {}
    return null;
  };
  return (await tryMethod('HEAD')) || (await tryMethod('GET')) || url;
}

function parseTikTokUrl(url) {
  let m = url.match(/@([^\/?#]+)\/video\/(\d+)/);
  if (m) return { username: m[1], videoId: m[2] };
  m = url.match(/\/video\/(\d+)/);
  if (m) return { username: null, videoId: m[1] };
  return null;
}

async function fetchOembed(url) {
  const endpoint = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
  const res = await fetch(endpoint, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('oEmbed HTTP ' + res.status);
  return res.json();
}

async function fetchUserInfoFallback(username) {
  const profileUrl = 'https://www.tiktok.com/@' + username;
  const res = await fetch(profileUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) return null;
  const html = await res.text();
  const uniMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (uniMatch) {
    try {
      const data = JSON.parse(uniMatch[1]);
      const user = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
      if (user) {
        return { userId: user.id || null, secUid: user.secUid || null, nickname: user.nickname || null, followerCount: user?.stats?.followerCount ?? null };
      }
    } catch (_) {}
  }
  return null;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  try {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    let url = (body.url || '').trim();
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL দরকার' }) };
    if (/vm\.tiktok\.com|vt\.tiktok\.com/i.test(url)) {
      url = await resolveShortUrl(url);
    }
    const parsed = parseTikTokUrl(url);
    if (!parsed || !parsed.videoId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'অবৈধ TikTok URL' }) };
    }
    const { username, videoId } = parsed;
    let oembed = null;
    try { oembed = await fetchOembed(url); }
    catch (_) { try { oembed = await fetchOembed(url.split('?')[0]); } catch (_) {} }
    let rapidData = null;
    if (process.env.RAPIDAPI_KEY) rapidData = await fetchFromRapidAPI(url);
    let userInfo = null;
    if (!rapidData && username) {
      try { userInfo = await fetchUserInfoFallback(username); } catch (_) {}
    }
    const data = {
      username: username || rapidData?.username || oembed?.author_unique_id || null,
      userId: rapidData?.userId || userInfo?.userId || null,
      secUid: rapidData?.secUid || userInfo?.secUid || null,
      nickname: rapidData?.nickname || userInfo?.nickname || oembed?.author_name || null,
      followerCount: rapidData?.followerCount ?? userInfo?.followerCount ?? null,
      videoId: rapidData?.videoId || videoId,
      title: rapidData?.title || oembed?.title || null,
      thumbnailUrl: oembed?.thumbnail_url || rapidData?.thumbnailUrl || null,
      embedHtml: oembed?.html || null,
      source: rapidData ? 'rapidapi' : userInfo ? 'scraping' : 'oembed-only'
    };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ডেটা বের করা যায়নি', details: err?.message || String(err) }) };
  }
};
