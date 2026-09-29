// netlify/functions/extract.js
// TikTok Bulk Extractor — tikwm.com + Auto Category

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

    const url = (body.url || '').trim();
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };

    // ---- ১ম চেষ্টা: tikwm.com ----
    let tikwmData = null;
    try {
      const tikwmUrl = 'https://tikwm.com/api/?url=' + encodeURIComponent(url) + '&hd=1';
      const res = await fetch(tikwmUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        if (json && json.code === 0 && json.data) {
          tikwmData = json.data;
        }
      }
    } catch (e) {}

    if (tikwmData) {
      const d = tikwmData;
      let title = safeText(d.title, 100);
      const category = detectCategory(d.title || '', d.music_info || {});

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
            autoCategory: category,
            source: 'tikwm'
          }
        })
      };
    }

    // ---- ২য় চেষ্টা: TikTok oEmbed ----
    try {
      const oembedUrl = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
      const res2 = await fetch(oembedUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (res2.ok) {
        const o = await res2.json();
        const m = url.match(/\/video\/(\d+)/);
        const title2 = safeText(o.title, 100);
        const category2 = detectCategory(o.title || '', {});

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
              autoCategory: category2,
              source: 'oembed'
            }
          })
        };
      }
    } catch (e) {}

    return { statusCode: 502, headers, body: JSON.stringify({ error: 'ডেটা পাওয়া যায়নি' }) };

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

// ============ Helpers ============

// টাইটেল পরিষ্কার — নতুন লাইন সরানো, পাইপ চিহ্ন সরানো
function safeText(s, maxLen) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  // পাইপ চিহ্ন সরানো — output ফরম্যাট ভাঙবে না
  s = s.replace(/\|/g, '/');
  if (!s) return 'Untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

// Word boundary ম্যাচ — "cat" যেন "concatenate" এ ম্যাচ না করে
function hasWord(text, word) {
  // হ্যাশট্যাগ প্যাটার্ন
  if (text.indexOf('#' + word) !== -1) return true;
  // Word boundary (regex-safe escaping)
  const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^a-z0-9])' + safe + '($|[^a-z0-9])', 'i');
  return re.test(text);
}

// ============ Auto Category Detection ============
function detectCategory(title, music) {
  const text = [
    String(title || ''),
    String((music && music.title) || ''),
    String((music && music.author) || '')
  ].join(' ').toLowerCase();

  if (!text.trim()) return 'Trending';

  const categories = [
    { name: 'Dance',      words: ['dance', 'dancing', 'dancer', 'choreography', 'bailar'] },
    { name: 'Comedy',     words: ['funny', 'comedy', 'lol', 'laugh', 'humor', 'joke', 'memes', 'meme', 'hilarious'] },
    { name: 'Music',      words: ['music', 'song', 'singing', 'cover', 'karaoke', 'singer', 'melody', 'beat', 'lyrics'] },
    { name: 'Food',       words: ['food', 'recipe', 'cooking', 'cook', 'baking', 'cake', 'chef', 'foodie', 'kitchen'] },
    { name: 'Fashion',    words: ['fashion', 'outfit', 'style', 'makeup', 'beauty', 'ootd', 'stylish', 'dress'] },
    { name: 'Travel',     words: ['travel', 'trip', 'traveling', 'tour', 'tourist', 'vacation', 'wanderlust'] },
    { name: 'Sports',     words: ['sport', 'football', 'cricket', 'soccer', 'sports', 'basketball', 'tennis', 'goal'] },
    { name: 'Pet',        words: ['pet', 'cat', 'dog', 'kitten', 'puppy', 'pets', 'animal', 'puppies'] },
    { name: 'DIY',        words: ['diy', 'craft', 'handmade', 'tutorial', 'howto', 'how to', 'drawing', 'painting'] },
    { name: 'Nature',     words: ['nature', 'sunset', 'sunrise', 'flower', 'mountain', 'ocean', 'sky', 'landscape'] },
    { name: 'Motivation', words: ['motivation', 'motivational', 'inspiration', 'success', 'mindset', 'discipline'] },
    { name: 'Technology', words: ['tech', 'technology', 'gadget', 'phone', 'computer', 'programming', 'coding'] },
    { name: 'Education',  words: ['education', 'learn', 'learning', 'study', 'knowledge', 'tips', 'facts'] },
    { name: 'Family',     words: ['family', 'mom', 'dad', 'baby', 'kids', 'children', 'parenting'] },
    { name: 'Trending',   words: ['trending', 'viral', 'fyp', 'foryou', 'for you', 'trend'] }
  ];

  let bestMatch = null;
  let bestScore = 0;

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    let score = 0;
    for (let j = 0; j < cat.words.length; j++) {
      const word = cat.words[j];
      if (hasWord(text, word)) {
        score += word.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cat.name;
    }
  }

  return bestMatch || 'Trending';
}
