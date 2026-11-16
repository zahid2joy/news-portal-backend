const express = require('express');
const cors = require('cors');
const { scrapeNews } = require('./scraper');
let PrismaClient;
try {
  PrismaClient = require('./generated/client').PrismaClient;
} catch (e) {
  PrismaClient = require('@prisma/client').PrismaClient;
}

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// GET /api/news - খবর পাওয়ার রুট
app.get('/api/news', async (req, res) => {
  try {
    const { category, search } = req.query;
    let whereClause = {};

    if (category && category !== 'all') {
      whereClause.category = category;
    }

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { excerpt: { contains: search, mode: 'insensitive' } }
      ];
    }

    const news = await prisma.post.findMany({
      where: whereClause,
      include: { source: true },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });

    res.json(news);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}`);
  
  // ব্যাকএন্ড চালু হলে প্রথমবার স্ক্র্যাপার রান করবে
  try {
    await scrapeNews();
  } catch (err) {
    console.error('Scraper initial run error:', err);
  }
});

// প্রতি ১৫ মিনিট পরপর স্বয়ংক্রিয়ভাবে খবর আপডেট হবে
setInterval(async () => {
  try {
    await scrapeNews();
  } catch (err) {
    console.error('Scheduled scraper error:', err);
  }
}, 15 * 60 * 1000);