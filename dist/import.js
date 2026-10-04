function parseXML(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Не удалось прочитать структуру Excel. Сохраните файл как CSV или XLSX.');return doc;}
// A warning heuristic, never a conversion: CSV no longer contains Excel cell types.
// These values are outside the model's supported range as well as looking like date serials.
export function spreadsheetDateIssues(values,schema){
 return schema.fields.flatMap(f=>{
  const raw=String(values[f.key]??'').trim(),value=Number(raw.replace(',','.'));
  if(!/^\d{5}(?:[.,]0+)?$/.test(raw)||value<20000||value>80000||value<=f.observed_max)return [];
  return [{key:f.key,message:`${f.label}: ${raw} — возможно, Excel преобразовал исходное число в дату. Значение не подходит для расчёта в указанных единицах. Сверьте его с исходным бланком и исправьте вручную; восстановить исходное число автоматически нельзя.`}];
 });
}
export function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');const line=text.split(/\r?\n/)[0];
 const separator=[';',',','\t'].sort((a,b)=>line.split(b).length-line.split(a).length)[0];
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.length)throw Error('Проверьте кавычки в CSV.');else quoted=!quoted;}else if(c===separator&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('В CSV не закрыта кавычка.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function isExcelDateFormat(id,code=''){
 if((id>=14&&id<=22)||(id>=27&&id<=36)||(id>=45&&id<=47)||(id>=50&&id<=58))return true;
 // Ignore quoted text, escaped characters, spacing and non-time bracket directives.
 const format=code.replace(/"[^"]*"|\\.|_.|\*./g,'').replace(/\[([^\]]*)\]/g,(_,part)=>/^[hms]+$/i.test(part)?part:'');
 return /[ymdhs]/i.test(format);
}
/** Read the first worksheet locally. Retain date metadata; never repair medical values by guessing. */
export async function parseXLSX(buffer){
 if(!globalThis.JSZip)throw Error('Не загрузился модуль Excel. Попробуйте CSV.');
 const zip=await globalThis.JSZip.loadAsync(buffer);
 const file=async name=>{const f=zip.file(name);if(!f)throw Error('В Excel отсутствует таблица данных.');const t=await f.async('string');if(t.length>15000000)throw Error('Лист слишком большой. Оставьте до 1000 записей.');return t;};
 const wb=parseXML(await file('xl/workbook.xml')),sheet=wb.getElementsByTagName('sheet')[0];if(!sheet)throw Error('В Excel нет листов.');
 const id=sheet.getAttribute('r:id'),rels=parseXML(await file('xl/_rels/workbook.xml.rels'));
 const rel=Array.from(rels.getElementsByTagName('Relationship')).find(x=>x.getAttribute('Id')===id);if(!rel)throw Error('Не найден первый лист Excel.');
 const target=rel.getAttribute('Target'),path=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
 const shared=zip.file('xl/sharedStrings.xml')?Array.from(parseXML(await file('xl/sharedStrings.xml')).getElementsByTagName('si')).map(si=>Array.from(si.getElementsByTagName('t')).map(t=>t.textContent).join('')):[];
 const styles=zip.file('xl/styles.xml')?parseXML(await file('xl/styles.xml')):null;
 const formats=new Map(Array.from(styles?.getElementsByTagName('numFmt')??[]).map(f=>[Number(f.getAttribute('numFmtId')),f.getAttribute('formatCode')??'']));
 const dateStyles=Array.from(styles?.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf')??[]).map(x=>{const id=Number(x.getAttribute('numFmtId'));return isExcelDateFormat(id,formats.get(id));});
 const doc=parseXML(await file(path)),rows=[];
 // Preserve date metadata until headers are mapped: unrelated date columns may be ignored.
 rows.dateCells=[];
 for(const r of Array.from(doc.getElementsByTagName('row'))){let row=[];const dates=[];for(const cell of Array.from(r.getElementsByTagName('c'))){const ref=cell.getAttribute('r')||'';let col=0;for(const c of ref.match(/^[A-Z]+/)?.[0]||'A')col=col*26+c.charCodeAt(0)-64;if(col>100)throw Error('Слишком много столбцов: используйте шаблон.');if(cell.getElementsByTagName('f').length)throw Error('В файле есть формулы. Сохраните результаты как значения перед загрузкой.');const type=cell.getAttribute('t'),v=cell.getElementsByTagName('v')[0]?.textContent??'';row[col-1]=type==='s'?shared[Number(v)]??'':type==='inlineStr'?Array.from(cell.getElementsByTagName('t')).map(t=>t.textContent).join(''):v;if(v.trim()&&(type==='d'||((!type||type==='n')&&dateStyles[Number(cell.getAttribute('s')??0)])))dates.push({column:col-1,ref});}row=Array.from({length:row.length},(_,i)=>row[i]??'');if(row.some(x=>String(x).trim())){rows.dateCells.push(...dates.map(d=>({...d,row:rows.length})));rows.push(row);}if(rows.length>1001)throw Error('Не больше 1000 записей в одном файле.');}return rows;
}
/** Map supported headers only. Ignore labels/identifiers and preserve missing measurements as empty strings. */
export function rowsToRecords(rows,schema){
 if(rows.length<2)throw Error('В файле есть заголовки, но нет результатов. Заполните хотя бы одну строку.');if(rows.length>1001)throw Error('Не больше 1000 записей в одном файле.');
 const inputs=['age_years','sex',...schema.fields.map(f=>f.key)],aliases=new Map(inputs.map(k=>[k.toLowerCase(),k]));
 for(const f of schema.fields){aliases.set(f.label.toLowerCase(),f.key);if(f.original_label)aliases.set(f.original_label.toLowerCase(),f.key);}
 for(const[alias,key]of Object.entries({age:'age_years','возраст':'age_years','пол':'sex',hb:'hemoglobin',hgb:'hemoglobin',hct:'hematocrit',plt:'platelets','rdw-cv':'RDW','гемоглобин':'hemoglobin','соэ':'ESR','срб':'CRP'}))aliases.set(alias,key);
 const ignored=new Set(schema.ignored.map(x=>x.toLowerCase())),headers=rows[0].map(x=>String(x).trim()),keys=headers.map(h=>aliases.get(h.toLowerCase())||null),known=keys.filter(Boolean);
 if(new Set(known).size!==known.length)throw Error('Один показатель указан в нескольких столбцах. Удалите повтор.');
 if(!keys.includes('hemoglobin'))throw Error('Не найден столбец hemoglobin / HGB / Hb. Используйте наш шаблон; единицы гемоглобина — г/л.');
 const dates=(rows.dateCells??[]).filter(d=>d.row>0&&keys[d.column]&&keys[d.column]!=='sex');
 if(dates.length)throw Error(`Файл не загружен: в ячейках ${dates.slice(0,8).map(d=>`${d.ref} (${keys[d.column]})`).join(', ')}${dates.length>8?' и других':''} вместо числовых результатов сохранены даты Excel. Сверьте значения с исходным бланком. Задайте этим ячейкам текстовый формат и заново введите исходные числа. Одна смена формата не восстановит результаты.`);
 const unknown=headers.filter((h,i)=>!keys[i]&&!ignored.has(h.toLowerCase()));
 const records=rows.slice(1).map((row,index)=>{if(row.length>headers.length)throw Error(`В строке ${index+2} больше значений, чем заголовков. Проверьте разделитель.`);const record={};keys.forEach((key,i)=>{if(key){let v=String(row[i]??'').trim();if(['nan','na','null','none','—','-'].includes(v.toLowerCase()))v='';if(key==='sex'){const s=v.toLowerCase();v=['f','ж','женский','female'].includes(s)?'F':['m','м','мужской','male'].includes(s)?'M':v;}record[key]=v;}});return record;});
 return{records,ignored:headers.filter(h=>ignored.has(h.toLowerCase())),unknown};
}
