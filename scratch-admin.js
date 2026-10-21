(() => {
  const $ = s => document.querySelector(s);
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg?.url || !cfg?.publishableKey || !window.supabase) { $('#authNotice').innerHTML = '<h1>缺少 Supabase 設定</h1><p>請確認 config.js 與 Supabase JS 已載入。</p>'; return; }
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);

  let user = null, venues = [], machines = [], campaigns = [];
  let mapsReady = null, placeSuggestions = [];
  function loadGoogleMaps(){
    if(mapsReady) return mapsReady;
    mapsReady = new Promise((resolve,reject)=>{
      const key = String(cfg.googleMapsApiKey || '').trim();
      if(!key || key === 'PASTE_YOUR_GOOGLE_MAPS_API_KEY_HERE'){
        reject(new Error('尚未設定 Google Maps API Key。請在 config.js 的 googleMapsApiKey 填入新金鑰。')); return;
      }
      if(window.google?.maps?.importLibrary){ resolve(window.google.maps); return; }
      const callbackName='__yeeMapsReady';
      window[callbackName]=()=>resolve(window.google.maps);
      const script=document.createElement('script');
      script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&v=weekly&loading=async&callback='+callbackName;
      script.async=true; script.onerror=()=>reject(new Error('Google Maps 載入失敗，請檢查 API 金鑰、網站限制及 API 是否已啟用。'));
      document.head.appendChild(script);
    });
    return mapsReady;
  }
  function clearAddressSuggestions(){ const root=$('#addressSuggestions'); root.innerHTML=''; root.classList.add('hidden'); placeSuggestions=[]; }
  async function searchGoogleAddress(){
    const input=$('#address'), query=input.value.trim();
    if(!query){say('請先輸入店家地址。',true);return;}
    const btn=$('#geocodeAddress'); btn.disabled=true; btn.textContent='搜尋中…';
    try{
      const maps=await loadGoogleMaps();
      const {AutocompleteSuggestion}=await maps.importLibrary('places');
      const {suggestions}=await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input:query,
        includedRegionCodes:['tw'],
        language:'zh-TW',
        region:'tw'
      });
      const root=$('#addressSuggestions'); root.innerHTML=''; placeSuggestions=[];
      const items=(suggestions||[]).filter(x=>x.placePrediction);
      if(!items.length) throw new Error('Google Maps 找不到相符地址，請補上縣市／區，或確認地址是否正確。');
      placeSuggestions=items;
      items.slice(0,6).forEach((item,index)=>{
        const pred=item.placePrediction;
        const option=document.createElement('button');
        option.type='button'; option.className='address-suggestion'; option.setAttribute('role','option');
        option.innerHTML=`<strong>${esc(pred.mainText?.text || pred.text?.text || query)}</strong><small>${esc(pred.secondaryText?.text || '')}</small>`;
        option.addEventListener('click',async()=>{
          option.disabled=true;
          try{
            const place=pred.toPlace();
            await place.fetchFields({fields:['formattedAddress','location','displayName']});
            if(!place.location) throw new Error('此搜尋結果沒有提供座標，請選擇其他地址結果。');
            input.value=place.formattedAddress || pred.text?.text || query;
            $('#lat').value=Number(place.location.lat()).toFixed(7);
            $('#lng').value=Number(place.location.lng()).toFixed(7);
            clearAddressSuggestions();
            say('已取得 Google Maps 店家座標，請確認地址與地點正確。');
          }catch(err){say(err.message||String(err),true);option.disabled=false;}
        });
        root.append(option);
      });
      root.classList.remove('hidden');
      say('請從地址建議清單中選擇正確的店家位置。');
    }catch(e){say(e.message||String(e),true);}
    finally{btn.disabled=false;btn.textContent='搜尋地址';}
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const say = (msg,bad=false) => { const el=$('#toast'); el.textContent=msg; el.classList.toggle('bad',bad); el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3500); };
  const message = (msg,bad=false) => { $('#createMessage').textContent=msg; $('#createMessage').classList.toggle('bad',bad); };
  function prizeGrade(i){let n=i+1,s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s+'賞';}
  function displayPrizeName(name,i){const raw=String(name||'').replace(/^[A-Z]+賞\s*/,'');return `${prizeGrade(i)} ${raw}`.trim();}
  function addPrize(name='',qty=1){ const row=document.createElement('div'); row.className='prize-row'; const idx=document.querySelectorAll('#prizeRows .prize-row').length; row.innerHTML=`<input class="prize-name" maxlength="80" required placeholder="${prizeGrade(idx)} 獎項名稱，例如：公仔A" value="${esc(name)}"><input class="prize-qty" type="number" min="0" step="1" required value="${Number(qty)}" aria-label="獎項數量"><button class="remove" type="button" aria-label="移除獎項">×</button>`; row.querySelector('.remove').onclick=()=>{row.remove();updatePrizeTotal()}; row.querySelectorAll('input').forEach(i=>i.addEventListener('input',updatePrizeTotal)); $('#prizeRows').append(row); updatePrizeTotal(); }
  function updatePrizeTotal(){ const n=[...document.querySelectorAll('.prize-qty')].reduce((s,x)=>s+Math.max(0,Number(x.value)||0),0); $('#prizeTotal').textContent=`獎項總數：${n}`; $('#prizeTotal').dataset.total=n; }
  function fillHoles(){ for(let i=10;i<=300;i+=10){const o=document.createElement('option');o.value=i;o.textContent=`${i} 洞`;$('#holes').append(o);} }
  function fillVenues(){ $('#venue').innerHTML=venues.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join(''); fillMachines(); }
  function fillMachines(){ const vid=$('#venue').value; const list=machines.filter(m=>m.venue_id===vid&&m.is_active!==false); $('#machine').innerHTML=list.map(m=>`<option value="${m.id}">${esc(m.machine_number)}</option>`).join(''); }
  async function loadMaster(){ const [v,m]=await Promise.all([db.from('venues').select('id,name,is_active').eq('owner_id',user.id).order('name'),db.from('machines').select('id,venue_id,machine_number,is_active').eq('owner_id',user.id).order('machine_number')]); if(v.error)throw v.error;if(m.error)throw m.error;venues=v.data||[];machines=m.data||[];fillVenues(); }
  async function loadCampaigns(){ const [c,p,claims]=await Promise.all([db.from('scratch_campaigns').select('*').eq('owner_id',user.id).order('created_at',{ascending:false}),db.from('scratch_prizes').select('*').eq('owner_id',user.id).order('sort_order'),db.from('scratch_claims').select('campaign_id,prize_id,cell_no')]); if(c.error)throw c.error;if(p.error)throw p.error;if(claims.error)throw claims.error;campaigns=(c.data||[]).map(x=>({...x,prizes:(p.data||[]).filter(q=>q.campaign_id===x.id),claims:(claims.data||[]).filter(q=>q.campaign_id===x.id)})); renderCampaigns(); }
  function playerUrl(c){ if(!c.public_code) throw new Error('此活動缺少公開代碼，請重新整理活動列表；若仍缺少，請先檢查資料庫 public_code 欄位。'); const basePath=location.pathname.endsWith('/')?location.pathname:location.pathname.slice(0,location.pathname.lastIndexOf('/')+1); const url=new URL(basePath+'scratch.html',location.origin); url.searchParams.set('code',String(c.public_code)); return url; }
  function renderCampaigns(){ const root=$('#campaignList'); if(!campaigns.length){root.innerHTML='<p class="muted">尚未建立刮刮樂活動。</p>';return;} root.innerHTML=campaigns.map(c=>{const venue=venues.find(v=>v.id===c.venue_id)?.name||'場地';const machine=machines.find(m=>m.id===c.machine_id)?.machine_number||'機台';const label=c.status==='active'?'進行中':c.status==='ended'?'已結束':'草稿';let url;try{url=playerUrl(c);}catch(e){url=new URL('scratch.html',location.href);url.searchParams.set('code','');}const canPlay=c.status==='active';return `<article class="campaign"><div><h3>${esc(c.title)} <span class="badge ${c.status}">${label}</span></h3><p class="muted">${esc(venue)}／${esc(machine)}　·　${c.holes_total} 洞　·　已刮 ${c.claims.length} 洞　·　建立 ${new Date(c.created_at).toLocaleString('zh-TW')}</p><p class="muted">獎項：${c.prizes.map((p,i)=>`${esc(displayPrizeName(p.prize_name,i))} × ${p.quantity}`).join('、')||'尚無獎項'}</p><p class="muted">遊玩規則：夾 ${c.catch_every||1} 個得 ${c.catch_plays||1} 次；歸還 ${c.return_every||3} 個得 ${c.return_plays||1} 次</p><div class="campaign-actions"><button class="btn secondary" data-action="preview" data-id="${c.id}">${c.status==='draft'?'預覽答案位置':'查看答案／存證'}</button>${c.status==='draft'?`<button class="btn secondary" data-action="shuffle" data-id="${c.id}">隨機產生／重新抽選</button><button class="btn" data-action="lock" data-id="${c.id}">鎖定答案並啟用</button>`:''}${canPlay?`<button class="btn secondary" data-action="qr" data-id="${c.id}">顯示 QR Code</button><button class="btn secondary" data-action="end" data-id="${c.id}">結束活動</button>`:''}${c.status==='ended'?`<button class="btn secondary" data-action="qr" data-id="${c.id}">查看活動 QR</button>`:''}<a class="btn secondary" href="${esc(url.href)}" target="_blank" rel="noopener">開啟玩家頁</a></div><div class="qr-inline hidden" id="qr-${c.id}"><p class="small">公開活動連結：${esc(url.href)}</p><div class="qrbox" id="qrcode-${c.id}"></div><button class="btn secondary" data-action="print" data-id="${c.id}">列印 QR Code</button><button class="btn secondary" data-action="copy" data-url="${esc(url.href)}">複製活動連結</button></div></div></article>`}).join(''); }
  async function createCampaign(e){e.preventDefault();const btn=$('#createBtn');btn.disabled=true;message('正在建立草稿…');try{if(!user)throw new Error('尚未登入');const title=$('#title').value.trim(),venueId=$('#venue').value,machineId=$('#machine').value,holes=Number($('#holes').value),lat=Number($('#lat').value),lng=Number($('#lng').value),catchEvery=Number($('#catchEvery').value),catchPlays=Number($('#catchPlays').value),returnEvery=Number($('#returnEvery').value),returnPlays=Number($('#returnPlays').value);if(!title||!venueId||!machineId)throw new Error('請填寫活動名稱、場地與機台。');if([catchEvery,catchPlays,returnEvery,returnPlays].some(n=>!Number.isInteger(n)||n<1||n>100))throw new Error('遊玩次數規則請填寫 1–100 的整數。');if(!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lng)||lng < -180||lng>180)throw new Error('請填寫有效的 GPS 緯度與經度。');const prizeRows=[...document.querySelectorAll('.prize-row')].map((r,i)=>({owner_id:user.id,prize_name:displayPrizeName(r.querySelector('.prize-name').value.trim(),i),quantity:Number(r.querySelector('.prize-qty').value),sort_order:i}));if(!prizeRows.length||prizeRows.some(p=>!p.prize_name||!Number.isInteger(p.quantity)||p.quantity<0))throw new Error('請設定至少一個有效獎項。');const total=prizeRows.reduce((s,p)=>s+p.quantity,0);if(total<1)throw new Error('獎項總數至少需有 1 個。');if(total>holes)throw new Error('獎項總數不可超過洞數。');const {data:machine,error:me}=await db.from('machines').select('id,venue_id').eq('id',machineId).eq('owner_id',user.id).single();if(me)throw me;if(machine.venue_id!==venueId)throw new Error('所選機台與場地不相符。');const {data:c,error:ce}=await db.from('scratch_campaigns').insert({owner_id:user.id,venue_id:venueId,machine_id:machineId,title,holes_total:holes,gps_lat:lat,gps_lng:lng,radius_m:200,catch_every:catchEvery,catch_plays:catchPlays,return_every:returnEvery,return_plays:returnPlays,status:'draft'}).select('*').single();if(ce)throw ce;const {error:pe}=await db.from('scratch_prizes').insert(prizeRows.map(p=>({...p,campaign_id:c.id})));if(pe)throw pe;const {error:ge}=await db.rpc('scratch_generate_layout',{p_campaign_id:c.id,p_lock:false});if(ge)throw ge;$('#createForm').reset();$('#prizeRows').innerHTML='';addPrize();message('草稿已建立並產生隨機配置。你可重抽，確認後再鎖定啟用。');await loadCampaigns();say('活動草稿已建立。');}catch(err){message(err.message||String(err),true);}finally{btn.disabled=false;}}
  let currentEvidence = null;
  const paletteClass = i => `prize-${Math.max(0,Math.min(99,i))}`;
  async function sha256Hex(text){
    if(!window.crypto?.subtle) return '瀏覽器不支援 SHA-256';
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function openAnswerPreview(id){
    const c=campaigns.find(x=>x.id===id); if(!c) throw new Error('找不到活動');
    const {data:cells,error}=await db.from('scratch_cells').select('cell_no,prize_id').eq('campaign_id',id).order('cell_no');
    if(error) throw error;
    if(!cells?.length) throw new Error('尚未產生答案配置，請先按「隨機產生／重新抽選」。');
    const prizeById=new Map(c.prizes.map(p=>[p.id,p.prize_name]));
    const layout=cells.map(cell=>({cell_no:cell.cell_no,prize_id:cell.prize_id,prize_name:cell.prize_id?(prizeById.get(cell.prize_id)||'未知獎項'):'未中獎'}));
    const venue=venues.find(v=>v.id===c.venue_id)?.name||'場地';
    const machine=machines.find(m=>m.id===c.machine_id)?.machine_number||'機台';
    const locked=c.status!=='draft' && !!c.locked_at;
    const root=$('#answerGrid'); root.innerHTML='';
    const distinct=[...new Set(layout.map(x=>x.prize_name))];
    $('#answerLegend').innerHTML=distinct.map(name=>{const idx=name==='未中獎'?-1:Math.max(0,c.prizes.findIndex(p=>p.prize_name===name));return `<span class="answer-chip"><i class="answer-swatch ${idx<0?'no-prize':paletteClass(idx)}"></i>${esc(name==='未中獎'?name:displayPrizeName(name,Math.max(0,c.prizes.findIndex(p=>p.prize_name===name))))}（${layout.filter(x=>x.prize_name===name).length}）</span>`}).join('');
    layout.forEach(cell=>{const idx=cell.prize_name==='未中獎'?-1:Math.max(0,c.prizes.findIndex(p=>p.prize_name===cell.prize_name));const div=document.createElement('div');div.className=`answer-cell ${idx<0?'no-prize':paletteClass(idx)}`;div.innerHTML=`<strong>${cell.cell_no} 號</strong><span>${esc(cell.prize_name==='未中獎'?cell.prize_name:displayPrizeName(cell.prize_name,idx))}</span>`;root.append(div);});
    $('#answerTitle').textContent=`答案配置：${c.title}`;
    $('#answerMeta').textContent=`${venue}／${machine}・${c.holes_total} 洞・${locked?'鎖定時間：'+new Date(c.locked_at).toLocaleString('zh-TW'):'草稿預覽（尚未鎖定）'}`;
    $('#evidenceNotice').textContent=locked?'答案已鎖定。建議立即下載 JSON 與 CSV 存證，並另外備份至自己的雲端或電腦。':'這是草稿答案預覽；你仍可重新抽選。只有鎖定啟用後才可下載存證檔案。';
    $('#downloadEvidence').disabled=!locked; $('#downloadCsv').disabled=!locked; $('#printEvidence').disabled=!locked;
    currentEvidence={campaign:c,venue,machine,layout,locked};
    $('#answerModal').classList.remove('hidden');
  }
  async function buildEvidence(){
    if(!currentEvidence?.locked) throw new Error('請先鎖定並啟用活動，再下載答案存證。');
    const {campaign:c,venue,machine,layout}=currentEvidence;
    const payload={document_type:'Yee-Fun-Catch Scratchcard Answer Evidence',version:1,campaign:{id:c.id,public_code:c.public_code,title:c.title,venue,machine,holes_total:c.holes_total,created_at:c.created_at,locked_at:c.locked_at,status:c.status},prizes:c.prizes.map(p=>({name:p.prize_name,quantity:p.quantity,sort_order:p.sort_order})),answer_layout:layout.map(x=>({cell_no:x.cell_no,prize_name:x.prize_name,prize_id:x.prize_id})),generated_at:new Date().toISOString(),note:'SHA-256 是檔案內容指紋，不是第三方時間戳或不可竄改證明。請保留原始下載檔及備份。'};
    const canonical=JSON.stringify(payload);
    payload.sha256=await sha256Hex(canonical);
    return payload;
  }
  function downloadText(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function downloadJsonEvidence(){const data=await buildEvidence();downloadText(`刮刮樂答案存證-${data.campaign.id}.json`,JSON.stringify(data,null,2),'application/json;charset=utf-8');say('答案存證 JSON 已下載，請妥善備份。');}
  async function downloadCsvEvidence(){const data=await buildEvidence();const rows=[['活動名稱',data.campaign.title],['活動 ID',data.campaign.id],['公開代碼',data.campaign.public_code],['場地',data.campaign.venue],['機台',data.campaign.machine],['洞數',data.campaign.holes_total],['鎖定時間',data.campaign.locked_at],['SHA-256',data.sha256],[],['洞號','答案'] ,...data.answer_layout.map(x=>[x.cell_no,x.prize_name])];const csv=rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadText(`刮刮樂答案清單-${data.campaign.id}.csv`,'\ufeff'+csv,'text/csv;charset=utf-8');say('答案清單 CSV 已下載。');}
  async function printAnswerEvidence(){const data=await buildEvidence();const w=window.open('','_blank','width=900,height=800');if(!w)throw new Error('瀏覽器阻擋列印視窗，請允許彈出視窗後重試。');const rows=data.answer_layout.map(x=>{const idx=x.prize_name==='未中獎'?-1:Math.max(0,data.prizes.findIndex(p=>p.name===x.prize_name));return `<div class="cell ${idx<0?'no-prize':`prize-${idx%7}`}"><b>${x.cell_no} 號</b><span>${esc(x.prize_name)}</span></div>`}).join('');w.document.write(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>刮刮樂答案存證</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#17263b}h1{font-size:22px}.meta{line-height:1.7;font-size:13px}.legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;font-size:12px}.legend span{border:1px solid #cbd5e1;border-radius:12px;padding:4px 8px}.grid{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin-top:18px}.cell{border:1px solid #cbd5e1;border-radius:6px;min-height:45px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-size:10px;overflow-wrap:anywhere;padding:3px;box-sizing:border-box}.cell b{font-size:11px}.cell.prize-0{background:#eaf2ff;border-color:#b9d0f7}.cell.prize-1{background:#e8f8ef;border-color:#a9e0bf}.cell.prize-2{background:#fff2d8;border-color:#f0d08b}.cell.prize-3{background:#f6eaff;border-color:#d8b9f5}.cell.prize-4{background:#ffe9ec;border-color:#f5b8c1}.cell.prize-5{background:#e4f8fb;border-color:#a7e0e9}.cell.prize-6{background:#f0f2f5;border-color:#cbd5e1}.cell.no-prize{background:#f5f7fb;color:#64748b}.hash{font-size:10px;word-break:break-all;margin-top:16px}@media print{body{padding:8px}.grid{gap:3px}}</style><h1>刮刮樂答案配置存證</h1><div class="meta">活動：${esc(data.campaign.title)}<br>場地／機台：${esc(data.campaign.venue)}／${esc(data.campaign.machine)}<br>活動 ID：${esc(data.campaign.id)}<br>洞數：${data.campaign.holes_total}<br>鎖定時間：${esc(data.campaign.locked_at)}<br>列印時間：${esc(new Date().toISOString())}</div><div class="legend">${data.prizes.map((p,i)=>`<span style="background:${['#eaf2ff','#e8f8ef','#fff2d8','#f6eaff','#ffe9ec','#e4f8fb','#f0f2f5'][i%7]}">${esc(p.name)} × ${p.quantity}</span>`).join('')}<span style="background:#f5f7fb">未中獎</span></div><div class="grid">${rows}</div><p class="hash">SHA-256：${esc(data.sha256)}</p><p style="font-size:10px">此列印文件為店家匯出存證。SHA-256 可用於比對內容是否變動，並非第三方認證的時間戳或不可竄改證明。</p><script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></html>`);w.document.close();}
  async function doAction(action,id,url){try{if(action==='preview'){await openAnswerPreview(id);return;}if(action==='copy'){await navigator.clipboard.writeText(url);say('活動連結已複製。');return;}const c=campaigns.find(x=>x.id===id);if(!c)throw new Error('找不到活動');if(action==='shuffle'){const {error}=await db.rpc('scratch_generate_layout',{p_campaign_id:id,p_lock:false});if(error)throw error;say('已重新抽選配置；答案尚未鎖定。');await loadCampaigns();}
    if(action==='lock'){if(!confirm('鎖定後無法重抽或修改獎項，並立即開放玩家參加。建議先預覽答案位置；確定要鎖定啟用嗎？'))return;const {error}=await db.rpc('scratch_generate_layout',{p_campaign_id:id,p_lock:true});if(error)throw error;say('答案已鎖定，活動正式啟用。');await loadCampaigns();}
    if(action==='end'){if(!confirm('確定結束活動？結束後玩家不能再申報或刮獎。'))return;const {error}=await db.from('scratch_campaigns').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id);if(error)throw error;say('活動已結束。');await loadCampaigns();}
    if(action==='qr'){const box=$(`#qr-${id}`);box.classList.toggle('hidden');const q=$(`#qrcode-${id}`);q.innerHTML='';const link=playerUrl(c);if(window.QRCode)new QRCode(q,{text:link.href,width:116,height:116});else q.textContent=link.href;}
    if(action==='print'){const link=playerUrl(c);const w=window.open('','_blank','width=500,height=650');if(!w)throw new Error('瀏覽器阻擋列印視窗，請允許彈出視窗後重試。');w.document.write(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>刮刮樂 QR Code</title><style>body{font-family:system-ui;text-align:center;padding:24px}#qrcode{display:flex;justify-content:center;margin:24px}small{word-break:break-all}</style><h1>${esc(c.title)}</h1><p>${esc(c.holes_total)} 洞刮刮樂活動</p><div id="qrcode"></div><small>${esc(link.href)}</small><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script><script>new QRCode(document.getElementById('qrcode'),{text:${JSON.stringify(link.href)},width:240,height:240});window.onload=()=>setTimeout(()=>window.print(),500);<\/script></html>`);w.document.close();}
  }catch(err){say(err.message||String(err),true);}}
  async function init(){fillHoles();addPrize();$('#venue').addEventListener('change',fillMachines);$('#addPrize').onclick=()=>addPrize();$('#createForm').onsubmit=createCampaign;$('#refresh').onclick=()=>loadCampaigns().catch(e=>say(e.message,true));$('#geocodeAddress').onclick=searchGoogleAddress;$('#address').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchGoogleAddress();}});$('#address').addEventListener('input',()=>{clearAddressSuggestions();});$('#campaignList').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)doAction(b.dataset.action,b.dataset.id,b.dataset.url);});$('#closeAnswer').onclick=()=>$('#answerModal').classList.add('hidden');$('#answerModal').addEventListener('click',e=>{if(e.target.id==='answerModal')$('#answerModal').classList.add('hidden');});$('#downloadEvidence').onclick=()=>downloadJsonEvidence().catch(e=>say(e.message||String(e),true));$('#downloadCsv').onclick=()=>downloadCsvEvidence().catch(e=>say(e.message||String(e),true));$('#printEvidence').onclick=()=>printAnswerEvidence().catch(e=>say(e.message||String(e),true));const {data:{session},error}=await db.auth.getSession();if(error||!session){$('#authNotice').innerHTML='<h1>請先登入管理員帳號</h1><p>刮刮樂活動管理僅限已啟用的平台管理員使用。</p><a class="btn" href="index.html">前往登入</a>';return;}user=session.user;const {data:profile,error:pe}=await db.from('profiles').select('role,status').eq('id',user.id).maybeSingle();if(pe||!profile||profile.role!=='admin'||profile.status!=='active'){await db.auth.signOut();$('#authNotice').innerHTML='<h1>沒有管理權限</h1><p>此功能僅供已啟用的平台管理員使用。</p><a class="btn" href="index.html">返回夾夾管家</a>';return;}$('#authNotice').classList.add('hidden');$('#adminApp').classList.remove('hidden');try{await loadMaster();await loadCampaigns();}catch(e){say('載入失敗：'+e.message,true);} }
  init();
})();
