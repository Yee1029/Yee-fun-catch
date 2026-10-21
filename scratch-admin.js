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
  function addPrize(name='',qty=1){ const row=document.createElement('div'); row.className='prize-row'; row.innerHTML=`<input class="prize-name" maxlength="80" required placeholder="獎項名稱，例如：A 獎水壺" value="${esc(name)}"><input class="prize-qty" type="number" min="0" step="1" required value="${Number(qty)}" aria-label="獎項數量"><button class="remove" type="button" aria-label="移除獎項">×</button>`; row.querySelector('.remove').onclick=()=>{row.remove();updatePrizeTotal()}; row.querySelectorAll('input').forEach(i=>i.addEventListener('input',updatePrizeTotal)); $('#prizeRows').append(row); updatePrizeTotal(); }
  function updatePrizeTotal(){ const n=[...document.querySelectorAll('.prize-qty')].reduce((s,x)=>s+Math.max(0,Number(x.value)||0),0); $('#prizeTotal').textContent=`獎項總數：${n}`; $('#prizeTotal').dataset.total=n; }
  function fillHoles(){ for(let i=10;i<=300;i+=10){const o=document.createElement('option');o.value=i;o.textContent=`${i} 洞`;$('#holes').append(o);} }
  function fillVenues(){ $('#venue').innerHTML=venues.map(v=>`<option value="${v.id}">${esc(v.name)}</option>`).join(''); fillMachines(); }
  function fillMachines(){ const vid=$('#venue').value; const list=machines.filter(m=>m.venue_id===vid&&m.is_active!==false); $('#machine').innerHTML=list.map(m=>`<option value="${m.id}">${esc(m.machine_number)}</option>`).join(''); }
  async function loadMaster(){ const [v,m]=await Promise.all([db.from('venues').select('id,name,is_active').eq('owner_id',user.id).order('name'),db.from('machines').select('id,venue_id,machine_number,is_active').eq('owner_id',user.id).order('machine_number')]); if(v.error)throw v.error;if(m.error)throw m.error;venues=v.data||[];machines=m.data||[];fillVenues(); }
  async function loadCampaigns(){ const [c,p,claims]=await Promise.all([db.from('scratch_campaigns').select('*').eq('owner_id',user.id).order('created_at',{ascending:false}),db.from('scratch_prizes').select('*').eq('owner_id',user.id).order('sort_order'),db.from('scratch_claims').select('campaign_id,prize_id,cell_no')]); if(c.error)throw c.error;if(p.error)throw p.error;if(claims.error)throw claims.error;campaigns=(c.data||[]).map(x=>({...x,prizes:(p.data||[]).filter(q=>q.campaign_id===x.id),claims:(claims.data||[]).filter(q=>q.campaign_id===x.id)})); renderCampaigns(); }
  function renderCampaigns(){ const root=$('#campaignList'); if(!campaigns.length){root.innerHTML='<p class="muted">尚未建立刮刮樂活動。</p>';return;} root.innerHTML=campaigns.map(c=>{const venue=venues.find(v=>v.id===c.venue_id)?.name||'場地';const machine=machines.find(m=>m.id===c.machine_id)?.machine_number||'機台';const label=c.status==='active'?'進行中':c.status==='ended'?'已結束':'草稿';const url=new URL('scratch.html',location.href);url.searchParams.set('code',c.public_code);const canPlay=c.status==='active';return `<article class="campaign"><div><h3>${esc(c.title)} <span class="badge ${c.status}">${label}</span></h3><p class="muted">${esc(venue)}／${esc(machine)}　·　${c.holes_total} 洞　·　已刮 ${c.claims.length} 洞　·　建立 ${new Date(c.created_at).toLocaleString('zh-TW')}</p><p class="muted">獎項：${c.prizes.map(p=>`${esc(p.prize_name)} × ${p.quantity}`).join('、')||'尚無獎項'}</p><div class="campaign-actions">${c.status==='draft'?`<button class="btn secondary" data-action="shuffle" data-id="${c.id}">隨機產生／重新抽選</button><button class="btn" data-action="lock" data-id="${c.id}">鎖定答案並啟用</button>`:''}${canPlay?`<button class="btn secondary" data-action="qr" data-id="${c.id}">顯示 QR Code</button><button class="btn secondary" data-action="end" data-id="${c.id}">結束活動</button>`:''}${c.status==='ended'?`<button class="btn secondary" data-action="qr" data-id="${c.id}">查看活動 QR</button>`:''}<a class="btn secondary" href="${esc(url.href)}" target="_blank" rel="noopener">開啟玩家頁</a></div><div class="qr-inline hidden" id="qr-${c.id}"><p class="small">公開活動連結：${esc(url.href)}</p><div class="qrbox" id="qrcode-${c.id}"></div><button class="btn secondary" data-action="print" data-id="${c.id}">列印 QR Code</button><button class="btn secondary" data-action="copy" data-url="${esc(url.href)}">複製活動連結</button></div></div></article>`}).join(''); }
  async function createCampaign(e){e.preventDefault();const btn=$('#createBtn');btn.disabled=true;message('正在建立草稿…');try{if(!user)throw new Error('尚未登入');const title=$('#title').value.trim(),venueId=$('#venue').value,machineId=$('#machine').value,holes=Number($('#holes').value),lat=Number($('#lat').value),lng=Number($('#lng').value);if(!title||!venueId||!machineId)throw new Error('請填寫活動名稱、場地與機台。');if(!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lng)||lng < -180||lng>180)throw new Error('請填寫有效的 GPS 緯度與經度。');const prizeRows=[...document.querySelectorAll('.prize-row')].map((r,i)=>({owner_id:user.id,prize_name:r.querySelector('.prize-name').value.trim(),quantity:Number(r.querySelector('.prize-qty').value),sort_order:i}));if(!prizeRows.length||prizeRows.some(p=>!p.prize_name||!Number.isInteger(p.quantity)||p.quantity<0))throw new Error('請設定至少一個有效獎項。');const total=prizeRows.reduce((s,p)=>s+p.quantity,0);if(total<1)throw new Error('獎項總數至少需有 1 個。');if(total>holes)throw new Error('獎項總數不可超過洞數。');const {data:machine,error:me}=await db.from('machines').select('id,venue_id').eq('id',machineId).eq('owner_id',user.id).single();if(me)throw me;if(machine.venue_id!==venueId)throw new Error('所選機台與場地不相符。');const {data:c,error:ce}=await db.from('scratch_campaigns').insert({owner_id:user.id,venue_id:venueId,machine_id:machineId,title,holes_total:holes,gps_lat:lat,gps_lng:lng,radius_m:200,status:'draft'}).select('*').single();if(ce)throw ce;const {error:pe}=await db.from('scratch_prizes').insert(prizeRows.map(p=>({...p,campaign_id:c.id})));if(pe)throw pe;const {error:ge}=await db.rpc('scratch_generate_layout',{p_campaign_id:c.id,p_lock:false});if(ge)throw ge;$('#createForm').reset();$('#prizeRows').innerHTML='';addPrize();message('草稿已建立並產生隨機配置。你可重抽，確認後再鎖定啟用。');await loadCampaigns();say('活動草稿已建立。');}catch(err){message(err.message||String(err),true);}finally{btn.disabled=false;}}
  async function doAction(action,id,url){try{if(action==='copy'){await navigator.clipboard.writeText(url);say('活動連結已複製。');return;}const c=campaigns.find(x=>x.id===id);if(!c)throw new Error('找不到活動');if(action==='shuffle'){const {error}=await db.rpc('scratch_generate_layout',{p_campaign_id:id,p_lock:false});if(error)throw error;say('已重新抽選配置；答案尚未鎖定。');await loadCampaigns();}
    if(action==='lock'){if(!confirm('鎖定後無法重抽或修改獎項，並立即開放玩家參加。確定嗎？'))return;const {error}=await db.rpc('scratch_generate_layout',{p_campaign_id:id,p_lock:true});if(error)throw error;say('答案已鎖定，活動正式啟用。');await loadCampaigns();}
    if(action==='end'){if(!confirm('確定結束活動？結束後玩家不能再申報或刮獎。'))return;const {error}=await db.from('scratch_campaigns').update({status:'ended',ended_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id);if(error)throw error;say('活動已結束。');await loadCampaigns();}
    if(action==='qr'){const box=$(`#qr-${id}`);box.classList.toggle('hidden');const q=$(`#qrcode-${id}`);q.innerHTML='';const link=new URL('scratch.html',location.href);link.searchParams.set('code',c.public_code);if(window.QRCode)new QRCode(q,{text:link.href,width:116,height:116});else q.textContent=link.href;}
    if(action==='print'){const link=new URL('scratch.html',location.href);link.searchParams.set('code',c.public_code);const w=window.open('','_blank','width=500,height=650');if(!w)throw new Error('瀏覽器阻擋列印視窗，請允許彈出視窗後重試。');w.document.write(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>刮刮樂 QR Code</title><style>body{font-family:system-ui;text-align:center;padding:24px}#qrcode{display:flex;justify-content:center;margin:24px}small{word-break:break-all}</style><h1>${esc(c.title)}</h1><p>${esc(c.holes_total)} 洞刮刮樂活動</p><div id="qrcode"></div><small>${esc(link.href)}</small><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script><script>new QRCode(document.getElementById('qrcode'),{text:${JSON.stringify(link.href)},width:240,height:240});window.onload=()=>setTimeout(()=>window.print(),500);<\/script></html>`);w.document.close();}
  }catch(err){say(err.message||String(err),true);}}
  async function init(){fillHoles();addPrize();$('#venue').addEventListener('change',fillMachines);$('#addPrize').onclick=()=>addPrize();$('#createForm').onsubmit=createCampaign;$('#refresh').onclick=()=>loadCampaigns().catch(e=>say(e.message,true));$('#geocodeAddress').onclick=searchGoogleAddress;$('#address').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchGoogleAddress();}});$('#address').addEventListener('input',()=>{clearAddressSuggestions();});$('#campaignList').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)doAction(b.dataset.action,b.dataset.id,b.dataset.url);});const {data:{session},error}=await db.auth.getSession();if(error||!session){$('#authNotice').innerHTML='<h1>請先登入管理員帳號</h1><p>刮刮樂活動管理僅限已啟用的平台管理員使用。</p><a class="btn" href="index.html">前往登入</a>';return;}user=session.user;const {data:profile,error:pe}=await db.from('profiles').select('role,status').eq('id',user.id).maybeSingle();if(pe||!profile||profile.role!=='admin'||profile.status!=='active'){await db.auth.signOut();$('#authNotice').innerHTML='<h1>沒有管理權限</h1><p>此功能僅供已啟用的平台管理員使用。</p><a class="btn" href="index.html">返回夾夾管家</a>';return;}$('#authNotice').classList.add('hidden');$('#adminApp').classList.remove('hidden');try{await loadMaster();await loadCampaigns();}catch(e){say('載入失敗：'+e.message,true);} }
  init();
})();
