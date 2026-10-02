const assert = require('node:assert/strict');
const test = require('node:test');
const CSVExporter = require('../csv_exporter');

const idColumns = [
  'record_id',
  'comment_id',
  'parent_comment_id',
  'content_id',
  'author_id_hash',
  'selector_fingerprint'
];

test('exports all ID-like columns as spreadsheet text', async () => {
  const item = {
    id: 'fb_9876543210987654321',
    realId: '9876543210987654321',
    parentRealId: '12345678901234567',
    postUrl: 'https://web.facebook.com/reel/9876543210987654321',
    commentText: 'sample comment',
    userId: 'researcher.example.42',
    level: 'Reply'
  };
  const columns = idColumns.map(key => ({ key, label: key }));
  const csv = await CSVExporter.generateCSV([item], columns);
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');
  const headers = rows[0].split(',');
  const values = rows[1].split(',');
  const actual = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  const expectedValues = {
    record_id: 'facebook_9876543210987654321',
    comment_id: '9876543210987654321',
    parent_comment_id: '12345678901234567',
    content_id: '9876543210987654321',
    author_id_hash: await CSVExporter.hashAuthorId('researcher.example.42'),
    selector_fingerprint: 'facebook-comments-dom-v1'
  };

  assert.deepEqual([...CSVExporter.idLikeColumns], idColumns);
  for (const key of idColumns) {
    assert.equal(actual[key], `'${expectedValues[key]}`, `${key} must be exported as text`);
  }
});

test('leaves empty optional ID fields empty', async () => {
  const csv = await CSVExporter.generateCSV([{
    id: 'fallback',
    postUrl: 'https://web.facebook.com/reel/9876543210987654321',
    commentText: 'sample comment',
    level: 'Top-level'
  }], [{ key: 'parent_comment_id', label: 'parent_comment_id' }]);

  assert.equal(csv.replace(/^\uFEFF/, '').split('\r\n')[1], '');
});

test('flags implausible comment reaction counts for manual review', async () => {
  const columns = [
    { key: 'like_count', label: 'like_count' },
    { key: 'manual_review', label: 'manual_review' }
  ];
  const csv = await CSVExporter.generateCSV([
    { id: 'large-count', likeCount: '14,000,000', level: 'Top-level' },
    { id: 'ceiling', likeCount: '100000', level: 'Top-level' }
  ], columns);
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n').slice(1).map(row => row.split(','));

  assert.deepEqual(rows, [
    ['14000000', 'Review like_count: 14000000 exceeds 100000'],
    ['100000', '']
  ]);
});

test('writes the collection query onto every exported row', async () => {
  const collectionQuery = 'hashtag: #pashtofunny';
  const csv = await CSVExporter.generateCSV([
    { id: 'first', commentText: 'first comment', level: 'Top-level' },
    { id: 'second', commentText: 'second comment', level: 'Reply' }
  ], [{ key: 'collection_query', label: 'collection_query' }], { collectionQuery });
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n');

  assert.deepEqual(rows, [
    'collection_query',
    collectionQuery,
    collectionQuery
  ]);
});
