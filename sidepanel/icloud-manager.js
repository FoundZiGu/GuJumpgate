(function attachSidepanelIcloudManager(globalScope) {
  function createIcloudManager(context = {}) {
    const {
      dom,
      helpers,
      runtime,
    } = context;

    let refreshQueued = false;
    let renderedAliases = [];
    let selectedEmails = new Set();
    let searchTerm = '';
    let filterMode = 'all';

    function normalizeIcloudSearchText(value) {
      return String(value || '').trim().toLowerCase();
    }

    function getFilteredIcloudAliases(aliases = renderedAliases) {
      const normalizedSearchTerm = normalizeIcloudSearchText(searchTerm);
      return (Array.isArray(aliases) ? aliases : []).filter((alias) => {
        const matchesFilter = (() => {
          switch (filterMode) {
            case 'active': return Boolean(alias.active);
            case 'used': return Boolean(alias.used);
            case 'unused': return !alias.used;
            case 'preserved': return Boolean(alias.preserved);
            default: return true;
          }
        })();

        if (!matchesFilter) return false;
        if (!normalizedSearchTerm) return true;

        const haystack = [
          alias.email,
          alias.label,
          alias.note,
          alias.used ? 'Đã dùng used' : 'chưa dùng unused',
          alias.active ? 'Có thể dùng active' : '不Có thể dùng inactive',
          alias.preserved ? 'Giữ lại preserved' : '',
        ].join(' ').toLowerCase();

        return haystack.includes(normalizedSearchTerm);
      });
    }

    function pruneIcloudSelection(aliases = renderedAliases) {
      const existing = new Set((Array.isArray(aliases) ? aliases : []).map((alias) => alias.email));
      selectedEmails = new Set([...selectedEmails].filter((email) => existing.has(email)));
    }

    function updateIcloudBulkUI(visibleAliases = getFilteredIcloudAliases()) {
      if (!dom.checkboxIcloudSelectAll || !dom.icloudSelectionSummary) {
        return;
      }

      const visibleEmails = visibleAliases.map((alias) => alias.email);
      const selectedVisibleCount = visibleEmails.filter((email) => selectedEmails.has(email)).length;
      const hasVisible = visibleEmails.length > 0;

      dom.checkboxIcloudSelectAll.checked = hasVisible && selectedVisibleCount === visibleEmails.length;
      dom.checkboxIcloudSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleEmails.length;
      dom.checkboxIcloudSelectAll.disabled = !hasVisible;
      dom.icloudSelectionSummary.textContent = `已选 ${selectedEmails.size} 个（当前显示 ${visibleEmails.length} 个）`;

      const hasSelection = selectedEmails.size > 0;
      if (dom.btnIcloudBulkUsed) dom.btnIcloudBulkUsed.disabled = !hasSelection;
      if (dom.btnIcloudBulkUnused) dom.btnIcloudBulkUnused.disabled = !hasSelection;
      if (dom.btnIcloudBulkPreserve) dom.btnIcloudBulkPreserve.disabled = !hasSelection;
      if (dom.btnIcloudBulkUnpreserve) dom.btnIcloudBulkUnpreserve.disabled = !hasSelection;
      if (dom.btnIcloudBulkDelete) dom.btnIcloudBulkDelete.disabled = !hasSelection;
    }

    function setIcloudLoadingState(loading, summary = '') {
      if (dom.btnIcloudRefresh) dom.btnIcloudRefresh.disabled = loading;
      if (dom.btnIcloudDeleteUsed) dom.btnIcloudDeleteUsed.disabled = loading;
      if (dom.btnIcloudLoginDone) dom.btnIcloudLoginDone.disabled = loading;
      if (dom.inputIcloudSearch) dom.inputIcloudSearch.disabled = loading;
      if (dom.selectIcloudFilter) dom.selectIcloudFilter.disabled = loading;
      if (dom.checkboxIcloudSelectAll) dom.checkboxIcloudSelectAll.disabled = loading || getFilteredIcloudAliases().length === 0;
      if (dom.btnIcloudBulkUsed) dom.btnIcloudBulkUsed.disabled = loading || selectedEmails.size === 0;
      if (dom.btnIcloudBulkUnused) dom.btnIcloudBulkUnused.disabled = loading || selectedEmails.size === 0;
      if (dom.btnIcloudBulkPreserve) dom.btnIcloudBulkPreserve.disabled = loading || selectedEmails.size === 0;
      if (dom.btnIcloudBulkUnpreserve) dom.btnIcloudBulkUnpreserve.disabled = loading || selectedEmails.size === 0;
      if (dom.btnIcloudBulkDelete) dom.btnIcloudBulkDelete.disabled = loading || selectedEmails.size === 0;
      if (summary && dom.icloudSummary) dom.icloudSummary.textContent = summary;
    }

    function showIcloudLoginHelp(payload = {}) {
      if (!dom.icloudLoginHelp) return;
      const loginUrl = String(payload.loginUrl || '').trim();
      let host = 'icloud.com.cn / icloud.com';
      if (loginUrl) {
        try {
          host = new URL(loginUrl).host;
        } catch {
          host = loginUrl;
        }
      }
      if (dom.icloudLoginHelpTitle) dom.icloudLoginHelpTitle.textContent = 'Cần đăng nhập iCloud';
      if (dom.icloudLoginHelpText) dom.icloudLoginHelpText.textContent = `我已经为你打开 ${host}。请在那个页面完Thành công登录，然后回到这里点击“我已登录”。`;
      dom.icloudLoginHelp.style.display = 'flex';
    }

    function hideIcloudLoginHelp() {
      if (dom.icloudLoginHelp) {
        dom.icloudLoginHelp.style.display = 'none';
      }
    }

    function renderIcloudAliases(aliases = []) {
      if (!dom.icloudList || !dom.icloudSummary) return;

      renderedAliases = Array.isArray(aliases) ? aliases : [];
      pruneIcloudSelection(renderedAliases);
      dom.icloudList.innerHTML = '';

      if (!aliases.length) {
        selectedEmails.clear();
        dom.icloudList.innerHTML = '<div class="icloud-empty">Không tìm thấy alias iCloud Hide My Email.</div>';
        dom.icloudSummary.textContent = 'Tải alias iCloud Hide My Email của bạn để quản lý tại đây.';
        if (dom.btnIcloudDeleteUsed) dom.btnIcloudDeleteUsed.disabled = true;
        updateIcloudBulkUI([]);
        return;
      }

      const usedCount = aliases.filter((alias) => alias.used).length;
      const deletableUsedCount = aliases.filter((alias) => alias.used && !alias.preserved).length;
      dom.icloudSummary.textContent = `已加载 ${aliases.length} 个别名，其中 ${usedCount} 个已Đánh dấu là đã dùng。`;
      if (dom.btnIcloudDeleteUsed) dom.btnIcloudDeleteUsed.disabled = deletableUsedCount === 0;

      const visibleAliases = getFilteredIcloudAliases(aliases);
      if (!visibleAliases.length) {
        dom.icloudList.innerHTML = '<div class="icloud-empty">Không có alias nào khớp bộ lọc hiện tại.</div>';
        updateIcloudBulkUI([]);
        return;
      }

      for (const alias of visibleAliases) {
        const item = document.createElement('div');
        item.className = 'icloud-item';
        item.innerHTML = `
          <input class="icloud-item-check" type="checkbox" data-action="select" ${selectedEmails.has(alias.email) ? 'checked' : ''} />
          <div class="icloud-item-main">
            <div class="icloud-item-email">${helpers.escapeHtml(alias.email)}</div>
            <div class="icloud-item-meta">
              ${alias.used ? '<span class="icloud-tag used">Đã dùng</span>' : ''}
              ${!alias.used && alias.active ? '<span class="icloud-tag active">Có thể dùng</span>' : ''}
              ${alias.preserved ? '<span class="icloud-tag">Giữ lại</span>' : ''}
              ${alias.label ? `<span class="icloud-tag">${helpers.escapeHtml(alias.label)}</span>` : ''}
              ${alias.note ? `<span class="icloud-tag">${helpers.escapeHtml(alias.note)}</span>` : ''}
            </div>
          </div>
          <div class="icloud-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-used">${helpers.escapeHtml(alias.used ? 'Đánh dấu chưa dùng' : 'Đánh dấu đã dùng')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-preserved">${helpers.escapeHtml(alias.preserved ? 'Bỏ giữ lại' : 'Giữ lại')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">Xoá</button>
          </div>
        `;

        item.querySelector('[data-action="select"]').addEventListener('change', (event) => {
          if (event.target.checked) {
            selectedEmails.add(alias.email);
          } else {
            selectedEmails.delete(alias.email);
          }
          updateIcloudBulkUI(visibleAliases);
        });
        item.querySelector('[data-action="toggle-used"]').addEventListener('click', async () => {
          await setSingleIcloudAliasUsedState(alias, !alias.used);
        });
        item.querySelector('[data-action="toggle-preserved"]').addEventListener('click', async () => {
          await setSingleIcloudAliasPreservedState(alias, !alias.preserved);
        });
        item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          await deleteSingleIcloudAlias(alias);
        });
        dom.icloudList.appendChild(item);
      }

      updateIcloudBulkUI(visibleAliases);
    }

    async function refreshIcloudAliases(options = {}) {
      const { silent = false } = options;
      if (!dom.icloudSection || dom.icloudSection.style.display === 'none') {
        return;
      }

      if (!silent) setIcloudLoadingState(true, 'Đang tải alias iCloud...');
      try {
        const response = await runtime.sendMessage({
          type: 'LIST_ICLOUD_ALIASES',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) throw new Error(response.error);
        hideIcloudLoginHelp();
        renderIcloudAliases(response?.aliases || []);
      } catch (err) {
        selectedEmails.clear();
        if (dom.icloudList) {
          dom.icloudList.innerHTML = '<div class="icloud-empty">Không thể tải alias iCloud.</div>';
        }
        if (dom.icloudSummary) {
          dom.icloudSummary.textContent = err.message;
        }
        updateIcloudBulkUI([]);
        if (!silent) helpers.showToast(`iCloud 别名加载Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
      }
    }

    function queueIcloudAliasRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(async () => {
        refreshQueued = false;
        await refreshIcloudAliases({ silent: true });
      }, 150);
    }

    async function deleteSingleIcloudAlias(alias) {
      const confirmed = await helpers.openConfirmModal({
        title: 'Xoá iCloud 别名',
        message: `Xác nhận xoá ${alias.email} 吗？此操作不可撤销。`,
        confirmLabel: 'Xác nhận xoá',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      setIcloudLoadingState(true, `正在Xoá ${alias.email} ...`);
      try {
        const response = await runtime.sendMessage({
          type: 'DELETE_ICLOUD_ALIAS',
          source: 'sidepanel',
          payload: { email: alias.email, anonymousId: alias.anonymousId },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`已Xoá ${alias.email}`, 'success', 2200);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        if (dom.icloudSummary) dom.icloudSummary.textContent = err.message;
        helpers.showToast(`Xoá iCloud 别名Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
      }
    }

    async function setSingleIcloudAliasUsedState(alias, used) {
      setIcloudLoadingState(true, `正在更新 ${alias.email} 的使用状态...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_ICLOUD_ALIAS_USED_STATE',
          source: 'sidepanel',
          payload: { email: alias.email, used },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`${alias.email} 已${used ? 'Đánh dấu là đã dùng' : 'Khôi phục về chưa dùng'}`, 'success', 2200);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        if (dom.icloudSummary) dom.icloudSummary.textContent = err.message;
        helpers.showToast(`更新 iCloud 使用状态Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
      }
    }

    async function setSingleIcloudAliasPreservedState(alias, preserved) {
      setIcloudLoadingState(true, `正在更新 ${alias.email} 的Giữ lại状态...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_ICLOUD_ALIAS_PRESERVED_STATE',
          source: 'sidepanel',
          payload: { email: alias.email, preserved },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`${alias.email} 已${preserved ? '设为Giữ lại' : 'Bỏ giữ lại'}`, 'success', 2200);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        if (dom.icloudSummary) dom.icloudSummary.textContent = err.message;
        helpers.showToast(`更新 iCloud Giữ lại状态Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
      }
    }

    async function runBulkIcloudAction(action) {
      const selectedAliases = renderedAliases.filter((alias) => selectedEmails.has(alias.email));
      if (!selectedAliases.length) {
        updateIcloudBulkUI();
        return;
      }

      if (action === 'delete') {
        const confirmed = await helpers.openConfirmModal({
          title: '批量Xoá iCloud 别名',
          message: `Xác nhận xoá选中的 ${selectedAliases.length} 个 iCloud 别名吗？此操作不可撤销。`,
          confirmLabel: 'Xác nhận xoá',
          confirmVariant: 'btn-danger',
        });
        if (!confirmed) {
          return;
        }
      }

      const actionLabelMap = {
        used: 'Đánh dấu đã dùng',
        unused: 'Đánh dấu chưa dùng',
        preserve: 'Giữ lại',
        unpreserve: 'Bỏ giữ lại',
        delete: 'Xoá',
      };
      setIcloudLoadingState(true, `正在批量${actionLabelMap[action] || 'Xử lý'} iCloud 别名...`);

      try {
        for (const alias of selectedAliases) {
          let response = null;
          if (action === 'used' || action === 'unused') {
            response = await runtime.sendMessage({
              type: 'SET_ICLOUD_ALIAS_USED_STATE',
              source: 'sidepanel',
              payload: { email: alias.email, used: action === 'used' },
            });
          } else if (action === 'preserve' || action === 'unpreserve') {
            response = await runtime.sendMessage({
              type: 'SET_ICLOUD_ALIAS_PRESERVED_STATE',
              source: 'sidepanel',
              payload: { email: alias.email, preserved: action === 'preserve' },
            });
          } else if (action === 'delete') {
            response = await runtime.sendMessage({
              type: 'DELETE_ICLOUD_ALIAS',
              source: 'sidepanel',
              payload: { email: alias.email, anonymousId: alias.anonymousId },
            });
            selectedEmails.delete(alias.email);
          }

          if (response?.error) {
            throw new Error(response.error);
          }
        }

        helpers.showToast(`已批量${actionLabelMap[action] || 'Xử lý'} ${selectedAliases.length} 个 iCloud 别名`, 'success', 2400);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        if (dom.icloudSummary) dom.icloudSummary.textContent = err.message;
        helpers.showToast(`批量Xử lý iCloud 别名Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
        updateIcloudBulkUI();
      }
    }

    async function deleteUsedIcloudAliases() {
      const confirmed = await helpers.openConfirmModal({
        title: 'XoáĐã dùng iCloud 别名',
        message: 'Xác nhận xoá所有未Giữ lại的Đã dùng iCloud 别名吗？此操作不可撤销。',
        confirmLabel: 'Xác nhận xoá',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      setIcloudLoadingState(true, '正在XoáĐã dùng iCloud 别名...');
      try {
        const response = await runtime.sendMessage({
          type: 'DELETE_USED_ICLOUD_ALIASES',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) throw new Error(response.error);
        const deleted = response?.deleted || [];
        const skipped = response?.skipped || [];
        helpers.showToast(`已Xoá ${deleted.length} 个Đã dùng别名，跳过 ${skipped.length} 个`, skipped.length ? 'warn' : 'success', 2800);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        if (dom.icloudSummary) dom.icloudSummary.textContent = err.message;
        helpers.showToast(`XoáĐã dùng iCloud 别名Thất bại：${err.message}`, 'error');
      } finally {
        setIcloudLoadingState(false);
      }
    }

    function isLikelyIcloudLoginRequiredMessage(message = '') {
      const lower = String(message || '').toLowerCase();
      return lower.includes('请先在新打开的 icloud 页面中完Thành công登录')
        || lower.includes('Hãy đăng nhập trước trên trình duyệt hiện tại')
        || lower.includes('Cần đăng nhập trước')
        || lower.includes('Hãy đăng nhập trước')
        || lower.includes('please sign in')
        || lower.includes('sign in required')
        || lower.includes('not logged in')
        || lower.includes('authentication required')
        || lower.includes('unauthenticated');
    }

    async function handleLoginDone() {
      if (dom.btnIcloudLoginDone) {
        dom.btnIcloudLoginDone.disabled = true;
      }
      try {
        const response = await runtime.sendMessage({
          type: 'CHECK_ICLOUD_SESSION',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) {
          throw new Error(response.error);
        }
        hideIcloudLoginHelp();
        helpers.showToast('Phiên iCloud đã được khôi phục, danh sách alias đã được làm mới.', 'success', 2600);
        await refreshIcloudAliases({ silent: true });
      } catch (err) {
        const errorMessage = String(err?.message || 'Lỗi không xác định');
        if (isLikelyIcloudLoginRequiredMessage(errorMessage)) {
          helpers.showToast(`看起来还没有登录完Thành công：${errorMessage}`, 'warn', 4200);
          return;
        }

        await refreshIcloudAliases({ silent: true }).catch(() => { });
        helpers.showToast(`iCloud 会话校验Thất bại（非登录态）：${errorMessage}`, 'warn', 4200);
      } finally {
        if (dom.btnIcloudLoginDone) {
          dom.btnIcloudLoginDone.disabled = false;
        }
      }
    }

    function reset() {
      selectedEmails.clear();
      renderedAliases = [];
      searchTerm = '';
      filterMode = 'all';
      refreshQueued = false;
      if (dom.inputIcloudSearch) dom.inputIcloudSearch.value = '';
      if (dom.selectIcloudFilter) dom.selectIcloudFilter.value = 'all';
      if (dom.icloudList) dom.icloudList.innerHTML = '';
      if (dom.icloudSummary) dom.icloudSummary.textContent = 'Tải alias iCloud Hide My Email của bạn để quản lý tại đây.';
      updateIcloudBulkUI([]);
      hideIcloudLoginHelp();
    }

    function hasDeletableUsedAliases() {
      return renderedAliases.some((alias) => alias.used && !alias.preserved);
    }

    function bindIcloudEvents() {
      dom.btnIcloudRefresh?.addEventListener('click', async () => {
        await refreshIcloudAliases();
      });

      dom.btnIcloudDeleteUsed?.addEventListener('click', async () => {
        await deleteUsedIcloudAliases();
      });

      dom.inputIcloudSearch?.addEventListener('input', () => {
        searchTerm = dom.inputIcloudSearch.value || '';
        renderIcloudAliases(renderedAliases);
      });

      dom.selectIcloudFilter?.addEventListener('change', () => {
        filterMode = dom.selectIcloudFilter.value || 'all';
        renderIcloudAliases(renderedAliases);
      });

      dom.checkboxIcloudSelectAll?.addEventListener('change', () => {
        const visibleAliases = getFilteredIcloudAliases();
        if (dom.checkboxIcloudSelectAll.checked) {
          visibleAliases.forEach((alias) => selectedEmails.add(alias.email));
        } else {
          visibleAliases.forEach((alias) => selectedEmails.delete(alias.email));
        }
        renderIcloudAliases(renderedAliases);
      });

      dom.btnIcloudBulkUsed?.addEventListener('click', async () => {
        await runBulkIcloudAction('used');
      });

      dom.btnIcloudBulkUnused?.addEventListener('click', async () => {
        await runBulkIcloudAction('unused');
      });

      dom.btnIcloudBulkPreserve?.addEventListener('click', async () => {
        await runBulkIcloudAction('preserve');
      });

      dom.btnIcloudBulkUnpreserve?.addEventListener('click', async () => {
        await runBulkIcloudAction('unpreserve');
      });

      dom.btnIcloudBulkDelete?.addEventListener('click', async () => {
        await runBulkIcloudAction('delete');
      });

      dom.btnIcloudLoginDone?.addEventListener('click', handleLoginDone);
    }

    return {
      bindIcloudEvents,
      hideIcloudLoginHelp,
      hasDeletableUsedAliases,
      queueIcloudAliasRefresh,
      refreshIcloudAliases,
      renderIcloudAliases,
      reset,
      showIcloudLoginHelp,
      updateIcloudBulkUI,
    };
  }

  globalScope.SidepanelIcloudManager = {
    createIcloudManager,
  };
})(window);
