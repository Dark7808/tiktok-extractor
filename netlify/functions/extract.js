// netlify/functions/extract.js
const API_HOST = 'tiktok-scraper7.p.rapidapi.com';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  try {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) return { statusCode: 500, headers, body: JSON.stringify({ error: 'RAPIDAPI_KEY সেট করা হয়নি' }) };

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}

    const url = (body.url || '').trim();
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL প্রয়োজন' }) };

    const endpoint = 'https://' + API_HOST + '/video/info?url=' + encodeURIComponent(url);
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': API_HOST }
    });

    if (res.status === 429) return { statusCode: 429, headers, body: JSON.stringify({ error: 'RapidAPI লিমিট শেষ (429)' }) };
    if (res.status === 403) return { statusCode: 403, headers, body: JSON.stringify({ error: 'RapidAPI Key ভুল (403)' }) };
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify({ error: 'API এরর ' + res.status }) };

    const json = await res.json();
    if (!json || json.code !== 0 || !json.data) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: json && json.msg ? json.msg : 'ডেটা পাওয়া যায়নি' }) };
    }

    const d = json.data;
    const author = d.author || {};
    let title = (d.title || '').replace(/\s+/g, ' ').trim();
    if (!title) title = 'Untitled';
    if (title.length > 100) title = title.slice(0, 100).trim();

    const data = {
      title: title,
      videoId: String(d.id || d.video_id || ''),
      thumbnailUrl: d.cover || d.origin_cover || d.dynamic_cover || '',
      userId: author.id || '',
      secUid: author.sec_uid || '',
      nickname: author.nickname || '',
      username: author.unique_id || '',
      followerCount: author.follower_count != null ? author.follower_count : null
    };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'সার্ভার এরর', details: err && err.message ? err.message : String(err) }) };
  }
};
