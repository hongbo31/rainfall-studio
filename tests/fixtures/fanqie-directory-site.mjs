const homePath = '/creator/music/home';
const formPath = '/creator/music/finished/ugc/uploadProduct';

function radio(index, field, options) {
  return options.map((option, i) => `<label><input type="radio" name="${index}_${field}" ${i === 0 ? 'checked' : ''}>${option}</label>`).join('');
}

function songCard(index, nestedCover, showAttributes) {
  const field = (key, label, body, hidden = false) => `<div class="arco-form-item"${hidden ? ' hidden' : ''}><label for="songs_${index}_${key}_input">${label}</label>${body}</div>`;
  const upload = (key, label, role, suffix = '') => {
    const nested = role === 'cover' && nestedCover && suffix;
    const id = `songs_${index}_${key}`;
    const caption = role === 'proof' ? '<a href="/fixture-proof-guide" target="_blank">歌曲版权证明材料提交指南</a>' : '选择文件';
    const trigger = role === 'cover' ? '<div class="image-upload-input-btn">上传封面</div>' :
      `<div class="upload-input-container-Xm4c1M"><div class="upload-input-icon-container-L26gsB">+</div>${caption}</div>`;
    const transfer = `<div id="${nested ? id : id + suffix}" data-transfer="${role}">${trigger}</div>`;
    return field(key, label, nested ? `<div id="${id}${suffix}">${transfer}</div>` : transfer);
  };
  const credit = (key, label) => field(key, label, `<div data-credit="${key}"><div role="combobox"><input placeholder="搜索或选择艺人"></div></div>`);
  return `<section data-index="${index}"><div class="song-item">
    <div class="song-header"><span class="name">歌曲${index + 1}: </span><svg class="delete-icon" width="24" height="24">
      <rect width="24" height="24"></rect></svg></div><div class="song-content">
    ${field('type', '音乐类型', radio(index, 'type', ['原创', '翻唱']))}
    ${showAttributes ? field('is_multi_version', '歌曲属性', radio(index, 'attribute', ['原版歌曲', '多版本歌曲'])) : ''}
    ${showAttributes ? field('master_product_id', '关联原作品', `<div class="multi-ver-song-search-selector"><div role="combobox" aria-controls="work-results-${index}"><input placeholder="请输入作品名称或作品ID搜索"></div></div>`, true) : ''}
    <label><input type="checkbox" data-instrumental>纯音乐</label>
    ${upload('songFile', '完整歌曲', 'audio')}${upload('lyricFile', '歌词', 'lyrics')}
    ${field('name', '作品名称', `<input id="songs_${index}_name_input" data-title>`)}
    ${credit('lyricist_id_list', '词作者')}${credit('composer_id_list', '曲作者')}
    ${field('originalSingers', '原唱', '<div class="arco-input-tag"><input placeholder="输入原唱后按回车键确认，最多10位"></div>', true)}
    ${credit('singer_id_list', '歌手')}
    ${upload('coverImage', '歌曲封面', 'cover', index === 0 ? '_input' : '')}
    ${field('ai_usage_type', '是否为AI作品', radio(index, 'ai', ['否', '是']))}
    ${upload('authorizationFiles', '版权证明', 'proof')}
  </div></div></section>`;
}

function renderEditor({artistNames, changeTitle, extraCard, mismatchedAudio, splitForms, nestedCover, wrongChooser, staleChooser,
  coverFailure, virtualized = false, extraVirtualCards = 0, tamperAfterNext = false, duplicateForm = false,
  noSongAttributes = false, duplicateOriginalWork = false, wrongResolvedWork = false, lazyRevisitedCovers = false,
  validationFailures = [], repeatValidation = false, confirmError = false, earlyAudioFailure = false}) {
  const add = '<button type="button" id="add" class="add-song-section"><span>点击添加歌曲</span></button>';
  const list = virtualized ? `<div id="viewport" style="height:420px;overflow:auto;contain:strict;overflow-anchor:none">
    <div id="songs" style="height:0px;width:100%;position:relative"></div><div>${add}</div></div>` : `<div id="songs"></div>${add}`;
  const templates = Array.from({length: Math.max(3, artistNames.length, 1 + extraVirtualCards)}, (_, index) =>
    songCard(index, index === 0 && nestedCover, !noSongAttributes)).join('');
  return `<div class="upload-form"><form>
    <p>上传歌曲信息 授权签约模式 预览合同协议</p>
    ${list}
    <button type="button" id="next" hidden>下一步</button>
  </form>${duplicateForm ? '<form><button type="button">点击添加歌曲</button></form>' : ''}</div>
  <template id="templates">${templates}</template>
  <script>
    const artistNames = ${JSON.stringify(artistNames)};
    const events = event => window.fixtureDirectoryEvent(event);
    const editor = document.querySelector('#songs');
    const viewport = document.querySelector('#viewport');
    const add = document.querySelector('#add');
    const next = document.querySelector('#next');
    const cards = [];
    let nextCardId = 0;
    const validationFailures = ${JSON.stringify(validationFailures)};
    const resetFields = new WeakMap();
    const validationMessages = {
      songFile: '请检查歌曲是否上传成功', lyricFile: '请上传歌词', name: '作品名称不能为空',
      lyricist_id_list: '请选择或添加词作者', composer_id_list: '请选择或添加曲作者',
      singer_id_list: '请选择或添加歌手', coverImage: '请上传封面图',
    };
    const updateHeader = card => {
      card.querySelector('.song-header .name').textContent = '歌曲' + (Number(card.dataset.index) + 1) + ': ' + card.querySelector('[data-title]').value;
    };
    const clearError = field => {
      field.classList.remove('arco-form-item-error', 'arco-form-item-status-error');
      field.querySelector('.arco-form-message')?.remove();
    };
    function rejectFields(index, fields) {
      const card = cards[index];
      for (const key of fields) {
        const field = card.querySelector('label[for="songs_' + index + '_' + key + '_input"]').closest('.arco-form-item');
        clearError(field);
        resetFields.get(card)[key]?.();
        field.classList.add('arco-form-item-error', 'arco-form-item-status-error');
        field.insertAdjacentHTML('beforeend', '<div class="arco-form-message"><div role="alert"></div></div>');
        field.querySelector('[role="alert"]').textContent = validationMessages[key];
      }
      if (viewport) {
        viewport.scrollTop = cards.slice(0, index).reduce((top, _, before) => top + rowHeight(before), 0);
        renderCards();
      }
    }
    const coverObserver = ${lazyRevisitedCovers} ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        const image = entry.target;
        if (!entry.isIntersecting || !image.isConnected) continue;
        image.src = image.dataset.coverSource;
        coverObserver.unobserve(image);
        events({kind: 'cover-visible', index: Number(image.closest('[data-index]').dataset.index)});
      }
    }, {root: viewport}) : null;
    const rowHeight = index => 740 + index % 3 * 197;
    function renderCards() {
      const heights = cards.map((_, index) => rowHeight(index));
      editor.style.height = heights.reduce((sum, height) => sum + height, 0) + 'px';
      const overscan = ${extraVirtualCards || tamperAfterNext ? 0 : 3};
      const wanted = [];
      let y = 0;
      for (const [index, card] of cards.entries()) {
        card.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:' + heights[index] + 'px;transform:translateY(' + y + 'px)';
        if (y + heights[index] > viewport.scrollTop - overscan * 740 && y < viewport.scrollTop + viewport.clientHeight + overscan * 740) {
          wanted.push(card);
        }
        y += heights[index];
      }
      for (const child of [...editor.children]) {
        if (wanted.includes(child)) continue;
        const image = child.querySelector('img[data-cover-source]');
        if (coverObserver && image) {
          coverObserver.unobserve(image);
          image.removeAttribute('src');
        }
        child.remove();
      }
      for (const [index, card] of wanted.entries()) {
        if (editor.children[index] !== card) editor.insertBefore(card, editor.children[index] ?? null);
        const preview = card.querySelector('img[data-cover-source]:not([src])');
        if (preview) coverObserver?.observe(preview);
      }
      return wanted.map(card => Number(card.dataset.index));
    }
    viewport?.addEventListener('scroll', () => events({kind: 'viewport', mounted: renderCards()}));
    const dialog = (title, body, arco = false) => {
      const node = document.createElement('div');
      if (arco) node.className = 'arco-modal';
      else { node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', title); }
      node.innerHTML = body;
      document.body.append(node);
      return node;
    };
    const accept = {audio: '.wav,.mp3', lyrics: '.txt', cover: 'image/png, image/jpeg', proof: '.zip,.jpeg,.jpg,.png,.bmp,.pdf'};
    // The official shared uploader creates a fresh, off-screen input under body during the click.
    function selectFile(role, receive) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept[role];
      input.multiple = role !== 'cover';
      input.style.cssText = 'position:absolute;left:-9999px';
      document.body.append(input);
      input.addEventListener('change', () => {
        input.remove();
        return receive([...input.files]);
      }, {once: true});
      input.click();
    }
    const staleInput = document.createElement('input');
    staleInput.type = 'file';
    staleInput.accept = accept.audio;
    staleInput.hidden = true;
    staleInput.onchange = () => events({kind: 'wrong-file'});
    document.body.append(staleInput);
    function addCard(index) {
      const card = document.querySelector('#templates').content.children[index].cloneNode(true);
      const cardId = nextCardId++;
      cards.push(card);
      const reset = {};
      resetFields.set(card, reset);
      card.querySelector('.song-header .delete-icon').onclick = () => {
        if (cards.length <= 1) return events({kind: 'minimum-one'});
        const removal = dialog('温馨提示', '<div class="arco-modal-title">温馨提示</div><p>删除后，歌曲和编辑的内容都将被删除</p><button type="button">确认删除</button>', true);
        removal.querySelector('button').onclick = async () => {
          const position = cards.indexOf(card);
          await events({kind: 'delete', index: position, title: title.value});
          cards.splice(position, 1);
          card.remove();
          for (const [newIndex, retained] of cards.entries()) {
            retained.dataset.index = newIndex;
            for (const control of retained.querySelectorAll('[id^="songs_"],label[for^="songs_"]')) {
              const attribute = control.tagName === 'LABEL' ? 'for' : 'id';
              control.setAttribute(attribute, control.getAttribute(attribute).replace(/^songs_\\d+_/u, 'songs_' + newIndex + '_'));
            }
            updateHeader(retained);
          }
          removal.remove();
          if (viewport) renderCards();
        };
      };
      const title = card.querySelector('[data-title]');
      reset.name = () => { title.value = ''; updateHeader(card); };
      title.oninput = () => {
        updateHeader(card);
        clearError(title.closest('.arco-form-item'));
        return events({kind: 'title', index: Number(card.dataset.index), name: title.value});
      };
      const pure = card.querySelector('[data-instrumental]');
      pure.onchange = () => {
        card.querySelector('[data-transfer="lyrics"]').parentElement.hidden = pure.checked;
        card.querySelector('[data-credit="lyricist_id_list"]').parentElement.hidden = pure.checked;
        return events({kind: 'instrumental', index, value: pure.checked});
      };
      const originalSinger = card.querySelector('.arco-input-tag');
      const relation = card.querySelector('.multi-ver-song-search-selector');
      for (const vote of card.querySelectorAll('input[type="radio"]')) {
        const kind = vote.name.split('_')[1];
        vote.name = cardId + '_' + kind;
        vote.onchange = () => {
          const value = vote.parentElement.textContent;
          if (kind === 'type') originalSinger.parentElement.hidden = value !== '翻唱';
          if (kind === 'attribute') relation.parentElement.hidden = value !== '多版本歌曲';
          return events({kind, index, value});
        };
      }
      const originalInput = originalSinger.querySelector('input');
      originalInput.onkeydown = event => {
        if (event.key !== 'Enter' || !originalInput.value) return;
        event.preventDefault();
        const tag = document.createElement('div');
        tag.className = 'arco-tag arco-input-tag-tag';
        tag.innerHTML = '<span class="arco-tag-content"></span>';
        tag.title = tag.firstChild.textContent = originalInput.value;
        originalSinger.prepend(tag);
        originalInput.value = '';
        originalInput.placeholder = '';
        return events({kind: 'original-singer', index, value: tag.title});
      };
      const relationInput = relation?.querySelector('input');
      if (relationInput) relationInput.oninput = () => {
        document.getElementById('work-results-' + index)?.remove();
        const popup = document.createElement('div');
        popup.id = 'work-results-' + index;
        popup.className = 'arco-select-popup-inner multi-ver-dropdown';
        popup.setAttribute('role', 'listbox');
        const exactId = '246813579012345678';
        const results = [exactId + '0', exactId];
        if (${duplicateOriginalWork}) results.push(exactId);
        for (const id of results) {
          const option = document.createElement('div');
          option.setAttribute('role', 'option');
          option.innerHTML = '<div class="multi-ver-song-option-card"><div>同名作品</div><div>作品ID：' + id + '</div></div>';
          option.onclick = () => {
            popup.remove();
            const combo = relationInput.parentElement;
            combo.classList.add('multi-ver-song-selector-select');
            combo.insertAdjacentHTML('beforeend', option.innerHTML);
            if (${wrongResolvedWork}) relation.insertAdjacentHTML('beforeend', '<div class="multi-ver-trace-tip">已关联对应原版歌曲：另一首（ID：78901234）</div>');
            relationInput.value = '';
            return events({kind: 'original-work', index, value: id});
          };
          popup.append(option);
        }
        document.body.append(popup);
      };
      for (const credit of card.querySelectorAll('[data-credit]')) {
        const field = credit.querySelector('input');
        const combo = credit.firstElementChild;
        const role = credit.dataset.credit;
        reset[role] = () => { field.value = ''; credit.replaceChildren(combo); };
        let interacted = false;
        field.onclick = () => { interacted = true; };
        field.oninput = () => {
          if (index > 0 && !interacted) return;
          const menu = document.createElement('div');
          menu.className = 'arco-select-popup-inner';
          const artist = artistNames.find(credits => credits[role] === field.value)?.[role] ?? artistNames[index]?.[role];
          for (const [name, exact, visible] of [[artist + '合作', false, true], [artist, false, false], [artist, true, true]]) {
            const item = document.createElement(index === 0 ? 'div' : 'label');
            if (index === 0) item.setAttribute('role', 'option');
            item.hidden = !visible;
            const span = document.createElement('span');
            span.textContent = name;
            item.append(span);
            item.onclick = () => {
              menu.remove();
              const details = dialog('艺人详情', '<p></p><button type="button">确认选择</button>');
              details.querySelector('p').textContent = name;
              details.querySelector('button').onclick = async () => {
                await events({kind: exact ? 'credit' : 'wrong-credit', index: Number(card.dataset.index), role, name});
                const tag = document.createElement('span');
                tag.className = 'arco-tag-content';
                tag.innerHTML = '<span class="name"></span>';
                tag.firstChild.textContent = name;
                credit.replaceChildren(tag);
                clearError(credit.closest('.arco-form-item'));
                details.remove();
              };
            };
            menu.append(item);
          }
          document.body.append(menu);
        };
      }
      for (const region of card.querySelectorAll('[data-transfer]')) {
        const role = region.dataset.transfer;
        const key = {lyrics: 'lyricFile', cover: 'coverImage'}[role];
        const trigger = region.firstElementChild;
        if (key) reset[key] = () => region.replaceChildren(trigger);
        region.querySelector('a')?.addEventListener('click', event => event.stopPropagation());
        const receive = async (field, files) => {
          await events({kind: 'file', index, role: field, titleAtTransfer: title.value, files: await Promise.all(files.map(async file => ({
            name: file.name,
            sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join(''),
          })))});
          if (field !== role) return;
          if (role === 'cover') {
            const crop = dialog('裁剪图片 (1/1)', '<div class="arco-modal-title">裁剪图片 (1/1)</div><button type="button">确定</button>', index === 0);
            crop.querySelector('button').onclick = async () => {
              await events({kind: 'crop', index});
              const local = URL.createObjectURL(files[0]);
              region.innerHTML = '<div class="upload-img-item"><div class="upload-img-item-mask">上传中...</div><img></div>';
              const image = region.querySelector('img');
              image.src = local;
              crop.remove();
              setTimeout(async () => {
                URL.revokeObjectURL(local);
                if (${JSON.stringify(coverFailure)}) {
                  region.querySelector('.upload-img-item-mask').innerHTML = '<span>上传失败</span>';
                  return;
                }
                image.src = '/fixture-cover.png?card=' + cardId;
                if (coverObserver) {
                  image.dataset.coverSource = image.src;
                  image.width = image.height = 120;
                }
                await events({kind: 'receipt', index, role});
                region.querySelector('.upload-img-item-mask').remove();
                clearError(region.closest('.arco-form-item'));
              }, 650);
            };
            return;
          }
          const file = files[0];
          if (role !== 'proof') region.replaceChildren();
          region.insertAdjacentHTML('beforeend', '<div class="upload-list-item-StKdwQ"><div class="main-detail-info-content-x7M"><span class="main-detail-info-content-name-guA"></span><span class="main-detail-info-content-status-yk0USs">上传中</span></div></div>');
          const name = region.querySelector('[class^="main-detail-info-content-name-"]');
          const status = region.querySelector('[class^="main-detail-info-content-status-"]');
          const filename = role === 'audio' && index === 0 ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name;
          name.textContent = ${JSON.stringify(mismatchedAudio)} && role === 'audio' ? filename + '错' : filename;
          if (role === 'audio' && !${JSON.stringify(mismatchedAudio)}) {
            title.addEventListener('input', () => { name.textContent = title.value; }, {once: true});
          }
          setTimeout(async () => {
            const format = role === 'audio' || role === 'proof' ? file.name.split('.').pop().toUpperCase() + '｜' : '';
            await events({kind: 'receipt', index, role});
            if (${earlyAudioFailure} && role === 'audio' && cardId === 0) {
              status.textContent = format + '上传失败';
              rejectFields(index, ['songFile']);
              return;
            }
            status.innerHTML = format + '<span class="success-message-LvAGEz">上传完成</span>｜' + file.size.toFixed(1) + 'B';
            clearError(region.closest('.arco-form-item'));
          }, 100);
        };
        region.firstElementChild.onclick = () => {
          if (${JSON.stringify(staleChooser)} && role === 'audio') return staleInput.click();
          const field = ${JSON.stringify(wrongChooser)} && role === 'audio' ? 'lyrics' : role;
          selectFile(field, files => receive(field, files));
        };
      }
      if (!viewport) editor.append(card);
      return card;
    }
    add.onclick = async () => {
      const index = cards.length;
      await events({kind: 'add', index});
      const card = addCard(index);
      if (${JSON.stringify(extraCard)} && index === 0) addCard(1);
      if (index === 0) for (let extra = 1; extra <= ${extraVirtualCards}; extra++) addCard(extra);
      if (${JSON.stringify(splitForms)} && index === 1) {
        const separateForm = document.createElement('form');
        separateForm.append(card);
        document.body.append(separateForm);
      }
      if (viewport) renderCards();
      next.hidden = false;
    };
    let nextAttempts = 0;
    next.onclick = async () => {
      await events({kind: 'next'});
      if (validationFailures.length && (nextAttempts++ === 0 || ${repeatValidation})) {
        for (const {index, fields} of validationFailures) rejectFields(index, fields);
        return;
      }
      if (${tamperAfterNext}) cards[0].querySelector('[data-title]').value = '被修改的第一首歌曲';
      const confirmation = dialog('是否确认上传成品', '<button type="button">确认上传</button>');
      confirmation.querySelector('button').onclick = async () => {
        await events({kind: 'confirm'});
        if (${confirmError}) {
          confirmation.remove();
          document.body.insertAdjacentHTML('beforeend', '<div class="arco-message-error">作品信息提交失败</div>');
          return;
        }
        const titles = cards.map(card => card.querySelector('[data-title]').value);
        if (${JSON.stringify(changeTitle)}) titles[titles.length - 1] = '偏移的其他作品';
        document.body.innerHTML = '<h2>选择签约模式</h2><h3>授权信息·' + titles.length + '</h3><div class="auth-rights-list"></div><button id="sign">签署合同</button>';
        document.querySelector('#sign').onclick = () => events({kind: 'sign'});
        setTimeout(() => {
          for (const title of titles) {
            const item = document.createElement('div');
            item.className = 'auth-right-item';
            item.innerHTML = '<span class="song-name"></span>';
            item.firstChild.textContent = title;
            document.querySelector('.auth-rights-list').append(item);
          }
        }, 125);
      };
    };
  </script>`;
}

/** All requests are local, including the profile page used for identity checks. */
export async function installFanqieDirectorySite(context, options) {
  const events = [];
  const refused = [];
  const requests = [];
  await context.exposeBinding('fixtureDirectoryEvent', async (_source, event) => {
    events.push(event);
    await options.beforeEvent?.(event);
  });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'https://www.novelfm.com') {
      refused.push(request.url());
      return route.abort();
    }
    requests.push(url.pathname);
    if (url.pathname === '/fixture-cover.png') return route.fulfill({contentType: 'image/png', body: options.cover});
    let body;
    if (url.pathname === homePath) {
      body = `<div>发布作品</div><div>成品发行</div><div class="sidebar-menu"><div class="publish-works" id="sidebar"></div></div>
        <script>setTimeout(() => {
          const sidebar = document.querySelector('#sidebar');
          sidebar.innerHTML = '<div class="publish-works__title">发布作品</div>';
          sidebar.firstChild.onclick = () => location.href = '/creator/music/publishWorks';
        }, 40);</script>`;
    } else if (url.pathname === '/creator/music/publishWorks') {
      body = ['成品发行', '成品出售', '词曲出售'].map((title, index) => `
        <section class="release-info-container">
          <div><span>${title}</span><p>发布说明</p></div>
          <button onclick="location.href='${index === 0 ? formPath : '/fixture-wrong-release'}'"><span>发布作品</span></button>
        </section>`).join('');
    } else if (url.pathname === '/creator/music/account/profile') {
      body = `<div class="profile-desc"><span>UID</span><div>${options.account()}</div></div>`;
    } else if (url.pathname === formPath) {
      body = renderEditor(options);
    } else {
      refused.push(request.url());
      return route.abort();
    }
    return route.fulfill({contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8">' + body});
  });
  return {events, refused, requests};
}
