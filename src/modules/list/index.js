const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const {
  SEGMENT_TYPES,
  initPresetSegments,
  refreshSegmentCache,
  updateUserInSegments,
  getSegmentUsers,
  getSegmentUserCount,
  evaluateUserForSegment
} = require('./segmentEngine');

initPresetSegments();

router.post('/users/batch', (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'users must be an array' });
  }

  const results = [];
  users.forEach(userData => {
    const id = userData.id || storage.generateId('user');
    const user = {
      id,
      email: userData.email,
      name: userData.name || '',
      registeredAt: userData.registeredAt || new Date(),
      lastLoginAt: userData.lastLoginAt || null,
      isPaid: userData.isPaid || false,
      isVip: userData.isVip || false,
      totalOrders: userData.totalOrders || 0,
      totalSpent: userData.totalSpent || 0,
      purchaseFrequency: userData.purchaseFrequency || 0,
      lastPurchaseAt: userData.lastPurchaseAt || null,
      recentOrders: userData.recentOrders || [],
      attributes: userData.attributes || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    storage.users.set(id, user);
    updateUserInSegments(id);
    results.push(id);
  });

  res.json({ success: true, count: results.length, userIds: results });
});

router.post('/users', (req, res) => {
  const userData = req.body;
  if (!userData.email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const id = storage.generateId('user');
  const user = {
    id,
    email: userData.email,
    name: userData.name || '',
    registeredAt: userData.registeredAt || new Date(),
    lastLoginAt: userData.lastLoginAt || null,
    isPaid: userData.isPaid || false,
    isVip: userData.isVip || false,
    totalOrders: userData.totalOrders || 0,
    totalSpent: userData.totalSpent || 0,
    purchaseFrequency: userData.purchaseFrequency || 0,
    lastPurchaseAt: userData.lastPurchaseAt || null,
    recentOrders: userData.recentOrders || [],
    attributes: userData.attributes || {},
    createdAt: new Date(),
    updatedAt: new Date()
  };
  storage.users.set(id, user);
  updateUserInSegments(id);

  res.status(201).json({ success: true, user });
});

router.get('/users', (req, res) => {
  const { page = 1, limit = 100 } = req.query;
  const allUsers = Array.from(storage.users.values());
  const start = (page - 1) * limit;
  const end = start + parseInt(limit, 10);
  const paginated = allUsers.slice(start, end);

  res.json({
    success: true,
    total: allUsers.length,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    users: paginated
  });
});

router.get('/users/:id', (req, res) => {
  const user = storage.users.get(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const segments = [];
  for (const [segId, segment] of storage.segments.entries()) {
    if (evaluateUserForSegment(user, segment)) {
      segments.push({ id: segId, name: segment.name });
    }
  }

  res.json({ success: true, user, segments });
});

router.put('/users/:id', (req, res) => {
  const user = storage.users.get(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  Object.assign(user, req.body, { updatedAt: new Date() });
  storage.users.set(req.params.id, user);
  updateUserInSegments(req.params.id);

  res.json({ success: true, user });
});

router.delete('/users/:id', (req, res) => {
  const deleted = storage.users.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'User not found' });
  }

  for (const cache of storage.segmentUserCache.values()) {
    cache.delete(req.params.id);
  }

  res.json({ success: true });
});

router.get('/segments', (req, res) => {
  const segments = [];
  for (const [id, segment] of storage.segments.entries()) {
    segments.push({
      ...segment,
      userCount: getSegmentUserCount(id)
    });
  }
  res.json({ success: true, segments });
});

router.get('/segments/:id', (req, res) => {
  const segment = storage.segments.get(req.params.id);
  if (!segment) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  const userCount = getSegmentUserCount(req.params.id);
  res.json({ success: true, segment: { ...segment, userCount } });
});

router.post('/segments', (req, res) => {
  const { name, type, description, rules } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  const validTypes = Object.values(SEGMENT_TYPES);
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  const id = storage.generateId('seg');
  const segment = {
    id,
    name,
    type,
    description: description || '',
    rules: rules || {},
    createdAt: new Date(),
    updatedAt: new Date()
  };
  storage.segments.set(id, segment);
  refreshSegmentCache(id);

  res.status(201).json({ success: true, segment: { ...segment, userCount: 0 } });
});

router.put('/segments/:id', (req, res) => {
  const segment = storage.segments.get(req.params.id);
  if (!segment) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  Object.assign(segment, req.body, { updatedAt: new Date() });
  storage.segments.set(req.params.id, segment);
  refreshSegmentCache(req.params.id);

  const userCount = getSegmentUserCount(req.params.id);
  res.json({ success: true, segment: { ...segment, userCount } });
});

router.delete('/segments/:id', (req, res) => {
  const deleted = storage.segments.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Segment not found' });
  }
  storage.segmentUserCache.delete(req.params.id);
  res.json({ success: true });
});

router.get('/segments/:id/users', (req, res) => {
  const { page = 1, limit = 100 } = req.query;
  const userIds = getSegmentUsers(req.params.id);
  const start = (page - 1) * limit;
  const end = start + parseInt(limit, 10);
  const paginatedIds = userIds.slice(start, end);

  const users = paginatedIds.map(id => storage.users.get(id)).filter(Boolean);

  res.json({
    success: true,
    total: userIds.length,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    users
  });
});

router.post('/segments/:id/refresh', (req, res) => {
  const users = refreshSegmentCache(req.params.id);
  res.json({ success: true, userCount: users.size });
});

module.exports = router;
