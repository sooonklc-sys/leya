export const CLASS_NAMES={no_anemia_no_deficiency:'Нет анемии и дефицитов по разметке',latent_deficiency:'Дефицит железа без анемии',iron_deficiency_anemia:'Железодефицитная анемия',B12_deficiency_anemia:'B12-дефицитная анемия',B12_deficiency_no_anemia:'Дефицит B12 без анемии',folate_deficiency_anemia:'Фолат-дефицитная анемия',folate_deficiency_no_anemia:'Дефицит фолатов без анемии',B6_deficiency:'Дефицит B6',copper_deficiency:'Дефицит меди',mixed_deficiency:'Сочетание дефицитов',anemia_other:'Анемия другой / неуточнённой причины',inflammation_anemia:'Анемия воспалительного профиля'};
export const TARGET_NAMES={iron_deficiency:'Железо',B12_deficiency:'Витамин B12',folate_deficiency:'Фолаты',B6_deficiency:'Витамин B6',copper_deficiency:'Медь',inflammation_anemia:'Воспалительный профиль'};
export const SUPPORT={iron_deficiency:['ferritin','TSAT','CRP'],B12_deficiency:['vitamin_B12','active_B12','MMA'],folate_deficiency:['folate','vitamin_B12'],B6_deficiency:['vitamin_B6'],copper_deficiency:['copper','ceruloplasmin'],inflammation_anemia:['CRP','ferritin','TSAT']};
export function predictForest(forest,values){
 const x=forest.features.map((f,i)=>Math.fround(values[f]==null?forest.medians[i]:Number(values[f])));
 const sums=new Array(forest.classes.length).fill(0);
 for(const tree of forest.trees){let n=0;while(tree.left[n]!==-1)n=x[tree.feature[n]]<=tree.threshold[n]?tree.left[n]:tree.right[n];for(let k=0;k<sums.length;k++)sums[k]+=tree.value[n][k];}
 return sums.map(v=>v/forest.trees.length);
}
export function calculateReport(values,schema,model){
 const threshold=model.anemia_rule[values.sex],anemia=values.hemoglobin<threshold;
 const missingBasic=schema.basic.filter(x=>x!=='RDW').filter(k=>values[k]==null);
 const present=schema.fields.filter(f=>values[f.key]!=null);
 const outside=present.filter(f=>values[f.key]<f.observed_min||values[f.key]>f.observed_max).map(f=>f.key);
 const extra=present.filter(f=>!schema.basic.includes(f.key)).length,variant=extra?'extended':'cbc';
 const result={values:{...values},anemia,threshold,missingBasic,present:present.length,extra,variant,outside,severe:values.hemoglobin<80,ranking:[],deficits:[],influential:[],withheld:missingBasic.length>0||outside.length>0};
 if(result.withheld)return result;
 const input={...values,sex:values.sex==='F'?0:1},chosen=model.variants[variant],probs=predictForest(chosen.classifier,input);
 result.ranking=chosen.classifier.classes.map((name,i)=>({name,score:probs[i]})).sort((a,b)=>b.score-a.score);
 result.deficits=model.targets.map(key=>{const binary=chosen.deficits[key],p=predictForest(binary,input);return{key,score:p[binary.classes.indexOf('1')],available:SUPPORT[key].filter(f=>input[f]!=null),missing:SUPPORT[key].filter(f=>input[f]==null)};}).sort((a,b)=>b.score-a.score);
 const top=result.ranking[0];
 const classAnemia=top.name.includes('_no_anemia')||['latent_deficiency','no_anemia_no_deficiency'].includes(top.name)?false:['B6_deficiency','copper_deficiency'].includes(top.name)?null:true;
 result.contradiction=classAnemia!==null&&classAnemia!==anemia;
 const targetIndex=chosen.classifier.classes.indexOf(top.name);
 result.influential=present.filter(f=>chosen.classifier.features.includes(f.key)).map(f=>({key:f.key,value:input[f.key],impact:Math.abs(top.score-predictForest(chosen.classifier,{...input,[f.key]:null})[targetIndex])})).sort((a,b)=>b.impact-a.impact).slice(0,5);
 return result;
}
