const express = require('express');
const router = express.Router();
const storage = require('../../storage');
const { renderTemplate } = require('./templateEngine');

router.get('/', (req, res) => {
  const templates = [];
  for (const [id, template] of storage.templates.entries()) {
    templates.push({
      id,
      name: template.name,
      description: template.description,
      subject: template.subject,
      versionCount: template.versionCount || 0,
      currentVersion: template.currentVersion,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    });
  }
  res.json({ success: true, templates });
});

router.get('/:id', (req, res) => {
  const template = storage.templates.get(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json({ success: true, template });
});

router.post('/', (req, res) => {
  const { name, description, subject, htmlContent, variables } = req.body;
  if (!name || !subject || !htmlContent) {
    return res.status(400).json({ error: 'name, subject and htmlContent are required' });
  }

  const id = storage.generateId('tpl');
  const versionId = storage.generateId('ver');
  const now = new Date();

  const template = {
    id,
    name,
    description: description || '',
    subject,
    variables: variables || [],
    currentVersion: versionId,
    versionCount: 1,
    createdAt: now,
    updatedAt: now
  };

  const version = {
    id: versionId,
    templateId: id,
    version: 1,
    subject,
    htmlContent,
    variables: variables || [],
    createdAt: now,
    createdBy: req.body.createdBy || 'system'
  };

  storage.templates.set(id, template);
  storage.templateVersions.set(versionId, version);

  res.status(201).json({ success: true, template, currentVersion: version });
});

router.put('/:id', (req, res) => {
  const template = storage.templates.get(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const { name, description, subject } = req.body;
  if (name) template.name = name;
  if (description !== undefined) template.description = description;
  if (subject) template.subject = subject;
  template.updatedAt = new Date();

  storage.templates.set(req.params.id, template);
  res.json({ success: true, template });
});

router.delete('/:id', (req, res) => {
  const deleted = storage.templates.delete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Template not found' });
  }
  res.json({ success: true });
});

router.get('/:id/versions', (req, res) => {
  const versions = [];
  for (const version of storage.templateVersions.values()) {
    if (version.templateId === req.params.id) {
      versions.push(version);
    }
  }
  versions.sort((a, b) => b.version - a.version);
  res.json({ success: true, versions });
});

router.get('/:id/versions/:versionId', (req, res) => {
  const version = storage.templateVersions.get(req.params.versionId);
  if (!version || version.templateId !== req.params.id) {
    return res.status(404).json({ error: 'Version not found' });
  }
  res.json({ success: true, version });
});

router.post('/:id/versions', (req, res) => {
  const template = storage.templates.get(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const { subject, htmlContent, variables, makeCurrent = true } = req.body;
  if (!htmlContent) {
    return res.status(400).json({ error: 'htmlContent is required' });
  }

  const versionId = storage.generateId('ver');
  const newVersionNum = (template.versionCount || 0) + 1;
  const now = new Date();

  const version = {
    id: versionId,
    templateId: req.params.id,
    version: newVersionNum,
    subject: subject || template.subject,
    htmlContent,
    variables: variables || template.variables || [],
    createdAt: now,
    createdBy: req.body.createdBy || 'system'
  };

  template.versionCount = newVersionNum;
  if (makeCurrent) {
    template.currentVersion = versionId;
  }
  template.updatedAt = now;

  storage.templateVersions.set(versionId, version);
  storage.templates.set(req.params.id, template);

  res.status(201).json({ success: true, version });
});

router.post('/:id/versions/:versionId/set-current', (req, res) => {
  const template = storage.templates.get(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const version = storage.templateVersions.get(req.params.versionId);
  if (!version || version.templateId !== req.params.id) {
    return res.status(404).json({ error: 'Version not found' });
  }

  template.currentVersion = req.params.versionId;
  template.updatedAt = new Date();
  storage.templates.set(req.params.id, template);

  res.json({ success: true, template });
});

router.post('/render', (req, res) => {
  const { templateId, versionId, context } = req.body;

  let htmlContent, subject;

  if (templateId) {
    const template = storage.templates.get(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const verId = versionId || template.currentVersion;
    const version = storage.templateVersions.get(verId);
    if (!version) {
      return res.status(404).json({ error: 'Template version not found' });
    }
    htmlContent = version.htmlContent;
    subject = version.subject;
  } else if (req.body.htmlContent) {
    htmlContent = req.body.htmlContent;
    subject = req.body.subject || '';
  } else {
    return res.status(400).json({ error: 'templateId or htmlContent is required' });
  }

  const renderedHtml = renderTemplate(htmlContent, context || {});
  const renderedSubject = subject ? renderTemplate(subject, context || {}) : '';

  res.json({
    success: true,
    renderedSubject,
    renderedHtml
  });
});

module.exports = router;
