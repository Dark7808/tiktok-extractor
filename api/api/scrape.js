export default async function handler(req, res) {
    // CORS Header Enable করা যাতে ওয়েবসাইট ব্লক না হয়
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

        // ১. শর্ট ইউআরএল পার্সিং (vt.tiktok.com)
        let resolvedUrl = url;
        try {
            const headRes = await fetch(url, { method: 'HEAD', redirect: 'follow' });
            if (headRes.url) {
                resolvedUrl = headRes.url;
            }
        } catch (e) {
            // Fallback if HEAD fails
        }

        // আসল ইনপুট করা লিংকটি যুক্ত রাখা
        const cleanBaseUrl = resolvedUrl.split('?')[0];
        collectedLinks.add(cleanBaseUrl);

        // যদি Related Limit = 0 হয়, তবে শুধু আসল লিংক রিটার্ন করবে
        if (targetLimit === 0) {
            return res.status(200).json({
                success: true,
                total: collectedLinks.size,
                links: Array.from(collectedLinks)
            });
        }

        // ২. TikWM API থেকে সম্পর্কিত ও ট্রেন্ডিং ডেটা নিয়ে আসা
        const seedApi = `https://www.tikwm.com/api/?url=${encodeURIComponent(resolvedUrl)}`;
        const seedRes = await fetch(seedApi, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const seedJson = await seedRes.json();

        let searchKeyword = "trending";

        if (seedJson && seedJson.data) {
            // ভিডিওর ক্যাপশন থেকে হ্যাশট্যাগ ও কিওয়ার্ড আলাদা করা
            if (seedJson.data.title) {
                const tags = seedJson.data.title.match(/#\w+/g);
                if (tags && tags.length > 0) {
                    searchKeyword = tags[0].replace('#', '');
                } else {
                    searchKeyword = seedJson.data.title.slice(0, 15);
                }
            }
        }

        // ৩. রিলেটেড এবং র্যান্ডম ভিডিও লুপ স্ক্র্যাপিং
        let cursor = 0;
        let attempts = 0;
        const maxAttempts = Math.min(15, Math.ceil(targetLimit / 20));

        while (collectedLinks.size < targetLimit && attempts < maxAttempts) {
            attempts++;
            const feedUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(searchKeyword)}&count=30&cursor=${cursor}`;
            
            const feedRes = await fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
                break; // ডেটা শেষ হলে থামবে
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
