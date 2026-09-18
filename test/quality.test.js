const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalizeUrl,
  isRelevantCandidate,
  isValidDateOnly,
  isWithinRecentDays,
  normalizeSource,
  storyKey,
  taipeiDateString,
} = require('../src/scrapers/quality');
const { extractArticleBody, tryParseDateString } = require('../src/scrapers/utils');

test('strict date parsing rejects impossible and unrelated digit sequences', () => {
  assert.equal(tryParseDateString('發布於 2026/9/14 08:30'), '2026-09-14');
  assert.equal(tryParseDateString('2168-92-85'), null);
  assert.equal(tryParseDateString('編號 20260914001'), null);
  assert.equal(isValidDateOnly('2026-02-29'), false);
  assert.equal(isValidDateOnly('2024-02-29'), true);
});

test('recency uses Taipei calendar days and rejects future dates', () => {
  const now = new Date('2026-09-14T00:30:00Z');
  assert.equal(taipeiDateString(now), '2026-09-14');
  assert.equal(isWithinRecentDays('2026-09-11', 3, now), true);
  assert.equal(isWithinRecentDays('2026-09-10', 3, now), false);
  assert.equal(isWithinRecentDays('2026-09-15', 3, now), false);
});

test('candidate filtering keeps New Taipei election signals and drops broad party noise', () => {
  assert.equal(isRelevantCandidate('李四川新北造勢，侯友宜站台', '李四川 新北'), true);
  assert.equal(isRelevantCandidate('民眾黨公布全國不分區名單', '台灣民眾黨'), false);
});

test('URL, source and story identities are normalized', () => {
  assert.equal(
    canonicalizeUrl('https://www.udn.com/news/story/1/2/?utm_source=x&b=2&a=1#top'),
    'https://udn.com/news/story/1/2?a=1&b=2'
  );
  assert.equal(normalizeSource('udn.com', 'https://udn.com/news/story/1/2'), '聯合報');
  assert.equal(normalizeSource('Yahoo News', 'https://tw.news.yahoo.com/story.html'), 'Yahoo新聞');
  assert.equal(storyKey('「新北選戰」升溫！'), storyKey('新北選戰 升溫'));
});

test('structured articleBody wins over unrelated page paragraphs', () => {
  const html = `
    <html><body>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        articleBody: '這是第一段選戰新聞內容，包含足夠長度以通過正文品質門檻。'.repeat(8),
      })}</script>
      <article><p>這是頁面下方的無關推薦新聞，而且不應進入擷取結果。</p></article>
    </body></html>`;
  const body = extractArticleBody(html);
  assert.match(body, /第一段選戰新聞/);
  assert.doesNotMatch(body, /無關推薦新聞/);
});
