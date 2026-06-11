const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const config = require('../../config');

function isUnsubscribed(email) {
  const entry = storage.unsubscribes.get(email);
  if (!entry) return false;
  const hoursSince = (Date.now() - entry.unsubscribedAt.getTime()) / (1000 * 60 * 60);
  return hoursSince < config.unsubscribeSuppressionHours;
}

function addUnsubscribe(email, reason = 'user_request') {
  const existing = storage.unsubscribes.get(email);
  const entry = {
    email,
    reason,
    unsubscribedAt: new Date(),
    count: (existing ? existing.count : 0) + 1
  };
  storage.unsubscribes.set(email, entry);
  return entry;
}

router.get('/check/:email', (req, res) => {
  const unsubscribed = isUnsubscribed(req.params.email);
  const entry = storage.unsubscribes.get(req.params.email);
  res.json({
    success: true,
    email: req.params.email,
    unsubscribed,
    details: entry || null
  });
});

router.post('/unsubscribe/:email', (req, res) => {
  const reason = (req.body && req.body.reason) || (req.query && req.query.reason) || 'user_request';
  const entry = addUnsubscribe(req.params.email, reason);
  res.json({
    success: true,
    message: '退订成功，我们将在24小时内停止向您发送营销邮件',
    entry
  });
});

router.get('/unsubscribe/:email', (req, res) => {
  const email = req.params.email;
  addUnsubscribe(email, 'link_click');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>退订成功</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { background: white; padding: 40px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        p { color: #666; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>退订成功</h1>
        <p>您的邮箱 <strong>${email}</strong> 已成功退订。</p>
        <p>我们将在 24 小时内停止向您发送营销邮件。</p>
        <p>如有任何问题，请联系我们的客服团队。</p>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

router.post('/complaint/:email', (req, res) => {
  const email = req.params.email;
  const { campaignId } = req.body;

  const complaintKey = campaignId || 'global';
  if (!storage.spamComplaints.has(complaintKey)) {
    storage.spamComplaints.set(complaintKey, { count: 0, totalSends: 0, emails: new Set() });
  }
  const complaintData = storage.spamComplaints.get(complaintKey);
  complaintData.count++;
  complaintData.emails.add(email);

  if (complaintData.totalSends > 0) {
    const rate = complaintData.count / complaintData.totalSends;
    if (rate > config.spamComplaintThreshold) {
      storage.senderStatus.set(complaintKey, {
        status: 'paused',
        pausedAt: new Date(),
        reason: `spam_complaint_rate_too_high: ${(rate * 100).toFixed(3)}%`,
        complaintCount: complaintData.count,
        totalSends: complaintData.totalSends
      });
    }
  }

  addUnsubscribe(email, 'spam_complaint');

  res.json({
    success: true,
    message: '投诉已记录，该邮箱已加入退订列表'
  });
});

router.get('/sender-status', (req, res) => {
  const statuses = {};
  for (const [key, status] of storage.senderStatus.entries()) {
    statuses[key] = {
      ...status,
      emails: undefined
    };
  }
  res.json({ success: true, statuses });
});

router.post('/sender-status/:key/resume', (req, res) => {
  const status = storage.senderStatus.get(req.params.key);
  if (!status) {
    return res.status(404).json({ error: 'Sender status not found' });
  }

  storage.senderStatus.set(req.params.key, {
    ...status,
    status: 'active',
    resumedAt: new Date(),
    resumedBy: req.body?.resumedBy || 'admin'
  });

  res.json({
    success: true,
    message: '发件人已恢复'
  });
});

router.get('/list', (req, res) => {
  const { page = 1, limit = 100, reason, email, sort = 'desc' } = req.query;
  let allEntries = Array.from(storage.unsubscribes.values());

  if (reason) {
    allEntries = allEntries.filter(e => e.reason === reason);
  }

  if (email) {
    const emailLower = email.toLowerCase();
    allEntries = allEntries.filter(e => e.email.toLowerCase().includes(emailLower));
  }

  allEntries.sort((a, b) => {
    if (sort === 'asc') {
      return new Date(a.unsubscribedAt) - new Date(b.unsubscribedAt);
    }
    return new Date(b.unsubscribedAt) - new Date(a.unsubscribedAt);
  });

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const start = (pageNum - 1) * limitNum;
  const end = start + limitNum;
  const paginated = allEntries.slice(start, end);

  res.json({
    success: true,
    total: allEntries.length,
    page: pageNum,
    limit: limitNum,
    filteredCount: paginated.length,
    unsubscribes: paginated
  });
});

module.exports = router;
module.exports.isUnsubscribed = isUnsubscribed;
module.exports.addUnsubscribe = addUnsubscribe;
