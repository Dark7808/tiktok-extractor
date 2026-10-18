// api/extract.js (Vercel Backend) - Ultimate Fix

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

    // ১. এক্সট্রাক্ট মোড
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

    // ২. ডিসকভার মোড
    if (action === 'discover') {
      if (!url) return res.status(400).json({ error: 'URL required' });
      
      const baseRes = await fetch(`${RENDER_API}/api/video?url=${encodeURIComponent(url)}`);
      const baseJson = await baseRes.json();
      
      if (!baseJson.success) return res.status(404).json({ success: false, error: 'মূল ভিডিও পাওয়া যায়নি' });

      const d = baseJson.data;
      const originalId = String(d.id || '');
      const secUid = (d.author && d.author.sec_uid) || ''; 
      const musicId = (d.music_info && d.music_info.id) || '';

      let relatedLinks = new Set();
      const promises = [];

      if (secUid) {
        promises.push(
          fetch(`${RENDER_API}/api/user?secUid=${secUid}`)
            .then(r => r.json()).then(j => {
              if (j.success && j.links) {
                j.links.forEach(link => { 
                  if (!link.includes(originalId)) relatedLinks.add(link); 
                });
              }
            }).catch(() => {})
        );
      }

      if (musicId) {
        promises.push(
          fetch(`${RENDER_API}/api/music?music_id=${musicId}`)
            .then(r => r.json()).then(j => {
              if (j.code === 0 && j.data && j.data.videos) {
                j.data.videos.forEach(v => { 
                  const aId = v.author ? v.author.unique_id : 'user';
                  const link = `https://www.tiktok.com/@${aId}/video/${v.id}`;
                  if (!link.includes(originalId)) relatedLinks.add(link); 
                });
              }
            }).catch(() => {})
        );
      }

      await Promise.allSettled(promises);

      return res.status(200).json({
        success: true,
        data: { relatedCount: relatedLinks.size, relatedLinks: Array.from(relatedLinks) }
      });
    }

    // ৩. ফিড মোড (Explore)
    if (action === 'feed') {
      const region = body.region || 'BD';
      try {
        const feedRes = await fetch(`${RENDER_API}/api/feed?region=${region}`);
        const feedJson = await feedRes.json();
        return res.status(200).json(feedJson);
      } catch (e) { return res.status(500).json({ error: 'Feed error' }); }
    }

    // ৪. লাইভ মোড
    if (action === 'live') {
      const username = body.username || '';
      try {
        const liveRes = await fetch(`${RENDER_API}/api/live?username=${username}`);
        const liveJson = await liveRes.json();
        return res.status(200).json(liveJson);
      } catch (e) { return res.status(500).json({ error: 'Live error' }); }
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
