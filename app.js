const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const emptyState={locations:[],machines:[],readings:[],campaigns:[]};
let state={...emptyState}, modalType='',editId=null,timer, supabaseClient=null, currentUser=null, syncQueue=Promise.resolve(), lastCloudIds={locations:new Set(),machines:new Set(),readings:new Set(),campaigns:new Set()};
let campaignEditId=null;
const uuid=()=>crypto.randomUUID();
const configReady=()=>Boolean(window.SUPABASE_CONFIG?.url&&window.SUPABASE_CONFIG?.publishableKey&&!String(window.SUPABASE_CONFIG.url).includes('YOUR_PROJECT')&&!String(window.SUPABASE_CONFIG.publishableKey).includes('YOUR_PUBLISHABLE'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'NT$ '+Number(n||0).toLocaleString('en-US');const today=()=>{let d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const loc=id=>state.locations.find(x=>x.id===id), machine=id=>state.machines.find(x=>x.id===id), activeM=()=>state.machines.filter(m=>m.active), rentTotal=()=>activeM().reduce((s,m)=>s+Number(m.rent||0),0);
function save(){
  syncQueue=syncQueue.then(()=>syncState()).then(()=>{toast('資料已安全同步至 Supabase')}).catch(err=>{console.error(err);toast('雲端同步失敗：'+(err.message||'請檢查設定與網路'),true)});
  return syncQueue;
}
function ensureOk(result){if(result?.error)throw result.error;return result?.data}
async function syncState(){
  if(!supabaseClient||!currentUser)throw new Error('尚未登入 Supabase');
  const owner_id=currentUser.id;
  const venues=state.locations.map(l=>({id:l.id,owner_id,name:l.name,address:l.address||'',note:l.note||'',is_active:l.active!==false}));
  if(venues.length) ensureOk(await supabaseClient.from('venues').upsert(venues));
  const machines=state.machines.map(m=>({id:m.id,owner_id,venue_id:m.locationId,machine_number:m.number,monthly_rent:Number(m.rent||0),coin_value:Number(m.coin||10),ordinary_unit_cost:Number(m.unitCost||0),initial_reading:Number(m.initialReading||0),is_active:m.active!==false}));
  if(machines.length) ensureOk(await supabaseClient.from('machines').upsert(machines));
  const readings=state.readings.map(r=>({id:r.id,owner_id,machine_id:r.machineId,reading_date:r.date,previous_reading:Number(r.previous||0),current_reading:Number(r.current||0),shipment_quantity:Number(r.quantity||0),coin_value_snapshot:Number(r.coin??10),ordinary_unit_cost_snapshot:Number(r.unitCost||0),revenue:Number(r.revenue||0),ordinary_goods_cost:Number(r.cost||0)}));
  if(readings.length) ensureOk(await supabaseClient.from('meter_readings').upsert(readings));
  const campaigns=state.campaigns.map(c=>({id:c.id,owner_id,machine_id:c.machineId,name:c.name,start_date:c.startDate,end_date:c.endDate||null,start_meter:Number(c.startReading||0),end_meter:c.endReading==null?null:Number(c.endReading),coin_value_snapshot:Number(c.coin??10),total_cost:Number(c.totalCost||0),campaign_revenue:c.campaignMeterRevenue==null?null:Number(c.campaignMeterRevenue),campaign_profit:c.campaignProfit==null?null:Number(c.campaignProfit),status:c.status==='ended'?'completed':'active'}));
  if(campaigns.length) ensureOk(await supabaseClient.from('special_campaigns').upsert(campaigns));
  const items=state.campaigns.flatMap(c=>(c.items||[]).map(i=>({id:i.id||uuid(),owner_id,campaign_id:c.id,item_name:i.name,unit_cost:Number(i.unitCost||0),quantity:Number(i.quantity||0)})));
  // Keep stable IDs in the in-memory state so repeat syncs are idempotent.
  for(const c of state.campaigns) for(const i of (c.items||[])) if(!i.id)i.id=items.find(x=>x.campaign_id===c.id&&x.item_name===i.name&&x.unit_cost===Number(i.unitCost||0)&&x.quantity===Number(i.quantity||0))?.id||uuid();
  const stableItems=state.campaigns.flatMap(c=>(c.items||[]).map(i=>({id:i.id,owner_id,campaign_id:c.id,item_name:i.name,unit_cost:Number(i.unitCost||0),quantity:Number(i.quantity||0)})));
  if(stableItems.length) ensureOk(await supabaseClient.from('special_campaign_items').upsert(stableItems));
  // Remove records deleted from the UI. Existing machine/location data is normally archived, not deleted.
  for(const table of ['special_campaign_items','special_campaigns','meter_readings','machines','venues']){
    const stateKey={special_campaign_items:'campaignItems',special_campaigns:'campaigns',meter_readings:'readings',machines:'machines',venues:'locations'}[table];
    if(table==='special_campaign_items'){
      const ids=stableItems.map(x=>x.id);
      let q=supabaseClient.from(table).delete().eq('owner_id',owner_id);
      if(ids.length) q=q.not('id','in','('+ids.join(',')+')');
      else q=q;
      const res=await q; ensureOk(res);
    }else{
      const arr=state[stateKey]||[], ids=arr.map(x=>x.id);
      let q=supabaseClient.from(table).delete().eq('owner_id',owner_id);
      if(ids.length) q=q.not('id','in','('+ids.join(',')+')');
      const res=await q; ensureOk(res);
    }
  }
}
async function loadCloudState(){
  const owner_id=currentUser.id;
  const [v,m,r,c,i]=await Promise.all([
    supabaseClient.from('venues').select('*').eq('owner_id',owner_id),
    supabaseClient.from('machines').select('*').eq('owner_id',owner_id),
    supabaseClient.from('meter_readings').select('*').eq('owner_id',owner_id),
    supabaseClient.from('special_campaigns').select('*').eq('owner_id',owner_id),
    supabaseClient.from('special_campaign_items').select('*').eq('owner_id',owner_id)
  ]);
  for(const x of [v,m,r,c,i])if(x.error)throw x.error;
  const venueRows=v.data||[], machineRows=m.data||[], readingRows=r.data||[], campaignRows=c.data||[], itemRows=i.data||[];
  const machineMap=new Map(machineRows.map(x=>[x.id,x]));
  const venueMap=new Map(venueRows.map(x=>[x.id,x]));
  state.locations=venueRows.map(x=>({id:x.id,name:x.name,address:x.address||'',note:x.note||'',active:x.is_active}));
  state.machines=machineRows.map(x=>({id:x.id,locationId:x.venue_id,number:x.machine_number,rent:Number(x.monthly_rent||0),coin:Number(x.coin_value||10),unitCost:Number(x.ordinary_unit_cost||0),initialReading:Number(x.initial_reading||0),active:x.is_active}));
  state.readings=readingRows.map(x=>{const m=machineMap.get(x.machine_id);return{id:x.id,createdAt:Date.parse(x.created_at||x.reading_date)||Date.now(),date:x.reading_date,locationId:m?.venue_id||'',machineId:x.machine_id,machineNumber:m?.machine_number||'',previous:Number(x.previous_reading||0),current:Number(x.current_reading||0),quantity:Number(x.shipment_quantity||0),coin:Number(x.coin_value_snapshot||10),unitCost:Number(x.ordinary_unit_cost_snapshot||0),cost:Number(x.ordinary_goods_cost||0),revenue:Number(x.revenue||0),profit:Number(x.revenue||0)-Number(x.ordinary_goods_cost||0)}});
  state.campaigns=campaignRows.map(x=>({id:x.id,name:x.name,machineId:x.machine_id,machineNumber:machineMap.get(x.machine_id)?.machine_number||'',startDate:x.start_date,endDate:x.end_date||'',startReading:Number(x.start_meter||0),endReading:x.end_meter==null?null:Number(x.end_meter),coin:Number(x.coin_value_snapshot||10),items:itemRows.filter(i=>i.campaign_id===x.id).map(i=>({id:i.id,name:i.item_name,unitCost:Number(i.unit_cost||0),quantity:Number(i.quantity||0)})),totalCost:Number(x.total_cost||0),status:x.status==='completed'?'ended':'active',campaignMeterRevenue:x.campaign_revenue==null?null:Number(x.campaign_revenue),campaignProfit:x.campaign_profit==null?null:Number(x.campaign_profit),createdAt:Date.parse(x.created_at||x.start_date)||Date.now()}));
}
function showAuth(message=''){
  document.body.classList.remove('authenticated');
  const panel=$('#authPanel'); if(panel)panel.classList.remove('hidden');
  const status=$('#authStatus');if(status)status.textContent=message;
}
function showApp(){
  document.body.classList.add('authenticated');
  const panel=$('#authPanel');if(panel)panel.classList.add('hidden');
  const badge=$('#signedInEmail');if(badge)badge.textContent=currentUser?.email||'已登入';
}
async function initializeSupabase(){
  if(!configReady()){showAuth('請先在 config.js 填入 Supabase Project URL 與 Publishable Key。');$('#loginForm').classList.add('hidden');$('#configHelp').classList.remove('hidden');return;}
  $('#loginForm').classList.remove('hidden');$('#configHelp').classList.add('hidden');
  supabaseClient=window.supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.publishableKey);
  const {data,error}=await supabaseClient.auth.getSession();
  if(error){showAuth('無法讀取登入狀態：'+error.message);return;}
  if(data.session){currentUser=data.session.user;try{await loadCloudState();showApp();renderAll()}catch(err){showAuth('讀取雲端資料失敗：'+err.message);return;}}
  else showAuth('請使用已建立的管理員帳號登入。');
  supabaseClient.auth.onAuthStateChange((event,session)=>{setTimeout(async()=>{if(session){currentUser=session.user;try{await loadCloudState();showApp();renderAll()}catch(err){showAuth('讀取雲端資料失敗：'+err.message)}}else{currentUser=null;state={...emptyState};showAuth('已登出，請重新登入。')}},0)});
}
function toast(t,bad=false){let el=$('#toast');if(!el)return;el.textContent=t;el.classList.toggle('bad',bad);el.classList.remove('hidden');clearTimeout(timer);timer=setTimeout(()=>el.classList.add('hidden'),2800)}
function page(p){if(p!=='campaigns'&&$('#campaignFormPanel'))$('#campaignFormPanel').classList.add('hidden');$$('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+p));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===p));$('#crumb').textContent=$(`[data-page="${p}"]`)?.textContent.trim().replace(/^\S+\s*/,'')||'營運總覽';$('#sidebar').classList.remove('open');renderAll();window.scrollTo({top:0,behavior:'smooth'})}
function periodRange(date=new Date()){let d;if(date instanceof Date){d=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12,0,0)}else{d=new Date(String(date)+'T12:00:00')}let start=new Date(d.getFullYear(),d.getMonth(),10);if(d.getDate()<10)start=new Date(d.getFullYear(),d.getMonth()-1,10);let end=new Date(start.getFullYear(),start.getMonth()+1,10);const fmt=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;return {start:fmt(start),end:fmt(end)}}
function dateMinusOne(iso){let d=new Date(iso+'T12:00:00');d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function fmtShort(iso){let [y,m,d]=iso.split('-');return `${Number(m)}/${Number(d)}`}
function periodLabel(p=periodRange()){return `${fmtShort(p.start)} – ${fmtShort(dateMinusOne(p.end))}`}
function updatePeriodLabel(){const el=document.querySelector('.period');if(el)el.innerHTML=`<i></i> 本期：${periodLabel()}`}
function inCurrentPeriod(r){let p=periodRange();return r.date>=p.start&&r.date<p.end}
function campaignCostForPeriod(){let p=periodRange();return state.campaigns.filter(c=>c.startDate>=p.start&&c.startDate<p.end).reduce((s,c)=>s+Number(c.totalCost||0),0)}
function totals(readings=state.readings.filter(inCurrentPeriod)){return readings.reduce((a,r)=>{a.revenue+=Number(r.revenue||0);a.cost+=Number(r.cost||0);a.profit+=Number(r.profit||0);return a},{revenue:0,cost:0,profit:0})}
function renderDashboard(){let ms=activeM(),t=totals(),campaignCost=campaignCostForPeriod();$('#locCount').textContent=state.locations.filter(l=>l.active).length;$('#macCount').textContent=ms.length;$('#dashReadingCount').textContent=state.readings.filter(inCurrentPeriod).length;$('#dashRent').textContent=money(rentTotal());$('#rentLabel').textContent=rentTotal().toLocaleString('en-US');$('#dashRevenue').textContent=money(t.revenue);$('#dashCost').textContent=money(t.cost);$('#dashProfit').textContent=money(t.revenue-t.cost-campaignCost-rentTotal());$('#dashProfitStructure').textContent=money(t.revenue-t.cost-campaignCost-rentTotal());$('#barRevenue').textContent=t.revenue.toLocaleString('en-US');$('#barCost').textContent=t.cost.toLocaleString('en-US');if($('#barCampaignCost'))$('#barCampaignCost').textContent=campaignCost.toLocaleString('en-US');const scale=Math.max(t.revenue,t.cost,campaignCost,rentTotal(),1);[['barRevenueWidth',t.revenue],['barCostWidth',t.cost],['barCampaignWidth',campaignCost],['barRentWidth',rentTotal()]].forEach(([id,v])=>{let el=$('#'+id);if(el)el.style.width=(Math.max(0,v)/scale*100)+'%'});$('#dashRows').innerHTML=ms.slice(0,6).map(m=>`<tr><td><div class="machine"><span class="glyph">▣</span><div><strong>${esc(loc(m.locationId)?.name||'未指定')}・${esc(m.number)} 號</strong><small>每格 ${money(m.coin)}</small></div></div></td><td class="money">${money(m.rent)}</td><td><span class="status">營運中</span></td></tr>`).join('')||'<tr><td colspan="3">尚未建立機台資料</td></tr>';let byMachine=ms.map(m=>({m,profit:state.readings.filter(r=>r.machineId===m.id&&inCurrentPeriod(r)).reduce((s,r)=>s+r.profit,0)})).sort((a,b)=>b.profit-a.profit).filter(x=>x.profit!==0).slice(0,5);$('#rankingRows').innerHTML=byMachine.map((x,i)=>`<div>${['🥇','🥈','🥉'][i]||'•'} <span>${esc(loc(x.m.locationId)?.name||'')}・${esc(x.m.number)} 號 <i><em style="width:${Math.max(4,Math.min(100,x.profit/Math.max(1,byMachine[0]?.profit)*100))}%"></em></i></span><b>${money(x.profit)}</b></div>`).join('')||'<p class="muted">新增抄表紀錄後，這裡會顯示機台營利排行。</p>'}
function renderLocations(){let q=($('#locSearch')?.value||'').toLowerCase().trim(),arr=state.locations.filter(l=>(l.name+' '+l.address).toLowerCase().includes(q));$('#locTotal').textContent=`共 ${arr.length} 個場地` ;$('#locationsTable').innerHTML=arr.map(l=>{let ms=state.machines.filter(m=>m.locationId===l.id),r=ms.reduce((s,m)=>s+Number(m.rent||0),0);return `<tr><td><div class="machine"><span class="glyph">⌂</span><div><strong>${esc(l.name)}</strong><small>${esc(l.note||'場地資料')}</small></div></div></td><td>${esc(l.address||'—')}</td><td>${ms.length} 台</td><td class="money">${money(r)}</td><td><span class="status ${l.active?'':'off'}">${l.active?'營運中':'已停用'}</span></td><td><button class="action" data-edit-l="${l.id}">編輯</button><button class="action" data-toggle-l="${l.id}">${l.active?'停用':'啟用'}</button></td></tr>`}).join('');$('#locEmpty').classList.toggle('hidden',arr.length>0)}
function renderMachines(){let q=($('#macSearch')?.value||'').toLowerCase().trim(),filter=$('#macFilter').value;$('#macFilter').innerHTML='<option value="">所有場地</option>'+state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');$('#macFilter').value=filter;let arr=state.machines.filter(m=>(!filter||m.locationId===filter)&&(`${m.number} ${loc(m.locationId)?.name||''}`).toLowerCase().includes(q));$('#macTotal').textContent=`共 ${arr.length} 台機台`;$('#machinesTable').innerHTML=arr.map(m=>`<tr><td><div class="machine"><span class="glyph">▣</span><div><strong>${esc(m.number)} 號機台</strong><small>機台編號：${esc(m.id)}</small></div></div></td><td>${esc(loc(m.locationId)?.name||'場地已不存在')}</td><td class="money">${money(m.rent)} <small>／月</small></td><td>${money(m.coin)}</td><td>${Number(m.initialReading||0).toLocaleString('en-US')}</td><td>${money(m.unitCost||0)}</td><td><span class="status ${m.active?'':'off'}">${m.active?'營運中':'已停用'}</span></td><td><button class="action" data-edit-m="${m.id}">編輯</button><button class="action" data-toggle-m="${m.id}">${m.active?'停用':'啟用'}</button></td></tr>`).join('');$('#macEmpty').classList.toggle('hidden',arr.length>0)}
function renderProfit(){let t=totals(),campaignCost=campaignCostForPeriod();$('#profitRent').textContent=money(rentTotal());$('#profitRevenue').textContent=money(t.revenue);$('#profitCost').textContent=money(t.cost+campaignCost);$('#profitNet').textContent=money(t.revenue-t.cost-campaignCost-rentTotal());$('#profitTable').innerHTML=state.machines.map(m=>`<tr><td>${esc(loc(m.locationId)?.name||'—')}</td><td>${esc(m.number)} 號</td><td class="money">${money(m.rent)}</td><td>${money(m.coin)}</td><td>${money(m.unitCost||0)}</td><td><span class="status ${m.active?'':'off'}">${m.active?'營運中':'已停用'}</span></td></tr>`).join('')}
function renderReadings(){
 const notice=$('#readingSetupNotice');
 if(notice){
   const needLocation=state.locations.length===0,needMachine=!needLocation&&state.machines.length===0;
   notice.classList.toggle('hidden',!needLocation&&!needMachine);
   if(needLocation){$('#readingSetupTitle').textContent='請先新增場地';$('#readingSetupText').textContent='建立場地後，才能在該場地底下新增機台，再開始記錄抄表數值與出貨數量。';$('#readingSetupGo').textContent='前往場地管理';$('#readingSetupGo').dataset.goto='locations';}
   else if(needMachine){$('#readingSetupTitle').textContent='請先新增機台';$('#readingSetupText').textContent='目前已有場地，但還沒有機台。新增機台時請設定每格投幣金額與每件商品成本，系統才能正確計算營利。';$('#readingSetupGo').textContent='前往機台管理';$('#readingSetupGo').dataset.goto='machines';}
 }
 let old=$('#readingLoc').value;$('#readingLoc').innerHTML=state.locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('')||'<option value="">請先建立場地</option>';if(state.locations.some(l=>l.id===old))$('#readingLoc').value=old;renderReadingMachines();updateReadingPreview();let arr=[...state.readings].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);$('#readingTotal').textContent=`${arr.length} 筆紀錄` ;$('#readingsTable').innerHTML=arr.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(loc(r.locationId)?.name||'場地')}・${esc(r.machineNumber)} 號</td><td>${Number(r.previous).toLocaleString('en-US')}</td><td>${Number(r.current).toLocaleString('en-US')}</td><td>${Number(r.quantity).toLocaleString('en-US')}</td><td class="money">${money(r.revenue)}</td><td>${money(r.cost)}</td><td class="money"><strong>${money(r.profit)}</strong></td></tr>`).join('');$('#readingsEmpty').classList.toggle('hidden',arr.length>0)}
function renderReadingMachines(){let id=$('#readingLoc').value,old=$('#readingMac').value;$('#readingMac').innerHTML=state.machines.filter(m=>m.locationId===id).map(m=>`<option value="${m.id}">${esc(m.number)} 號機台</option>`).join('')||'<option value="">此場地尚無機台</option>';if(state.machines.some(m=>m.id===old&&m.locationId===id))$('#readingMac').value=old;updateReadingPreview()}
function latestReading(machineId,date=null){return state.readings.filter(r=>r.machineId===machineId&&(!date||r.date<date)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt)[0]}
function updateReadingPreview(){
 const m=machine($('#readingMac')?.value),date=$('#readingDate')?.value||today();
 const prev=latestReading(m?.id,date),currentRaw=$('#readingCurrent')?.value,qtyRaw=$('#readingQty')?.value;
 const current=currentRaw===''||currentRaw==null?0:Number(currentRaw),qty=qtyRaw===''||qtyRaw==null?0:Number(qtyRaw);
 const coin=Number(m?.coin||0),unitCost=Number(m?.unitCost||0),baseline=$('#readingPrevious');
 if(baseline){
   if(prev){baseline.value=prev.current;baseline.readOnly=true}
   else if(m){baseline.value=Number(m.initialReading||0);baseline.readOnly=true}
   else {baseline.value='0';baseline.readOnly=true;}
 }
 const previous=Number(prev?.current??m?.initialReading??baseline?.value??0),delta=current-previous;
 const revenue=Math.max(0,delta)*coin,cost=qty*unitCost,profit=revenue-cost;
 if($('#readingCoin'))$('#readingCoin').value=coin;
 if($('#readingUnitCost'))$('#readingUnitCost').value=unitCost;
 $('#readingRevenue').textContent=money(revenue);
 $('#readingCost').textContent=money(cost);
 $('#readingProfit').textContent=money(profit);
 let err='';
 if(m&&current<previous)err='目前讀數小於上次讀數，請確認是否輸入錯誤或機台歸零。';
 if(m&&state.readings.some(r=>r.machineId===m.id&&r.date===date))err='這台機器當天已經有抄表紀錄，請更改日期或確認是否重複。';
 else if(m&&state.readings.some(r=>r.machineId===m.id&&r.date>date))err='請依照時間順序新增抄表紀錄；這台機器已有較晚日期的紀錄。';
 $('#readingError').textContent=err;
 $('#readingError').classList.toggle('hidden',!err);
 $('#saveReading').disabled=!m||!date||!!err||current<0||qty<0||previous<0||!Number.isInteger(current)||!Number.isInteger(qty);
}
function renderCampaigns(){
 const select=$('#campaignMachine');if(!select)return;const old=select.value;
 select.innerHTML=state.machines.filter(m=>m.active).map(m=>`<option value="${m.id}">${esc(loc(m.locationId)?.name||'場地')}・${esc(m.number)} 號</option>`).join('')||'<option value="">請先建立營運中機台</option>';
 if(state.machines.some(m=>m.id===old&&m.active))select.value=old;
 const rows=state.campaigns.slice().sort((a,b)=>b.startDate.localeCompare(a.startDate));
 $('#campaignTotal').textContent=`${rows.length} 筆活動`;
 $('#campaignHistoryCount').textContent=rows.length;
 $('#campaignActiveCount').textContent=rows.filter(c=>c.status!=='ended').length;
 $('#campaignPeriodCost').textContent=money(campaignCostForPeriod());
 $('#campaignTable').innerHTML=rows.map(c=>{let m=machine(c.machineId);return `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(loc(m?.locationId)?.name||'—')}・${esc(m?.number||c.machineNumber||'—')} 號</td><td>${esc(c.startDate)}<br><small>讀數：${Number(c.startReading||0).toLocaleString('en-US')}</small></td><td>${c.status==='ended'?`${esc(c.endDate||'—')}<br><small>讀數：${Number(c.endReading||0).toLocaleString('en-US')}</small>`:'尚未結束'}</td><td>${(c.items||[]).map(i=>`${esc(i.name)} × ${i.quantity}`).join('<br>')||'—'}</td><td class="money"><strong>${money(c.totalCost)}</strong></td><td class="money">${c.status==='ended'?money(c.campaignMeterRevenue||0):'—'}</td><td class="money"><strong>${c.status==='ended'?money(c.campaignProfit??((c.campaignMeterRevenue||0)-(c.totalCost||0))):'—'}</strong></td><td><span class="status ${c.status==='ended'?'off':''}">${c.status==='ended'?'已結束':'進行中'}</span></td><td><button class="action" data-edit-c="${c.id}">編輯</button> ${c.status==='ended'?'—':`<button class="action" data-end-c="${c.id}">結束活動</button>`} <button class="action" data-delete-c="${c.id}">刪除</button></td></tr>`}).join('');
 $('#campaignEmpty').classList.toggle('hidden',rows.length>0);
}
function updateCampaignPreview(){let rows=$$('#campaignItems .campaign-item'),sum=0;rows.forEach(row=>{sum+=Math.max(0,Number(row.querySelector('[name="itemCost"]').value||0))*Math.max(0,Number(row.querySelector('[name="itemQty"]').value||0))});$('#campaignCostPreview').textContent=money(sum);$('#campaignItemCount').textContent=rows.length}
function addCampaignItem(name='',cost=0,qty=1,itemId=null){let row=document.createElement('div');row.className='campaign-item';if(itemId)row.dataset.itemId=itemId;row.innerHTML=`<label>商品／獎品名稱<input name="itemName" required maxlength="80" placeholder="例如：限定公仔" value="${esc(name)}"></label><label>每件成本（NT$）<input name="itemCost" type="number" min="0" step="1" required value="${cost}"></label><label>數量<input name="itemQty" type="number" min="1" step="1" required value="${qty}"></label><button type="button" class="action remove-campaign-item">移除</button>`;$('#campaignItems').append(row);row.addEventListener('input',updateCampaignPreview);row.querySelector('.remove-campaign-item').onclick=()=>{row.remove();updateCampaignPreview()};updateCampaignPreview()}
function openCampaignForm(campaignId=null){
 const existing=campaignId?state.campaigns.find(c=>c.id===campaignId):null;
 if(!existing&&!state.machines.some(m=>m.active)){toast('請先建立營運中的機台。',true);page('machines');return}
 campaignEditId=existing?.id||null;
 $('#campaignFormPanel').classList.remove('hidden');
 $('#campaignFormPanel').querySelector('h2').textContent=existing?'編輯特殊活動':'新增特殊活動';
 $('#campaignFormPanel').querySelector('.panelhead p').textContent=existing?'可修改活動日期、起始／結束讀數及獎品內容；成本會即時重算。':'填寫活動基本資料及獎品項目，儲存後會加入歷史紀錄。';
 $('#campaignForm').querySelector('[type="submit"]').textContent=existing?'儲存活動修改':'儲存特殊活動';
 $('#campaignName').value=existing?.name||'';
 $('#campaignStartDate').value=existing?.startDate||today();
 $('#campaignStartReading').value=existing?.startReading??'';
 const machineSelect=$('#campaignMachine');
 const allowed=state.machines.filter(m=>m.active||m.id===existing?.machineId);
 machineSelect.innerHTML=allowed.map(m=>`<option value="${m.id}">${esc(loc(m.locationId)?.name||'場地')}・${esc(m.number)} 號${m.active?'':'（已停用）'}</option>`).join('')||'<option value="">請先建立營運中機台</option>';
 if(existing)machineSelect.value=existing.machineId;
 $('#campaignItems').innerHTML='';
 if(existing?.items?.length)existing.items.forEach(i=>addCampaignItem(i.name,i.unitCost,i.quantity,i.id));
 else addCampaignItem();
 $('#campaignItems').querySelectorAll('.campaign-item').forEach((row,index)=>{if(existing?.items?.[index]?.id)row.dataset.itemId=existing.items[index].id});
 updateCampaignPreview();
 $('#campaignFormPanel').scrollIntoView({behavior:'smooth',block:'start'});
}
function endCampaign(id){let c=state.campaigns.find(x=>x.id===id);if(!c)return;let m=machine(c.machineId);let last=latestReading(m?.id,today());let value=prompt(`請輸入「${c.name}」的活動結束讀數。\n活動開始讀數：${c.startReading}\n計算方式：(結束讀數 − 開始讀數) × 每格投幣金額 − 活動商品成本。`,String(last?.current??m?.initialReading??''));if(value===null)return;let reading=Number(value);if(!Number.isInteger(reading)||reading<Number(c.startReading))return toast('結束讀數需為有效整數，且不可小於活動起始讀數。',true);c.endDate=today();c.endReading=reading;c.status='ended';c.campaignMeterRevenue=(reading-Number(c.startReading))*Number(c.coin??m?.coin??10);c.campaignProfit=c.campaignMeterRevenue-Number(c.totalCost||0);save();renderAll();toast(`活動已結束｜活動營收 ${money(c.campaignMeterRevenue)}｜活動營利 ${money(c.campaignProfit)}`)}

function renderHistory(){
  const fromEl=$('#historyStart'),toEl=$('#historyEnd');
  if(!fromEl||!toEl)return;
  const from=fromEl.value,to=toEl.value;
  const invalid=!!from&&!!to&&from>to;
  $('#historyDateError').classList.toggle('hidden',!invalid);
  if(invalid){
    $('#historySummary').innerHTML='';
    $('#historyReadingsTable').innerHTML='';
    $('#historyCampaignsTable').innerHTML='';
    $('#historyReadingsEmpty').classList.remove('hidden');
    $('#historyCampaignsEmpty').classList.remove('hidden');
    return;
  }
  const inRange=d=>(!from||d>=from)&&(!to||d<=to);
  const readings=state.readings.filter(r=>inRange(r.date)).slice().sort((a,b)=>b.date.localeCompare(a.date)||Number(b.createdAt||0)-Number(a.createdAt||0));
  const campaigns=state.campaigns.filter(c=>inRange(c.startDate)||Boolean(c.endDate&&inRange(c.endDate))).slice().sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const revenue=readings.reduce((s,r)=>s+Number(r.revenue||0),0);
  const goodsCost=readings.reduce((s,r)=>s+Number(r.cost||0),0);
  const campaignCost=campaigns.reduce((s,c)=>s+Number(c.totalCost||0),0);
  const intervalProfit=revenue-goodsCost-campaignCost;
  $('#historySummary').innerHTML=`
    <article class="stat"><span>查詢區間投幣營收</span><strong>${money(revenue)}</strong><small>${readings.length} 筆抄表紀錄</small></article>
    <article class="stat"><span>一般商品成本</span><strong>${money(goodsCost)}</strong><small>依查詢區間內抄表紀錄</small></article>
    <article class="stat"><span>特殊活動成本</span><strong>${money(campaignCost)}</strong><small>${campaigns.length} 筆活動相關紀錄</small></article>
    <article class="stat hero"><span>區間估算營利</span><strong>${money(intervalProfit)}</strong><small>營收－一般商品成本－活動成本；未扣歷史租金</small></article>`;
  $('#historyRangeLabel').textContent=`查詢期間：${from||'不限起日'} ～ ${to||'不限迄日'}`;
  $('#historyReadingsCount').textContent=`${readings.length} 筆紀錄`;
  $('#historyReadingsTable').innerHTML=readings.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(loc(r.locationId)?.name||'場地')}・${esc(r.machineNumber||machine(r.machineId)?.number||'—')} 號</td><td>${Number(r.previous||0).toLocaleString('en-US')}</td><td>${Number(r.current||0).toLocaleString('en-US')}</td><td>${Number(r.quantity||0).toLocaleString('en-US')}</td><td class="money">${money(r.revenue)}</td><td>${money(r.cost)}</td><td class="money"><strong>${money(r.profit??(Number(r.revenue||0)-Number(r.cost||0)))}</strong></td></tr>`).join('');
  $('#historyReadingsEmpty').classList.toggle('hidden',readings.length>0);
  $('#historyCampaignsCount').textContent=`${campaigns.length} 筆活動`;
  $('#historyCampaignsTable').innerHTML=campaigns.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(loc(machine(c.machineId)?.locationId)?.name||'—')}・${esc(machine(c.machineId)?.number||c.machineNumber||'—')} 號</td><td>${esc(c.startDate||'—')}</td><td>${esc(c.endDate||'進行中')}</td><td class="money">${money(c.totalCost)}</td><td class="money">${c.status==='ended'?money(c.campaignMeterRevenue||0):'—'}</td><td class="money">${c.status==='ended'?money(c.campaignProfit??(Number(c.campaignMeterRevenue||0)-Number(c.totalCost||0))):'—'}</td><td><span class="status ${c.status==='ended'?'off':''}">${c.status==='ended'?'已結束':'進行中'}</span></td></tr>`).join('');
  $('#historyCampaignsEmpty').classList.toggle('hidden',campaigns.length>0);
}
function setDefaultHistoryRange(){
  const p=periodRange();
  // Default to the most recently completed operating period.
  const end=p.start;
  const endDate=new Date(end+'T12:00:00');
  endDate.setDate(endDate.getDate()-1);
  const endIso=`${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
  const startDate=new Date(end+'T12:00:00');
  startDate.setMonth(startDate.getMonth()-1);
  const startIso=`${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-10`;
  $('#historyStart').value=startIso;
  $('#historyEnd').value=endIso;
}

function renderAll(){updatePeriodLabel();renderDashboard();renderLocations();renderMachines();renderProfit();renderReadings();renderCampaigns();renderHistory()}
function openModal(type,id=null){modalType=type;editId=id;let obj=type==='l'?state.locations.find(x=>x.id===id):state.machines.find(x=>x.id===id);$('#error').classList.add('hidden');$('#modalEyebrow').textContent=type==='l'?'LOCATION MASTER':'MACHINE MASTER';$('#modalTitle').textContent=(id?'編輯':'新增')+(type==='l'?'場地':'機台');if(type==='l')$('#fields').innerHTML=`<label>場地名稱<input name="name" required maxlength="50" placeholder="例如：三民路" value="${esc(obj?.name||'')}"></label><label>場地地址（選填）<input name="address" maxlength="120" placeholder="輸入地址" value="${esc(obj?.address||'')}"></label><label>備註（選填）<textarea name="note" rows="2" placeholder="輸入備註">${esc(obj?.note||'')}</textarea></label><label>營運狀態<select name="active"><option value="true" ${obj?.active!==false?'selected':''}>營運中</option><option value="false" ${obj?.active===false?'selected':''}>已停用</option></select></label>`;else $('#fields').innerHTML=`<label>所屬場地<select name="locationId" required>${state.locations.map(l=>`<option value="${l.id}" ${obj?.locationId===l.id?'selected':''}>${esc(l.name)}${l.active?'':'（已停用）'}</option>`).join('')}</select></label><label>機台台號<input name="number" required maxlength="20" placeholder="例如：11" value="${esc(obj?.number||'')}"><small>台號只需在同一場地內唯一；不同場地可使用相同台號。</small></label><label>每月租金（NT$）<input name="rent" type="number" min="0" step="1" required value="${obj?.rent??0}"></label><label>每格投幣金額（NT$）<input name="coin" type="number" min="1" step="1" required value="${obj?.coin??10}"><small>預設每格 NT$10，可依機台個別調整。</small></label><label>接手時目前投幣讀數<input name="initialReading" type="number" min="0" step="1" required value="${obj?.initialReading??0}"><small>填寫租賃交接時機台上的累積讀數，例如 181540。第一次抄表會用這個數值當起點，不會把接手前的營收算進來。</small></label><label>每件一般商品成本（NT$）<input name="unitCost" type="number" min="0" step="1" required value="${obj?.unitCost??0}"><small>用來計算出貨數量 × 每件成本。</small></label><label>營運狀態<select name="active"><option value="true" ${obj?.active!==false?'selected':''}>營運中</option><option value="false" ${obj?.active===false?'selected':''}>已停用</option></select></label>`;$('#backdrop').classList.remove('hidden')}
function closeModal(){$('#backdrop').classList.add('hidden')}function fail(t){$('#error').textContent=t;$('#error').classList.remove('hidden')}
$('#entityForm').addEventListener('submit',e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.currentTarget).entries());if(modalType==='l'){let name=d.name.trim();if(!name)return fail('請輸入場地名稱。');if(state.locations.some(l=>l.id!==editId&&l.name.toLowerCase()===name.toLowerCase()))return fail('已有同名場地，請確認是否重複建立。');let obj={id:editId||uuid(),name,address:d.address.trim(),note:d.note.trim(),active:d.active==='true'};if(editId)state.locations=state.locations.map(x=>x.id===editId?obj:x);else state.locations.push(obj)}else{if(!d.locationId)return fail('請先建立場地，再新增機台。');let number=d.number.trim();if(state.machines.some(m=>m.id!==editId&&m.locationId===d.locationId&&m.number.toLowerCase()===number.toLowerCase()))return fail('這個場地已有相同台號。');let obj={id:editId||uuid(),locationId:d.locationId,number,rent:Number(d.rent||0),coin:Number(d.coin||10),initialReading:Number(d.initialReading||0),unitCost:Number(d.unitCost||0),active:d.active==='true'};if(editId)state.machines=state.machines.map(x=>x.id===editId?obj:x);else state.machines.push(obj)}save();closeModal();renderAll();toast((editId?'已更新':'已新增')+(modalType==='l'?'場地資料':'機台資料'))});
document.addEventListener('click',e=>{let n=e.target.closest('[data-page]'),g=e.target.closest('[data-goto]');if(n)page(n.dataset.page);if(g)page(g.dataset.goto);let el=e.target.closest('[data-edit-l]');if(el)openModal('l',el.dataset.editL);el=e.target.closest('[data-edit-m]');if(el)openModal('m',el.dataset.editM);el=e.target.closest('[data-toggle-l]');if(el){let l=loc(el.dataset.toggleL);if(l.active&&state.machines.some(m=>m.locationId===l.id&&m.active)){toast('此場地仍有營運中的機台，請先停用所屬機台。',true);return}l.active=!l.active;save();renderAll();toast(l.active?'場地已啟用':'場地已停用')}el=e.target.closest('[data-toggle-m]');if(el){let m=machine(el.dataset.toggleM);if(!m.active&&!loc(m.locationId)?.active){toast('所屬場地已停用，請先啟用場地。',true);return}m.active=!m.active;save();renderAll();toast(m.active?'機台已啟用':'機台已停用')}});
$('#addLocation').onclick=()=>openModal('l');$('#addMachine').onclick=()=>state.locations.length?openModal('m'):(toast('請先新增場地。',true),page('locations'));$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;$('#backdrop').onclick=e=>{if(e.target.id==='backdrop')closeModal()};$('#locSearch').oninput=renderLocations;$('#macSearch').oninput=renderMachines;$('#macFilter').onchange=renderMachines;$('#readingLoc').onchange=renderReadingMachines;['readingDate','readingCurrent','readingQty','readingPrevious'].forEach(id=>$('#'+id).addEventListener('input',updateReadingPreview));$('#readingMac').onchange=()=>{let prev=latestReading($('#readingMac').value,$('#readingDate').value),base=$('#readingPrevious');base.value=prev?prev.current:Number(machine($('#readingMac').value)?.initialReading||0);base.dataset.autoFilled='true';base.readOnly=true;updateReadingPreview()};
$('#readingDate').addEventListener('change',()=>{let prev=latestReading($('#readingMac').value,$('#readingDate').value),base=$('#readingPrevious');if(prev){base.value=prev.current;base.readOnly=true}else{base.value=Number(machine($('#readingMac').value)?.initialReading||0);base.readOnly=true}base.dataset.autoFilled='true';updateReadingPreview()});$('#hamb').onclick=()=>$('#sidebar').classList.toggle('open');$('#readingDate').value=today();
$('#readingForm').addEventListener('submit',e=>{e.preventDefault();updateReadingPreview();let m=machine($('#readingMac').value),date=$('#readingDate').value,current=Number($('#readingCurrent').value),quantity=Number($('#readingQty').value),prev=latestReading(m?.id,date),previous=Number(prev?.current??m?.initialReading??$('#readingPrevious').value??0);if(!m)return toast('請先建立場地與機台。',true);if(state.readings.some(r=>r.machineId===m.id&&r.date===date))return toast('這台機器當天已經有抄表紀錄。',true);if(state.readings.some(r=>r.machineId===m.id&&r.date>date))return toast('請依照時間順序新增抄表紀錄；這台機器已有較晚日期的紀錄。',true);if(current<previous)return toast('目前讀數不能小於上次讀數，請確認數值。',true);if(!Number.isInteger(current)||!Number.isInteger(quantity)||current<0||quantity<0)return toast('讀數與出貨數量請輸入 0 或正整數。',true);let revenue=(current-previous)*Number(m.coin||0),cost=quantity*Number(m.unitCost||0),record={id:uuid(),createdAt:Date.now(),date,locationId:m.locationId,machineId:m.id,machineNumber:m.number,previous,current,quantity,coin:Number(m.coin||0),unitCost:Number(m.unitCost||0),rent:Number(m.rent||0),revenue,cost,profit:revenue-cost};state.readings.push(record);save();$('#readingCurrent').value='';$('#readingQty').value='0';renderAll();toast(`抄表已儲存｜區間營收 ${money(record.revenue)}｜商品成本 ${money(record.cost)}｜區間營利 ${money(record.profit)}`)});
$('#newCampaign').onclick=()=>openCampaignForm();
$('#cancelCampaign').onclick=()=>{$('#campaignFormPanel').classList.add('hidden');campaignEditId=null};
$('#addCampaignItem').onclick=()=>addCampaignItem();
$('#campaignItems').addEventListener('input',updateCampaignPreview);
$('#campaignForm').addEventListener('submit',e=>{
 e.preventDefault();
 const existing=campaignEditId?state.campaigns.find(c=>c.id===campaignEditId):null;
 const m=machine($('#campaignMachine').value);
 const items=$$('#campaignItems .campaign-item').map(row=>({id:row.dataset.itemId||uuid(),name:row.querySelector('[name="itemName"]').value.trim(),unitCost:Number(row.querySelector('[name="itemCost"]').value),quantity:Number(row.querySelector('[name="itemQty"]').value)}));
 if(!name)return toast('請輸入活動名稱。',true);
 if(!m)return toast('請選擇活動機台。',true);
 if(!startDate)return toast('請選擇活動開始日期。',true);
 if(!Number.isInteger(startReading)||startReading<0)return toast('請輸入有效的活動起始讀數。',true);
 if(!items.length||items.some(i=>!i.name||!Number.isFinite(i.unitCost)||i.unitCost<0||!Number.isInteger(i.quantity)||i.quantity<1))return toast('請確認每個品項都有名稱、有效成本與正整數數量。',true);
 const totalCost=items.reduce((sum,item)=>sum+item.unitCost*item.quantity,0);
 const next={
   ...(existing||{}),
   id:existing?.id||uuid(),
   name,machineId:m.id,machineNumber:m.number,startDate,startReading,
   // 結束日期與結束讀數只由「結束活動」操作寫入；編輯活動內容時保留既有結束資訊。
   endDate:existing?.endDate||'',
   endReading:existing?.endReading??null,
   coin:(existing&&existing.machineId===m.id)?Number(existing.coin??m.coin??10):Number(m.coin||10),
   items,totalCost,
   status:existing?.status==='ended'?'ended':'active',
   createdAt:existing?.createdAt||Date.now()
 };
 if(next.status==='ended'){
   if(!next.endDate||next.endReading==null)return toast('這筆已結束活動缺少結束資訊，請檢查資料。',true);
   if(next.endDate<next.startDate||Number(next.endReading)<Number(next.startReading))return toast('開始日期或起始讀數不可晚於既有的活動結束資料。',true);
   next.campaignMeterRevenue=(Number(next.endReading)-Number(next.startReading))*Number(next.coin||10);
   next.campaignProfit=next.campaignMeterRevenue-totalCost;
 }else{
   next.endDate='';next.endReading=null;next.campaignMeterRevenue=null;next.campaignProfit=null;
 }
 if(existing)state.campaigns=state.campaigns.map(c=>c.id===existing.id?next:c);
 else state.campaigns.push(next);
 save();
 $('#campaignFormPanel').classList.add('hidden');campaignEditId=null;
 renderAll();
 toast(existing?`活動已更新｜目前總成本 ${money(totalCost)}`:`特殊活動已儲存｜總成本 ${money(totalCost)}`);
});
$('#campaignTable').addEventListener('click',e=>{
 let edit=e.target.closest('[data-edit-c]');
 if(edit){openCampaignForm(edit.dataset.editC);return}
 let end=e.target.closest('[data-end-c]');
 if(end)endCampaign(end.dataset.endC);
 let del=e.target.closest('[data-delete-c]');
 if(del&&confirm('確定刪除這筆特殊活動？')){state.campaigns=state.campaigns.filter(c=>c.id!==del.dataset.deleteC);save();renderAll();toast('特殊活動已刪除')}
});
$('#exportCsv').onclick=()=>{let rows=[['場地','台號','接手時起始讀數','每月租金','每格投幣金額','每件商品成本','狀態'],...state.machines.map(m=>[loc(m.locationId)?.name||'',m.number,m.initialReading||0,m.rent,m.coin,m.unitCost||0,m.active?'營運中':'已停用'])];let csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');let a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));a.href=url;a.download='機台清單.csv';a.click();URL.revokeObjectURL(url);toast('已匯出機台清單 CSV')};
$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!supabaseClient)return showAuth('請先完成 config.js 設定。');
  const btn=$('#loginButton');btn.disabled=true;btn.textContent='登入中…';
  try{
    const {data,error}=await supabaseClient.auth.signInWithPassword({email:$('#loginEmail').value.trim(),password:$('#loginPassword').value});
    if(error)throw error;
    currentUser=data.user;await loadCloudState();showApp();renderAll();toast('登入成功，已載入雲端資料');
  }catch(err){showAuth('登入或讀取資料失敗：'+err.message)}
  finally{btn.disabled=false;btn.textContent='登入管理系統'}
});
$('#logoutButton').addEventListener('click',async()=>{if(supabaseClient)await supabaseClient.auth.signOut();currentUser=null;state={...emptyState};showAuth('已登出。');});
$('#historySearch').addEventListener('click',renderHistory);
$('#historyReset').addEventListener('click',()=>{setDefaultHistoryRange();renderHistory()});
$('#historyStart').addEventListener('change',renderHistory);
$('#historyEnd').addEventListener('change',renderHistory);
setDefaultHistoryRange();
initializeSupabase();