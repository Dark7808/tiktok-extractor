// api/extract.js (Multi-API Fallback System)

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

    let url = (body.url || '').trim();
    const action = body.action || 'extract';
    const region = body.region || 'BD';

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    };

    // ================== EXPLORE ==================
    if (action === 'feed') {
      try {
        const feedUrl = `https://tikwm.com/api/feed/list?region=${region}&count=20`;
        const apiRes = await fetch(feedUrl, { headers: fetchHeaders });
        const json = await apiRes.json();
        if (json && json.code === 0 && json.data) {
          return res.status(200).json({ success: true, data: json.data.map(v => ({
            title: v.title, link: `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id}`, author: v.author.unique_id
          }))});
        }
        return res.status(404).json({ error: 'ফিড পাওয়া যায়নি' });
      } catch (e) { return res.status(500).json({ error: 'ফিড এরর' }); }
    }

    // ================== EXTRACT / DISCOVER ==================
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    // লিংক ক্লিন
    if (url.includes('tiktok.com')) {
      const match = url.match(/\/video\/(\d+)/);
      if (match) url = `https://www.tiktok.com/@_/video/${match[1]}`;
    }

    // ১. মূল ভিডিও ডেটা আনার চেষ্টা (Tiklydown API)
    let videoData = null;
    let videoId = '';
    let authorName = '';

    try {
      const res1 = await fetch(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`, { headers: fetchHeaders });
      const json1 = await res1.json();
      if (json1 && json1.id) {
        videoData = json1;
        videoId = json1.id;
        authorName = json1.author ? json1.author.unique_id : '';
      }
    } catch (e) {}

    // যদি Tiklydown ফেল করে, তবে TikWM দিয়ে চেষ্টা করি
    if (!videoData) {
      try {
        const res2 = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { headers: fetchHeaders });
        const json2 = await res2.json();
        if (json2 && json2.code === 0 && json2.data) {
          videoData = json2.data;
          videoId = json2.data.id;
          authorName = json2.data.author ? json2.data.author.unique_id : '';
        }
      } catch (e) {}
    }

    if (!videoData) return res.status(404).json({ error: 'ভিডিও ডেটা পাওয়া যায়নি বা প্রাইভেট' });

    // Extract Action (শুধু ডেটা)
    if (action === 'extract') {
      return res.status(200).json({
        success: true,
        data: {
          title: videoData.title || 'No title',
          videoId: videoId,
          thumbnailUrl: videoData.cover || videoData.thumbnail || '',
          autoCategory: 'Trending'
        }
      });
    }

    // Discover Action (রিলেটেড ভিডিও)
    if (action === 'discover') {
      let relatedLinks = new Set();
      const fetchPromises = [];

      // ১. ইউজারের অন্যান্য ভিডিও (TikWM API)
      if (authorName) {
        fetchPromises.push(
          fetch(`https://tikwm.com/api/user/posts?unique_id=${authorName}&count=30`, { headers: fetchHeaders })
            .then(r => r.json()).then(json => {
              if (json && json.code === 0 && json.data && json.data.videos) {
                json.data.videos.forEach(v => { if (v.id && v.id !== videoId) relatedLinks.add(`https://www.tiktok.com/@${authorName}/video/${v.id}`); });
              }
            }).catch(() => {})
        );
      }

      // ২. মিউজিকের অন্যান্য ভিডিও (TikWM API)
      let musicId = (videoData.music_info && videoData.music_info.id) || (videoData.music && videoData.music.id);
      if (musicId) {
        fetchPromises.push(
          fetch(`https://tikwm.com/api/music/posts?music_id=${musicId}&count=30`, { headers: fetchHeaders })
            .then(r => r.json()).then(json => {
              if (json && json.code === 0 && json.data && json.data.videos) {
                json.data.videos.forEach(v => { 
                  const aId = v.author ? v.author.unique_id : 'user'; 
                  if (v.id && v.id !== videoId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`); 
                });
              }
            }).catch(() => {})
        );
      }

      // ম্যাক্সিমাম ২৫ সেকেন্ড অপেক্ষা করবে ডেটার জন্য
      const timeout = new Promise(resolve => setTimeout(resolve, 25000));
      await Promise.race([Promise.allSettled(fetchPromises), timeout]);

      return res.status(200).json({
        success: true,
        data: { originalId: videoId, relatedCount: relatedLinks.size, relatedLinks: Array.from(relatedLinks) }
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
