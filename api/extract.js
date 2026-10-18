// api/extract.js (Ultimate All-in-One Version)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    let url = (body.url || '').trim();
    const action = body.action || 'extract';
    const sessionId = body.sessionId || ''; 
    const region = body.region || 'BD';

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    };
    if (sessionId) fetchHeaders['Cookie'] = `sessionid=${sessionId}`;

    // ================== ১. EXPLORE FEED ==================
    if (action === 'feed') {
      try {
        const feedUrl = `https://tikwm.com/api/feed/list?region=${region}&count=20`;
        const apiRes = await fetch(feedUrl, { headers: fetchHeaders });
        const json = await apiRes.json();
        if (json && json.code === 0 && json.data) {
          const videos = json.data.map(v => ({
            id: v.video_id, title: v.title || 'No title',
            link: `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id}`,
            author: v.author.unique_id
          }));
          return res.status(200).json({ success: true, data: videos });
        }
        return res.status(200).json({ success: false, error: 'ফিড পাওয়া যায়নি' });
      } catch (e) { return res.status(500).json({ error: 'ফিড লোড এরর' }); }
    }

    // ================== ২. LIVE STREAM ==================
    if (action === 'live') {
      const username = body.username || '';
      if (!username) return res.status(400).json({ error: 'ইউজারনেম দিন' });
      try {
        const liveUrl = `https://tikwm.com/api/live/info?unique_id=${username}`;
        const apiRes = await fetch(liveUrl, { headers: fetchHeaders });
        const json = await apiRes.json();
        if (json && json.code === 0 && json.data) return res.status(200).json({ success: true, data: json.data });
        return res.status(200).json({ success: false, error: 'লাইভে নেই' });
      } catch (e) { return res.status(500).json({ error: 'লাইভ চেক এরর' }); }
    }

    // ================== ৩. SINGLE EXTRACT ==================
    if (!url) return res.status(400).json({ error: 'URL required' });
    const cleaned = universalClean(url);
    if (!cleaned) return res.status(400).json({ error: 'অবৈধ URL' });
    url = cleaned;

    if (action === 'extract') {
      try {
        const tikwmUrl = 'https://tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
        const apiRes = await fetch(tikwmUrl, { headers: fetchHeaders });
        if (apiRes.ok) {
          const json = await apiRes.json();
          if (json && json.code === 0 && json.data) {
            const d = json.data;
            return res.status(200).json({
              success: true,
              data: {
                title: safeText(d.title, 100),
                videoId: String(d.id || ''),
                thumbnailUrl: d.cover || d.origin_cover || '',
                autoCategory: detectCategory(d.title || '', d.music_info || {})
              }
            });
          }
        }
        return res.status(404).json({ success: false, error: 'ভিডিও ডেটা পাওয়া যায়নি' });
      } catch (e) { return res.status(500).json({ success: false, error: 'নেটওয়ার্ক এরর' }); }
    }

    // ================== ৪. DISCOVER MODE ==================
    if (action === 'discover') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000); // ৭ সেকেন্ডে বন্ধ হবে

      try {
        const tikwmUrl = 'https://tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
        const baseRes = await fetch(tikwmUrl, { headers: fetchHeaders, signal: controller.signal });
        const baseJson = await baseRes.json();

        if (!baseJson || baseJson.code !== 0 || !baseJson.data) {
          clearTimeout(timeoutId);
          return res.status(404).json({ success: false, error: 'মূল ভিডিও পাওয়া যায়নি' });
        }

        const d = baseJson.data;
        const originalId = String(d.id || '');
        const username = (d.author && d.author.unique_id) || '';
        const musicId = (d.music_info && d.music_info.id) || '';

        let relatedLinks = new Set();
        const fetchPromises = [];

        if (username) {
          fetchPromises.push(
            fetch(`https://tikwm.com/api/user/posts?unique_id=${username}&count=25`, { headers: fetchHeaders, signal: controller.signal })
              .then(r => r.json()).then(json => {
                if (json && json.code === 0 && json.data && json.data.videos) {
                  json.data.videos.forEach(v => { if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${username}/video/${v.id}`); });
                }
              }).catch(() => {})
          );
        }

        if (musicId) {
          fetchPromises.push(
            fetch(`https://tikwm.com/api/music/posts?music_id=${musicId}&count=25`, { headers: fetchHeaders, signal: controller.signal })
              .then(r => r.json()).then(json => {
                if (json && json.code === 0 && json.data && json.data.videos) {
                  json.data.videos.forEach(v => { const aId = v.author ? v.author.unique_id : 'user'; if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`); });
                }
              }).catch(() => {})
          );
        }

        // ৭ সেকেন্ড অপেক্ষা করবে, এরপর যা পেয়েছে তাই দিবে
        await Promise.race([
            Promise.allSettled(fetchPromises),
            new Promise(resolve => setTimeout(resolve, 6500))
        ]);

        clearTimeout(timeoutId);
        return res.status(200).json({
          success: true,
          data: { originalId, relatedCount: relatedLinks.size, relatedLinks: Array.from(relatedLinks) }
        });

      } catch (e) {
        clearTimeout(timeoutId);
        // টাইমআউট হলেও যা পেয়েছে তা রিটার্ন করবে (ক্র্যাশ করবে না)
        return res.status(200).json({ success: true, data: { relatedLinks: [] } });
      }
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}

// ============ Helpers ============
function safeText(s, maxLen) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\|/g, '/');
  if (!s) return 'Untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

function universalClean(input) {
  if (!input) return null;
  if (/^\d{15,25}$/.test(input)) return 'https://www.tiktok.com/@_/video/' + input;
  var urlMatch = input.match(/https?:\/\/[^\s<>"'\)\]\}]+/i);
  if (urlMatch) input = urlMatch[0];
  input = input.replace(/[.,;:!?\)\]\}"']+$/, '');
  var vidM = input.match(/\/(?:video|v|photo)\/(\d+)/i);
  if (vidM) return 'https://www.tiktok.com/@_/video/' + vidM[1];
  return input;
}

function hasWord(text, word) {
  const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(^|[^A-Za-z0-9])' + safe + '($|[^A-Za-z0-9])', 'i');
  return re.test(text);
}

function detectCategory(title, music) {
  const text = [String(title || ''), String((music && music.title) || '')].join(' ').toLowerCase();
  if (!text.trim()) return 'Trending';
  const cats = [
    { n: 'Dance', w: ['dance', 'dancing'] }, { n: 'Comedy', w: ['funny', 'comedy', 'lol', 'humor'] },
    { n: 'Music', w: ['music', 'song', 'singing'] }, { n: 'Food', w: ['food', 'recipe', 'cooking'] },
    { n: 'Fashion', w: ['fashion', 'outfit', 'style'] }, { n: 'Sports', w: ['sport', 'football', 'cricket'] },
    { n: 'Pet', w: ['pet', 'cat', 'dog'] }, { n: 'Tech', w: ['tech', 'gadget', 'phone', 'coding'] }
  ];
  let best = 'Trending', bestScore = 0;
  for (let c of cats) {
    let score = 0; c.w.forEach(w => { if (hasWord(text, w)) score += w.length; });
    if (score > bestScore) { bestScore = score; best = c.n; }
  }
  return best;
}
