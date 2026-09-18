const { URL } = require('url');

const CORE_ENTITIES = [
  '李四川', '蘇巧慧', '吳亞倫', '劉和然', '侯友宜',
];

const ELECTION_CONTEXT = [
  '新北市長', '新北選舉', '新北選戰', '新北市議員', '新北議員', '百里侯',
  '參選', '候選人', '競選', '競總', '造勢', '拜票', '掃街', '民調',
];

const NEW_TAIPEI_CONTEXT = [
  '新北', '板橋', '三重', '新莊', '中和', '永和', '土城', '樹林',
  '三峽', '鶯歌', '淡水', '新店', '汐止', '瑞芳', '金山', '萬里',
];

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'mc_cid', 'mc_eid', 'ref', 'source', 'from', 'ocid',
  'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term',
]);

function canonicalizeUrl(input) {
  if (!input) return '';
  try {
    const url = new URL(input);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of Array.from(url.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch (_) {
    return input.split('#')[0];
  }
}

function normalizeTitle(title) {
  return (title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function storyKey(title) {
  return normalizeTitle(title).slice(0, 160);
}

function normalizeSource(source, articleUrl = '') {
  const raw = (source || '').trim();
  let host = '';
  try { host = new URL(articleUrl).hostname.replace(/^www\./, ''); } catch (_) {}
  if (raw === 'udn.com' || host === 'udn.com') return '聯合報';
  if (raw === 'news.ltn.com.tw' || host === 'news.ltn.com.tw') return '自由時報';
  if (raw === 'chinatimes.com' || host === 'chinatimes.com') return '中國時報';
  if (raw === 'tw.news.yahoo.com' || raw === 'Yahoo新聞' || raw === 'Yahoo News') return 'Yahoo新聞';
  return raw || host || '未知來源';
}

function scoreRelevance(title, keyword = '') {
  const text = `${title || ''} ${keyword || ''}`;
  const titleText = title || '';
  let score = 0;

  if (CORE_ENTITIES.some((term) => titleText.includes(term))) score += 45;
  if (ELECTION_CONTEXT.some((term) => titleText.includes(term))) score += 30;
  if (NEW_TAIPEI_CONTEXT.some((term) => titleText.includes(term))) score += 20;
  if (keyword && titleText.includes(keyword.trim())) score += 15;

  // A broad party-only query is useful only when the result also carries local/election context.
  if (/民眾黨|國民黨|民進黨/.test(text) &&
      !CORE_ENTITIES.some((term) => titleText.includes(term)) &&
      !NEW_TAIPEI_CONTEXT.some((term) => titleText.includes(term)) &&
      !ELECTION_CONTEXT.some((term) => titleText.includes(term))) {
    score -= 40;
  }

  return score;
}

function isRelevantCandidate(title, keyword = '', threshold = 30) {
  return scoreRelevance(title, keyword) >= threshold;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function taipeiDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function isWithinRecentDays(value, recentDays = 3, now = new Date()) {
  if (!value) return true;
  if (!isValidDateOnly(value)) return false;
  const today = taipeiDateString(now);
  const dayMs = 24 * 60 * 60 * 1000;
  const ageDays = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / dayMs;
  return ageDays >= 0 && ageDays <= recentDays;
}

function dedupeParagraphs(content) {
  const seen = new Set();
  return (content || '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (line.length < 20) return false;
      const key = line.normalize('NFKC').replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

module.exports = {
  canonicalizeUrl,
  dedupeParagraphs,
  isRelevantCandidate,
  isValidDateOnly,
  isWithinRecentDays,
  normalizeTitle,
  normalizeSource,
  scoreRelevance,
  storyKey,
  taipeiDateString,
};
