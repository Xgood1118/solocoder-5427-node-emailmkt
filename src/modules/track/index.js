const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const config = require('../../config');

const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function recordOpen(campaignId, userId, metadata = {}) {
  if (!storage.openEvents.has(campaignId)) {
    storage.openEvents.set(campaignId, new Map());
  }
  const campaignOpens = storage.openEvents.get(campaignId);

  const key = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  campaignOpens.set(key, {
    userId,
    timestamp: new Date(),
    userAgent: metadata.userAgent || '',
    ip: metadata.ip || ''
  });

  if (!campaignOpens.has(`user_${userId}`)) {
    campaignOpens.set(`user_${userId}`, { firstOpen: new Date(), count: 0 });
  }
  const userOpenData = campaignOpens.get(`user_${userId}`);
  userOpenData.count++;
  userOpenData.lastOpen = new Date();

  if (!storage.uniqueOpens.has(campaignId)) {
    storage.uniqueOpens.set(campaignId, new Set());
  }
  storage.uniqueOpens.get(campaignId).add(userId);
}

function recordClick(campaignId, userId, url, metadata = {}) {
  if (!storage.clickEvents.has(campaignId)) {
    storage.clickEvents.set(campaignId, new Map());
  }
  const campaignClicks = storage.clickEvents.get(campaignId);

  const key = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  campaignClicks.set(key, {
    userId,
    url,
    timestamp: new Date(),
    userAgent: metadata.userAgent || '',
    ip: metadata.ip || ''
  });

  if (!campaignClicks.has(`user_${userId}`)) {
    campaignClicks.set(`user_${userId}`, { firstClick: new Date(), count: 0, urls: new Set() });
  }
  const userClickData = campaignClicks.get(`user_${userId}`);
  userClickData.count++;
  userClickData.lastClick = new Date();
  userClickData.urls.add(url);
}

router.get('/pixel/:campaignId/:userId.gif', (req, res) => {
  const { campaignId, userId } = req.params;

  recordOpen(campaignId, userId, {
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(PIXEL_GIF);
});

router.get('/click/:campaignId/:userId', (req, res) => {
  const { campaignId, userId } = req.params;
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  recordClick(campaignId, userId, url, {
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  const decodedUrl = decodeURIComponent(url);
  res.redirect(302, decodedUrl);
});

router.get('/stats/:campaignId', (req, res) => {
  const { campaignId } = req.params;

  const campaignOpens = storage.openEvents.get(campaignId);
  const campaignClicks = storage.clickEvents.get(campaignId);

  let openCount = 0;
  let uniqueOpens = 0;
  let clickCount = 0;
  let uniqueClicks = 0;

  if (campaignOpens) {
    for (const [key, value] of campaignOpens.entries()) {
      if (key.startsWith('user_')) {
        uniqueOpens++;
        openCount += value.count;
      }
    }
  }

  if (campaignClicks) {
    for (const [key, value] of campaignClicks.entries()) {
      if (key.startsWith('user_')) {
        uniqueClicks++;
        clickCount += value.count;
      }
    }
  }

  res.json({
    success: true,
    campaignId,
    openCount,
    uniqueOpens,
    clickCount,
    uniqueClicks
  });
});

router.post('/conversion', (req, res) => {
  const { campaignId, userId, orderId, couponCode, amount } = req.body;

  if (!campaignId || !userId || !orderId) {
    return res.status(400).json({ error: 'campaignId, userId and orderId are required' });
  }

  if (!storage.conversions.has(campaignId)) {
    storage.conversions.set(campaignId, new Map());
  }
  const campaignConversions = storage.conversions.get(campaignId);

  if (campaignConversions.has(orderId)) {
    return res.json({ success: true, message: 'Conversion already recorded', conversion: campaignConversions.get(orderId) });
  }

  const conversion = {
    orderId,
    userId,
    campaignId,
    couponCode: couponCode || null,
    amount: amount || 0,
    timestamp: new Date()
  };
  campaignConversions.set(orderId, conversion);

  res.status(201).json({ success: true, conversion });
});

module.exports = router;
module.exports.recordOpen = recordOpen;
module.exports.recordClick = recordClick;
