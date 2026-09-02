/*
 * 小众工具箱
 * TauriTavern / SillyTavern 1.18 compatible offline extension.
 */
(function () {
  'use strict';

  const EXT_ID = 'xiaozhong-toolbox';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bytesFmt = (n) => { n = Number(n || 0); const u=['B','KB','MB','GB']; let i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return `${n.toFixed(i ? 2 : 0)} ${u[i]}`; };
  const timeFmt = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '未知' : d.toLocaleString(); };
  const toast = (msg, type='info') => window.toastr?.[type] ? window.toastr[type](msg) : console[type==='error'?'error':'log'](`[${EXT_ID}] ${msg}`);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function hostReady() {
    const h = window.__TAURITAVERN__;
    if (h?.ready) await h.ready;
    else if (window.__TAURITAVERN_MAIN_READY__) await window.__TAURITAVERN_MAIN_READY__;
  }

  async function invokeAny(cmd, args = {}) {
    const h = window.__TAURITAVERN__;
    if (h?.invoke?.safeInvoke) return await h.invoke.safeInvoke(cmd, args);
    if (typeof h?.invoke === 'function') return await h.invoke(cmd, args);
    if (window.__TAURI__?.core?.invoke) return await window.__TAURI__.core.invoke(cmd, args);
    if (window.__TAURI_INTERNALS__?.invoke) return await window.__TAURI_INTERNALS__.invoke(cmd, args);
    throw new Error('本地宿主 invoke 不可用');
  }

  async function invokeCandidates(candidates, args={}) {
    let last;
    for (const c of candidates) {
      try { return await invokeAny(c, args); } catch (e) { last = e; }
    }
    throw last || new Error('宿主命令不可用');
  }

  const HOST = {
    async dataRoot() {
      const h = window.__TAURITAVERN__;
      const candidates = [
        'get_data_root','getDataRoot','data_root','get_data_dir','getDataDir',
        'app_get_data_root','app_data_root','get_app_data_dir','getAppDataDir'
      ];
      try {
        const r = await invokeCandidates(candidates);
        if (typeof r === 'string' && r) return r;
        if (r && typeof r === 'object') return r.path || r.dataRoot || r.data_root || r.dataDir || r.data_dir || null;
      } catch (_) {}
      const hints = [h?.paths?.dataRoot, h?.paths?.data_root, h?.api?.paths?.dataRoot, h?.api?.paths?.data_root];
      return hints.find(x => typeof x === 'string' && x) || null;
    },
    async readFile(path) {
      const tries = [
        ['plugin:fs|read_file', {path}],
        ['plugin:fs|read_binary_file', {path}],
        ['read_file', {path}], ['read_binary_file', {path}], ['filesystem_read_file', {path}], ['fs_read_file', {path}]
      ];
      let last;
      for (const [cmd,args] of tries) {
        try {
          const r = await invokeAny(cmd,args);
          if (r instanceof ArrayBuffer) return new Uint8Array(r);
          if (ArrayBuffer.isView(r)) return new Uint8Array(r.buffer, r.byteOffset, r.byteLength);
          if (Array.isArray(r)) return Uint8Array.from(r);
          if (r?.data) return Uint8Array.from(r.data);
        } catch(e) { last=e; }
      }
      throw last || new Error('读取文件失败');
    },
    async readText(path) { return new TextDecoder().decode(await this.readFile(path)); },
    async writeFile(path, bytes) {
      const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      return await invokeCandidates([
        'plugin:fs|write_file','write_file','write_binary_file','filesystem_write_file','fs_write_file'
      ], {path, data});
    },
    async listDir(path) {
      let r;
      try { r = await invokeAny('plugin:fs|read_dir',{path}); } catch (_) {
        r = await invokeCandidates(['read_dir','list_directory','filesystem_read_dir','fs_read_dir'],{path});
      }
      return Array.isArray(r) ? r : (r?.entries || r?.files || r?.items || []);
    },
    async exists(path) {
      try { return Boolean(await invokeAny('plugin:fs|exists',{path})); } catch (_) {}
      try { return Boolean(await invokeCandidates(['exists','file_exists','path_exists'],{path})); } catch (_) { return false; }
    },
    async mkdir(path) {
      try { return await invokeAny('plugin:fs|mkdir',{path,options:{recursive:true}}); } catch (_) {}
      try { return await invokeAny('plugin:fs|mkdir',{path,recursive:true}); } catch (_) {}
      return await invokeCandidates(['mkdir','make_directory','create_directory'],{path,recursive:true});
    },
    async remove(path, recursive=false) {
      try { return await invokeAny('plugin:fs|remove',{path,options:{recursive}}); } catch (_) {}
      try { return await invokeAny('plugin:fs|remove',{path,recursive}); } catch (_) {}
      return await invokeCandidates(['remove','delete_path','remove_path','delete_file'],{path,recursive});
    },
    async copy(src,dst) { return await invokeCandidates(['copy_path','copy','copy_file','copy_directory'],{src,dst}); },
    async move(src,dst) { return await invokeCandidates(['move_path','rename','rename_path','move'],{src,dst}); },
    async folderPicker(title='选择目录') {
      try {
        const r = await invokeAny('plugin:dialog|open',{options:{directory:true,multiple:false,title}});
        return typeof r === 'string' ? r : null;
      } catch (_) {}
      try {
        const r = await invokeAny('plugin:dialog|open',{directory:true,multiple:false,title});
        return typeof r === 'string' ? r : null;
      } catch (_) {}
      if (window.__TAURI__?.dialog?.open) return await window.__TAURI__.dialog.open({directory:true,multiple:false,title});
      return null;
    },
    async filePicker(extensions,title='选择文件') {
      try {
        const r = await invokeAny('plugin:dialog|open',{options:{multiple:false,title,filters:[{name:'文件',extensions}]}});
        return typeof r === 'string' ? r : null;
      } catch (_) {}
      if (window.__TAURI__?.dialog?.open) return await window.__TAURI__.dialog.open({multiple:false,title,filters:[{name:'文件',extensions}]});
      return null;
    },
    async savePicker(defaultPath, title='保存文件', filters=[]) {
      try {
        const r = await invokeAny('plugin:dialog|save',{options:{defaultPath,title,filters}});
        return typeof r === 'string' ? r : null;
      } catch (_) {}
      if (window.__TAURI__?.dialog?.save) return await window.__TAURI__.dialog.save({defaultPath,title,filters});
      return null;
    },
    async writeText(path,text){return await this.writeFile(path,new TextEncoder().encode(text));},
    async platformDir(kind){
      const names = kind==='cache' ? ['plugin:path|app_cache_dir','app_cache_dir','get_app_cache_dir','getAppCacheDir'] : ['plugin:path|temp_dir','temp_dir','get_temp_dir','getTempDir'];
      try { const r=await invokeCandidates(names); if(typeof r==='string'&&r)return r; if(r&&typeof r==='object')return r.path||r.value||null; } catch(_){}
      return null;
    }
  };

  async function nativeOpenFile(extensions, title='选择文件') {
    if (window.__TAURI__?.dialog?.open) {
      try { return await window.__TAURI__.dialog.open({multiple:false,title,filters:[{name:'文件',extensions}]}); } catch (_) {}
    }
    try { return await HOST.filePicker(extensions,title); } catch (_) {}
    return null;
  }

  function pickWebFile(accept) {
    return new Promise(resolve => {
      const input=document.createElement('input'); input.type='file'; input.accept=accept; input.style.display='none';
      document.body.appendChild(input);
      input.onchange=()=>{const r=input.files?.[0]||null;input.remove();resolve(r);};
      input.click();
    });
  }

  async function getFileFromPathOrBrowser(extensions, accept, title) {
    const picked = await nativeOpenFile(extensions,title).catch(()=>null);
    if (picked instanceof File) return picked;
    if (typeof picked === 'string') {
      try {
        const bytes = await HOST.readFile(picked);
        return new File([bytes], picked.split(/[\\/]/).pop() || 'file');
      } catch (_) {
        // 某些打包版本允许 native dialog 选路径但没有把任意文件读权限暴露给扩展；回退到 WebView 文件选择器。
      }
    }
    return await pickWebFile(accept);
  }

  async function exportBlob(blob,name,mime) {
    const target = await HOST.savePicker(name,'导出文件',[{name:mime==='application/json'?'JSON':'文件',extensions:[name.split('.').pop()]}]).catch(()=>null);
    if (target) { try { await HOST.writeFile(target,new Uint8Array(await blob.arrayBuffer())); return; } catch (_) {} }
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); await sleep(700); URL.revokeObjectURL(a.href);
  }

  /* ---------- ZIP ---------- */
  async function readZip(file) {
    const ab=await file.arrayBuffer(), b=new Uint8Array(ab), dv=new DataView(ab); let eocd=-1;
    for(let i=b.length-22;i>=Math.max(0,b.length-66000);i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0) throw new Error('无效 ZIP：找不到中央目录');
    const count=dv.getUint16(eocd+10,true), cdOff=dv.getUint32(eocd+16,true); let p=cdOff; const out=[];
    for(let i=0;i<count;i++){
      if(dv.getUint32(p,true)!==0x02014b50) throw new Error('ZIP 中央目录损坏');
      const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true), usize=dv.getUint32(p+24,true), nlen=dv.getUint16(p+28,true), xlen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true), off=dv.getUint32(p+42,true);
      const name=new TextDecoder().decode(b.slice(p+46,p+46+nlen)); p+=46+nlen+xlen+clen; if(name.endsWith('/')) continue;
      if(dv.getUint32(off,true)!==0x04034b50) throw new Error('ZIP 文件头损坏');
      const ln=dv.getUint16(off+26,true), lx=dv.getUint16(off+28,true), start=off+30+ln+lx; out.push({name,method,size:usize,compressedSize:csize,data:b.slice(start,start+csize)});
    }
    for(const e of out){
      if(e.method===0)e.bytes=e.data;
      else if(e.method===8){const ds=new DecompressionStream('deflate-raw');e.bytes=new Uint8Array(await new Response(new Blob([e.data]).stream().pipeThrough(ds)).arrayBuffer());}
      else throw new Error(`不支持的 ZIP 压缩方式：${e.method}`);
    }
    return out;
  }
  const safeRel=(p)=>{p=p.replaceAll('\\','/');while(p.startsWith('./'))p=p.slice(2);if(!p||p.startsWith('/')||/^[A-Za-z]:\//.test(p))return null;const ps=p.split('/');if(ps.some(x=>!x||x==='..'))return null;return ps.join('/');};
  function findManifest(entries){
    const candidates=entries.filter(e=>e.name.split('/').at(-1).toLowerCase()==='manifest.json');
    candidates.sort((a,b)=>a.name.split('/').length-b.name.split('/').length);
    for(const e of candidates){
      try{
        const m=JSON.parse(new TextDecoder().decode(e.bytes));
        if(!m||typeof m!=='object'||Array.isArray(m))continue;
        const prefix=e.name.slice(0,-'manifest.json'.length);
        const siblingJs=entries.some(x=>x.name.startsWith(prefix) && /(^|\/)index\.js$/i.test(x.name.slice(prefix.length)));
        if(siblingJs || candidates.length===1)return {entry:e,manifest:m};
      }catch(_){}
    }
    throw new Error('ZIP 中没有可用的扩展 manifest.json');
  }
  const manifestIdentity=(m,fallback)=>String(m.id||m.extension_id||m.identifier||m.slug||m.name||m.display_name||fallback||'extension').trim().toLowerCase().replace(/[^\w.-]+/g,'-');
  function versionParts(v){return String(v||'0').replace(/^v/i,'').split(/[.+-]/).map(x=>{const n=parseInt(x,10);return Number.isFinite(n)?n:0;});}
  function versionCmp(a,b){const x=versionParts(a),y=versionParts(b);for(let i=0;i<Math.max(x.length,y.length);i++){const aa=x[i]||0,bb=y[i]||0;if(aa!==bb)return aa>bb?1:-1;}return 0;}

  async function discoverFilesRecursive(root,max=8000){
    const out=[],stack=[root];
    while(stack.length&&out.length<max){
      const dir=stack.pop(); let list=[]; try{list=await HOST.listDir(dir);}catch(_){break;}
      for(const it of list){const name=it.name||it.path?.split(/[\\/]/).pop()||'';const full=it.path||`${dir}/${name}`;const isDir=it.isDir||it.is_directory||it.kind==='directory'||it.type==='directory';if(isDir)stack.push(full);else out.push({path:full,name,size:Number(it.size||0),modified:it.modified||it.mtime||null});}
    }
    return out;
  }

  async function locateInstalledExtension(base,id){
    let dirs=[]; try{dirs=await HOST.listDir(base);}catch(_){return null;}
    for(const it of dirs){
      const isDir=it.isDir||it.is_directory||it.kind==='directory'||it.type==='directory'; if(!isDir)continue;
      const name=it.name||it.path?.split(/[\\/]/).pop(); if(!name)continue;
      const dir=it.path||`${base}/${name}`;
      try{const m=JSON.parse(await HOST.readText(`${dir}/manifest.json`));if(manifestIdentity(m,name)===id)return {dir,name,manifest:m};}catch(_){ }
    }
    return null;
  }

  /* ---------- UI ---------- */
  const CATS=['world','chat','cache','local','session','idb','temp','appcache'];
  const state={items:Object.fromEntries(CATS.map(x=>[x,[]])),selected:new Set(),allChats:[],scan:false,filter:'all',before:''};
  const cid=(cat,id)=>`${cat}::${id}`;

  function cleanerHTML(){
    const row=(cat,icon,title)=>`<div class="xz-section" data-cat="${cat}"><div class="xz-section-head"><strong>${icon} ${title} <span class="xz-count" data-count="${cat}">(0)</span></strong><div class="xz-section-actions"><button class="xz-mini" data-act="all" data-cat="${cat}">全选</button><button class="xz-mini" data-act="none" data-cat="${cat}">取消全选</button><button class="xz-mini" data-act="toggle" data-cat="${cat}">展开</button></div></div><div class="xz-list" data-list="${cat}" hidden></div></div>`;
    return `<div class="xz-toolbar"><div class="xz-toolbar-left"><button class="xz-primary" id="xz-scan">开始扫描</button><span id="xz-clean-status"></span></div><div class="xz-chat-filter"><span>聊天筛选</span><select id="xz-chat-filter"><option value="all">全部聊天</option><option value="7">7 天未使用</option><option value="30">30 天未使用</option><option value="90">90 天未使用</option><option value="180">180 天未使用</option><option value="before">指定日期以前</option></select><input id="xz-chat-before" type="date" hidden></div></div><div class="xz-all"><strong>全部清理项 <span id="xz-total">(0)</span></strong><div><button class="xz-mini" id="xz-all">全选</button><button class="xz-mini" id="xz-none">取消全选</button><button class="xz-danger" id="xz-delete">一键清理</button></div></div>${row('world','📚','遗留世界书')}${row('chat','🗨️','聊天记录')}${row('cache','💾','Cache Storage')}${row('local','🗄','LocalStorage')}${row('session','🗄','SessionStorage')}${row('idb','🗄','IndexedDB')}${row('temp','📂','临时文件')}${row('appcache','🧹','应用缓存')}`;
  }
  function extHTML(){return `<div class="xz-card"><div class="xz-card-title">📦 本地扩展导入</div><div class="xz-line"><button class="xz-primary" id="xz-ext-pick">选择 ZIP</button><span id="xz-ext-file">未选择</span></div><div id="xz-ext-info" class="xz-sub"></div><div class="xz-line"><label><input type="radio" name="xz-scope" value="global" checked> 所有用户</label><label><input type="radio" name="xz-scope" value="local"> 仅为我</label></div><button class="xz-primary" id="xz-ext-install" disabled>安装 / 替换扩展</button><div id="xz-ext-status" class="xz-status"></div></div>`;}
  function imageHTML(){return `<div class="xz-card"><div class="xz-card-title">🖼️ 图片格式转换</div><div class="xz-line"><button class="xz-primary" id="xz-img-pick">选择图片</button><span id="xz-img-file">未选择</span></div><div class="xz-grid"><label>输出格式<select id="xz-img-format"><option>PNG</option><option>JPEG</option><option>WebP</option></select></label><label>最大边<select id="xz-img-size"><option value="0">保持原尺寸</option><option value="4096">4096</option><option value="2560">2560</option><option value="1920" selected>1920</option><option value="1280">1280</option></select></label></div><div id="xz-quality-wrap" class="xz-grid"><label>质量 <output id="xz-quality-out">80</output><input id="xz-quality" type="range" min="55" max="95" value="80"></label><label>PNG 模式<select id="xz-png-mode"><option value="original">原始 PNG</option><option value="compress">PNG 压缩</option><option value="256">256 色</option><option value="128">128 色</option><option value="64">64 色</option></select></label></div><button class="xz-primary" id="xz-img-convert" disabled>开始转换</button><div id="xz-img-result" class="xz-status"></div><button class="xz-primary" id="xz-img-export" disabled>导出图片</button></div>`;}
  function presetHTML(){return `<div class="xz-card"><div class="xz-card-title">📋 Preset JSON 整理</div><div class="xz-line"><button class="xz-primary" id="xz-json-pick">选择 JSON</button><span id="xz-json-file">未选择</span></div><div class="xz-rule">✓ 按 Preset 内置排序整理 prompts<br>✓ 不修改任何条目数据<br>✓ 自动格式化 JSON</div><button class="xz-primary" id="xz-json-run" disabled>开始整理</button><div id="xz-json-status" class="xz-status"></div><button class="xz-primary" id="xz-json-export" disabled>导出 JSON</button></div>`;}

  function mountUI(){
    if(document.getElementById('xz-toolbox-root'))return document.getElementById('xz-toolbox-root');
    const host=document.createElement('div');host.id='xz-toolbox-root';host.innerHTML=`<section class="xz-panel"><div class="xz-title">🧰 小众工具箱 <span class="xz-badge">离线工具</span></div><div class="xz-tabs"><button data-tab="clean">🧹 清理维护</button><button data-tab="ext">📦 扩展导入</button><button data-tab="image">🖼️ 图片转换</button><button data-tab="preset">📋 Preset JSON 整理</button></div><div class="xz-body"><div class="xz-tab" data-view="clean">${cleanerHTML()}</div><div class="xz-tab" data-view="ext" hidden>${extHTML()}</div><div class="xz-tab" data-view="image" hidden>${imageHTML()}</div><div class="xz-tab" data-view="preset" hidden>${presetHTML()}</div></div></section>`;
    const target=document.querySelector('#extensions_settings, #extensions_settings2, .extensions_settings, #extensions_settings_wrapper')||document.body;
    target.appendChild(host);
    $$('.xz-tabs button',host).forEach(b=>b.onclick=()=>{$$('.xz-tabs button',host).forEach(x=>x.classList.toggle('active',x===b));$$('.xz-tab',host).forEach(v=>v.hidden=v.dataset.view!==b.dataset.tab);});
    $('.xz-tabs button',host).classList.add('active');
    bindCleaner(host);bindExt(host);bindImage(host);bindPreset(host);
    return host;
  }

  /* ---------- Cleaner: Browser Storage ---------- */
  async function scanBrowserStorage(){
    const local=[];try{for(const k of Object.keys(localStorage)){const v=localStorage.getItem(k)||'';local.push({id:k,label:k,size:new Blob([v]).size,detail:'LocalStorage 键'});}}catch(_){ }
    const session=[];try{for(const k of Object.keys(sessionStorage)){const v=sessionStorage.getItem(k)||'';session.push({id:k,label:k,size:new Blob([v]).size,detail:'SessionStorage 键'});}}catch(_){ }
    const cache=[];try{for(const n of await caches.keys()){const c=await caches.open(n);const reqs=await c.keys();cache.push({id:n,label:n,size:reqs.length,detail:`${reqs.length} 个缓存请求`});}}catch(_){ }
    const idb=[];try{if(indexedDB.databases){for(const d of await indexedDB.databases())idb.push({id:d.name||'',label:d.name||'(无名称)',size:0,detail:`version ${d.version||0}`});}}catch(_){ }
    state.items.local=local;state.items.session=session;state.items.cache=cache;state.items.idb=idb;
  }

  function collectBindingStrings(value,set,keyHint=''){
    if(value==null)return;
    if(typeof value==='string'){
      if(/world|lore|book|knowledge|wi/i.test(keyHint)) set.add(value);
      return;
    }
    if(Array.isArray(value)){for(const v of value)collectBindingStrings(v,set,keyHint);return;}
    if(typeof value==='object')for(const [k,v] of Object.entries(value))collectBindingStrings(v,set,k);
  }

  async function scanWorlds(){
    const out=[];let names=[];let apiSuccess=false;
    try{const r=await fetch('/api/worldinfo/list',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.ok){const j=await r.json();names=(Array.isArray(j)?j:(j.worlds||j.items||j.names||[]));apiSuccess=true;}}catch(_){ }
    if(!apiSuccess){try{const r=await fetch('/api/worldinfo/list');if(r.ok){const j=await r.json();names=(Array.isArray(j)?j:(j.worlds||j.items||j.names||[]));apiSuccess=true;}}catch(_){} }
    const references=new Map();const addRef=(name,source)=>{name=String(name||'').trim();if(!name)return;if(!references.has(name))references.set(name,new Set());references.get(name).add(source);};
    const known=new Set();
    const sources=[];
    const chars=window.characters||[];if(Array.isArray(chars)){sources.push({name:'角色数据',value:chars});for(const c of chars){const b=c?.data?.character_book;if(b?.name)addRef(b.name,'内嵌 Character Book（需单独确认）');}}
    const ctx=window.getContext?.()||window.SillyTavern?.getContext?.()||null;
    const pw=ctx?.power_user||window.power_user||null;if(pw){sources.push({name:'Persona / Power User',value:pw});}
    for(const x of [window.world_names,window.worldNames,window.world_info,ctx?.worldInfo]){if(x)sources.push({name:'全局 World Info',value:x});}
    for(const s of sources){const vals=new Set();collectBindingStrings(s.value,vals);for(const v of vals)addRef(v,s.name);}

    let fsScan=false;
    const root=await HOST.dataRoot().catch(()=>null);
    if(root){
      const files=await discoverFilesRecursive(root,12000); fsScan=files.length>0;
      const candidates=files.filter(f=>/\.(json|jsonl)$/i.test(f.name));
      for(const f of candidates){
        let text='';try{text=await HOST.readText(f.path);}catch(_){continue;}
        for(const n of (names||[]).map(x=>String(x?.name||x)).filter(Boolean)){
          if(!text.includes(`"${n.replace(/"/g,'\\"')}"`))continue;
          const around=new RegExp(`(?:world|lore|book|knowledge)[^\\n\\r]{0,180}${n.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}|${n.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}[^\\n\\r]{0,180}(?:world|lore|book|knowledge)`,'i');
          if(around.test(text))addRef(n,`本地数据：${f.name}`);
        }
      }
    }

    for(const raw of names){
      const name=String(raw?.name||raw||'').trim();if(!name)continue;
      let data=null;try{const r=await fetch('/api/worldinfo/get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});if(r.ok)data=await r.json();}catch(_){ }
      if(data==null){try{const r=await fetch(`/api/worldinfo/get?name=${encodeURIComponent(name)}`);if(r.ok)data=await r.json();}catch(_){} }
      const refs=references.get(name)||new Set();
      let status='未发现有效引用';
      if(refs.size)status='正在使用';
      if(!apiSuccess||!fsScan)status=refs.size?'正在使用':'无法确认来源';
      if([...refs].some(x=>/内嵌 Character Book/.test(x)) && refs.size===1)status='无法确认来源';
      out.push({id:name,label:name,size:new Blob([JSON.stringify(data||{})]).size,status,detail:[...refs].join('；')||'扫描到世界书，但未找到有效绑定'});
    }
    return out;
  }

  /* ---------- Cleaner: Chats ---------- */
  async function scanChats(){
    const out=[];const chars=window.characters||[];const seen=new Set();
    const add=(x)=>{if(!x?.id||seen.has(x.id))return;seen.add(x.id);out.push(x);};
    for(const c of chars){
      const avatar=c?.avatar||c?.avatar_url;if(!avatar)continue;const owner=c?.name||avatar;
      try{const r=await fetch('/api/characters/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar_url:avatar})});if(!r.ok)continue;const j=await r.json();const arr=Array.isArray(j)?j:(j.chats||j.items||[]);
        for(const x of arr){const f=x.file_name||x.filename||x.name||x.chatfile||'';if(!f)continue;const rawTime=x.date_last_message||x.last_message_date||x.updated_at||x.lastModified||x.modified||x.mtime||x.timestamp||0;const lm=typeof rawTime==='number'?rawTime:Date.parse(rawTime)||0;add({id:`${avatar}::${f}`,label:x.name||f,owner,size:Number(x.size||x.file_size||0),last:lm,file:f,avatar_url:avatar,kind:'chat'});}
      }catch(_){ }
    }
    const groups=window.groups||[];for(const g of groups){const gid=g?.id||g?.name;for(const f of (g?.chats||[])){const file=typeof f==='string'?f:(f?.file_name||f?.filename||f?.name||f?.chatfile||'');if(!file)continue;add({id:`group::${gid}::${file}`,label:typeof f==='string'?f:(f?.name||file),owner:`群组：${g?.name||gid}`,size:Number(f?.size||f?.file_size||0),last:(typeof (f?.date_last_message||f?.last_message_date||f?.updated_at||f?.lastModified||f?.modified||f?.mtime||f?.timestamp||0)==='number' ? Number(f?.date_last_message||f?.last_message_date||f?.updated_at||f?.lastModified||f?.modified||f?.mtime||f?.timestamp||0) : (Date.parse(f?.date_last_message||f?.last_message_date||f?.updated_at||f?.lastModified||f?.modified||f?.mtime||f?.timestamp||'')||0)),file,group_id:gid,kind:'groupchat'});}}
    state.allChats=out;return applyChatFilter();
  }
  function applyChatFilter(){
    const now=Date.now(),f=state.filter;let arr=state.allChats||[];
    if(f==='before'){const d=Date.parse(state.before);if(!Number.isNaN(d))arr=arr.filter(x=>x.last&&x.last<d);}
    else if(f!=='all'){const days=Number(f);if(days>0)arr=arr.filter(x=>x.last&&now-x.last>=days*86400000);}
    state.items.chat=arr;return arr;
  }

  async function scanAppFileCaches(){
    const root=await HOST.dataRoot().catch(()=>null);const temps=[],caches=[];
    const candidates=[];
    if(root){candidates.push(['temp',`${root}/temp`],['temp',`${root}/tmp`],['temp',`${root}/temporary`],['cache',`${root}/cache`],['cache',`${root}/caches`],['cache',`${root}/default-user/cache`],['cache',`${root}/default-user/caches`],['cache',`${root}/extensions/cache`]);}
    const platformTemp=await HOST.platformDir('temp').catch(()=>null),platformCache=await HOST.platformDir('cache').catch(()=>null);
    if(platformTemp)candidates.push(['temp',platformTemp]);
    if(platformCache)candidates.push(['cache',platformCache]);
    if(!candidates.length)return {temps,caches,available:false};
    for(const [kind,path] of candidates){if(!await HOST.exists(path).catch(()=>false))continue;const files=await discoverFilesRecursive(path,5000);for(const f of files)(kind==='temp'?temps:caches).push({id:f.path,label:f.path.split(/[\\/]/).pop()||f.path,owner:path,size:f.size,last:f.modified,file:f.path,kind:'file'});}
    return {temps,caches,available:true};
  }
  async function scanAndRender(root){
    $('#xz-clean-status',root).textContent='扫描中…';state.scan=true;state.selected.clear();try{await scanBrowserStorage();state.items.world=await scanWorlds();await scanChats();const fc=await scanAppFileCaches();state.items.temp=fc.temps;state.items.appcache=fc.caches;renderCleaner(root);$('#xz-clean-status',root).textContent='✓ 扫描完成';}catch(e){console.error(e);$('#xz-clean-status',root).textContent=`扫描失败：${e.message}`;toast(`扫描失败：${e.message}`,'error');}finally{state.scan=false;}}

  function isSelectable(cat,item){return !(cat==='world'&&item.status==='正在使用');}
  function renderCleaner(root){
    let total=0;for(const cat of CATS){const arr=state.items[cat]||[];total+=arr.filter(x=>isSelectable(cat,x)).length;const c=$(`[data-count="${cat}"]`,root);if(c)c.textContent=`(${arr.length})`;const box=$(`[data-list="${cat}"]`,root);if(box)box.innerHTML=arr.map(x=>{const key=cid(cat,x.id),disabled=!isSelectable(cat,x);return `<label class="xz-item ${disabled?'xz-disabled':''}"><input type="checkbox" data-sel="${esc(key)}" ${disabled?'disabled':''} ${state.selected.has(key)?'checked':''}><span><strong>${esc(x.label)}</strong><small>${esc(x.owner||x.detail||'')}</small><small>${x.last?`最后使用：${timeFmt(x.last)} · `:''}${bytesFmt(x.size||0)}${x.status?` · ${esc(x.status)}`:''}</small></span></label>`;}).join('')||'<div class="xz-empty">没有符合条件的项目</div>';}
    $('#xz-total',root).textContent=`(${state.selected.size}/${total})`;
    $$('[data-sel]',root).forEach(i=>i.onchange=()=>{if(i.checked)state.selected.add(i.dataset.sel);else state.selected.delete(i.dataset.sel);renderCleaner(root);});
  }

  async function deleteChat(item){
    if(item.kind==='chat'){
      const r=await fetch('/api/chats/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar_url:item.avatar_url,ch_name:item.owner,chatfile:item.file})});
      if(!r.ok)throw new Error(`角色聊天删除失败：HTTP ${r.status}`);return;
    }
    const payloads=[{id:item.group_id,chatfile:item.file},{group_id:item.group_id,chatfile:item.file},{id:item.group_id,chat_id:item.file}];
    let ok=false,last='';for(const p of payloads){for(const url of ['/api/chats/group/delete','/api/group/chats/delete']){for(const method of ['POST','DELETE']){try{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});if(r.ok){ok=true;break;}last=`HTTP ${r.status}`;}catch(e){last=e.message;}}if(ok)break;}if(ok)break;}if(!ok)throw new Error(`群组聊天删除失败：${last}`);
  }

  async function deleteSelected(root){
    const selected=[...state.selected];if(!selected.length){toast('没有选择任何项目');return;}
    const uncertain=selected.some(k=>k.startsWith('world::')&&state.items.world.some(x=>k===cid('world',x.id)&&x.status==='无法确认来源'));
    const msg=uncertain?'所选项目包含“无法确认来源”的世界书。继续删除可能造成数据丢失。确定继续？':`确定删除已选择的 ${selected.length} 项本地数据吗？`;
    if(!window.confirm(msg))return;$('#xz-clean-status',root).textContent='正在清理…';let ok=0,fail=0;
    for(const key of selected){const idx=key.indexOf('::');const cat=key.slice(0,idx),id=key.slice(idx+2);const item=(state.items[cat]||[]).find(x=>String(x.id)===id);if(!item){continue;}try{
      if(cat==='local')localStorage.removeItem(item.id);else if(cat==='session')sessionStorage.removeItem(item.id);else if(cat==='cache'){await caches.delete(item.id);}else if(cat==='idb'){await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(item.id);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error||new Error('删除失败'));r.onblocked=()=>resolve();});}
      else if(cat==='world'){const r=await fetch('/api/worldinfo/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:item.id})});if(!r.ok)throw new Error(`世界书删除失败：HTTP ${r.status}`);}
      else if(cat==='chat')await deleteChat(item);
      else if(cat==='temp'||cat==='appcache'){await HOST.remove(item.file,true);}
      ok++;
    }catch(e){fail++;console.error(`[${EXT_ID}]`,cat,item,e);}}
    state.selected.clear();toast(`清理完成：成功 ${ok}，失败 ${fail}`,fail?'warning':'success');await scanAndRender(root);
  }

  async function bindCleaner(root){
    $('#xz-all',root).onclick=()=>{for(const [cat,arr] of Object.entries(state.items))for(const x of arr)if(isSelectable(cat,x))state.selected.add(cid(cat,x.id));renderCleaner(root);};
    $('#xz-none',root).onclick=()=>{state.selected.clear();renderCleaner(root);};
    $('#xz-delete',root).onclick=()=>deleteSelected(root);
    $('#xz-scan',root).onclick=()=>scanAndRender(root);
    $('#xz-chat-filter',root).onchange=e=>{state.filter=e.target.value;$('#xz-chat-before',root).hidden=state.filter!=='before';applyChatFilter();renderCleaner(root);};
    $('#xz-chat-before',root).onchange=e=>{state.before=e.target.value;applyChatFilter();renderCleaner(root);};
    $$('.xz-mini[data-cat]',root).forEach(b=>b.onclick=()=>{const cat=b.dataset.cat,act=b.dataset.act,list=state.items[cat]||[];if(act==='toggle'){const el=$(`[data-list="${cat}"]`,root);el.hidden=!el.hidden;return;}if(act==='all')list.forEach(x=>{if(isSelectable(cat,x))state.selected.add(cid(cat,x.id));});else list.forEach(x=>state.selected.delete(cid(cat,x.id)));renderCleaner(root);});
    renderCleaner(root);
  }

  /* ---------- Extension importer ---------- */
  let extState={file:null,entries:null,manifest:null,rootPrefix:''};
  async function bindExt(root){
    $('#xz-ext-pick',root).onclick=async()=>{try{const f=await getFileFromPathOrBrowser(['zip'],'.zip','选择扩展 ZIP');if(!f)return;const entries=await readZip(f),{entry,manifest}=findManifest(entries);const prefix=entry.name.slice(0,-'manifest.json'.length);const files=entries.filter(e=>e.name.startsWith(prefix));if(!files.some(e=>e.name.slice(prefix.length).toLowerCase()==='index.js') && !(manifest.js||manifest.scripts))toast('警告：manifest 中没有发现 index.js/js 入口，仍可继续安装。','warning');extState={file:f,entries,manifest,rootPrefix:prefix};$('#xz-ext-file',root).textContent=f.name;$('#xz-ext-info',root).innerHTML=`扩展：<b>${esc(manifest.display_name||manifest.name||manifest.id||'未命名')}</b>　版本：<b>${esc(manifest.version||'未知')}</b>　ZIP 文件：${entries.length}`;$('#xz-ext-status',root).textContent='';$('#xz-ext-install',root).disabled=false;}catch(e){extState={};$('#xz-ext-install',root).disabled=true;$('#xz-ext-status',root).textContent=`读取失败：${e.message}`;toast(e.message,'error');}};
    $('#xz-ext-install',root).onclick=()=>installExtension(root);
  }

  async function resolveDataRoot(){
    const r=await HOST.dataRoot().catch(()=>null);if(r)return r;
    const manual=await HOST.folderPicker('请选择 TauriTavern 的 data 目录').catch(()=>null);if(manual)return manual.replace(/[\\/]$/,'');
    throw new Error('无法取得 TauriTavern data 目录；请允许本地文件系统访问或手动选择 data 目录。');
  }

  async function installExtension(root){
    const {entries,manifest,rootPrefix}=extState;if(!entries||!manifest)return;const scope=$('input[name="xz-scope"]:checked',root).value;const baseRel=scope==='local'?'default-user/extensions':'extensions/third-party';$('#xz-ext-status',root).textContent='正在安装…';
    try{
      const dataRoot=await resolveDataRoot(),base=`${dataRoot.replace(/[\\/]$/,'')}/${baseRel}`,id=manifestIdentity(manifest,extState.file?.name||'extension');await HOST.mkdir(base);
      const existing=await locateInstalledExtension(base,id);const target=existing?.dir||`${base}/${id}`;const temp=`${base}/.${id}.xz-install-${Date.now()}`;const backup=`${base}/.${id}.xz-backup-${Date.now()}`;
      await HOST.mkdir(temp);
      const files=entries.filter(e=>e.name.startsWith(rootPrefix)).map(e=>({e,rel:safeRel(e.name.slice(rootPrefix.length))})).filter(x=>x.rel);
      if(!files.some(x=>x.rel.toLowerCase()==='manifest.json'))throw new Error('ZIP 根目录没有 manifest.json');
      for(const {e,rel} of files){const path=`${temp}/${rel}`,parts=path.split('/');parts.pop();if(parts.length)await HOST.mkdir(parts.join('/'));await HOST.writeFile(path,e.bytes);}
      const staged=JSON.parse(await HOST.readText(`${temp}/manifest.json`));const stagedId=manifestIdentity(staged,id);if(stagedId!==id)throw new Error('安装验证失败：manifest identity 不一致');
      let backupMade=false;
      try {
        if(existing){await HOST.move(target,backup);backupMade=true;}
        await HOST.move(temp,target);
        const verify=JSON.parse(await HOST.readText(`${target}/manifest.json`));
        if(manifestIdentity(verify,id)!==id)throw new Error('安装验证失败：安装目录中的 manifest 不匹配');
        if(String(verify.version||'')!==String(manifest.version||''))throw new Error('安装验证失败：版本号不一致');
        if(backupMade)await HOST.remove(backup,true);
      } catch(err) {
        try { if(await HOST.exists(target)) await HOST.remove(target,true); } catch(_){}
        if(backupMade){ try{await HOST.move(backup,target);}catch(_){} }
        throw err;
      }
      const compare=existing?versionCmp(manifest.version,existing.manifest?.version):null;const mode=!existing?'新安装':compare>0?'升级':compare<0?'降级':'同版本重新安装';
      $('#xz-ext-status',root).textContent=`✓ ${mode}完成：${verify.display_name||id} ${verify.version||''}，正在刷新 TauriTavern…`;await sleep(900);location.reload();
    }catch(e){console.error(e);$('#xz-ext-status',root).textContent=`安装失败：${e.message}`;toast(`扩展安装失败：${e.message}`,'error');}
  }

  /* ---------- Image converter ---------- */
  let imgState={file:null,blob:null,name:'converted'};
  function quantizeImageData(src,colors){
    const d=src.data,out=new ImageData(new Uint8ClampedArray(d),src.width,src.height);let levels;
    if(colors===256)levels=[8,8,4];else if(colors===128)levels=[8,4,4];else levels=[4,4,4];
    const q=(v,n)=>Math.round(v*(n-1)/255)*255/(n-1);
    for(let i=0;i<d.length;i+=4){out.data[i]=q(d[i],levels[0]);out.data[i+1]=q(d[i+1],levels[1]);out.data[i+2]=q(d[i+2],levels[2]);}
    return out;
  }
  async function bindImage(root){
    const sync=()=>{$('#xz-quality-wrap',root).hidden=$('#xz-img-format',root).value==='PNG';};$('#xz-img-format',root).onchange=sync;$('#xz-quality',root).oninput=e=>$('#xz-quality-out',root).textContent=e.target.value;sync();
    $('#xz-img-pick',root).onclick=async()=>{try{const f=await getFileFromPathOrBrowser(['png','jpg','jpeg','webp'],'image/png,image/jpeg,image/webp','选择图片');if(!f)return;imgState.file=f;$('#xz-img-file',root).textContent=`${f.name} · ${bytesFmt(f.size)}`;$('#xz-img-convert',root).disabled=false;$('#xz-img-export',root).disabled=true;}catch(e){toast(`选择图片失败：${e.message}`,'error');}};
    $('#xz-img-convert',root).onclick=async()=>{try{const f=imgState.file,fmt=$('#xz-img-format',root).value,max=Number($('#xz-img-size',root).value),q=Number($('#xz-quality',root).value)/100,pngMode=$('#xz-png-mode',root).value;const bitmap=await createImageBitmap(f);let w=bitmap.width,h=bitmap.height;if(max&&Math.max(w,h)>max){const s=max/Math.max(w,h);w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));}const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});if(fmt==='JPEG'){ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);}ctx.drawImage(bitmap,0,0,w,h);let blob;if(fmt==='PNG'){if(/^(256|128|64)$/.test(pngMode)){ctx.putImageData(quantizeImageData(ctx.getImageData(0,0,w,h),Number(pngMode)),0,0);}blob=await new Promise(r=>c.toBlob(r,'image/png'));}else blob=await new Promise(r=>c.toBlob(r,fmt==='JPEG'?'image/jpeg':'image/webp',q));if(!blob)throw new Error('当前 WebView 无法编码此格式');imgState.blob=blob;imgState.name=(f.name.replace(/\.[^.]+$/,'')||'image')+'.'+(fmt==='JPEG'?'jpg':fmt.toLowerCase());const ratio=f.size?100*(1-blob.size/f.size):0;$('#xz-img-result',root).textContent=`✓ 转换完成　原始：${bytesFmt(f.size)}　输出：${bytesFmt(blob.size)}　压缩比例：${ratio.toFixed(1)}%　格式：${fmt}`;$('#xz-img-export',root).disabled=false;}catch(e){console.error(e);toast(`图片转换失败：${e.message}`,'error');}};
    $('#xz-img-export',root).onclick=()=>imgState.blob&&exportBlob(imgState.blob,imgState.name,imgState.blob.type).catch(e=>toast(`导出失败：${e.message}`,'error'));
  }

  /* ---------- Preset organizer ---------- */
  let presetState={file:null,result:null,name:'preset_sorted.json'};
  async function bindPreset(root){
    $('#xz-json-pick',root).onclick=async()=>{try{const f=await getFileFromPathOrBrowser(['json'],'application/json,.json','选择 Preset JSON');if(!f)return;presetState.file=f;presetState.name=(f.name||'preset.json').replace(/\.json$/i,'')+'_sorted.json';$('#xz-json-file',root).textContent=f.name;$('#xz-json-run',root).disabled=false;$('#xz-json-export',root).disabled=true;}catch(e){toast(`选择 JSON 失败：${e.message}`,'error');}};
    $('#xz-json-run',root).onclick=async()=>{try{const j=JSON.parse(await presetState.file.text());if(!Array.isArray(j.prompts)||!Array.isArray(j.prompt_order))throw new Error('不是包含 prompts 与 prompt_order 的 Preset JSON');const order=j.prompt_order.map(x=>String(x?.identifier??x??''));const byId=new Map();for(const p of j.prompts){const id=String(p?.identifier??'');if(!byId.has(id))byId.set(id,p);}const used=new Set(),reordered=[];for(const id of order){if(byId.has(id)&&!used.has(id)){reordered.push(byId.get(id));used.add(id);}}for(const p of j.prompts){const id=String(p?.identifier??'');if(!used.has(id)){reordered.push(p);used.add(id);}}j.prompts=reordered;presetState.result=new Blob([JSON.stringify(j,null,4)],{type:'application/json'});$('#xz-json-status',root).textContent=`✓ 整理完成　共发现 ${j.prompts.length} 个提示词条目　已按 Preset 排序重新排列`,$('#xz-json-export',root).disabled=false;}catch(e){console.error(e);toast(`Preset 整理失败：${e.message}`,'error');}};
    $('#xz-json-export',root).onclick=()=>presetState.result&&exportBlob(presetState.result,presetState.name,'application/json').catch(e=>toast(`导出失败：${e.message}`,'error'));
  }

  async function init(){try{await hostReady();}catch(_){}mountUI();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
