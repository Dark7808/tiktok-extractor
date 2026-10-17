// api/extract.js (Vercel Serverless Function)

export default async function handler(req, res) {
  // CORS হেডার সেট করা
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    let url = (body.url || '').trim();
    const action = body.action || 'extract';

    if (!url) return res.status(400).json({ error: 'URL required' });

    const cleaned = universalClean(url);
    if (!cleaned) return res.status(400).json({ error: 'অবৈধ TikTok URL' });
    url = cleaned;

    // ---- Fetch Base Video Data ----
    let videoData = null;
    try {
      const tikwmUrl = 'https://tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
      const apiRes = await fetch(tikwmUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      if (apiRes.ok) {
        const json = await apiRes.json();
        if (json && json.code === 0 && json.data) videoData = json.data;
      }
    } catch (e) {}

    if (!videoData) return res.status(502).json({ error: 'মূল ভিডিও ডেটা পাওয়া যায়নি' });

    const d = videoData;
    const originalId = String(d.id || '');

    // ---- 1. Normal Extract ----
    if (action === 'extract') {
      return res.status(200).json({
        success: true,
        data: {
          title: safeText(d.title, 100),
          videoId: originalId,
          thumbnailUrl: d.cover || d.origin_cover || '',
          autoCategory: detectCategory(d.title || '', d.music_info || {}),
          source: 'tikwm'
        }
      });
    }

    // ---- 2. Auto Discover Mode ----
    if (action === 'discover') {
      const username = (d.author && d.author.unique_id) || '';
      const musicId = (d.music_info && d.music_info.id) || '';
      let challengeId = '';
      let challengeName = '';
      if (d.challenges && d.challenges.length > 0) {
        challengeId = d.challenges[0].id || '';
        challengeName = d.challenges[0].title || '';
      }

      let relatedLinks = new Set();
      const fetchPromises = [];
      const LIMIT = 30; 

      if (username) {
        fetchPromises.push(fetch(`https://tikwm.com/api/user/posts?unique_id=${username}&count=${LIMIT}`).then(r => r.json()).then(json => {
          if (json && json.code === 0 && json.data && json.data.videos) {
            json.data.videos.forEach(v => { if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${username}/video/${v.id}`); });
          }
        }).catch(() => {}));
      }

      if (musicId) {
        fetchPromises.push(fetch(`https://tikwm.com/api/music/posts?music_id=${musicId}&count=${LIMIT}`).then(r => r.json()).then(json => {
          if (json && json.code === 0 && json.data && json.data.videos) {
            json.data.videos.forEach(v => { const aId = v.author ? v.author.unique_id : 'user'; if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`); });
          }
        }).catch(() => {}));
      }

      if (challengeId || challengeName) {
        const queryParam = challengeId ? `ch_id=${challengeId}` : `ch_name=${encodeURIComponent(challengeName)}`;
        fetchPromises.push(fetch(`https://tikwm.com/api/challenge/posts?${queryParam}&count=${LIMIT}`).then(r => r.json()).then(json => {
          if (json && json.code === 0 && json.data && json.data.videos) {
            json.data.videos.forEach(v => { const aId = v.author ? v.author.unique_id : 'user'; if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`); });
          }
        }).catch(() => {}));
      }

      await Promise.all(fetchPromises);

      return res.status(200).json({
        success: true,
        data: { originalId: originalId, relatedCount: relatedLinks.size, relatedLinks: Array.from(relatedLinks) }
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (err) {
    return res.status(500).json({ error: 'সার্ভার এরর', details: err.message });
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
  if (re.test(text)) return true;
  var hashRe = new RegExp('#' + safe + '($|[^A-Za-z0-9])', 'i');
  if (hashRe.test(text)) return true;
  return false;
}

function detectCategory(title, music) {
  const text = [String(title || ''), String((music && music.title) || ''), String((music && music.author) || '')].join(' ').toLowerCase();
  if (!text.trim()) return 'Trending';
  const categories = [
    { name: 'Dance',       words: ['dance', 'dancing', 'dancer', 'choreography', 'bailar', 'dancecover'] },
    { name: 'Comedy',      words: ['funny', 'comedy', 'lol', 'laugh', 'humor', 'joke', 'memes', 'meme', 'hilarious', 'prank'] },
    { name: 'Music',       words: ['music', 'song', 'singing', 'cover', 'karaoke', 'singer', 'melody', 'beat', 'lyrics'] },
    { name: 'Acting',      words: ['acting', 'actor', 'actress', 'skit', 'drama', 'scene', 'performance'] },
    { name: 'Entertainment', words: ['entertainment', 'celebrity', 'celeb', 'star', 'show', 'showbiz'] },
    { name: 'Food',        words: ['food', 'recipe', 'cooking', 'cook', 'baking', 'cake', 'chef', 'foodie', 'kitchen'] },
    { name: 'Fashion',     words: ['fashion', 'outfit', 'style', 'makeup', 'beauty', 'ootd', 'stylish', 'dress'] },
    { name: 'Fitness',     words: ['fitness', 'workout', 'gym', 'exercise', 'yoga', 'training', 'body'] },
    { name: 'Health',      words: ['health', 'healthy', 'wellness', 'diet', 'weight'] },
    { name: 'Travel',      words: ['travel', 'trip', 'traveling', 'tour', 'tourist', 'vacation', 'wanderlust'] },
    { name: 'Nature',      words: ['nature', 'sunset', 'sunrise', 'flower', 'mountain', 'ocean', 'sky', 'landscape'] },
    { name: 'Sports',      words: ['sport', 'football', 'cricket', 'soccer', 'sports', 'basketball', 'tennis', 'goal'] },
    { name: 'Gaming',      words: ['gaming', 'game', 'gamer', 'gameplay', 'pubg', 'freefire', 'minecraft'] },
    { name: 'Pet',         words: ['pet', 'cat', 'dog', 'kitten', 'puppy', 'pets', 'animal', 'puppies'] },
    { name: 'DIY',         words: ['diy', 'craft', 'handmade', 'tutorial', 'howto', 'how to', 'drawing', 'painting', 'art'] },
    { name: 'Photography', words: ['photography', 'photo', 'camera', 'shot', 'photoshoot'] },
    { name: 'Motivation',  words: ['motivation', 'motivational', 'inspiration', 'success', 'mindset', 'discipline'] },
    { name: 'Technology',  words: ['tech', 'technology', 'gadget', 'phone', 'computer', 'programming', 'coding', 'ai'] },
    { name: 'Education',   words: ['education', 'learn', 'learning', 'study', 'knowledge', 'tips', 'facts'] },
    { name: 'Business',    words: ['business', 'entrepreneur', 'money', 'marketing', 'sales', 'startup'] },
    { name: 'Family',      words: ['family', 'mom', 'dad', 'baby', 'kids', 'children', 'parenting'] },
    { name: 'Relationship', words: ['love', 'couple', 'relationship', 'romantic', 'valentine'] },
    { name: 'Trending',    words: ['trending', 'viral', 'fyp', 'foryou', 'for you', 'trend', 'explore'] }
  ];
  let bestMatch = null, bestScore = 0;
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]; let score = 0;
    for (let j = 0; j < cat.words.length; j++) { if (hasWord(text, cat.words[j])) score += cat.words[j].length; }
    if (score > bestScore) { bestScore = score; bestMatch = cat.name; }
  }
  return bestMatch || 'Trending';
}
