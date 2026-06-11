const storage = require('./src/storage');
const campId = 'camp_1781057683334_mqmrjgl5x';
const opens = storage.openEvents.get(campId);
if (!opens) {
  console.log('no opens');
  process.exit(0);
}
let i = 0;
for (const [k, v] of opens.entries()) {
  console.log('key:', k, '| startsWith user_:', k.startsWith('user_'), '| value:', JSON.stringify(v));
  if (++i > 10) break;
}
console.log('---');
console.log('Total entries:', opens.size);

// Replay the stats logic
let openCount = 0;
let uniqueOpens = 0;
for (const [key, value] of opens.entries()) {
  if (key.startsWith('user_')) {
    uniqueOpens++;
    console.log('counter key:', key, 'value.count:', value && value.count);
    openCount += value.count;
  }
}
console.log('Replayed: openCount=', openCount, 'uniqueOpens=', uniqueOpens);
