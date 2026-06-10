const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config');

const listRoutes = require('./modules/list');
const templateRoutes = require('./modules/template');
const campaignRoutes = require('./modules/campaign');
const trackRoutes = require('./modules/track');
const unsubscribeRoutes = require('./modules/unsubscribe');
const queueRoutes = require('./modules/queue');

const app = express();

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use('/list', listRoutes);
app.use('/templates', templateRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/track', trackRoutes);
app.use('/unsubscribe', unsubscribeRoutes);
app.use('/queue', queueRoutes);

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(config.port, () => {
  console.log(`Email Marketing Service running on port ${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/health`);
  console.log(`Rate limit: ${config.rateLimitPerHour} emails/hour`);
});

module.exports = app;
