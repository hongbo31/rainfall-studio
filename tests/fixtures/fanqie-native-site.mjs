// Synthetic DOM shaped from the calibrated public form. Every URL is fulfilled locally.
// This is browser integration coverage, never evidence about a live official account.
const html = body => `<!doctype html><html lang="zh"><meta charset="utf-8"><body>${body}</body></html>`;
const formPath = '/creator/music/finished/ugc/uploadProduct';
const catalogPath = '/creator/music/finished/ugc';
export async function installFanqieNativeSite(context, {title, artist, accountId, cover, beforeEvent, countDelay = 0}) {
  const events = [], requests = [], failures = [];
  const rows = [{id:'1234567890123456789', title:'已有合成作品'}];
  await context.exposeBinding('fixtureEvent', async (_source, event) => {
    events.push(event); await beforeEvent?.(event);
    if (event.kind === 'confirm-upload') rows.push({id:'9876543210987654321',title});
  });
  const credit = (field, label) => `<div class="arco-form-item" data-credit="${field}"><label for="songs_0_${field}_input">${label}</label><input aria-label="搜索或选择艺人"></div>`;
  const file = (field, label, role) => `<div class="arco-form-item"><label for="songs_0_${field}_input">${label}</label><div id="songs_0_${field}"><button type="button" class="${role==='cover'?'image-upload-input-btn':'upload-input-container-Xm4c1M'}" data-file="${role}">选择文件</button><input type="file" data-role="${role}" ${role==='audio'?'multiple':''} hidden></div></div>`;
  const form = `<form><p>上传歌曲信息 授权签约模式 预览合同协议</p><div>歌曲1: </div>
    <div class="arco-form-item"><label for="songs_0_name_input">作品名称</label><input id="songs_0_name_input"></div>
    <div class="arco-form-item"><label for="songs_0_type_input">音乐类型</label><label><input type="radio" name="type" checked>原创</label></div>
    <div class="arco-form-item"><label for="songs_0_ai_usage_type_input">是否为AI作品</label><label><input type="radio" name="ai" value="yes">是</label><label><input type="radio" name="ai" value="no" checked>否</label></div>
    ${credit('lyricist_id_list','词作者')}${credit('composer_id_list','曲作者')}${credit('singer_id_list','歌手')}
    ${file('songFile','完整歌曲','audio')}${file('lyricFile','歌词','lyrics')}${file('coverImage','歌曲封面','cover')}
    <button type="button" id="next">下一步</button></form>`;
  const formScript = `<script>
    const artist=${JSON.stringify(artist)}, title=${JSON.stringify(title)};
    const event=value=>window.fixtureEvent(value);
    const modal=(name,body)=>{const el=document.createElement('div');el.setAttribute('role','dialog');el.setAttribute('aria-label',name);el.innerHTML=body;document.body.append(el);return el;};
    document.querySelectorAll('[data-credit]').forEach(region=>{
      region.querySelector('input').oninput=()=>{
        document.querySelectorAll('[role=option]').forEach(el=>el.remove());
        const option=document.createElement('div');option.setAttribute('role','option');option.textContent=artist;document.body.append(option);
        option.onclick=()=>{option.remove();const dialog=modal('艺人详情','<p>'+artist+'</p><button type="button">确认选择</button>');
          dialog.querySelector('button').onclick=async()=>{await event({kind:'credit',role:region.dataset.credit,name:artist});region.querySelector('input').remove();const tag=document.createElement('span');tag.className='arco-tag-content';tag.innerHTML='<span class="name">'+artist+'</span>';region.append(tag);dialog.remove();};};
      };
    });
    document.querySelectorAll('[data-file]').forEach(button=>{button.onclick=()=>button.nextElementSibling.click();});
    document.querySelectorAll('input[type=file]').forEach(input=>{input.onchange=async()=>{
      const selected=[...input.files], role=input.dataset.role, region=input.parentElement;
      await event({kind:'file',role,files:await Promise.all(selected.map(async file=>({name:file.name,size:file.size,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('')})))});
      if(role==='cover'){
        const dialog=modal('裁剪图片 (1/1)','<button type="button">确定</button>');
        dialog.querySelector('button').onclick=async()=>{await event({kind:'crop'});region.innerHTML='<img class="arco-image-img" src="/fixture-cover.png">';dialog.remove();};
      }else{
        const file=selected[0], size=file.size>=1048576?(file.size/1048576).toFixed(1)+'MB':(file.size/1024).toFixed(1)+'KB';
        region.innerHTML='';const first=document.createElement('div'),second=document.createElement('div');first.textContent=role==='audio'?document.querySelector('#songs_0_name_input').value:file.name;
        second.textContent=(role==='audio'?'WAV｜':'')+'上传完成｜'+size;region.append(first,second);
      }
    };});
    document.querySelector('#next').onclick=async()=>{
      await event({kind:'next'});const dialog=modal('是否确认上传成品','<button type="button">确认上传</button>');
      dialog.querySelector('button').onclick=async()=>{await event({kind:'confirm-upload'});document.body.innerHTML='<h2>选择签约模式</h2><h3>授权信息·1</h3><p>'+title+'</p><button id="sign">签署合同</button>';document.querySelector('#sign').onclick=()=>event({kind:'SIGN_FORBIDDEN'});};
    };
  </script>`;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); requests.push({method:request.method(),path:url.pathname});
    if(url.origin !== 'https://www.novelfm.com' || request.method() !== 'GET') {failures.push(request.url());return route.abort();}
    if(url.pathname === '/fixture-cover.png') return route.fulfill({contentType:'image/png',body:cover});
    let body;
    if(url.pathname === '/creator/music/account/profile') body=`<div class="profile-desc"><span>UID</span><div>${typeof accountId==='function'?accountId():accountId}</div></div>`;
    else if(url.pathname === '/creator/music/account/artist') body=`<input aria-label="请输入艺人名"><div class="artist-item"><div class="artist-name">${artist}</div><div>艺人ID：123456789</div></div>`;
    else if(url.pathname === '/creator/music/home') body=`<button id="release">发布作品</button><template><div class="release-info-container">成品发行<button onclick="location.href='${formPath}'">发布作品</button></div></template><script>document.querySelector('#release').onclick=()=>{document.querySelector('#release').remove();document.body.append(document.querySelector('template').content.cloneNode(true));};</script>`;
    else if(url.pathname === formPath) body=`<button id="add">点击添加歌曲</button><template>${form}</template><script>document.querySelector('#add').onclick=()=>{const template=document.querySelector('template');document.body.append(template.content.cloneNode(true));template.remove();document.querySelector('#add').remove();const script=document.createElement('script');script.textContent=${JSON.stringify(formScript.slice(8,-9))};document.body.append(script);};</script>`;
    else if(url.pathname === catalogPath) body=`<button role="tab" aria-selected="true" id="total">全部·${countDelay?0:rows.length}</button><input placeholder="请输入作品名称"><div role="tabpanel"><table><thead><tr>${['作品信息','作品状态','创建时间','上架时间','操作'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td><div>${row.title}</div><div>作品ID：${row.id}</div></td><td>待授权</td><td>2026-01-01</td><td>-</td><td>查看</td></tr>`).join('')}</tbody></table></div><script>setTimeout(()=>document.querySelector('#total').textContent='全部·${rows.length}',${countDelay});</script>`;
    else {failures.push(url.pathname);return route.abort();}
    if(url.pathname==='/creator/music/home')body='<span class="card-title-origin text-18 bold">发布作品</span>'+body.replace('<button id="release">发布作品</button>','<div class="sidebar-menu"><div class="publish-works"><div class="publish-works__title" id="release">发布作品</div></div></div>');
    return route.fulfill({contentType:'text/html; charset=utf-8',body:html(body)});
  });
  return {events,requests,failures,rows};
}
