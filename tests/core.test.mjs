import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateReport} from '../dist/engine.js';
import {parseCSV,rowsToRecords,spreadsheetDateIssues,isExcelDateFormat} from '../dist/import.js';
import {doctorOverview} from '../dist/workflow.js';
const schema=JSON.parse(await readFile(new URL('../dist/schema.json',import.meta.url),'utf8'));
const model=JSON.parse(await readFile(new URL('../dist/model.json',import.meta.url),'utf8'));
// Synthetic example, not a patient record from the training dataset.
const example={age_years:35,sex:'F',hemoglobin:138,RBC:4.6,hematocrit:41.4,MCV:90,MCH:30,MCHC:333,RDW:12.8,platelets:250,WBC:6.1};
test('Порог анемии строгий: 120 для женщин и 130 для мужчин',()=>{
 for(const [sex,threshold] of [['F',120],['M',130]]){
  assert.equal(calculateReport({...example,sex,hemoglobin:threshold},schema,model).anemia,false);
  assert.equal(calculateReport({...example,sex,hemoglobin:threshold-1},schema,model).anemia,true);
 }
});
test('Пропуск обязательного ОАК блокирует прогноз причин, но не оценку гемоглобина',()=>{
 const result=calculateReport({...example,hemoglobin:70,RBC:null},schema,model);
 assert.equal(result.withheld,true);assert.equal(result.severe,true);assert.equal(result.anemia,true);
 assert(result.missingBasic.includes('RBC'));assert.deepEqual(result.deficits,[]);
 assert(doctorOverview(result,schema).includes('Оценка причин недоступна'));
});
test('Необязательный RDW не блокирует расчёт; дополнительные данные выбирают другую модель',()=>{
 const basic=calculateReport({...example,RDW:null},schema,model);
 assert.equal(basic.withheld,false);assert.equal(basic.variant,'cbc');
 const expanded=calculateReport({...example,ferritin:85},schema,model);
 assert.equal(expanded.withheld,false);assert.equal(expanded.variant,'extended');
 assert.equal(expanded.deficits.length,6);
 assert(Math.abs(expanded.ranking.reduce((s,x)=>s+x.score,0)-1)<1e-9);
});
test('Значение вне обучения блокирует прогноз и не объявляется клинической нормой',()=>{
 const result=calculateReport({...example,ferritin:1e9},schema,model);
 assert.equal(result.withheld,true);assert(result.outside.includes('ferritin'));
 assert.deepEqual(result.ranking,[]);
});
test('Импорт сохраняет пропуски и десятичную запятую, исключает диагнозы и идентификаторы',()=>{
 const imported=rowsToRecords(parseCSV('age_years;sex;Hb;RBC;ferritin;patient_id;anemia_class\n35;женский;138;4,6;;TEST;FAKE'),schema);
 assert.equal(imported.records[0].sex,'F');assert.equal(imported.records[0].RBC,'4,6');
 assert.equal(imported.records[0].ferritin,'');assert(!('patient_id' in imported.records[0]));
 assert(!('anemia_class' in imported.records[0]));assert.equal(imported.ignored.length,2);
});
test('CSV с кавычками поддерживается, дублирующие показатели и неверные кавычки отклоняются',()=>{
 assert.deepEqual(parseCSV('Hb,note\n138,"a,b"'),[['Hb','note'],['138','a,b']]);
 assert.throws(()=>parseCSV('Hb,note\n138,"unfinished'));
 assert.throws(()=>rowsToRecords(parseCSV('Hb,HGB\n138,139'),schema));
});

test('Импорт сохраняет исходные RDW и WBC; номера дат требуют проверки без автоматического исправления',()=>{
 const clean=rowsToRecords(parseCSV('Hb;RDW-CV;WBC\n139,6;14,9;6,2'),schema).records[0];
 assert.equal(clean.RDW,'14,9');assert.equal(clean.WBC,'6,2');
 assert.deepEqual(spreadsheetDateIssues(clean,schema),[]);
 const damaged=rowsToRecords(parseCSV('Hb;RDW-CV;WBC\n139,6;46094;46241,00'),schema).records[0];
 assert.deepEqual(spreadsheetDateIssues(damaged,schema).map(x=>x.key),['RDW','WBC']);
 assert.equal(damaged.RDW,'46094');assert.equal(damaged.WBC,'46241,00');
 assert.deepEqual(spreadsheetDateIssues({RDW:'',WBC:'6.2'},schema),[]);
 // The heuristic does not reinterpret other out-of-range results as dates.
 assert.deepEqual(spreadsheetDateIssues({RDW:40,WBC:100},schema),[]);
});

test('XLSX: форматы дат распознаются, текстовые подписи числовых форматов не считаются датами',()=>{
 for(const [id,code] of [[14,''],[22,''],[164,'d\\.m'],[165,'yyyy-mm-dd'],[166,'[h]:mm'],[167,'[$-409]m/d/yy']])assert.equal(isExcelDateFormat(id,code),true);
 for(const [id,code] of [[0,'General'],[2,'0.00'],[164,'0.00 "days"'],[165,'[Red]0.00'],[166,'0\\m']])assert.equal(isExcelDateFormat(id,code),false);
});

test('XLSX: даты в результатах отклоняются с адресами, даты в посторонних столбцах игнорируются',()=>{
 const rows=[['Hb','WBC','RDW-CV','collection_date'],['138','6.1','','45000']];
 rows.dateCells=[{row:1,column:3,ref:'D2'}];
 assert.equal(rowsToRecords(rows,schema).records[0].WBC,'6.1');
 rows[1][1]='45000';rows.dateCells.push({row:1,column:1,ref:'B2'});
 assert.throws(()=>rowsToRecords(rows,schema),/Файл не загружен:.*B2 \(WBC\)/);
});
