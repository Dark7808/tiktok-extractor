export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url, limit = 50 } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, error: "Missing URL parameter" });
    }

    try {
        let collectedLinks = new Set();
        let targetLimit = parseInt(limit);

        // ১. শর্ট ইউআরএল (vt.tiktok.com) সলভ করা
        let resolvedUrl = url;
        try {
            const response = await fetch(url, { 
                method: 'GET', 
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (response.url) {
                resolvedUrl = response.url;
            }
        } catch (e) {
            console.log("Redirect error ignored:", e.message);
        }

        const cleanBaseUrl = resolvedUrl.split('?')[0];
        collectedLinks.add(cleanBaseUrl);

        if (targetLimit === 0) {
            return res.status(200).json({
                success: true,
                total: collectedLinks.size,
                links: Array.from(collectedLinks)
            });
        }

        // ২. TikWM API থেকে হ্যাশট্যাগ এবং কিওয়ার্ড বের করা
        let searchKeyword = "trending";
        try {
            const seedApi = `https://www.tikwm.com/api/?url=${encodeURIComponent(resolvedUrl)}`;
            const seedRes = await fetch(seedApi, { 
                headers: { 'User-Agent': 'Mozilla/5.0' } 
            });
            const seedJson = await seedRes.json();

            if (seedJson && seedJson.data) {
                if (seedJson.data.title) {
                    const tags = seedJson.data.title.match(/#\w+/g);
                    if (tags && tags.length > 0) {
                        searchKeyword = tags[0].replace('#', '');
                    } else {
                        searchKeyword = seedJson.data.title.slice(0, 15).trim() || "trending";
                    }
                }
            }
        } catch (err) {
            console.log("Seed fetch failed, using default fallback keyword.");
        }

        // ৩. রিলেটেড ভিডিও ফিড সার্চ
        let cursor = 0;
        let attempts = 0;
        const maxAttempts = Math.min(20, Math.ceil(targetLimit / 20));

        while (collectedLinks.size < targetLimit && attempts < maxAttempts) {
            attempts++;
            const feedUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(searchKeyword)}&count=30&cursor=${cursor}`;
            
            try {
                const feedRes = await fetch(feedUrl, { 
                    headers: { 'User-Agent': 'Mozilla/5.0' } 
                });
                const feedJson = await feedRes.json();

                if (feedJson && feedJson.data && feedJson.data.videos && feedJson.data.videos.length > 0) {
                    for (const vid of feedJson.data.videos) {
                        if (vid.author && vid.author.unique_id && vid.video_id) {
                            const realShareUrl = `https://www.tiktok.com/@${vid.author.unique_id}/video/${vid.video_id}`;
                            collectedLinks.add(realShareUrl);
                            if (collectedLinks.size >= targetLimit) break;
                        }
                    }
                } else {
                    break;
                }
            } catch (innerErr) {
                break;
            }

            cursor += 30;
        }

        return res.status(200).json({
            success: true,
            total: collectedLinks.size,
            links: Array.from(collectedLinks)
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: "Scraping failed",
            details: error.message
        });
    }
}
