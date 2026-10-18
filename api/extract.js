// api/extract.js (Vercel Backend)

export const config = { maxDuration: 60 };
const RENDER_API = 'https://tiktok-api-bqk1.onrender.com'; 

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

    let url = (body.url || '').trim();
    const action = body.action || 'extract';

    if (action === 'extract') {
      if (!url) return res.status(400).json({ error: 'URL required' });
      const response = await fetch(`${RENDER_API}/api/video?url=${encodeURIComponent(url)}`);
      const json = await response.json();
      
      if (json.success && json.data) {
        const d = json.data;
        return res.status(200).json({
          success: true,
          data: {
            title: d.title || 'No Title',
            videoId: String(d.id || ''),
            thumbnailUrl: d.cover || d.origin_cover || '',
            autoCategory: 'Trending'
          }
        });
      }
      return res.status(404).json({ success: false, error: 'ভিডিও পাওয়া যায়নি' });
    }

    if (action === 'discover') {
      if (!url) return res.status(400).json({ error: 'URL required' });
      const baseRes = await fetch(`${RENDER_API}/api/video?url=${encodeURIComponent(url)}`);
      const baseJson = await baseRes.json();
      if (!baseJson.success) return res.status(404).json({ success: false, error: 'মূল ভিডিও পাওয়া যায়নি' });

      const d = baseJson.data;
      const originalId = String(d.id || '');
      const musicId = (d.music_info && d.music_info.id) || '';

      let relatedLinks = new Set();
      if (musicId) {
        try {
          const mRes = await fetch(`${RENDER_API}/api/music?music_id=${musicId}`);
          const mJson = await mRes.json();
          if (mJson.code === 0 && mJson.data && mJson.data.videos) {
            mJson.data.videos.forEach(v => { 
              const link = `https://www.tiktok.com/@${v.author.unique_id}/video/${v.id}`;
              if (!link.includes(originalId)) relatedLinks.add(link); 
            });
          }
        } catch(e) {}
      }
      return res.status(200).json({ success: true, data: { relatedLinks: Array.from(relatedLinks) } });
    }

    if (action === 'user') {
      const username = body.username || '';
      const uRes = await fetch(`${RENDER_API}/api/user?username=${username}`);
      const uJson = await uRes.json();
      return res.status(200).json(uJson);
    }

    if (action === 'hashtag') {
      const tag = body.tag || '';
      const hRes = await fetch(`${RENDER_API}/api/hashtag?tag=${tag}`);
      const hJson = await hRes.json();
      return res.status(200).json(hJson);
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
