// netlify/functions/extract.js
// TikTok Bulk Extractor — Universal Auto-Detect v4 (Final)

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
    if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: 'URL required' }) };

    const cleaned = universalClean(url);
    if (!cleaned) return { statusCode: 400, headers, body: JSON.stringify({ error: 'অবৈধ TikTok URL' }) };
    url = cleaned;

    // ---- tikwm.com ----
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
        if (json && json.code === 0 && json.data) tikwmData = json.data;
      }
    } catch (e) {}

    if (tikwmData) {
      const d = tikwmData;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            title: safeText(d.title, 100),
            videoId: String(d.id || ''),
            thumbnailUrl: d.cover || d.origin_cover || d.dynamic_cover || '',
            videoUrl: d.play || d.wmplay || d.hdplay || '',
            authorName: (d.author && d.author.nickname) || '',
            authorUniqueId: (d.author && d.author.unique_id) || '',
            authorId: (d.author && d.author.id) || '',
            secUid: (d.author && d.author.sec_uid) || '',
            followerCount: (d.author && d.author.follower_count) || null,
            viewCount: d.play_count || d.views || null,
            likeCount: d.digg_count || null,
            commentCount: d.comment_count || null,
            shareCount: d.share_count || null,
            duration: d.duration || null,
            musicTitle: (d.music_info && d.music_info.title) || '',
            musicAuthor: (d.music_info && d.music_info.author) || '',
            uploadDate: d.create_time ? new Date(d.create_time * 1000).toISOString().split('T')[0] : '',
            autoCategory: detectCategory(d.title || '', d.music_info || {}),
            source: 'tikwm'
          }
        })
      };
    }

    // ---- oEmbed fallback ----
    try {
      const oembedUrl = 'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url);
      const res2 = await fetch(oembedUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (res2.ok) {
        const o = await res2.json();
        const m = url.match(/\/(?:video|v|photo)\/(\d+)/i);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: {
              title: safeText(o.title, 100),
              videoId: m ? m[1] : '',
              thumbnailUrl: o.thumbnail_url || '',
              videoUrl: '',
              authorName: o.author_name || '',
              authorUniqueId: o.author_unique_id || '',
              authorId: '', secUid: '', followerCount: null,
              viewCount: null, likeCount: null, commentCount: null,
              shareCount: null, duration: null,
              musicTitle: '', musicAuthor: '', uploadDate: '',
              autoCategory: detectCategory(o.title || '', {}),
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

// ============ Universal URL Cleaner ============
function universalClean(input) {
  input = String(input || '').trim();
  if (!input) return null;
  if (input.length > 2000) return null;

  // ১. Pure numeric ID
  if (/^\d{15,25}$/.test(input)) {
    return 'https://www.tiktok.com/@_/video/' + input;
  }

  // ২. URL বের করা
  var urlMatch = input.match(/https?:\/\/[^\s<>"'\)\]\}]+/i);
  if (urlMatch) {
    input = urlMatch[0];
  } else {
    var bareMatch = input.match(/(?:^|[\s\(\[\{>])((?:www\.|m\.|vt\.|vm\.|t\.)?tiktok\.com\/[^\s<>"'\)\]\}]+)/i);
    if (bareMatch) {
      input = 'https://' + bareMatch[1];
    } else {
      return null;
    }
  }

  // Trailing punctuation সরানো
  input = input.replace(/[.,;:!?\)\]\}"']+$/, '');

  if (!/^https?:\/\//i.test(input)) return null;
  if (!/tiktok\.com/i.test(input)) return null;

  // vt/vm short
  var shortM = input.match(/^https?:\/\/(vt|vm)\.tiktok\.com\/([A-Za-z0-9]+)/i);
  if (shortM) return 'https://' + shortM[1].toLowerCase() + '.tiktok.com/' + shortM[2] + '/';

  // t.tiktok.com/i18n/share/video/ID
  var i18nM = input.match(/^https?:\/\/t\.tiktok\.com\/i18n\/share\/video\/(\d+)/i);
  if (i18nM) return 'https://www.tiktok.com/@_/video/' + i18nM[1];

  // www.tiktok.com/t/XXXXX/
  var tShareM = input.match(/^https?:\/\/(?:www\.)?tiktok\.com\/t\/([A-Za-z0-9]+)/i);
  if (tShareM) return 'https://www.tiktok.com/t/' + tShareM[1] + '/';

  // embed URL
  var embedM = input.match(/tiktok\.com\/embed\/(?:v2\/)?(\d+)/i);
  if (embedM) return 'https://www.tiktok.com/@_/video/' + embedM[1];

  // Full @user URL
  var fullM = input.match(/^(https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^\/?#]+\/(?:video|v|photo)\/\d+)/i);
  if (fullM) return fullM[1];

  // শুধু /video/ID etc
  var vidM = input.match(/\/(?:video|v|photo)\/(\d+)/i);
  if (vidM) return 'https://www.tiktok.com/@_/video/' + vidM[1];

  return input;
}

// ============ Helpers ============
function safeText(s, maxLen) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\|/g, '/');
  if (!s) return 'Untitled';
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

function hasWord(text, word) {
  const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(^|[^A-Za-z0-9])' + safe + '($|[^A-Za-z0-9])', 'i');
  if (re.test(text)) return true;
  var hashRe = new RegExp('#' + safe + '($|[^A-Za-z0-9])', 'i');
  if (hashRe.test(text)) return true;
  return false;
}

// ============ Smart Auto Category ============
function detectCategory(title, music) {
  const text = [
    String(title || ''),
    String((music && music.title) || ''),
    String((music && music.author) || '')
  ].join(' ').toLowerCase();
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
    const cat = categories[i];
    let score = 0;
    for (let j = 0; j < cat.words.length; j++) {
      if (hasWord(text, cat.words[j])) score += cat.words[j].length;
    }
    if (score > bestScore) { bestScore = score; bestMatch = cat.name; }
  }
  return bestMatch || 'Trending';
}
