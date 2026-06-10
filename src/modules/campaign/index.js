const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const emailQueue = require('../queue/emailQueue');
const { getSegmentUsers } = require('../list/segmentEngine');
const { isUnsubscribed } = require('../unsubscribe');

const CAMPAIGN_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PAUSED: 'paused'
};

function getCampaignStats(campaignId) {
  const campaign = storage.campaigns.get(campaignId);
  if (!campaign) return null;

  const campaignSends = [];
  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const job of storage.sends.values()) {
    if (job.campaignId === campaignId) {
      campaignSends.push(job);
      if (job.status === 'sent') totalSent++;
      else if (job.status === 'failed') totalFailed++;
      else if (job.status === 'skipped') totalSkipped++;
    }
  }

  const uniqueOpens = storage.uniqueOpens.get(campaignId) || new Set();
  const openCount = uniqueOpens.size;

  let clickCount = 0;
  const uniqueClickers = new Set();
  const campaignClicks = storage.clickEvents.get(campaignId);
  if (campaignClicks) {
    for (const [key, value] of campaignClicks.entries()) {
      if (key.startsWith('user_')) {
        uniqueClickers.add(key.replace('user_', ''));
        clickCount += value.count;
      }
    }
  }

  let conversionCount = 0;
  let totalRevenue = 0;
  const campaignConversions = storage.conversions.get(campaignId);
  if (campaignConversions) {
    conversionCount = campaignConversions.size;
    for (const conv of campaignConversions.values()) {
      totalRevenue += conv.amount || 0;
    }
  }

  let unsubscribeCount = 0;
  for (const entry of storage.unsubscribes.values()) {
    if (entry.reason === 'link_click' && entry.unsubscribedAt >= campaign.createdAt) {
      unsubscribeCount++;
    }
  }

  const delivered = totalSent;
  const openRate = delivered > 0 ? openCount / delivered : 0;
  const clickRate = delivered > 0 ? uniqueClickers.size / delivered : 0;
  const unsubscribeRate = delivered > 0 ? unsubscribeCount / delivered : 0;
  const conversionRate = delivered > 0 ? conversionCount / delivered : 0;

  return {
    campaignId,
    totalSent,
    totalFailed,
    totalSkipped,
    delivered,
    openCount,
    uniqueOpens: openCount,
    clickCount,
    uniqueClicks: uniqueClickers.size,
    conversionCount,
    totalRevenue,
    unsubscribeCount,
    openRate: parseFloat(openRate.toFixed(4)),
    clickRate: parseFloat(clickRate.toFixed(4)),
    unsubscribeRate: parseFloat(unsubscribeRate.toFixed(4)),
    conversionRate: parseFloat(conversionRate.toFixed(4))
  };
}

function getAbTestStats(campaignId) {
  const campaign = storage.campaigns.get(campaignId);
  if (!campaign || !campaign.isAbTest) return null;

  const versionAUsers = new Set();
  const versionBUsers = new Set();

  for (const job of storage.sends.values()) {
    if (job.campaignId === campaignId && job.status === 'sent') {
      if (job.abVersion === 'A') versionAUsers.add(job.userId);
      else if (job.abVersion === 'B') versionBUsers.add(job.userId);
    }
  }

  const uniqueOpens = storage.uniqueOpens.get(campaignId) || new Set();
  const campaignClicks = storage.clickEvents.get(campaignId);
  const campaignConversions = storage.conversions.get(campaignId);

  const versionAOpens = new Set();
  const versionBOpens = new Set();
  const versionAClicks = new Set();
  const versionBClicks = new Set();

  for (const userId of uniqueOpens) {
    if (versionAUsers.has(userId)) versionAOpens.add(userId);
    if (versionBUsers.has(userId)) versionBOpens.add(userId);
  }

  if (campaignClicks) {
    for (const [key] of campaignClicks.entries()) {
      if (key.startsWith('user_')) {
        const userId = key.replace('user_', '');
        if (versionAUsers.has(userId)) versionAClicks.add(userId);
        if (versionBUsers.has(userId)) versionBClicks.add(userId);
      }
    }
  }

  const versionAConversions = new Set();
  const versionBConversions = new Set();
  if (campaignConversions) {
    for (const conv of campaignConversions.values()) {
      if (versionAUsers.has(conv.userId)) versionAConversions.add(conv.orderId);
      if (versionBUsers.has(conv.userId)) versionBConversions.add(conv.orderId);
    }
  }

  const sentA = versionAUsers.size;
  const sentB = versionBUsers.size;

  const stats = {
    isAbTest: true,
    versionA: {
      sent: sentA,
      opens: versionAOpens.size,
      clicks: versionAClicks.size,
      conversions: versionAConversions.size,
      openRate: sentA > 0 ? versionAOpens.size / sentA : 0,
      clickRate: sentA > 0 ? versionAClicks.size / sentA : 0,
      conversionRate: sentA > 0 ? versionAConversions.size / sentA : 0
    },
    versionB: {
      sent: sentB,
      opens: versionBOpens.size,
      clicks: versionBClicks.size,
      conversions: versionBConversions.size,
      openRate: sentB > 0 ? versionBOpens.size / sentB : 0,
      clickRate: sentB > 0 ? versionBClicks.size / sentB : 0,
      conversionRate: sentB > 0 ? versionBConversions.size / sentB : 0
    }
  };

  if (sentA > 0 && sentB > 0) {
    const aWinRate = stats.versionA.openRate + stats.versionA.clickRate;
    const bWinRate = stats.versionB.openRate + stats.versionB.clickRate;
    stats.winner = aWinRate > bWinRate ? 'A' : (bWinRate > aWinRate ? 'B' : 'tie');
  }

  return stats;
}

router.get('/', (req, res) => {
  const campaigns = [];
  for (const [id, campaign] of storage.campaigns.entries()) {
    campaigns.push({
      ...campaign,
      stats: null
    });
  }
  campaigns.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, total: campaigns.length, campaigns });
});

router.get('/:id', (req, res) => {
  const campaign = storage.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const stats = getCampaignStats(req.params.id);
  const abStats = getAbTestStats(req.params.id);

  res.json({
    success: true,
    campaign,
    stats,
    abStats
  });
});

router.post('/', (req, res) => {
  const {
    name,
    description,
    subject,
    templateId,
    templateVersionId,
    segmentId,
    fromEmail,
    couponCode,
    isAbTest = false,
    abConfig = null
  } = req.body;

  if (!name || !subject || !templateId) {
    return res.status(400).json({ error: 'name, subject and templateId are required' });
  }

  const id = storage.generateId('camp');
  const now = new Date();

  const campaign = {
    id,
    name,
    description: description || '',
    subject,
    templateId,
    templateVersionId: templateVersionId || null,
    segmentId: segmentId || null,
    fromEmail: fromEmail || null,
    couponCode: couponCode || null,
    status: CAMPAIGN_STATUS.DRAFT,
    isAbTest,
    abConfig: isAbTest ? (abConfig || {
      versionA: { name: '版本 A', templateId, templateVersionId: null, subject, weight: 50 },
      versionB: { name: '版本 B', templateId, templateVersionId: null, subject, weight: 50 }
    }) : null,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    completedAt: null
  };

  storage.campaigns.set(id, campaign);
  res.status(201).json({ success: true, campaign });
});

router.put('/:id', (req, res) => {
  const campaign = storage.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  Object.assign(campaign, req.body, { updatedAt: new Date() });
  storage.campaigns.set(req.params.id, campaign);

  res.json({ success: true, campaign });
});

router.delete('/:id', (req, res) => {
  const deleted = storage.campaigns.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  res.json({ success: true });
});

router.post('/:id/send', (req, res) => {
  const campaign = storage.campaigns.get(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  if (!campaign.segmentId) {
    return res.status(400).json({ error: 'segmentId is required to send campaign' });
  }

  const userIds = getSegmentUsers(campaign.segmentId);
  if (userIds.length === 0) {
    return res.status(400).json({ error: 'No users in segment' });
  }

  const template = storage.templates.get(campaign.templateId);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const versionId = campaign.templateVersionId || template.currentVersion;
  const version = storage.templateVersions.get(versionId);
  if (!version) {
    return res.status(404).json({ error: 'Template version not found' });
  }

  campaign.status = CAMPAIGN_STATUS.RUNNING;
  campaign.sentAt = new Date();
  campaign.updatedAt = new Date();
  storage.campaigns.set(req.params.id, campaign);

  const emailDataList = [];

  if (campaign.isAbTest && campaign.abConfig) {
    const weightA = campaign.abConfig.versionA.weight || 50;
    const weightB = campaign.abConfig.versionB.weight || 50;
    const totalWeight = weightA + weightB;

    let templateA = version;
    let templateB = version;
    let subjectA = campaign.abConfig.versionA.subject || campaign.subject;
    let subjectB = campaign.abConfig.versionB.subject || campaign.subject;

    if (campaign.abConfig.versionA.templateVersionId) {
      const vA = storage.templateVersions.get(campaign.abConfig.versionA.templateVersionId);
      if (vA) { templateA = vA; subjectA = campaign.abConfig.versionA.subject || campaign.subject; }
    }
    if (campaign.abConfig.versionB.templateVersionId) {
      const vB = storage.templateVersions.get(campaign.abConfig.versionB.templateVersionId);
      if (vB) { templateB = vB; subjectB = campaign.abConfig.versionB.subject || campaign.subject; }
    }

    let countA = 0;
    let countB = 0;

    userIds.forEach((userId) => {
      const user = storage.users.get(userId);
      if (!user) return;

      const ratioA = countA * totalWeight < (countA + countB + 1) * weightA;
      const ratio = ratioA ? 'A' : 'B';
      if (ratio === 'A') countA++; else countB++;
      const tmpl = ratio === 'A' ? templateA : templateB;
      const subj = ratio === 'A' ? subjectA : subjectB;

      const templateData = {
        ...user,
        coupon: campaign.couponCode || '',
        campaignId: campaign.id
      };

      emailDataList.push({
        to: user.email,
        subject: subj,
        html: tmpl.htmlContent,
        campaignId: campaign.id,
        userId: user.id,
        templateData,
        from: campaign.fromEmail,
        abVersion: ratio
      });
    });
  } else {
    userIds.forEach(userId => {
      const user = storage.users.get(userId);
      if (!user) return;

      const templateData = {
        ...user,
        coupon: campaign.couponCode || '',
        campaignId: campaign.id
      };

      emailDataList.push({
        to: user.email,
        subject: campaign.subject,
        html: version.htmlContent,
        campaignId: campaign.id,
        userId: user.id,
        templateData,
        from: campaign.fromEmail
      });
    });
  }

  const jobs = emailQueue.addBatch(emailDataList);

  res.json({
    success: true,
    message: `Campaign queued for ${emailDataList.length} recipients`,
    queuedCount: jobs.length,
    campaignId: campaign.id
  });
});

router.get('/:id/stats', (req, res) => {
  const stats = getCampaignStats(req.params.id);
  if (!stats) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const abStats = getAbTestStats(req.params.id);

  res.json({ success: true, stats, abStats });
});

router.get('/ab/winners', (req, res) => {
  const winners = [];
  for (const [campaignId, winnerData] of storage.abWinners.entries()) {
    winners.push({ campaignId, ...winnerData });
  }
  res.json({ success: true, winners });
});

router.post('/ab/:id/record-winner', (req, res) => {
  const campaign = storage.campaigns.get(req.params.id);
  if (!campaign || !campaign.isAbTest) {
    return res.status(400).json({ error: 'Not an A/B test campaign' });
  }

  const abStats = getAbTestStats(req.params.id);
  if (!abStats || !abStats.winner || abStats.winner === 'tie') {
    return res.status(400).json({ error: 'No clear winner yet' });
  }

  const winnerVersion = abStats.winner === 'A' ? campaign.abConfig.versionA : campaign.abConfig.versionB;
  const winnerData = {
    winner: abStats.winner,
    versionName: winnerVersion.name,
    templateId: winnerVersion.templateId,
    templateVersionId: winnerVersion.templateVersionId,
    subject: winnerVersion.subject,
    openRate: abStats[`version${abStats.winner}`].openRate,
    clickRate: abStats[`version${abStats.winner}`].clickRate,
    recordedAt: new Date()
  };

  storage.abWinners.set(req.params.id, winnerData);

  res.json({ success: true, winner: winnerData });
});

router.get('/ab/recommend/:topic', (req, res) => {
  const { topic } = req.params;
  const recommendations = [];

  for (const [campaignId, winnerData] of storage.abWinners.entries()) {
    const campaign = storage.campaigns.get(campaignId);
    if (campaign && campaign.name.includes(topic)) {
      recommendations.push({
        campaignId,
        campaignName: campaign.name,
        ...winnerData
      });
    }
  }

  recommendations.sort((a, b) => b.openRate + b.clickRate - (a.openRate + a.clickRate));

  res.json({
    success: true,
    topic,
    recommendations,
    best: recommendations[0] || null
  });
});

module.exports = router;
module.exports.getCampaignStats = getCampaignStats;
module.exports.CAMPAIGN_STATUS = CAMPAIGN_STATUS;
