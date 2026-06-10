const storage = require('../../storage');

const SEGMENT_TYPES = {
  NEW_USERS: 'new_users',
  ACTIVE_USERS: 'active_users',
  DORMANT_USERS: 'dormant_users',
  CHURNED_USERS: 'churned_users',
  PAID_USERS: 'paid_users',
  VIP_USERS: 'vip_users',
  CUSTOM_RFM: 'custom_rfm',
  CAMPAIGN_OPEN: 'campaign_open'
};

const PRESET_SEGMENTS = [
  { id: 'seg_new_users', name: '新用户', type: SEGMENT_TYPES.NEW_USERS, description: '注册7天内的用户' },
  { id: 'seg_active_users', name: '活跃用户', type: SEGMENT_TYPES.ACTIVE_USERS, description: '30天内登录过的用户' },
  { id: 'seg_dormant_users', name: '沉睡用户', type: SEGMENT_TYPES.DORMANT_USERS, description: '30-90天没登录的用户' },
  { id: 'seg_churned_users', name: '流失用户', type: SEGMENT_TYPES.CHURNED_USERS, description: '90天以上没登录的用户' },
  { id: 'seg_paid_users', name: '付费用户', type: SEGMENT_TYPES.PAID_USERS, description: '有消费记录的用户' },
  { id: 'seg_vip_users', name: 'VIP用户', type: SEGMENT_TYPES.VIP_USERS, description: 'VIP标记用户' }
];

function initPresetSegments() {
  PRESET_SEGMENTS.forEach(seg => {
    if (!storage.segments.has(seg.id)) {
      storage.segments.set(seg.id, { ...seg, rules: {}, createdAt: new Date(), updatedAt: new Date() });
      storage.segmentUserCache.set(seg.id, new Set());
    }
  });
}

function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor(Math.abs((date1 - date2)) / oneDay);
}

function evaluateUserForSegment(user, segment) {
  const now = new Date();
  const registeredAt = new Date(user.registeredAt);
  const lastLoginAt = user.lastLoginAt ? new Date(user.lastLoginAt) : null;

  switch (segment.type) {
    case SEGMENT_TYPES.NEW_USERS:
      return daysBetween(now, registeredAt) <= 7;

    case SEGMENT_TYPES.ACTIVE_USERS:
      return lastLoginAt && daysBetween(now, lastLoginAt) <= 30;

    case SEGMENT_TYPES.DORMANT_USERS:
      return lastLoginAt && daysBetween(now, lastLoginAt) > 30 && daysBetween(now, lastLoginAt) <= 90;

    case SEGMENT_TYPES.CHURNED_USERS:
      if (!lastLoginAt) return daysBetween(now, registeredAt) > 90;
      return daysBetween(now, lastLoginAt) > 90;

    case SEGMENT_TYPES.PAID_USERS:
      return user.isPaid || (user.totalOrders && user.totalOrders > 0);

    case SEGMENT_TYPES.VIP_USERS:
      return user.isVip === true;

    case SEGMENT_TYPES.CUSTOM_RFM:
      return evaluateRfmRules(user, segment.rules);

    case SEGMENT_TYPES.CAMPAIGN_OPEN:
      return evaluateCampaignOpen(user, segment.rules);

    default:
      return false;
  }
}

function evaluateRfmRules(user, rules) {
  const now = new Date();
  const { r: rRule, f: fRule, m: mRule } = rules || {};
  let rPass = true, fPass = true, mPass = true;

  if (rRule && rRule.enabled) {
    const lastPurchase = user.lastPurchaseAt ? new Date(user.lastPurchaseAt) : null;
    const daysSince = lastPurchase ? daysBetween(now, lastPurchase) : Infinity;
    if (rRule.operator === 'lte') rPass = daysSince <= rRule.value;
    else if (rRule.operator === 'gte') rPass = daysSince >= rRule.value;
    else if (rRule.operator === 'between') rPass = daysSince >= rRule.min && daysSince <= rRule.max;
  }

  if (fRule && fRule.enabled) {
    const frequency = user.purchaseFrequency || 0;
    if (fRule.operator === 'lte') fPass = frequency <= fRule.value;
    else if (fRule.operator === 'gte') fPass = frequency >= fRule.value;
    else if (fRule.operator === 'between') fPass = frequency >= fRule.min && frequency <= fRule.max;
  }

  if (mRule && mRule.enabled) {
    const monetary = user.totalSpent || 0;
    if (mRule.operator === 'lte') mPass = monetary <= mRule.value;
    else if (mRule.operator === 'gte') mPass = monetary >= mRule.value;
    else if (mRule.operator === 'between') mPass = monetary >= mRule.min && monetary <= mRule.max;
  }

  return rPass && fPass && mPass;
}

function evaluateCampaignOpen(user, rules) {
  const { campaignId } = rules || {};
  if (!campaignId) return false;
  const uniqueOpens = storage.uniqueOpens.get(campaignId);
  if (!uniqueOpens) return false;
  return uniqueOpens.has(user.id);
}

function computeSegmentUsers(segmentId) {
  const segment = storage.segments.get(segmentId);
  if (!segment) return new Set();

  const userSet = new Set();
  for (const user of storage.users.values()) {
    if (evaluateUserForSegment(user, segment)) {
      userSet.add(user.id);
    }
  }
  return userSet;
}

function refreshSegmentCache(segmentId) {
  const users = computeSegmentUsers(segmentId);
  storage.segmentUserCache.set(segmentId, users);
  return users;
}

function updateUserInSegments(userId) {
  const user = storage.users.get(userId);
  if (!user) return;

  for (const [segmentId, segment] of storage.segments.entries()) {
    const cache = storage.segmentUserCache.get(segmentId);
    if (!cache) continue;

    const shouldBeIn = evaluateUserForSegment(user, segment);
    const isIn = cache.has(userId);

    if (shouldBeIn && !isIn) {
      cache.add(userId);
    } else if (!shouldBeIn && isIn) {
      cache.delete(userId);
    }
  }
}

function getSegmentUsers(segmentId) {
  let cache = storage.segmentUserCache.get(segmentId);
  if (!cache) {
    cache = refreshSegmentCache(segmentId);
  }
  return Array.from(cache);
}

function getSegmentUserCount(segmentId) {
  return getSegmentUsers(segmentId).length;
}

module.exports = {
  SEGMENT_TYPES,
  PRESET_SEGMENTS,
  initPresetSegments,
  evaluateUserForSegment,
  computeSegmentUsers,
  refreshSegmentCache,
  updateUserInSegments,
  getSegmentUsers,
  getSegmentUserCount
};
