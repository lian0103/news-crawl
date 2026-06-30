const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep } = require('./utils');

/**
 * Scrape articles from LTN search results.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of articles
 */
async function scrapeLTN(keyword) {
  console.log(`[LTN] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  const searchUrl = `https://search.ltn.com.tw/list?keyword=${encodedKeyword}`;
  
  const articles = [];
  try {
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    $('div.cont').each((_, el) => {
      const aTit = $(el).find('a.tit');
      const title = cleanText(aTit.attr('title') || aTit.text());
      const url = aTit.attr('href');
      
      const timeText = $(el).find('span.time').text().trim();
      // Format 2026/03/10 to 2026-03-10
      let publishDate = '';
      const match = timeText.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (match) {
        publishDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      } else {
        publishDate = new Date().toISOString().substring(0, 10);
      }

      if (url && title) {
        const cleanUrl = url.split('?')[0];
        articles.push({
          title,
          source: '自由時報',
          url: cleanUrl,
          publish_date: publishDate
        });
      }
    });

    console.log(`[LTN] Found ${articles.length} search results`);

    // Fetch content for each article
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      console.log(`[LTN] Fetching content for article ${i + 1}/${articles.length}: ${art.title}`);
      try {
        const artHtml = await fetchHtml(art.url);
        const $art = cheerio.load(artHtml);
        
        let contentText = '';
        $art('div.text p, .articlebody p, .text p').each((_, p) => {
          // Avoid text that is inside sub-elements or scripts/advertisements if any
          const text = $art(p).text().trim();
          if (text && !$art(p).hasClass('appE112') && !$art(p).find('script').length) {
            contentText += text + '\n';
          }
        });

        art.content = contentText.trim();
        await sleep(1000); // 1s delay
      } catch (err) {
        console.error(`[LTN] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    }

  } catch (err) {
    console.error('[LTN] Scrape failed:', err.message);
  }

  return articles.filter(a => a.content);
}

module.exports = scrapeLTN;
