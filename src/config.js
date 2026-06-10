require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  smtp: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'no-reply@example.com'
  },
  rateLimitPerHour: parseInt(process.env.RATE_LIMIT_PER_HOUR || '100', 10),
  spamComplaintThreshold: parseFloat(process.env.SPAM_COMPLAINT_THRESHOLD || '0.001'),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  retryAttempts: 3,
  unsubscribeSuppressionHours: 24
};
