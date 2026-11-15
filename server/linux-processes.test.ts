import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcessStat, processCpu } from './linux-processes.js';

function stat(name = 'a tricky (process) name') {
  const fields = Array.from({ length: 30 }, () => '0');
  fields[0] = 'R';
  fields[11] = '100';
  fields[12] = '50';
  fields[19] = '12345';
  return `42 (${name}) ${fields.join(' ')}`;
}

test('process names with spaces and parentheses cannot shift CPU or start-time fields', () => {
  const parsed = parseProcessStat(stat());
  assert.deepEqual(parsed, { pid: 42, name: 'a tricky (process) name', state: 'running', ticks: 150, started: 12345 });
  assert.equal(parseProcessStat('42 (gone) R'), null);
  assert.equal(parseProcessStat(''), null);
});

test('CPU is measured between samples across all cores, with no lifetime-average fallback', () => {
  const previous = parseProcessStat(stat())!;
  assert.equal(processCpu({ ...previous, ticks: 250 }, previous, 800), 12.5);
  assert.equal(processCpu(previous, previous, 800), 0);
  assert.equal(processCpu(previous, undefined, 800), null);
  assert.equal(processCpu(previous, previous, 0), null);
});

test('PID reuse and counter resets do not create bogus CPU spikes', () => {
  const previous = parseProcessStat(stat())!;
  assert.equal(processCpu({ ...previous, started: 56789, ticks: 5000 }, previous, 800), null);
  assert.equal(processCpu({ ...previous, ticks: 20 }, previous, 800), null);
});
