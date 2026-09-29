// netlify/functions/extract.js
// tikwm.com এর সাথে server-side কথা বলে — CORS নেই, Key লাগে না

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  try {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}

    const url = (body.url || '').trim();
    if (!url) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };
    }

    // ---- ১ম চেষ্টা: tikwm.com ----
    try {
      const tikwmUrl = 'https://www.tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
      const res = await fetch(tikwmUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        if (json && json.code === 0 && json.data) {
          const d = json.data;
          let title = (d.title || '').replace(/\s+/g, ' ').trim();
          if (!title) title = 'Untitled';
          if (title.length > 100) title = title.slice(0, 100).trim();

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              data: {
                title: title,
                videoId: String(d.id || ''),
                thumbnailUrl: d.cover || d.origin_cover || d.dynamic_cover || '',
                authorName: (d.author && d.author.nickname) || '',
                authorUniqueId: (d.author && d.author.unique_id) || '',
                source: 'tikwm'
              }
            })
          };
        }
      }
    } catch (e) {
      // tikwm fail — পরের চেষ্টায় যাই
    }

    // ---- ২য় চেষ্টা: TikTok oEmbed ----
    try {
      const oembedUrl = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
      const res2 = await fetch(oembedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (res2.ok) {
        const o = await res2.json();
        const m = url.match(/\/video\/(\d+)/);
        let title2 = (o.title || '').replace(/\s+/g, ' ').trim();
        if (!title2) title2 = 'Untitled';
        if (title2.length > 100) title2 = title2.slice(0, 100).trim();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: {
              title: title2,
              videoId: m ? m[1] : '',
              thumbnailUrl: o.thumbnail_url || '',
              authorName: o.author_name || '',
              authorUniqueId: o.author_unique_id || '',
              source: 'oembed'
            }
          })
        };
      }
    } catch (e) {
      // oEmbed fail
    }

    // দুইটাই fail
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'ডেটা পাওয়া যায়নি' })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'সার্ভার এরর',
        details: (err && err.message) ? err.message : String(err)
      })
    };
  }
};
