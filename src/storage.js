class MemoryStorage {
  constructor() {
    this.users = new Map();
    this.segments = new Map();
    this.segmentUserCache = new Map();
    this.templates = new Map();
    this.templateVersions = new Map();
    this.campaigns = new Map();
    this.sends = new Map();
    this.openEvents = new Map();
    this.clickEvents = new Map();
    this.conversions = new Map();
    this.unsubscribes = new Map();
    this.uniqueOpens = new Map();
    this.spamComplaints = new Map();
    this.senderStatus = new Map();
    this.abWinners = new Map();
  }

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const storage = new MemoryStorage();
module.exports = storage;
