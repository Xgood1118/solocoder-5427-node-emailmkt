const nodemailer = require('nodemailer');
const config = require('../../config');
const storage = require('../../storage');
const { renderTemplate } = require('../template/templateEngine');
const { isUnsubscribed } = require('../unsubscribe');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port == 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
  }
  return transporter;
}

class EmailQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.sendTimestamps = [];
    this.rateLimitPerHour = config.rateLimitPerHour;
  }

  canSendNow() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    this.sendTimestamps = this.sendTimestamps.filter(t => t > oneHourAgo);
    return this.sendTimestamps.length < this.rateLimitPerHour;
  }

  getNextSendDelay() {
    if (this.canSendNow()) return 0;
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    if (this.sendTimestamps.length > 0) {
      const oldest = this.sendTimestamps[0];
      const waitTime = oldest - oneHourAgo;
      return Math.max(0, waitTime + 1000);
    }
    return 60000;
  }

  injectTrackingPixel(html, campaignId, userId) {
    const pixelUrl = `${config.baseUrl}/track/pixel/${campaignId}/${userId}.gif`;
    const pixelTag = `<img src="${pixelUrl}" alt="" width="1" height="1" border="0" style="display:none!important;">`;
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixelTag}</body>`);
    }
    return html + pixelTag;
  }

  injectTrackingLinks(html, campaignId, userId) {
    const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    return html.replace(linkRegex, (match, url) => {
      if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:')) {
        return match;
      }
      const encodedUrl = encodeURIComponent(url);
      const trackUrl = `${config.baseUrl}/track/click/${campaignId}/${userId}?url=${encodedUrl}`;
      return match.replace(url, trackUrl);
    });
  }

  injectUnsubscribeLink(html, email) {
    const encodedEmail = encodeURIComponent(email);
    const unsubscribeUrl = `${config.baseUrl}/unsubscribe/unsubscribe/${encodedEmail}`;
    const unsubscribeHtml = `
      <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center;">
        <p>如果您不想再收到此类邮件，请<a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline;">取消订阅</a></p>
      </div>
    `;
    if (html.includes('</body>')) {
      return html.replace('</body>', `${unsubscribeHtml}</body>`);
    }
    return html + unsubscribeHtml;
  }

  add(emailData) {
    const job = {
      id: storage.generateId('job'),
      ...emailData,
      status: 'queued',
      retryCount: 0,
      maxRetries: config.retryAttempts,
      createdAt: new Date(),
      error: null
    };

    if (isUnsubscribed(emailData.to)) {
      job.status = 'skipped';
      job.skippedReason = 'user_unsubscribed';
      job.finishedAt = new Date();
      storage.sends.set(job.id, job);
      return job;
    }

    this.queue.push(job);
    this.process();
    return job;
  }

  addBatch(emailDataList) {
    const jobs = [];
    for (const data of emailDataList) {
      const job = {
        id: storage.generateId('job'),
        ...data,
        status: 'queued',
        retryCount: 0,
        maxRetries: config.retryAttempts,
        createdAt: new Date(),
        error: null
      };

      if (isUnsubscribed(data.to)) {
        job.status = 'skipped';
        job.skippedReason = 'user_unsubscribed';
        job.finishedAt = new Date();
        storage.sends.set(job.id, job);
        continue;
      }

      this.queue.push(job);
      jobs.push(job);
    }
    this.process();
    return jobs;
  }

  async process() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      if (!this.canSendNow()) {
        const delay = this.getNextSendDelay();
        this.processing = false;
        setTimeout(() => this.process(), delay);
        return;
      }

      const job = this.queue.shift();
      job.status = 'sending';

      try {
        await this.sendEmail(job);
        job.status = 'sent';
        job.sentAt = new Date();
        this.sendTimestamps.push(Date.now());
      } catch (error) {
        job.retryCount++;
        job.error = error.message;

        if (job.retryCount < job.maxRetries) {
          job.status = 'retrying';
          const delay = Math.pow(2, job.retryCount) * 1000;
          setTimeout(() => {
            this.queue.push(job);
            this.process();
          }, delay);
        } else {
          job.status = 'failed';
          job.failedAt = new Date();
        }
      }

      storage.sends.set(job.id, { ...job });
    }

    this.processing = false;
  }

  async sendEmail(job) {
    const { to, subject, html, campaignId, userId, from } = job;

    let renderedHtml = html;
    if (job.templateData) {
      renderedHtml = renderTemplate(html, job.templateData);
    }

    if (campaignId && userId) {
      renderedHtml = this.injectTrackingPixel(renderedHtml, campaignId, userId);
      renderedHtml = this.injectTrackingLinks(renderedHtml, campaignId, userId);
    }

    renderedHtml = this.injectUnsubscribeLink(renderedHtml, to);

    let renderedSubject = subject;
    if (job.templateData && subject) {
      renderedSubject = renderTemplate(subject, job.templateData);
    }

    const mailOptions = {
      from: from || config.smtp.from,
      to,
      subject: renderedSubject,
      html: renderedHtml
    };

    if (!config.smtp.host) {
      console.log(`[Mock Send] To: ${to}, Subject: ${renderedSubject}`);
      return { messageId: `mock_${Date.now()}`, mock: true };
    }

    const transporter = getTransporter();
    return await transporter.sendMail(mailOptions);
  }

  getStats() {
    const queued = this.queue.length;
    let sent = 0, failed = 0, skipped = 0, retrying = 0;

    for (const job of storage.sends.values()) {
      if (job.status === 'sent') sent++;
      else if (job.status === 'failed') failed++;
      else if (job.status === 'skipped') skipped++;
      else if (job.status === 'retrying') retrying++;
    }

    return {
      queued,
      sent,
      failed,
      skipped,
      retrying,
      rateLimitPerHour: this.rateLimitPerHour,
      sentThisHour: this.sendTimestamps.filter(t => t > Date.now() - 60 * 60 * 1000).length
    };
  }

  getJobs(status, limit = 100) {
    const jobs = [];
    for (const job of storage.sends.values()) {
      if (!status || job.status === status) {
        jobs.push(job);
      }
    }
    jobs.sort((a, b) => b.createdAt - a.createdAt);
    return jobs.slice(0, limit);
  }
}

const emailQueue = new EmailQueue();

module.exports = emailQueue;
