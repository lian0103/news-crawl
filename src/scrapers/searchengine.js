const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep, mapConcurrent, extractPublishDateFromHtml, extractArticleBody } = require('./utils');
const { URL } = require('url');
const { canonicalizeUrl, dedupeParagraphs, isRelevantCandidate, isWithinRecentDays } = require('./quality');

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
      const cleanUrl = canonicalizeUrl(href);
      let source = '';
      try {
        const u = new URL(cleanUrl);
        source = u.hostname.replace('www.', '');
      } catch (e) {
        source = 'unknown';
      }

      if (!candidates.has(cleanUrl) && isRelevantCandidate(text, keyword)) {
        candidates.set(cleanUrl, {
          title: text,
          source,
          url: cleanUrl,
          publish_date: ''
        });
      }
    });

    let articles = Array.from(candidates.values());

    // Apply recentDays filter
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    articles = articles.filter(a => isWithinRecentDays(a.publish_date, recentDays));

    // Limit to maxArticles
    const max = options.maxArticles || 8;
    articles = articles.slice(0, max);

    // Fetch content for each candidate concurrently
    await mapConcurrent(articles, options.concurrency || 4, async (art, i) => {
      console.log(`[SearchEngine] Fetching content ${i + 1}/${articles.length}: ${art.url}`);
      try {
        const pageHtml = await fetchHtml(art.url);
        art.content = extractArticleBody(pageHtml, [
          'article p', '[itemprop="articleBody"] p', '.article-body p',
          '.article-content p', '.story-body p', 'main article p',
        ]);
        // Try to extract publish date from article page
        try {
          const found = await extractPublishDateFromHtml(pageHtml, art.url);
          if (found) art.publish_date = found;
        } catch (e) {
          // ignore
        }
        // small delay to be gentle
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error('[SearchEngine] Failed to fetch content for', art.url, err.message);
        art.content = '';
      }
    });

    return articles.filter(a => a.content && isWithinRecentDays(a.publish_date, recentDays));
  } catch (err) {
    console.error('[SearchEngine] Scrape failed:', err.message);
    throw err;
  }
}

module.exports = scrapeSearchEngine;
