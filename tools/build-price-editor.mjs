#!/usr/bin/env node
// Генерирует скрытую страницу пересмотра цен из assets/data/prices.json
// Запуск: node tools/build-price-editor.mjs <slug-папки>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const slug = process.argv[2];
if (!slug) { console.error('нужен slug папки, напр. price-edit-xxxxx'); process.exit(1); }

const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/prices.json'), 'utf8'));
const DATA = JSON.stringify(reg.items);

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>EGOE — пересмотр цен</title>
<style>
:root{--bg:#0f1113;--card:#171a1d;--card2:#1d2126;--line:#2a2f35;--tx:#e8eaec;--mut:#9aa3ab;--acc:#ffb020;--ok:#3ecf72;--bad:#ff6b6b}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:15px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif;padding-bottom:110px}
.top{position:sticky;top:0;z-index:20;background:rgba(15,17,19,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:14px 16px}
.top h1{font-size:17px;letter-spacing:.06em}
.top h1 b{color:var(--acc)}
.top .sub{color:var(--mut);font-size:12.5px;margin-top:3px}
.tabs{display:flex;gap:8px;margin-top:12px}
.tab{flex:1;padding:10px 8px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--mut);text-align:center;cursor:pointer;font-size:14px;font-weight:600}
.tab.on{border-color:var(--acc);color:var(--tx);background:#221d10}
.tab small{display:block;font-weight:400;font-size:11px;margin-top:2px}
.flt{display:flex;gap:6px;margin-top:10px}
.chip{padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--mut);font-size:12.5px;cursor:pointer}
.chip.on{border-color:var(--tx);color:var(--tx)}
.wrap{max-width:860px;margin:0 auto;padding:14px}
.cat{margin-bottom:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden}
.cat>header{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;cursor:pointer;user-select:none}
.cat>header h2{font-size:15px}
.cat>header .cnt{font-size:12.5px;color:var(--mut)}
.cat>header .cnt b.done{color:var(--ok)}
.cat.closed .rows{display:none}
.row{display:grid;grid-template-columns:64px 1fr 150px;gap:12px;padding:12px 16px;border-top:1px solid var(--line);align-items:center}
.row.hid{display:none}
.row img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:#22262b;display:block}
.row .noimg{width:64px;height:64px;border-radius:8px;background:#22262b;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:11px}
.row .nm{font-weight:600;font-size:14px}
.row .nm a{color:inherit;text-decoration:none;border-bottom:1px dotted var(--mut)}
.row .meta{color:var(--mut);font-size:12.5px;margin-top:2px}
.row .meta .old{color:var(--tx)}
.row .note-in{margin-top:7px;width:100%;background:var(--card2);border:1px solid var(--line);border-radius:8px;color:var(--tx);font-size:12.5px;padding:6px 9px;display:none}
.row.noted .note-in,.row .note-in.show{display:block}
.ctrl{display:flex;flex-direction:column;gap:6px;align-items:stretch}
.ctrl input[type=text]{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:9px;color:var(--tx);font-size:16px;font-weight:700;padding:9px 32px 9px 11px;text-align:right}
.ctrl input:focus{outline:none;border-color:var(--acc)}
.ctrl .pin{position:relative}
.ctrl .pin::after{content:'₽';position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:14px}
.ctrl .mini{display:flex;gap:6px}
.mb{flex:1;padding:6px 4px;font-size:11.5px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--mut);cursor:pointer;white-space:nowrap}
.mb.on{border-color:var(--ok);color:var(--ok)}
.mb.poz.on{border-color:var(--acc);color:var(--acc)}
.row.done-row{background:rgba(62,207,114,.05)}
.row .st{font-size:11px;color:var(--ok);display:none;text-align:right}
.row.done-row .st{display:block}
.bot{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(15,17,19,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding:12px 16px}
.bot .in{max-width:860px;margin:0 auto;display:flex;gap:12px;align-items:center}
.pr{flex:1}
.pr .bar{height:7px;border-radius:99px;background:var(--card2);overflow:hidden}
.pr .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),var(--ok));transition:width .3s}
.pr .t{font-size:12px;color:var(--mut);margin-top:5px}
.dl{padding:12px 18px;border-radius:11px;border:0;background:var(--acc);color:#151105;font-weight:800;font-size:14px;cursor:pointer;white-space:nowrap}
.dl:disabled{opacity:.4;cursor:default}
.dl2{padding:12px 14px;border-radius:11px;border:1px solid var(--line);background:transparent;color:var(--mut);font-size:13px;cursor:pointer;white-space:nowrap}
.saved{position:fixed;top:70px;right:14px;z-index:40;background:var(--card);border:1px solid var(--ok);color:var(--ok);border-radius:9px;padding:7px 13px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .3s}
.saved.show{opacity:1}
.hint{max-width:860px;margin:6px auto 0;padding:0 16px;color:var(--mut);font-size:12.5px}
@media(max-width:560px){
 .row{grid-template-columns:52px 1fr;grid-template-rows:auto auto}
 .row img,.row .noimg{width:52px;height:52px}
 .ctrl{grid-column:1/-1}
 .ctrl .mini{justify-content:stretch}
}
</style>
</head>
<body>
<div class="top">
 <div class="wrap" style="padding:0 2px">
  <h1><b>EGOE</b> · ПЕРЕСМОТР ЦЕН</h1>
  <div class="sub">Впишите новую цену «от» по каждой позиции. Всё сохраняется автоматически на этом устройстве — можно заполнять в несколько заходов.</div>
  <div class="tabs" id="tabs"></div>
  <div class="flt" id="flt">
   <span class="chip on" data-f="all">Все</span>
   <span class="chip" data-f="todo">Осталось заполнить</span>
   <span class="chip" data-f="done">Заполненные</span>
  </div>
 </div>
</div>
<div class="hint">Подсказка: если цена не меняется — нажмите «без изменений». По Art Déco можно оставить «под заказ» или задать цену.</div>
<div class="wrap" id="list"></div>
<div class="saved" id="saved">✓ Сохранено</div>
<div class="bot"><div class="in">
 <div class="pr"><div class="bar"><i id="pbar"></i></div><div class="t" id="ptxt"></div></div>
 <button class="dl2" id="csv">CSV</button>
 <button class="dl" id="dl">Скачать файл цен</button>
</div></div>
<script>
const ITEMS=__DATA__;
const LS='egoe-prices-v1';
let state={};try{state=JSON.parse(localStorage.getItem(LS)||'{}')}catch(e){}
let tab='standard',flt='all';
const fmt=n=>n==null?'—':String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'\\u2009');
const key=i=>i.group+':'+i.cat+':'+i.slug;
const st=i=>state[key(i)]||{};
const isDone=i=>{const s=st(i);return s.keep||s.poz||(s.price!=null&&s.price!=='')};
function save(){localStorage.setItem(LS,JSON.stringify(state));const el=document.getElementById('saved');el.classList.add('show');clearTimeout(save._t);save._t=setTimeout(()=>el.classList.remove('show'),900)}
function counts(g){const its=ITEMS.filter(i=>i.group===g);return[its.filter(isDone).length,its.length]}
function renderTabs(){
 const t=document.getElementById('tabs');
 t.innerHTML=[['standard','Стандарт'],['artdeco','Art Déco']].map(([g,l])=>{const[d,n]=counts(g);return '<div class="tab'+(tab===g?' on':'')+'" data-g="'+g+'">'+l+'<small>'+d+' / '+n+'</small></div>'}).join('');
 t.querySelectorAll('.tab').forEach(el=>el.onclick=()=>{tab=el.dataset.g;render()});
}
function rowHtml(i){
 const s=st(i);const done=isDone(i);
 const img=i.photo?'<img loading="lazy" src="../'+i.photo+'" alt="">':'<div class="noimg">нет фото</div>';
 const old=i.price!=null?'сейчас: <span class="old">от '+fmt(i.price)+' ₽</span>':'сейчас: <span class="old">под заказ</span>';
 const val=s.keep?fmt(i.price):(s.price!=null&&s.price!==''?fmt(s.price):'');
 const ad=i.group==='artdeco';
 return '<div class="row'+(done?' done-row':'')+(s.note?' noted':'')+'" data-k="'+key(i)+'" data-done="'+(done?1:0)+'">'
 +img
 +'<div><div class="nm"><a href="../'+i.url+'" target="_blank" rel="noopener">'+i.name+'</a></div>'
 +'<div class="meta">'+i.catLabel+' · '+i.sku+' · '+old+'</div>'
 +'<input class="note-in'+(s.note?' show':'')+'" placeholder="заметка (необязательно)" value="'+(s.note||'').replace(/"/g,'&quot;')+'"></div>'
 +'<div class="ctrl">'
 +'<div class="pin"><input type="text" inputmode="numeric" placeholder="'+(i.price!=null?fmt(i.price):'цена от')+'" value="'+val+'"'+(s.keep||s.poz?' disabled':'')+'></div>'
 +'<div class="mini">'
 +(i.price!=null?'<button class="mb keep'+(s.keep?' on':'')+'">без изменений</button>':'')
 +(ad?'<button class="mb poz'+(s.poz?' on':'')+'">под заказ</button>':'')
 +'<button class="mb nt">✎</button>'
 +'</div><div class="st">✓ заполнено</div></div></div>';
}
function render(){
 renderTabs();
 const list=document.getElementById('list');
 const cats=[...new Set(ITEMS.filter(i=>i.group===tab).map(i=>i.catLabel))];
 list.innerHTML=cats.map(c=>{
  const its=ITEMS.filter(i=>i.group===tab&&i.catLabel===c);
  const d=its.filter(isDone).length;
  const rows=its.filter(i=>flt==='all'||(flt==='done'?isDone(i):!isDone(i))).map(rowHtml).join('');
  if(flt!=='all'&&!rows)return'';
  return '<div class="cat"><header><h2>'+c+'</h2><span class="cnt"><b class="'+(d===its.length?'done':'')+'">'+d+'</b> / '+its.length+'</span></header><div class="rows">'+rows+'</div></div>';
 }).join('');
 list.querySelectorAll('.cat>header').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('closed'));
 list.querySelectorAll('.row').forEach(bindRow);
 progress();
}
function bindRow(row){
 const k=row.dataset.k;const item=ITEMS.find(i=>key(i)===k);
 const inp=row.querySelector('.pin input');
 const keep=row.querySelector('.mb.keep');
 const poz=row.querySelector('.mb.poz');
 const nt=row.querySelector('.mb.nt');
 const note=row.querySelector('.note-in');
 inp.addEventListener('input',()=>{
  const raw=inp.value.replace(/\\D/g,'');
  inp.value=raw?fmt(+raw):'';
  const s=state[k]=state[k]||{};s.price=raw?+raw:'';delete s.keep;delete s.poz;
  if(keep)keep.classList.remove('on');if(poz)poz.classList.remove('on');
  refresh(row,item);save();
 });
 if(keep)keep.onclick=()=>{
  const s=state[k]=state[k]||{};s.keep=!s.keep;delete s.poz;if(s.keep){s.price=item.price;inp.value=fmt(item.price);inp.disabled=true}else{s.price='';inp.value='';inp.disabled=false}
  keep.classList.toggle('on',!!s.keep);if(poz)poz.classList.remove('on');refresh(row,item);save();
 };
 if(poz)poz.onclick=()=>{
  const s=state[k]=state[k]||{};s.poz=!s.poz;delete s.keep;if(s.poz){s.price='';inp.value='';inp.disabled=true}else{inp.disabled=false}
  poz.classList.toggle('on',!!s.poz);if(keep)keep.classList.remove('on');refresh(row,item);save();
 };
 nt.onclick=()=>{note.classList.toggle('show');if(note.classList.contains('show'))note.focus()};
 note.addEventListener('input',()=>{const s=state[k]=state[k]||{};s.note=note.value;save()});
}
function refresh(row,item){
 const done=isDone(item);
 row.classList.toggle('done-row',done);row.dataset.done=done?1:0;
 renderTabs();progress();
 const cat=row.closest('.cat');const its=ITEMS.filter(i=>i.group===tab&&i.catLabel===item.catLabel);
 const d=its.filter(isDone).length;const cnt=cat.querySelector('.cnt');
 cnt.innerHTML='<b class="'+(d===its.length?'done':'')+'">'+d+'</b> / '+its.length;
}
function progress(){
 const d=ITEMS.filter(isDone).length;
 document.getElementById('pbar').style.width=(100*d/ITEMS.length)+'%';
 document.getElementById('ptxt').textContent='Заполнено '+d+' из '+ITEMS.length;
 document.getElementById('dl').disabled=d===0;
}
document.querySelectorAll('#flt .chip').forEach(ch=>ch.onclick=()=>{
 document.querySelectorAll('#flt .chip').forEach(c=>c.classList.remove('on'));
 ch.classList.add('on');flt=ch.dataset.f;render();
});
function exportItems(){
 return ITEMS.map(i=>{const s=st(i);return{group:i.group,cat:i.cat,catLabel:i.catLabel,slug:i.slug,sku:i.sku,name:i.name,
  oldPrice:i.price,newPrice:s.keep?i.price:(s.poz?null:(s.price!==''&&s.price!=null?s.price:null)),
  underOrder:!!s.poz,
  keep:!!s.keep,filled:isDone(i),note:s.note||''}});
}
function dl(name,text,mime){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:mime}));a.download=name;a.click()}
document.getElementById('dl').onclick=()=>{
 const out={version:1,exportedAt:new Date().toISOString(),filled:ITEMS.filter(isDone).length,total:ITEMS.length,items:exportItems()};
 dl('egoe-prices.json',JSON.stringify(out,null,1),'application/json');
 alert('Файл egoe-prices.json скачан. Отправьте его нам — цены будут применены на сайт.');
};
document.getElementById('csv').onclick=()=>{
 const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
 const rows=[['Раздел','Линейка','Категория','Артикул','Название','Цена сейчас','Новая цена','Под заказ','Без изменений','Заметка']]
  .concat(exportItems().map(r=>[r.cat,r.group==='artdeco'?'Art Déco':'Стандарт',r.catLabel,r.sku,r.name,r.oldPrice??'',r.newPrice??'',r.underOrder?'да':'',r.keep?'да':'',r.note]));
 dl('egoe-prices.csv','\\uFEFF'+rows.map(r=>r.map(esc).join(';')).join('\\r\\n'),'text/csv;charset=utf-8');
};
render();
</script>
</body>
</html>`;

const out = path.join(ROOT, slug, 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html.replace('__DATA__', DATA));
console.log('written', out, Math.round(fs.statSync(out).size / 1024) + 'KB, items:', reg.items.length);
