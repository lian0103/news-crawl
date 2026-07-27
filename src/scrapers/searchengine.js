const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep, mapConcurrent } = require('./utils');
const { URL } = require('url');

/**
 * Use a search engine (Bing News) to find relevant articles for a keyword.
 * Returns articles with { title, source, url, publish_date, content }
 */
async function scrapeSearchEngine(keyword, options = {}) {
  console.log(`[SearchEngine] Scraping keyword: ${keyword}`);
  const encoded = encodeURIComponent(keyword);
  const searchUrl = `https://www.bing.com/news/search?q=${encoded}`;

  try {
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    const candidates = new Map();

    // Bing News results often have anchors under .news-card or .newsitem; collect anchor tags
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = cleanText($(el).text());
      if (!href || !text) return;
      // Filter out Bing internal links
      if (href.includes('bing.com')) return;
      // Only http(s) links
      if (!/^https?:\/\//i.test(href)) return;
      // Skip very short texts
      if (text.length < 15) return;

      // Use hostname as source when available
      let source = '';
      try {
        const u = new URL(href);
        source = u.hostname.replace('www.', '');
      } catch (e) {
        source = 'unknown';
      }

      if (!candidates.has(href)) {
        candidates.set(href, {
          title: text,
          source,
          url: href,
          publish_date: new Date().toISOString().substring(0, 10)
        });
      }
    });

    let articles = Array.from(candidates.values());

    // Apply recentDays filter
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);
    articles = articles.filter(a => {
      if (!a.publish_date) return true;
      return new Date(a.publish_date) >= cutoff;
    });

    // Limit to maxArticles
    const max = options.maxArticles || 8;
    articles = articles.slice(0, max);

    // Fetch content for each candidate concurrently
    await mapConcurrent(articles, options.concurrency || 4, async (art, i) => {
      console.log(`[SearchEngine] Fetching content ${i + 1}/${articles.length}: ${art.url}`);
      try {
        const pageHtml = await fetchHtml(art.url);
        const $p = cheerio.load(pageHtml);
        let content = '';
        $p('article p, p').each((_, p) => {
          const t = $p(p).text().trim();
          if (t && t.length > 20) content += cleanText(t) + '\n';
        });
        art.content = content.trim();
        // small delay to be gentle
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error('[SearchEngine] Failed to fetch content for', art.url, err.message);
        art.content = '';
      }
    });

    return articles.filter(a => a.content && a.content.length > 0);
  } catch (err) {
    console.error('[SearchEngine] Scrape failed:', err.message);
    return [];
  }
}

module.exports = scrapeSearchEngine;
