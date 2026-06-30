const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Send an email with the PDF summary report as an attachment.
 * @param {string} date YYYY-MM-DD
 * @param {string} pdfPath Path to the generated PDF file
 * @returns {Promise<boolean>} Success status
 */
async function sendDailyEmail(date, pdfPath) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.EMAIL_TO;

  if (!host || !user || !pass || !to) {
    console.warn('[Mailer] SMTP configuration is incomplete. Skipping email dispatch.');
    console.warn(`[Mailer] Checked: host=${host}, user=${user}, pass=${pass ? '***' : 'missing'}, to=${to}`);
    return false;
  }

  console.log(`[Mailer] Preparing to send daily email for ${date} to ${to}...`);

  // Create transporter
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass
    }
  });

  const mailOptions = {
    from: `"新北市選舉輿情系統" <${user}>`,
    to: to,
    subject: `【輿情每日報告】${date} 新北市選舉輿情摘要與分析`,
    text: `您好：

附件為 ${date} 關於「新北市選舉」的輿情每日摘要報告 PDF 檔案。
本報告包含：
1. 今日輿情總量及報社聲量統計
2. 今日輿情大局觀與參選人動態分析
3. 重點新聞的 AI 摘要

祝工作順利！
新北市選舉輿情整理系統 敬上`,
    attachments: [
      {
        filename: `新北市選舉輿情報告_${date}.pdf`,
        path: pdfPath
      }
    ]
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('[Mailer] Email sent successfully:', info.messageId);
    return true;
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err.message);
    return false;
  }
}

module.exports = {
  sendDailyEmail
};
