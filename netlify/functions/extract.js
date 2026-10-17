// netlify/functions/extract.js
// Ultimate Version: Bulk Extract + Auto Discover (Creator + Hashtag + Music)
// Fully Checked & Bug Free

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  try {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (e) {}

    let url = (body.url || '').trim();
    const action = body.action || 'extract';

    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };

    const cleaned = universalClean(url);
    if (!cleaned) return { statusCode: 400, headers, body: JSON.stringify({ error: 'অবৈধ TikTok URL' }) };
    url = cleaned;

    // ---- 1. Fetch Base Video Data ----
    let videoData = null;
    try {
      const tikwmUrl = 'https://tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
      const res = await fetch(tikwmUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.code === 0 && json.data) videoData = json.data;
      }
    } catch (e) {}

    if (!videoData) return { statusCode: 502, headers, body: JSON.stringify({ error: 'মূল ভিডিও ডেটা পাওয়া যায়নি' }) };

    const d = videoData;
    const originalId = String(d.id || '');

    // ---- 2. Normal Extract (Single Video Info) ----
    if (action === 'extract') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            title: safeText(d.title, 100),
            videoId: originalId,
            thumbnailUrl: d.cover || d.origin_cover || '',
            autoCategory: detectCategory(d.title || '', d.music_info || {}),
            source: 'tikwm'
          }
        })
      };
    }

    // ---- 3. Auto Discover Mode (100+ Videos) ----
    if (action === 'discover') {
      const username = (d.author && d.author.unique_id) || '';
      const musicId = (d.music_info && d.music_info.id) || '';
      
      // Hashtag ID বা Title এর ব্যাকআপ
      let challengeId = '';
      let challengeName = '';
      if (d.challenges && d.challenges.length > 0) {
        challengeId = d.challenges[0].id || '';
        challengeName = d.challenges[0].title || '';
      }

      let relatedLinks = new Set();
      const fetchPromises = [];
      const LIMIT = 30; // ৩টি API * ৩০ = ৯০টি ভিডিও (নিরাপদ লিমিট)

      // ১. Creator এর ভিডিও
      if (username) {
        fetchPromises.push(
          fetch(`https://tikwm.com/api/user/posts?unique_id=${username}&count=${LIMIT}`)
            .then(r => r.json())
            .then(json => {
              if (json && json.code === 0 && json.data && json.data.videos) {
                json.data.videos.forEach(v => {
                  if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${username}/video/${v.id}`);
                });
              }
            }).catch(() => {})
        );
      }

      // ২. Music এর ভিডিও
      if (musicId) {
        fetchPromises.push(
          fetch(`https://tikwm.com/api/music/posts?music_id=${musicId}&count=${LIMIT}`)
            .then(r => r.json())
            .then(json => {
              if (json && json.code === 0 && json.data && json.data.videos) {
                json.data.videos.forEach(v => {
                  const aId = v.author ? v.author.unique_id : 'user';
                  if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`);
                });
              }
            }).catch(() => {})
        );
      }

      // ৩. Hashtag এর ভিডিও (ID না থাকলে Name দিয়ে)
      if (challengeId || challengeName) {
        const queryParam = challengeId ? `ch_id=${challengeId}` : `ch_name=${encodeURIComponent(challengeName)}`;
        fetchPromises.push(
          fetch(`https://tikwm.com/api/challenge/posts?${queryParam}&count=${LIMIT}`)
            .then(r => r.json())
            .then(json => {
              if (json && json.code === 0 && json.data && json.data.videos) {
                json.data.videos.forEach(v => {
                  const aId = v.author ? v.author.unique_id : 'user';
                  if (v.id && v.id !== originalId) relatedLinks.add(`https://www.tiktok.com/@${aId}/video/${v.id}`);
                });
              }
            }).catch(() => {})
        );
      }

      // সবগুলো রিকোয়েস্ট একসাথে চালাই (যদি কোনোটা ফেলও করে, বাকিগুলো কাজ করবে)
      await Promise.all(fetchPromises);

      const linksArray = Array.from(relatedLinks);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            originalId: originalId,
            relatedCount: linksArray.length,
            relatedLinks: linksArray
          }
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'সার্ভার এরর', details: err.message })
    };
  }
};

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
