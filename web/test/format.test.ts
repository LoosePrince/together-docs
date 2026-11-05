import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuery, formatBytes, formatDate, formatDuration } from '../src/format';

test('容量、时间与查询串格式化', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatDuration(45), '45 秒');
  assert.equal(formatDuration(125), '2 分 5 秒');
  assert.equal(formatDuration(3661), '1 小时 1 分');
  assert.equal(formatDate(''), '—');
  assert.equal(buildQuery({ page: 1, search: '', type: 'native_document' }), '?page=1&type=native_document');
});
