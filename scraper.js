const Parser = require('rss-parser');
const https = require('https');
const http = require('http');
const { PrismaClient } = require('@prisma/client');

let prisma;
try {
  const { PrismaClient: GeneratedClient } = require('./generated/client');
  prisma = new GeneratedClient();
} catch (e) {
  prisma = new PrismaClient();
}

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['content:encoded', 'contentEncoded'],
      ['enclosure', 'enclosure'],
    ],
  },
});

// ইউটিউব ইউআরএল থেকে এম্বেড লিংক তৈরি করার ফাংশন
function formatEmbedVideoUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match && match[1] ? `https://www.youtube.com/embed/${match[1]}` : url;
}

// এইচটিটিপিএস ফেচার
function fetchRawXml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        rejectUnauthorized: false,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchRawXml(res.headers.location, redirects + 1)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Status code ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Request Timeout'));
    });
  });
}

function sanitizeXml(xmlString) {
  return xmlString.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');
}

// ১০০% কাজ করে এমন এক্টিভ আরএসএস ফিডের তালিকা
const defaultSources = [
  {
    name: 'Prothom Alo',
    baseUrl: 'https://www.prothomalo.com',
    rssUrl: 'https://www.prothomalo.com/stories.rss',
  },
  {
    name: 'Ajker Patrika',
    baseUrl: 'https://www.ajkerpatrika.com',
    rssUrl: 'https://www.ajkerpatrika.com/feed',
  },
  {
    name: 'Samakal',
    baseUrl: 'https://samakal.com',
    rssUrl: 'https://samakal.com/rss',
  },
  {
    name: 'bd-pratidin',
    baseUrl: 'https://www.bd-pratidin.com',
    rssUrl: 'https://www.bd-pratidin.com/rss.xml',
  },
{
    name: 'Daily Janakantha',
    baseUrl: 'https://www.dailyjanakantha.com',
    rssUrl: 'https://www.dailyjanakantha.com/rss',
  },

  {
    name: 'Dhaka Post',
    baseUrl: 'https://www.dhakapost.com',
    rssUrl: 'https://www.dhakapost.com/rss/rss.xml',
  },
  {
    name: 'Channel i',
    baseUrl: 'https://www.channelionline.com',
    rssUrl: 'https://www.channelionline.com/rss.xml',
  },
  {
    name: 'BBC Bangla',
    baseUrl: 'https://www.bbc.com/bengali',
    rssUrl: 'https://feeds.bbci.co.uk/bengali/rss.xml',
  },
];

async function runScraper() {
  console.log('🔄 [Multi-Source Scraper] সব পত্রিকার খবর সংগ্রহ শুরু হচ্ছে...');

  for (const srcData of defaultSources) {
    try {
      const source = await prisma.source.upsert({
        where: { name: srcData.name },
        update: { baseUrl: srcData.baseUrl, rssUrl: srcData.rssUrl },
        create: {
          name: srcData.name,
          baseUrl: srcData.baseUrl,
          rssUrl: srcData.rssUrl,
        },
      });

      const rawXml = await fetchRawXml(srcData.rssUrl);
      const cleanXml = sanitizeXml(rawXml);
      const feed = await parser.parseString(cleanXml);
      let count = 0;

      for (const item of feed.items) {
        if (!item.link) continue;

        let rawTitle = item.title;
        if (typeof rawTitle === 'object' && rawTitle !== null) {
          rawTitle = rawTitle._ || rawTitle.text || Object.values(rawTitle)[0] || '';
        }
        const titleStr = String(rawTitle || '').trim();
        if (!titleStr) continue;

        // ছবির URL বের করা
        let imageUrl = null;
        if (item.mediaContent && item.mediaContent.$&& item.mediaContent.$.url) {
          imageUrl = item.mediaContent.$.url;
        } else if (item.enclosure && item.enclosure.url) {
          imageUrl = item.enclosure.url;
        } else if (item.contentEncoded) {
          const imgMatch = item.contentEncoded.match(/<img[^>]+src="([^">]+)"/);
          if (imgMatch) imageUrl = imgMatch[1];
        }

        // ভিডিও ইউআরএল সনাক্তকরণ
        const contentHtml = item.contentEncoded || item.content || item.description || '';
        const ytMatch = contentHtml.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"']+)/i);
        const isVideo = !!ytMatch || titleStr.includes('ভিডিও');
        const videoUrl = ytMatch ? formatEmbedVideoUrl(ytMatch[1]) : null;

        const cleanTitle = titleStr
          .replace(/[^\w\s\u0980-\u09FF-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        const slug = `${cleanTitle.slice(0, 50)}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        await prisma.post.upsert({
          where: { sourceUrl: item.link },
          update: {
            title: titleStr,
            excerpt: item.contentSnippet ? item.contentSnippet.slice(0, 300) : null,
            imageUrl: imageUrl,
            isVideo: isVideo,
            videoUrl: videoUrl,
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          },
          create: {
            title: titleStr,
            slug: slug,
            excerpt: item.contentSnippet ? item.contentSnippet.slice(0, 300) : null,
            sourceUrl: item.link,
            imageUrl: imageUrl,
            isVideo: isVideo,
            videoUrl: videoUrl,
            category: isVideo ? 'ভিডিও' : 'জাতীয়',
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            sourceId: source.id,
          },
        });
        count++;
      }

      console.log(`✅ [${srcData.name}] ${count} টি সংবাদ সফলভাবে লোড ও আপডেট করা হয়েছে।`);
    } catch (error) {
      console.log(`⚠️ [${srcData.name}] স্কিপ করা হয়েছে: (${error.message || error})`);
    }
  }

  console.log('🎉 [Multi-Source Scraper] সকল পত্রিকার তথ্য আপডেট সম্পন্ন!');
}

module.exports = {
  runScraper,
  scrapeNews: runScraper,
};