#!/usr/bin/env node
// Генерирует скрытую страницу пересмотра цен из assets/data/prices.json (v2: галереи фото)
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
:root{--bg:#0f1113;--card:#171a1d;--card2:#1d2126;--line:#2a2f35;--tx:#e8eaec;--mut:#9aa3ab;--acc:#ffb020;--ok:#3ecf72}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font:15px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif;padding-bottom:96px}
.top{position:sticky;top:0;z-index:20;background:rgba(15,17,19,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:12px 0 10px}
.tin{max-width:1180px;margin:0 auto;padding:0 16px}
.top h1{font-size:16px;letter-spacing:.06em;display:flex;align-items:baseline;gap:10px}
.top h1 b{color:var(--acc)}
.top h1 small{color:var(--mut);font-weight:400;font-size:12px}
.cats{display:flex;gap:7px;margin-top:11px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:2px}
.cats::-webkit-scrollbar{display:none}
.cat-chip{flex:0 0 auto;padding:8px 14px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--mut);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.cat-chip.on{border-color:var(--acc);color:var(--tx);background:#221d10}
.cat-chip i{font-style:normal;font-weight:400;font-size:11px;opacity:.75;margin-left:5px}
.cat-chip i.full{color:var(--ok);opacity:1}
.sub{display:flex;gap:7px;margin-top:9px;align-items:center;flex-wrap:wrap}
.gr{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.gr span{padding:7px 14px;font-size:12.5px;color:var(--mut);cursor:pointer;background:var(--card)}
.gr span.on{background:#221d10;color:var(--tx);font-weight:600}
.flt{display:flex;gap:6px;margin-left:auto}
.chip{padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--mut);font-size:12px;cursor:pointer;white-space:nowrap}
.chip.on{border-color:var(--tx);color:var(--tx)}
.wrap{max-width:1180px;margin:0 auto;padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.card{border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden;display:flex;flex-direction:column}
.card.done-row{border-color:rgba(62,207,114,.45)}
.gal{position:relative;aspect-ratio:4/3;background:#22262b}
.gal img{width:100%;height:100%;object-fit:cover;display:block}
.gal .noimg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px}
.gnav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:56px;border:0;background:rgba(15,17,19,.55);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.gnav.p{left:0;border-radius:0 10px 10px 0}
.gnav.n{right:0;border-radius:10px 0 0 10px}
.dots{position:absolute;bottom:9px;left:0;right:0;display:flex;gap:5px;justify-content:center}
.dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.4)}
.dots i.on{background:var(--acc)}
.gtag{position:absolute;top:9px;right:9px;background:rgba(15,17,19,.6);color:#dfe3e7;font-size:11px;padding:3px 9px;border-radius:999px;backdrop-filter:blur(4px)}
.done-b{position:absolute;top:9px;left:9px;background:rgba(23,50,33,.85);color:var(--ok);font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;display:none}
.card.done-row .done-b{display:block}
.cb{padding:12px 14px 14px;display:flex;flex-direction:column;gap:9px;flex:1}
.nm{font-weight:650;font-size:14.5px;line-height:1.3}
.meta{color:var(--mut);font-size:12.5px}
.meta b{color:var(--tx);font-weight:600}
.pin{position:relative}
.pin input{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:10px;color:var(--tx);font-size:17px;font-weight:700;padding:10px 34px 10px 12px;text-align:right}
.pin input:focus{outline:none;border-color:var(--acc)}
.pin::after{content:'₽';position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--mut)}
.mini{display:flex;gap:7px}
.mb{flex:1;padding:8px 6px;font-size:12px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--mut);cursor:pointer;white-space:nowrap}
.mb.on{border-color:var(--ok);color:var(--ok)}
.mb.poz.on{border-color:var(--acc);color:var(--acc)}
.mb.nt{flex:0 0 44px}
.note-in{width:100%;background:var(--card2);border:1px solid var(--line);border-radius:9px;color:var(--tx);font-size:12.5px;padding:7px 10px;display:none}
.note-in.show{display:block}
.bot{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(15,17,19,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding:11px 16px}
.bot .in{max-width:1180px;margin:0 auto;display:flex;gap:12px;align-items:center}
.pr{flex:1}
.pr .bar{height:7px;border-radius:99px;background:var(--card2);overflow:hidden}
.pr .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--acc),var(--ok));transition:width .3s}
.pr .t{font-size:12px;color:var(--mut);margin-top:4px}
.dl{padding:12px 18px;border-radius:11px;border:0;background:var(--acc);color:#151105;font-weight:800;font-size:14px;cursor:pointer;white-space:nowrap}
.dl:disabled{opacity:.4;cursor:default}
.dl2{padding:12px 14px;border-radius:11px;border:1px solid var(--line);background:transparent;color:var(--mut);font-size:13px;cursor:pointer}
.saved{position:fixed;top:64px;right:14px;z-index:40;background:var(--card);border:1px solid var(--ok);color:var(--ok);border-radius:9px;padding:7px 13px;font-size:12.5px;opacity:0;pointer-events:none;transition:opacity .3s}
.saved.show{opacity:1}
.empty{color:var(--mut);text-align:center;padding:60px 0;grid-column:1/-1}
@media(max-width:560px){.grid{grid-template-columns:1fr}.flt{margin-left:0}.sub{gap:8px}.top h1 small{display:none}}
</style>
</head>
<body>
<div class="top"><div class="tin">
 <h1><b>EGOE</b> · ПЕРЕСМОТР ЦЕН <small>сохраняется само, можно в несколько заходов</small></h1>
 <div class="cats" id="cats"></div>
 <div class="sub">
  <div class="gr" id="gr"></div>
  <div class="flt">
   <span class="chip on" data-f="all">Все</span>
   <span class="chip" data-f="todo">Осталось</span>
   <span class="chip" data-f="done">Заполненные</span>
  </div>
 </div>
</div></div>
<div class="wrap"><div class="grid" id="list"></div></div>
<div class="saved" id="saved">✓ Сохранено</div>
<div class="bot"><div class="in">
 <div class="pr"><div class="bar"><i id="pbar"></i></div><div class="t" id="ptxt"></div></div>
 <button class="dl2" id="csv">CSV</button>
 <button class="dl" id="dl">Скачать файл цен</button>
</div></div>
<script>
const ITEMS=__DATA__;
const LS='egoe-prices-v2';
let state={};try{state=JSON.parse(localStorage.getItem(LS)||'{}')}catch(e){}
const CATS=[...new Set(ITEMS.map(i=>i.catLabel))];
let cat=CATS[0],grp='standard',flt='all';
const fmt=n=>n==null?'—':String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'\\u2009');
const key=i=>i.group+':'+i.cat+':'+i.slug;
const st=i=>state[key(i)]||{};
const isDone=i=>{const s=st(i);return s.keep||s.poz||(s.price!=null&&s.price!=='')};
const CATSHORT={'Корзины для кондиционеров':'Корзины конд.','Контейнерные площадки':'Площадки ТБО','Павильоны и навесы':'Павильоны'};
function save(){localStorage.setItem(LS,JSON.stringify(state));const el=document.getElementById('saved');el.classList.add('show');clearTimeout(save._t);save._t=setTimeout(()=>el.classList.remove('show'),900)}
function items(c,g){return ITEMS.filter(i=>i.catLabel===c&&(g?i.group===g:true))}
function renderCats(){
 document.getElementById('cats').innerHTML=CATS.map(c=>{
  const its=items(c),d=its.filter(isDone).length;
  return '<span class="cat-chip'+(c===cat?' on':'')+'" data-c="'+c+'">'+(CATSHORT[c]||c)+'<i class="'+(d===its.length?'full':'')+'">'+d+'/'+its.length+'</i></span>';
 }).join('');
 document.querySelectorAll('.cat-chip').forEach(el=>el.onclick=()=>{cat=el.dataset.c;
  const gs=[...new Set(items(cat).map(i=>i.group))];if(!gs.includes(grp))grp=gs[0];
  render();document.querySelector('.wrap').scrollIntoView()});
}
function renderGr(){
 const gs=[...new Set(items(cat).map(i=>i.group))];
 const el=document.getElementById('gr');
 el.style.display=gs.length>1?'':'none';
 el.innerHTML=[['standard','Стандарт'],['artdeco','Art Déco']].filter(([g])=>gs.includes(g)).map(([g,l])=>{
  const its=items(cat,g),d=its.filter(isDone).length;
  return '<span class="'+(g===grp?'on':'')+'" data-g="'+g+'">'+l+' · '+d+'/'+its.length+'</span>';
 }).join('');
 el.querySelectorAll('span').forEach(s=>s.onclick=()=>{grp=s.dataset.g;render()});
}
function cardHtml(i,idx){
 const s=st(i),done=isDone(i);
 const val=s.keep?fmt(i.price):(s.price!=null&&s.price!==''?fmt(s.price):'');
 const ph=i.photos&&i.photos.length?i.photos:[];
 const gal=ph.length?'<img loading="lazy" src="../'+ph[0]+'" alt="">'
  +(ph.length>1?'<button class="gnav p">‹</button><button class="gnav n">›</button><div class="dots">'+ph.map((_,j)=>'<i class="'+(j?'':'on')+'"></i>').join('')+'</div>':'')
  :'<div class="noimg">нет фото</div>';
 return '<div class="card'+(done?' done-row':'')+'" data-k="'+key(i)+'" data-gi="0">'
 +'<div class="gal">'+gal+'<span class="gtag">'+i.sku+'</span><span class="done-b">✓ заполнено</span></div>'
 +'<div class="cb">'
 +'<div class="nm">'+i.name+'</div>'
 +'<div class="meta">сейчас: <b>'+(i.price!=null?'от '+fmt(i.price)+' ₽':'под заказ')+'</b></div>'
 +'<div class="pin"><input type="text" inputmode="numeric" placeholder="'+(i.price!=null?fmt(i.price):'цена от')+'" value="'+val+'"'+(s.keep||s.poz?' disabled':'')+'></div>'
 +'<div class="mini">'
 +(i.price!=null?'<button class="mb keep'+(s.keep?' on':'')+'">без изменений</button>':'')
 +(i.group==='artdeco'?'<button class="mb poz'+(s.poz?' on':'')+'">под заказ</button>':'')
 +'<button class="mb nt">✎</button></div>'
 +'<input class="note-in'+(s.note?' show':'')+'" placeholder="заметка (необязательно)" value="'+(s.note||'').replace(/"/g,'&quot;')+'">'
 +'</div></div>';
}
function render(){
 renderCats();renderGr();
 const gs=[...new Set(items(cat).map(i=>i.group))];if(!gs.includes(grp))grp=gs[0];
 const its=items(cat,grp).filter(i=>flt==='all'||(flt==='done'?isDone(i):!isDone(i)));
 document.getElementById('list').innerHTML=its.length?its.map(cardHtml).join(''):'<div class="empty">Здесь всё '+(flt==='todo'?'заполнено ✓':'пусто')+'</div>';
 document.querySelectorAll('.card').forEach(bindCard);
 progress();
}
function bindCard(card){
 const k=card.dataset.k;const item=ITEMS.find(i=>key(i)===k);
 const img=card.querySelector('.gal img');
 const dots=card.querySelectorAll('.dots i');
 const show=j=>{const ph=item.photos;const n=ph.length;j=(j+n)%n;card.dataset.gi=j;img.src='../'+ph[j];dots.forEach((d,x)=>d.classList.toggle('on',x===j));
  const pre=new Image();pre.src='../'+ph[(j+1)%n]};
 const gp=card.querySelector('.gnav.p'),gn=card.querySelector('.gnav.n');
 if(gp){gp.onclick=()=>show(+card.dataset.gi-1);gn.onclick=()=>show(+card.dataset.gi+1);
  let x0=null;const g=card.querySelector('.gal');
  g.addEventListener('touchstart',e=>{x0=e.touches[0].clientX},{passive:true});
  g.addEventListener('touchend',e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>36)show(+card.dataset.gi+(dx<0?1:-1));x0=null},{passive:true});}
 const inp=card.querySelector('.pin input');
 const keep=card.querySelector('.mb.keep'),poz=card.querySelector('.mb.poz'),nt=card.querySelector('.mb.nt'),note=card.querySelector('.note-in');
 const refresh=()=>{const done=isDone(item);card.classList.toggle('done-row',done);renderCats();renderGr();progress()};
 inp.addEventListener('input',()=>{const raw=inp.value.replace(/\\D/g,'');inp.value=raw?fmt(+raw):'';
  const s=state[k]=state[k]||{};s.price=raw?+raw:'';delete s.keep;delete s.poz;
  if(keep)keep.classList.remove('on');if(poz)poz.classList.remove('on');refresh();save()});
 if(keep)keep.onclick=()=>{const s=state[k]=state[k]||{};s.keep=!s.keep;delete s.poz;
  if(s.keep){s.price=item.price;inp.value=fmt(item.price);inp.disabled=true}else{s.price='';inp.value='';inp.disabled=false}
  keep.classList.toggle('on',!!s.keep);if(poz)poz.classList.remove('on');refresh();save()};
 if(poz)poz.onclick=()=>{const s=state[k]=state[k]||{};s.poz=!s.poz;delete s.keep;
  if(s.poz){s.price='';inp.value='';inp.disabled=true}else{inp.disabled=false}
  poz.classList.toggle('on',!!s.poz);if(keep)keep.classList.remove('on');refresh();save()};
 nt.onclick=()=>{note.classList.toggle('show');if(note.classList.contains('show'))note.focus()};
 note.addEventListener('input',()=>{const s=state[k]=state[k]||{};s.note=note.value;save()});
}
function progress(){
 const d=ITEMS.filter(isDone).length;
 document.getElementById('pbar').style.width=(100*d/ITEMS.length)+'%';
 document.getElementById('ptxt').textContent='Заполнено '+d+' из '+ITEMS.length;
 document.getElementById('dl').disabled=d===0;
}
document.querySelectorAll('.flt .chip').forEach(ch=>ch.onclick=()=>{
 document.querySelectorAll('.flt .chip').forEach(c=>c.classList.remove('on'));
 ch.classList.add('on');flt=ch.dataset.f;render()});
function exportItems(){
 return ITEMS.map(i=>{const s=st(i);return{group:i.group,cat:i.cat,catLabel:i.catLabel,slug:i.slug,sku:i.sku,name:i.name,
  oldPrice:i.price,newPrice:s.keep?i.price:(s.poz?null:(s.price!==''&&s.price!=null?s.price:null)),
  underOrder:!!s.poz,keep:!!s.keep,filled:isDone(i),note:s.note||''}});
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
