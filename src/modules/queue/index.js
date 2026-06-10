const express = require('express');
const router = express.Router();
const emailQueue = require('./emailQueue');
const storage = require('../../storage');

router.post('/send', (req, res) => {
  const { to, subject, html, campaignId, userId, templateData, from } = req.body;

  if (!to || !subject) {
    return res.status(400).json({ error: 'to and subject are required' });
  }

  const job = emailQueue.add({
    to,
    subject,
    html: html || '',
    campaignId,
    userId,
    templateData,
    from
  });

  res.status(202).json({ success: true, jobId: job.id, status: job.status });
});

router.post('/send/batch', (req, res) => {
  const { emails } = req.body;

  if (!Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails must be an array' });
  }

  const jobs = emailQueue.addBatch(emails);

  res.status(202).json({
    success: true,
    count: jobs.length,
    jobIds: jobs.map(j => j.id)
  });
});

router.get('/stats', (req, res) => {
  const stats = emailQueue.getStats();
  res.json({ success: true, stats });
});

router.get('/jobs', (req, res) => {
  const { status, limit = 100 } = req.query;
  const jobs = emailQueue.getJobs(status, parseInt(limit, 10));
  res.json({ success: true, total: jobs.length, jobs });
});

router.get('/jobs/:id', (req, res) => {
  const job = storage.sends.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ success: true, job });
});

module.exports = router;
