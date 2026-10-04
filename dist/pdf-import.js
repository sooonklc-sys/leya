// Импорт текстового лабораторного бланка. Расчёт модели здесь не выполняется.
const normalize = text => String(text).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const unitKey = text => normalize(text).replace(/[¹²³⁹]/g, c => ({'¹':'1','²':'2','³':'3','⁹':'9'}[c]))
  .replace(/[\s^·×*]/g, '').replace(/μ/g, 'µ');
const unitAliases = {'g/L':'г/л','10^12/L':'10^12/л','10^9/L':'10^9/л','fL':'фл','pg':'пг',
  'µg/L':'мкг/л','µmol/L':'мкмоль/л','mg/L':'мг/л','pg/mL':'пг/мл','pmol/L':'пмоль/л',
  'ng/mL':'нг/мл','nmol/L':'нмоль/л','mm/h':'мм/ч','mL/min/1.73m²':'мл/мин/1,73 м²',
  'mIU/L':'мМЕ/л','U/L':'Ед/л'};
const labelAliases = {
  'гемоглобин общий':'hemoglobin', 'гемоглобин':'hemoglobin', 'hgb':'hemoglobin', 'hb':'hemoglobin',
  'количество эритроцитов':'RBC', 'эритроциты':'RBC', 'гематокрит':'hematocrit', 'hct':'hematocrit',
  'средний объем эритроцита':'MCV', 'среднее содержание гемоглобина в эритроците':'MCH',
  'средняя концентрация гемоглобина в эритроците':'MCHC',
  'ширина распределения эритроцитов по объему':'RDW', 'rdw-cv':'RDW',
  'количество тромбоцитов':'platelets', 'тромбоциты':'platelets', 'plt':'platelets',
  'количество лейкоцитов':'WBC', 'лейкоциты':'WBC',
  'скорость оседания эритроцитов (по вестергрену)':'ESR', 'соэ':'ESR',
};

function lines(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r.y - item.y) < 0.004);
    if (row) row.items.push(item);
    else rows.push({y:item.y, items:[item]});
  }
  return rows.map(r => ({...r, text:r.items.sort((a,b) => a.x-b.x).map(i=>i.text).join(' ').trim()}));
}

function tableColumns(items) {
  const result = items.find(i => normalize(i.text) === 'результат');
  if (!result) return null;
  const header = items.filter(i => Math.abs(i.y - result.y) < 0.022);
  const test = header.find(i => normalize(i.text) === 'тест');
  const norm = header.find(i => normalize(i.text) === 'норма');
  const unit = header.find(i => /^ед\.?\s*изм\.?$/.test(normalize(i.text)));
  if (!test || !norm || !unit || !(test.x < result.x && result.x < norm.x && norm.x < unit.x)) return null;
  const center = i => i.x + i.width / 2;
  const gap = center(norm) - center(result);
  if (gap < 0.05 || gap > 0.25) return null;
  return {left:center(result)-gap/2, right:center(result)+gap/2,
    units:center(unit)-gap/2, top:Math.max(...header.map(i=>i.y))+0.006};
}

/** Координаты нормированы к размеру страницы. Берём только столбец результата,
 * а не соседние референсы. Неизвестные единицы и повторные измерения не угадываем.
 * pages: [{items:[{text,x,y,width,height}]}]; результат не содержит ФИО/номеров полиса.
 */
export function parseLabPages(pages, schema) {
  const aliases = new Map(Object.entries(labelAliases));
  for (const f of schema.fields) {
    for (const label of [f.key, f.label, f.original_label].filter(Boolean)) aliases.set(normalize(label), f.key);
  }
  const measurements = new Map(), seen = new Set(), blocked = new Set(), warnings = [];
  let previousColumns = null, ignored = 0, skippedPages = 0;
  for (const [pageIndex, page] of pages.entries()) {
    if (!page.items.length) { skippedPages++; continue; }
    const ownColumns = tableColumns(page.items);
    // Продолжение таблицы без шапки допустимо только на следующей странице
    // того же бланка: позиции столбцов и единицы всё равно проверяются.
    const columns = ownColumns ?? (previousColumns && {...previousColumns, top:0});
    if (!columns) { skippedPages++; continue; }
    previousColumns = columns;
    const body = page.items.filter(i => i.y > columns.top);
    const resultRows = lines(body.filter(i => {
      const center = i.x + i.width/2;
      return center > columns.left && center < columns.right;
    }));
    for (const [index, row] of resultRows.entries()) {
      const before = resultRows[index-1]?.y ?? row.y-0.05;
      const after = resultRows[index+1]?.y ?? row.y+0.05;
      const top = (before+row.y)/2, bottom = (after+row.y)/2;
      const band = body.filter(i => i.y > top && i.y < bottom);
      const label = lines(band.filter(i=>i.x < columns.left)).map(r=>r.text).join(' ');
      const key = aliases.get(normalize(label));
      if (!key) { ignored++; continue; }
      const field = schema.fields.find(f=>f.key===key);
      if (!field) continue;
      if (seen.has(key)) {
        blocked.add(key); measurements.delete(key);
        warnings.push(`${field.label}: найдено несколько результатов. Выберите нужный по дате и введите вручную.`);
        continue;
      }
      seen.add(key);
      const unit = lines(band.filter(i=>i.x >= columns.units)).map(r=>r.text).join(' ');
      const expected = unitAliases[field.unit] ?? field.unit;
      if (!unit || ![unitKey(expected), unitKey(field.unit)].includes(unitKey(unit))) {
        warnings.push(`${field.label}: единица измерения не распознана или отличается от ${expected}. Поле не заполнено.`);
        continue;
      }
      // Знаки <, >, диапазоны и текстовые ответы нельзя превращать в точное число.
      const raw = row.text.replace(/\s*[↑↓*]\s*$/u, '').trim();
      if (!/^\d+(?:[.,]\d+)?$/.test(raw) || !Number.isFinite(Number(raw.replace(',','.')))) {
        warnings.push(`${field.label}: результат не является однозначным числом. Проверьте бланк и заполните вручную.`);
        continue;
      }
      measurements.set(key, {key, value:raw.replace(',','.'), unit:expected, page:pageIndex+1});
    }
  }
  for (const key of blocked) measurements.delete(key);
  if (skippedPages) warnings.push(`Не удалось разобрать страниц: ${skippedPages}. Сверьте полноту показателей с бланком.`);
  if (!measurements.size) throw Error('Не удалось извлечь показатели из таблицы. Поддерживается текстовый бланк со столбцами «Тест», «Результат», «Норма», «Ед. изм.». Заполните анализы вручную.');
  return {measurements:[...measurements.values()], warnings:[...new Set(warnings)], ignored, pages:pages.length};
}

let pdfLibrary;
/** Safari может поддерживать getReader(), но не асинхронный перебор потока,
 * используемый PDF.js в getTextContent(). Читаем те же блоки через reader,
 * сохраняя порядок текста и координаты; глобальные API браузера не меняем. */
export async function readPdfTextItems(page) {
  const reader = page.streamTextContent().getReader();
  const items = [];
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) return items;
      for (const item of value.items) items.push(item);
    }
  } finally {
    reader.releaseLock();
  }
}

async function loadPdfLibrary() {
  if (!pdfLibrary) {
    pdfLibrary = (async () => {
      // Автономная сборка содержит эти же файлы в виде Blob URL; CDN не используется.
      const embedded = globalThis.LEYA_PDF_ASSETS;
      const lib = await import(embedded?.library ?? './vendor/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = embedded?.worker ?? new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    })().catch(error => { pdfLibrary = null; throw error; });
  }
  return pdfLibrary;
}

/** Файл обрабатывается локально. PDF-скрипты и вложения не исполняются,
 * OCR и отправка документа сторонним сервисам не используются. */
export async function parseLabPDF(buffer, schema) {
  if (buffer.byteLength > 5*1024*1024) throw Error('Размер PDF — не больше 5 МБ.');
  const bytes = new Uint8Array(buffer);
  if (!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-')) throw Error('Файл не является PDF. Выберите исходный бланк лаборатории.');
  let task, timer;
  try {
    const lib = await loadPdfLibrary();
    task = lib.getDocument({data:bytes, isEvalSupported:false, useSystemFonts:true,
      disableFontFace:true, useWasm:false, stopAtErrors:true});
    task.onPassword = () => { void task.destroy(); };
    const operation = (async () => {
      const doc = await task.promise;
      if (doc.numPages > 10) throw Error('Загрузите бланк не длиннее 10 страниц.');
      const pages = [];
      let characters = 0;
      for (let n=1; n<=doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (page.rotate % 360) throw Error('В PDF есть повёрнутые страницы. Используйте исходный бланк или ручной ввод.');
        const viewport = page.getViewport({scale:1});
        const textItems = await readPdfTextItems(page);
        const items = textItems.filter(i => i.str?.trim()).map(i => ({text:i.str,
          x:i.transform[4]/viewport.width, y:(viewport.height-i.transform[5])/viewport.height,
          width:i.width/viewport.width, height:i.height/viewport.height}));
        characters += items.reduce((sum,i)=>sum+i.text.length,0);
        if (characters > 250000) throw Error('В PDF слишком много текста. Загрузите отдельный бланк анализов.');
        pages.push({items});
        page.cleanup();
      }
      if (!characters) throw Error('В PDF нет доступного текста: возможно, это скан. Распознавание фотографий пока не поддерживается. Введите показатели вручную.');
      return parseLabPages(pages, schema);
    })();
    return await Promise.race([operation, new Promise((_,reject) => {
      timer = setTimeout(()=>reject(Error('Чтение PDF заняло слишком много времени. Попробуйте меньший файл или ручной ввод.')),45000);
    })]);
  } catch (error) {
    if (/password|passwordException|destroyed/i.test(String(error))) throw Error('Не удалось открыть PDF. Возможно, файл защищён паролем. Используйте незапароленный бланк или ручной ввод.');
    if (/InvalidPDF|MissingPDF|Invalid PDF|bad XRef|Failed to fetch|fetch dynamically/i.test(String(error))) throw Error('Не удалось прочитать PDF. Проверьте файл или введите показатели вручную.');
    throw error;
  } finally {
    clearTimeout(timer);
    await task?.destroy();
  }
}

