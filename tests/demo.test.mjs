import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseCSV, rowsToRecords, spreadsheetDateIssues} from '../dist/import.js';
import {calculateReport} from '../dist/engine.js';
const schema = JSON.parse(await readFile(new URL('../dist/schema.json', import.meta.url), 'utf8'));
const model = JSON.parse(await readFile(new URL('../dist/model.json', import.meta.url), 'utf8'));

test('Демо-таблица загружается и показывает расширенную модель и ОАК без RDW', async () => {
  const csv = await readFile(new URL('../examples/demo.csv', import.meta.url), 'utf8');
  const {records, unknown} = rowsToRecords(parseCSV(csv), schema);
  assert.equal(records.length, 3);
  assert.deepEqual(unknown, []);
  const reports = records.map(record => {
    assert.deepEqual(spreadsheetDateIssues(record, schema), []);
    const values = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, key === 'sex' ? value : value === '' ? null : Number(value)]));
    return calculateReport(values, schema, model);
  });
  assert.deepEqual(reports.map(r => r.variant), ['extended', 'extended', 'cbc']);
  assert.deepEqual(reports.map(r => r.anemia), [false, false, true]);
  assert(reports.every(r => !r.withheld));
  assert.equal(records[2].RDW, '');
});
