import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseLabPages} from '../dist/pdf-import.js';

const schema=JSON.parse(await readFile(new URL('../dist/schema.json',import.meta.url),'utf8'));
// Полностью синтетические позиции и результаты, без данных реального пациента.
const item=(text,x,y,width=.04)=>({text,x,y,width,height:.015});
const headers=[item('Тест',.04,.1),item('Результат',.30,.1,.08),item('Норма',.45,.1,.06),item('Ед. изм.',.86,.1,.06)];
const row=(label,value,unit,y=.2)=>[item(label,.04,y,.18),item(value,.33,y,.02),item('100–150',.45,y),item(unit,.87,y)];
const parse=(items,extra=[])=>parseLabPages([{items:[...headers,...items]},...extra],schema);
test('PDF: результат берётся из своего столбца, десятичная запятая сохраняет число',()=>{
  const result=parse([...row('Гемоглобин общий','136','г/л'),...row('Количество эритроцитов','4,7','10^12/л',.26)]);
  assert.deepEqual(result.measurements.map(x=>[x.key,x.value]),[['hemoglobin','136'],['RBC','4.7']]);
});
test('PDF: продолжение таблицы, перенос названия и подпись после последней строки',()=>{
  const first=row('Гемоглобин общий','136','г/л');
  const second=row('Среднее содержание гемоглобина в','30','пг');
  second[0].y-=.008;
  second.push(item('эритроците',.04,.21,.08));
  second.push(...row('Средний объем эритроцита','89','фл',.26),item('Исполнитель: учебный пример',.04,.292,.18));
  const result=parse(first,[{items:second}]);
  assert.deepEqual(result.measurements.map(x=>[x.key,x.value,x.page]),[['hemoglobin','136',1],['MCH','30',2],['MCV','89',2]]);
});
test('PDF: несовместимые единицы, отсутствующие единицы и RDW-SD не подменяют RDW-CV',()=>{
  const r=parse([...row('Гемоглобин общий','136','г/л'),...row('Ширина распределения эритроцитов по объему','44','фл',.26),...row('Количество лейкоцитов','6.4','',.32)]);
  assert.deepEqual(r.measurements.map(x=>x.key),['hemoglobin']);
  assert.equal(r.warnings.length,2);
});
test('PDF: повторный показатель исключается, даже если результаты совпадают',()=>{
  const r=parse([...row('Гемоглобин общий','136','г/л'),...row('Количество эритроцитов','4.7','10^12/л',.26)], [{items:row('Гемоглобин общий','136','г/л')}]);
  assert.deepEqual(r.measurements.map(x=>x.key),['RBC']);
  assert.match(r.warnings[0],/несколько результатов/);
});
test('PDF: неравенства и диапазоны не превращаются в точные результаты',()=>{
  const r=parse([...row('Гемоглобин общий','136','г/л'),...row('Количество лейкоцитов','< 2','10^9/л',.26)]);
  assert.equal(r.measurements.length,1);
  assert.match(r.warnings[0],/однозначным числом/);
});
test('PDF: незнакомая структура и документ без текста не заполняют форму',()=>{
  assert.throws(()=>parseLabPages([{items:row('Гемоглобин общий','136','г/л')}],schema),/Не удалось/);
  assert.throws(()=>parseLabPages([{items:[]}],schema),/Не удалось/);
});
test('PDF: пустая страница в смешанном документе вызывает предупреждение',()=>{
  const r=parse(row('Гемоглобин общий','136','г/л'),[{items:[]}]);
  assert.match(r.warnings[0],/страниц: 1/);
});
test('PDF: результат не включает посторонние идентификаторы',()=>{
  const r=parse([item('ФИО: УЧЕБНЫЙ ПРИМЕР',.04,.03),item('Полис: DEMO',.04,.05),...row('Гемоглобин общий','136','г/л')]);
  assert.doesNotMatch(JSON.stringify(r),/DEMO|ФИО|Полис|УЧЕБНЫЙ/);
});
