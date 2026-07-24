const COMMON_STOP_PHRASES = [
  '延伸閱讀',
  '更多新聞',
  '相關新聞',
  '點我下載',
  '點擊下載',
  '加入LINE',
  '加入 Line',
  '責任編輯',
  '本文授權',
  '廣告'
];

const SIGNAL_TERMS = [
  '選舉', '初選', '提名', '參選', '造勢', '民調', '表態', '抨擊', '回應', '質疑',
  '議會', '市政', '藍白', '民進黨', '國民黨', '民眾黨', '柯文哲', '蘇巧慧', '李四川', '劉和然',
  '侯友宜', '里長', '凍蒜', '基層', '政績', '掃街', '拜票', '廟口', '地方',
  '板橋', '三重', '新莊', '中和', '永和', '土城', '樹林', '三峽', '鶯歌', '淡水'
];

function normalizeArticleContent(content) {
  return (content || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !COMMON_STOP_PHRASES.some((phrase) => line.includes(phrase)))
    .join('\n');
}

function splitIntoSentences(content) {
  return normalizeArticleContent(content)
    .split(/(?<=[。！？!?；;])\s*/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 12);
}

function extractTitleTerms(title) {
  return (title || '')
    .split(/[｜|:：、，,\s()（）【】\[\]／/]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function scoreSentence(sentence, titleTerms, index, totalSentences) {
  let score = 0;
  const compactSentence = sentence.replace(/\s+/g, '');

  for (const term of titleTerms) {
    if (compactSentence.includes(term)) {
      score += Math.min(term.length, 6) * 2;
    }
  }

  for (const term of SIGNAL_TERMS) {
    if (compactSentence.includes(term)) {
      score += 3;
    }
  }

  if (compactSentence.length >= 20 && compactSentence.length <= 80) {
    score += 4;
  } else if (compactSentence.length <= 120) {
    score += 2;
  }

  if (index === 0) {
    score += 5;
  } else if (index === 1) {
    score += 3;
  } else if (index < Math.ceil(totalSentences / 3)) {
    score += 1;
  }

  if (/表示|指出|認為|強調|說明|回應|質疑|宣布|提到/.test(compactSentence)) {
    score += 2;
  }

  return score;
}

function buildExtractiveSummary(title, content) {
  const sentences = splitIntoSentences(content);
  if (sentences.length === 0) {
    return '（無法解析內容）';
  }

  if (sentences.length <= 2) {
    return sentences.join(' ');
  }

  const titleTerms = extractTitleTerms(title);
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, titleTerms, index, sentences.length)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = ranked
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence);

  const summary = selected.join(' ');
  return summary.length > 180 ? `${summary.substring(0, 177)}...` : summary;
}

function extractKeywords(title, content) {
  const mergedText = `${title || ''}\n${content || ''}`;
  const matched = SIGNAL_TERMS.filter((term) => mergedText.includes(term));
  if (matched.length > 0) {
    return matched.slice(0, 5).join(', ');
  }

  const titleTerms = extractTitleTerms(title);
  return (titleTerms.slice(0, 5).join(', ')) || '新北市選舉';
}

/**
 * Summarize an article and extract sentiment + keywords.
 * @param {string} title 
 * @param {string} content 
 * @returns {Promise<Object>} { summary, sentiment, keywords }
 */
async function summarizeArticle(title, content) {
  return ruleBasedSummarize(title, content);
}

/**
 * Generate a combined daily summary of all articles.
 * @param {string} date 
 * @param {Array} articles 
 * @returns {Promise<string>} Markdown text
 */
async function generateDailySummary(date, articles) {
  return ruleBasedDailySummary(date, articles);
}

// Fallback rule-based implementations
function ruleBasedSummarize(title, content) {
  const summary = buildExtractiveSummary(title, content);

  return {
    summary: summary || '（無法解析內容）',
    sentiment: 'Neutral',
    keywords: extractKeywords(title, content)
  };
}

function ruleBasedDailySummary(date, articles) {
  const count = articles.length;
  const sources = articles.reduce((acc, curr) => {
    acc[curr.source] = (acc[curr.source] || 0) + 1;
    return acc;
  }, {});

  const sourceBreakdown = Object.entries(sources).map(([src, num]) => `- ${src}：${num} 篇`).join('\n');
  const keywordCounts = {};

  articles.forEach((article) => {
    const keywords = (article.keywords || '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    keywords.forEach((keyword) => {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
    });
  });

  const topKeywords = Object.entries(keywordCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([keyword, num]) => `${keyword} (${num})`)
    .join('、') || '無明顯集中議題';

  const representativeArticles = articles
    .slice()
    .sort((left, right) => (right.summary || '').length - (left.summary || '').length)
    .slice(0, 3)
    .map((article, index) => {
      const shortSummary = (article.summary || '').trim() || '無摘要';
      return `${index + 1}. ${article.title}：${shortSummary}`;
    })
    .join('\n');

  return `
# ${date} 輿情每日摘要報告

本報告由系統依據新聞蒐集結果自動整理，不使用外部 AI 分析服務。

## 今日數據統計
- **今日總聲量**：共 ${count} 篇新聞。
- **報社來源分佈**：
${sourceBreakdown}

## 今日輿情焦點
今天的新聞主軸圍繞在新北市選舉相關人物、政黨攻防與地方議題推進。從當日報導量來看，媒體焦點集中在 ${topKeywords} 等主題，顯示這些議題是目前較容易帶動聲量的觀察點。

## 代表新聞摘要
${representativeArticles || '今日尚無可整理的代表新聞。'}

## 觀察重點
建議持續追蹤高頻關鍵詞是否延續，以及主要人物是否在不同媒體出現明顯不同的敘事角度。
  `;
}

module.exports = {
  summarizeArticle,
  generateDailySummary
};
