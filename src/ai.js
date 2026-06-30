const axios = require('axios');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = 'gemini-1.5-flash';

/**
 * Call Gemini API to generate content.
 * @param {string} prompt 
 * @param {boolean} forceJson 
 * @returns {Promise<string>}
 */
async function callGemini(prompt, forceJson = false) {
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined in environmental variables.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
  
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };

  if (forceJson) {
    requestBody.generationConfig = {
      responseMimeType: 'application/json'
    };
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30s timeout
    });

    if (
      response.data &&
      response.data.candidates &&
      response.data.candidates[0] &&
      response.data.candidates[0].content &&
      response.data.candidates[0].content.parts &&
      response.data.candidates[0].content.parts[0]
    ) {
      return response.data.candidates[0].content.parts[0].text;
    } else {
      throw new Error('Invalid response structure from Gemini API');
    }
  } catch (err) {
    console.error('Gemini API call failed:', err.response ? err.response.data : err.message);
    throw err;
  }
}

/**
 * Summarize an article and extract sentiment + keywords.
 * @param {string} title 
 * @param {string} content 
 * @returns {Promise<Object>} { summary, sentiment, keywords }
 */
async function summarizeArticle(title, content) {
  if (!API_KEY) {
    console.warn('[AI] Gemini API Key is missing. Using rule-based fallback.');
    return ruleBasedSummarize(title, content);
  }

  const prompt = `
你是一位資深的台灣政治輿情分析師。請分析以下關於「新北市選舉」的新聞：
標題：${title}
內文：${content}

請提供以下分析，並「只」回傳一個 JSON 物件，格式如下：
{
  "summary": "100到150字以內的繁體中文精簡摘要，描述新聞核心事件。",
  "sentiment": "針對此新聞對選舉局勢或主要參選人（如李四川、蘇巧慧、劉和然等）的情感傾向，只填寫 'Positive' (正面)、'Neutral' (中立) 或 'Negative' (負面)。",
  "keywords": ["關鍵詞1", "關鍵詞2", "關鍵詞3"]
}
  `;

  try {
    const jsonText = await callGemini(prompt, true);
    const result = JSON.parse(jsonText);
    return {
      summary: result.summary || content.substring(0, 150) + '...',
      sentiment: result.sentiment || 'Neutral',
      keywords: Array.isArray(result.keywords) ? result.keywords.join(', ') : ''
    };
  } catch (err) {
    console.error('[AI] Gemini article summarization failed, falling back:', err.message);
    return ruleBasedSummarize(title, content);
  }
}

/**
 * Generate a combined daily summary of all articles.
 * @param {string} date 
 * @param {Array} articles 
 * @returns {Promise<string>} Markdown text
 */
async function generateDailySummary(date, articles) {
  if (!API_KEY) {
    console.warn('[AI] Gemini API Key is missing. Using rule-based summary.');
    return ruleBasedDailySummary(date, articles);
  }

  if (articles.length === 0) {
    return '今日無相關輿情新聞。';
  }

  const articlesText = articles.map((a, i) => {
    return `[新聞 ${i+1}]
來源：${a.source}
標題：${a.title}
摘要：${a.summary}
情感傾向：${a.sentiment}
關鍵詞：${a.keywords}
    `;
  }).join('\n');

  const prompt = `
你是一位資深的台灣政治輿情分析專家。以下是 ${date} 當天蒐集到關於「新北市選舉」的新聞摘要列表：
${articlesText}

請撰寫一份「每日輿情綜合報告」，包含以下部分：
1. **今日輿情大局觀**：用 2-3 句話總結今天的整體選情聲量與核心焦點。
2. **主要參選人/政黨動態與聲量**：分析今天各個參選人（如李四川、蘇巧慧、劉和然等）或藍綠白陣營的曝光度與情感倾向分析（正面/負面事件）。
3. **焦點議題解析**：分析今天引起討論的核心議題（如市政攻防、交通通車、藍白整合等）。
4. **未來觀察點**：從今日的輿情中，推測未來幾天可能發酵的議題或選情走勢。

請用繁體中文撰寫，語氣專業、中立客觀，並使用精美的 Markdown 格式進行排版。
  `;

  try {
    const markdown = await callGemini(prompt, false);
    return markdown;
  } catch (err) {
    console.error('[AI] Gemini daily summary generation failed, falling back:', err.message);
    return ruleBasedDailySummary(date, articles);
  }
}

// Fallback rule-based implementations
function ruleBasedSummarize(title, content) {
  // Grab the first 150 characters
  const cleanContent = content.replace(/\s+/g, ' ').trim();
  const summary = cleanContent.length > 150 ? cleanContent.substring(0, 150) + '...' : cleanContent;
  
  // Basic keyword extraction based on common political names
  const keywordsList = [];
  if (content.includes('蘇巧慧')) keywordsList.push('蘇巧慧');
  if (content.includes('李四川')) keywordsList.push('李四川');
  if (content.includes('劉和然')) keywordsList.push('劉和然');
  if (content.includes('藍白')) keywordsList.push('藍白合');
  if (content.includes('通車')) keywordsList.push('三鶯線');
  if (keywordsList.length === 0) keywordsList.push('新北市選舉');

  return {
    summary: summary || '（無法解析內容）',
    sentiment: 'Neutral',
    keywords: keywordsList.join(', ')
  };
}

function ruleBasedDailySummary(date, articles) {
  const count = articles.length;
  const sources = articles.reduce((acc, curr) => {
    acc[curr.source] = (acc[curr.source] || 0) + 1;
    return acc;
  }, {});

  const sourceBreakdown = Object.entries(sources).map(([src, num]) => `- ${src}：${num} 篇`).join('\n');

  return `
# ${date} 輿情每日摘要報告 (統計版)

由於未配置 Gemini API 金鑰或呼叫失敗，本報告由系統自動生成統計數據。

## 今日數據統計
- **今日總聲量**：共 ${count} 篇新聞。
- **報社來源分佈**：
${sourceBreakdown}

## 輿情觀察與焦點關鍵詞
今天的新聞主要涵蓋新北市選舉的相關報導。
熱門提及人名與主題包括：蘇巧慧、李四川、劉和然等參選人。
建議手動閱讀以下列表中的新聞，以了解最新進度。
  `;
}

module.exports = {
  summarizeArticle,
  generateDailySummary
};
