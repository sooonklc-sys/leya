import {TARGET_NAMES,SUPPORT} from './engine.js';

const wfEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wfSignals=r=>r.withheld||r.variant==='cbc'?[]:r.deficits.filter(d=>d.score>=.5&&(d.key!=='inflammation_anemia'||r.anemia));
const wfHypotheses={iron_deficiency:'дефицит железа',B12_deficiency:'дефицит витамина В12',folate_deficiency:'дефицит фолатов',B6_deficiency:'дефицит витамина В6',copper_deficiency:'дефицит меди',inflammation_anemia:'воспалительный профиль'};
function wfAssessment(r){
 if(r.withheld)return 'Оценка причин недоступна: есть пропуски в обязательном ОАК или значения вне диапазонов обучения.';
 if(r.variant==='cbc')return 'По одному ОАК причина остаётся неопределённой. Подробное заключение о дефицитах не формируется.';
 const signals=wfSignals(r);
 return signals.length?'Гипотезы для проверки: '+signals.map(d=>wfHypotheses[d.key]).join(', ')+'. Это предположения модели, а не подтверждённые диагнозы.':'Убедительный сигнал дефицита моделью не выделен. Это не исключает дефициты.';
}
function wfPatientAssessment(r){
 if(r.withheld)return 'Сервис не смог оценить возможные причины по этим данным. Это не означает, что дефицитов нет.';
 if(r.variant==='cbc')return 'Общего анализа крови недостаточно, чтобы этот сервис сделал подробный вывод о возможных дефицитах.';
 const signals=wfSignals(r);
 return signals.length?'По сочетанию показателей сервис предложил проверить: '+signals.map(d=>wfHypotheses[d.key]).join(', ')+'. Эти предположения требуют оценки врачом.':'Сервис не выделил убедительных признаков дефицита. Однако автоматический разбор не может исключить его.';
}
function wfPatientUnknown(r,schema){
 const notes=[];
 if(r.missingBasic.length)notes.push('В загруженных данных не указаны: '+wfNames(r.missingBasic,schema)+'. Если эти результаты есть в бланке, их можно добавить.');
 if(r.outside.length)notes.push('Некоторые значения выходят за границы, в которых работает прототип. Нужно проверить перенос цифр и единиц, затем обсудить результаты с врачом.');
 const missing=new Set();
 if(!r.withheld){
  if(r.variant==='cbc')for(const key of ['ferritin','TSAT','CRP'])if(r.values[key]==null)missing.add(key);
  for(const d of wfSignals(r))for(const key of SUPPORT[d.key])if(r.values[key]==null)missing.add(key);
 }
 if(missing.size)notes.push('Для уточнения предположений могут быть полезны отсутствующие результаты: '+wfNames([...missing],schema)+'. Врач определит, нужны ли эти исследования именно вам.');
 notes.push('Для полного разбора врачу нужно учесть ваше самочувствие, историю заболеваний и результаты осмотра. Одних цифр в анализах недостаточно.');
 return notes.join('\n\n');
}
function wfNames(keys,schema){return keys.map(k=>schema.fields.find(f=>f.key===k)?.label??k).join(', ');}
function wfGaps(r,schema){
 const messages=[];
 if(r.missingBasic.length)messages.push('Для расчёта причин не хватает показателей ОАК: '+wfNames(r.missingBasic,schema)+'.');
 if(r.outside.length)messages.push('Проверьте значения и единицы: '+wfNames(r.outside,schema)+'. Они вне диапазонов обучающей выборки; это не клинические референсы.');
 const missing=new Set();
 if(!r.withheld){
  if(r.variant==='cbc')for(const key of ['ferritin','TSAT','CRP'])if(r.values[key]==null)missing.add(key);
  for(const d of wfSignals(r))for(const key of SUPPORT[d.key])if(r.values[key]==null)missing.add(key);
 }
 if(missing.size)messages.push('Для уточнения отмеченных направлений не представлены: '+wfNames([...missing],schema)+'. Необходимость исследований определяет врач.');
 if(!messages.length)messages.push('Обязательный ОАК и уточняющие показатели для выделенных моделью направлений представлены. Это не означает, что обследование завершено.');
 messages.push('Жалобы, история заболеваний и результаты осмотра в расчёт не входят. Их нужно учесть при интерпретации.');
 return messages;
}
export function doctorOverview(r,schema){
 const missing=schema.fields.filter(f=>r.values[f.key]==null);
 const Hb=new Intl.NumberFormat('ru-RU').format(r.values.hemoglobin);
 return `<article class="result-card doctor-overview"><p class="kicker">Кратко для врача</p><h3>Что требует внимания</h3><ul class="overview-list"><li><strong>По представленным данным</strong><p>Гемоглобин ${Hb} г/л. ${r.anemia?'Гемоглобин снижен — есть признаки анемии. Причину снижения нужно уточнить.':'По уровню гемоглобина признаков анемии не выявлено. Это не исключает дефицит железа или витаминов: их оценивают по другим показателям.'}</p><p class="micro">Для этого расчёта признак анемии — гемоглобин ниже ${r.threshold} г/л. Ограничения оценки указаны в разделе «Как работает оценка и где её границы».</p></li><li><strong>Что проверить</strong><p>${wfEscape(wfAssessment(r))}</p>${r.contradiction?'<p class="error">Выбранная моделью группа не согласуется с гемоглобином. Требуется самостоятельная оценка врача.</p>':''}</li><li><strong>Что пока неизвестно</strong>${wfGaps(r,schema).map(t=>`<p>${wfEscape(t)}</p>`).join('')}</li></ul></article><details class="result-card data-coverage"><summary>Состав данных: ${r.present} из ${schema.fields.length} показателей</summary><p>Это состав загруженного бланка, а не оценка полноты обследования. Пропуск не означает норму или отсутствие дефицита. Сдавать все перечисленные анализы автоматически не требуется.</p>${missing.length?`<p><strong>Не представлены:</strong> ${wfEscape(missing.map(f=>f.label).join(', '))}.</p>`:'<p>Все поля лабораторного словаря заполнены.</p>'}</details>`;
}

export function setupMemo(getReport,schema){
 const el=id=>document.getElementById(id),editor=el('memo-editor'),review=el('memo-reviewed'),print=el('memo-print'),printArea=el('memo-printout');
 const fields=['memo-findings','memo-unknown','memo-next','memo-comment'];
 const headings=['Что показали анализы','Что требует уточнения','Следующий шаг','Комментарий врача'];
 function resize(){if(!editor.hidden)for(const id of fields){el(id).style.height='auto';el(id).style.height=Math.max(105,el(id).scrollHeight+3)+'px';}}
 function update(){print.disabled=!review.checked;el('memo-status').textContent=review.checked?'Содержание проверено пользователем. Памятка готова к печати.':'Черновик — проверьте и при необходимости измените текст.';}
 function reset(){editor.hidden=true;for(const id of fields)el(id).value='';review.checked=false;printArea.replaceChildren();update();}
 function prepare(){const r=getReport();if(!r)return;if(editor.hidden){
  el('memo-findings').value=`Гемоглобин — ${new Intl.NumberFormat('ru-RU').format(r.values.hemoglobin)} г/л. ${r.anemia?'Гемоглобин снижен. Это признак анемии; врач поможет выяснить причину.':'Гемоглобин не снижен. По этому показателю признаков анемии не выявлено. Однако нехватка железа или витаминов может быть и без снижения гемоглобина. Для её оценки врач учитывает другие анализы.'}\n\n${wfPatientAssessment(r)}${r.contradiction?'\n\nАвтоматический разбор содержит противоречие и требует проверки врачом.':''}${r.severe?'\n\nВыраженное снижение гемоглобина. Не откладывайте медицинскую оценку. При обмороке, боли в груди или одышке в покое обращайтесь за экстренной помощью.':''}`;
  el('memo-unknown').value=wfPatientUnknown(r,schema);
  el('memo-next').value='Дальнейшие действия пока не согласованы. Врач дополнит этот раздел после оценки анализов, жалоб и истории заболеваний.';
  editor.hidden=false;review.checked=false;update();resize();
 }editor.scrollIntoView({behavior:'smooth',block:'start'});el('memo-findings').focus({preventScroll:true});}
 function preparePrint(){printArea.replaceChildren();const r=getReport();const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;printArea.append(node);};
  add('h1','Лея · Памятка по анализам');
  if(!r||editor.hidden){add('p','Памятка ещё не подготовлена. Сначала проанализируйте данные и подготовьте объяснение для пациента.');return;}
  add('p',review.checked?'Содержание проверено пользователем перед печатью.':'ЧЕРНОВИК — содержание не проверено.');
  add('p',`Возраст: ${r.values.age_years} · ${r.values.sex==='F'?'Женский':'Мужской'} пол · Гемоглобин: ${new Intl.NumberFormat('ru-RU').format(r.values.hemoglobin)} г/л`);
  fields.forEach((id,i)=>{if(el(id).value.trim()){add('h2',headings[i]);add('p',el(id).value);}});
  add('p','Памятка подготовлена с помощью исследовательского прототипа. Автоматические предположения не подтверждают диагноз. Отметка проверки не является электронной подписью врача.');
 }
 editor.addEventListener('input',e=>{if(e.target!==review){review.checked=false;printArea.replaceChildren();}update();resize();});
 window.addEventListener('resize',resize);
 review.addEventListener('change',update);print.onclick=()=>{if(review.checked&&getReport()&&!editor.hidden){preparePrint();window.print();}};
 window.addEventListener('beforeprint',preparePrint);
 return {reset,prepare};
}
