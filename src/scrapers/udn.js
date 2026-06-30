const cheerio = require('cheerio');
const axios = require('axios');
const { fetchHtml, cleanText, sleep } = require('./utils');

/**
 * Scrape articles from UDN search results.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of articles
 */
async function scrapeUDN(keyword) {
  console.log(`[UDN] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  // We can fetch page 1
  const searchUrl = `https://udn.com/api/more?page=1&id=search:${encodedKeyword}&channelId=2&type=searchword`;
  
  const articles = [];
  try {
    const res = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.data || !res.data.lists) {
      console.warn('[UDN] No lists found in search API response');
      return [];
    }

    const lists = res.data.lists;
    console.log(`[UDN] Found ${lists.length} search results`);

    for (const item of lists) {
      const title = cleanText(item.title);
      const url = item.titleLink;

      // Extract date: item.time.date format is YYYY-MM-DD HH:mm
      let publishDate = '';
      if (item.time && item.time.date) {
        publishDate = item.time.date.split(' ')[0]; // gets YYYY-MM-DD
      } else {
        publishDate = new Date().toISOString().substring(0, 10);
      }

      if (!url || !title) continue;

      // Clean the URL (remove query params)
      const cleanUrl = url.split('?')[0];

      articles.push({
        title,
        source: '聯合報',
        url: cleanUrl,
        publish_date: publishDate
      });
    }

    // Now, fetch content for each article
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      console.log(`[UDN] Fetching content for article ${i + 1}/${articles.length}: ${art.title}`);
      try {
        const html = await fetchHtml(art.url);
        const $ = cheerio.load(html);
        
        // Match content paragraphs
        let contentText = '';
        $('section.article-content__editor p, .article-content__editor p, .story p, #article_body p').each((_, p) => {
          const text = $(p).text().trim();
          if (text) {
            contentText += text + '\n';
          }
        });

        // Fallback content if empty
        if (!contentText) {
          $('article p').each((_, p) => {
            const text = $(p).text().trim();
            if (text) {
              contentText += text + '\n';
            }
          });
        }

        art.content = contentText.trim();
        await sleep(1000); // 1s delay
      } catch (err) {
        console.error(`[UDN] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    }

  } catch (err) {
    console.error('[UDN] Scrape failed:', err.message);
  }

  return articles.filter(a => a.content);
}

module.exports = scrapeUDN;
