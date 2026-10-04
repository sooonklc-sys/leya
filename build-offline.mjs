import fs from 'node:fs/promises';
import path from 'node:path';
import{fileURLToPath}from'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFile(path.join(root,'dist',name),'utf8');
const safeScript=s=>s.replace(/<\/script/gi,'<\\/script');
let html=await read('index.html');
html=html.replace('class="brand" href="./"','class="brand" href="#"');
let css=await read('styles.css');
for(const font of ['Unbounded','Manrope']){
 const bytes=await fs.readFile(path.join(root,'dist','assets',font+'.ttf'));
 css=css.replace('assets/'+font+'.ttf','data:font/ttf;base64,'+bytes.toString('base64'));
}
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>'<style>'+css+'</style>');
try{
 const art=await fs.readFile(path.join(root,'dist','assets','caring-conversation.png'));
 html=html.replace('src="assets/caring-conversation.png"',()=> 'src="data:image/png;base64,'+art.toString('base64')+'"');
}catch(error){
 if(error.code!=='ENOENT')throw error;
 html=html.replace(/<img\b[^>]*src="assets\/caring-conversation\.png"[^>]*>/,'');
 console.warn('Необязательная иллюстрация отсутствует: сборка будет без неё.');
}
html=html.replace('href="template.csv"','href="data:text/csv;charset=utf-8,'+encodeURIComponent(await read('template.csv'))+'"');
const engine=(await read('engine.js')).replace(/^export /gm,'');
const importer=(await read('import.js')).replace(/^export /gm,'');
const pdfImporter=(await read('pdf-import.js')).replace(/^export /gm,'');
const localization=(await read('localization.js')).replace(/^export /gm,'');
const workflow=(await read('workflow.js')).replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
const app=(await read('app.js')).replace(/^import[^\n]+\n/gm,'');
const schema=await read('schema.json'),model=await read('model.json');
const pdfLibrary=Buffer.from(await read('vendor/pdf.min.mjs')).toString('base64');
const pdfWorker=Buffer.from(await read('vendor/pdf.worker.min.mjs')).toString('base64');
const embeddedPdf=`const pdfBlob=s=>URL.createObjectURL(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))],{type:'text/javascript'}));globalThis.LEYA_PDF_ASSETS={library:pdfBlob('${pdfLibrary}'),worker:pdfBlob('${pdfWorker}')};addEventListener('pagehide',()=>{Object.values(globalThis.LEYA_PDF_ASSETS).forEach(URL.revokeObjectURL);},{once:true});`;
const scripts='<script>'+embeddedPdf+'globalThis.HEMO_PRELOADED=['+safeScript(schema)+','+safeScript(model)+'];</script><script type="module">'+safeScript(engine+'\n'+importer+'\n'+pdfImporter+'\n'+localization+'\n'+workflow+'\n'+app)+'</script>';
html=html.replace('<script type="module" src="app.js"></script>',()=>scripts);
const out=process.argv[2]?path.resolve(root,process.argv[2]):path.join(root,'..','hemonavigator.html');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,html,'utf8');console.log('Offline artifact:',out,'bytes:',Buffer.byteLength(html));
