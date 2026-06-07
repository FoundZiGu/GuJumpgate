(function attachSidepanelCustomEmailPoolManager(globalScope) {
  function createCustomEmailPoolManager(context = {}) {
    const {
      dom,
      helpers,
      state,
      actions,
      constants = {},
    } = context;

    const copyIcon = constants.copyIcon || '';

    let renderedEntries = [];
    let selectedEntryIds = new Set();
    let searchTerm = '';
    let filterMode = 'all';
    let refreshQueued = false;
    let loading = false;

    function normalizeEmail(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function isValidEmail(value = '') {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
    }

    function createEntryId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return `custom-pool-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function normalizeEntry(rawEntry = {}) {
      const email = normalizeEmail(rawEntry?.email || '');
      if (!isValidEmail(email)) {
        return null;
      }

      return {
        id: String(rawEntry?.id || createEntryId()),
        email,
        enabled: rawEntry?.enabled !== undefined ? Boolean(rawEntry.enabled) : true,
        used: Boolean(rawEntry?.used),
        note: String(rawEntry?.note || '').trim(),
        lastUsedAt: Number.isFinite(Number(rawEntry?.lastUsedAt)) ? Number(rawEntry.lastUsedAt) : 0,
      };
    }

    function normalizeEntries(entries = []) {
      if (!Array.isArray(entries)) {
        return [];
      }

      const seenEmails = new Set();
      const normalized = [];
      for (const entry of entries) {
        const item = normalizeEntry(entry);
        if (!item) continue;
        if (seenEmails.has(item.email)) continue;
        seenEmails.add(item.email);
        normalized.push(item);
      }
      return normalized;
    }

    function withCurrentFlag(entries = renderedEntries) {
      const currentEmail = normalizeEmail(state.getCurrentEmail?.());
      return normalizeEntries(entries).map((entry) => ({
        ...entry,
        current: Boolean(currentEmail) && entry.email === currentEmail,
      }));
    }

    function normalizeSearchText(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function getFilteredEntries(entries = renderedEntries) {
      const normalizedSearchTerm = normalizeSearchText(searchTerm);
      return withCurrentFlag(entries).filter((entry) => {
        const matchesFilter = (() => {
          switch (filterMode) {
            case 'enabled': return Boolean(entry.enabled);
            case 'disabled': return !entry.enabled;
            case 'used': return Boolean(entry.used);
            case 'unused': return !entry.used;
            case 'current': return Boolean(entry.current);
            default: return true;
          }
        })();

        if (!matchesFilter) return false;
        if (!normalizedSearchTerm) return true;

        const haystack = [
          entry.email,
          entry.note,
          entry.enabled ? 'enabled Bật' : 'disabled ngừng dùng',
          entry.used ? 'used đã dùng' : 'unused chưa dùng',
          entry.current ? 'current hiện tại' : '',
        ].join(' ').toLowerCase();

        return haystack.includes(normalizedSearchTerm);
      });
    }

    function pruneSelection(entries = renderedEntries) {
      const existingIds = new Set(withCurrentFlag(entries).map((entry) => String(entry.id)));
      selectedEntryIds = new Set([...selectedEntryIds].filter((id) => existingIds.has(id)));
    }

    function updateBulkUi(visibleEntries = getFilteredEntries()) {
      if (!dom.checkboxCustomEmailPoolSelectAll || !dom.customEmailPoolSelectionSummary) {
        return;
      }

      const visibleIds = visibleEntries.map((entry) => String(entry.id));
      const selectedVisibleCount = visibleIds.filter((id) => selectedEntryIds.has(id)).length;
      const hasVisible = visibleIds.length > 0;
      const hasSelection = selectedEntryIds.size > 0;

      dom.checkboxCustomEmailPoolSelectAll.checked = hasVisible && selectedVisibleCount === visibleIds.length;
      dom.checkboxCustomEmailPoolSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
      dom.checkboxCustomEmailPoolSelectAll.disabled = loading || !hasVisible;
      dom.customEmailPoolSelectionSummary.textContent = `已选 ${selectedEntryIds.size} 个（当前显示 ${visibleIds.length} 个）`;

      if (dom.btnCustomEmailPoolBulkUsed) dom.btnCustomEmailPoolBulkUsed.disabled = loading || !hasSelection;
      if (dom.btnCustomEmailPoolBulkUnused) dom.btnCustomEmailPoolBulkUnused.disabled = loading || !hasSelection;
      if (dom.btnCustomEmailPoolBulkEnable) dom.btnCustomEmailPoolBulkEnable.disabled = loading || !hasSelection;
      if (dom.btnCustomEmailPoolBulkDisable) dom.btnCustomEmailPoolBulkDisable.disabled = loading || !hasSelection;
      if (dom.btnCustomEmailPoolBulkDelete) dom.btnCustomEmailPoolBulkDelete.disabled = loading || !hasSelection;
    }

    function setLoadingState(nextLoading, summary = '') {
      loading = Boolean(nextLoading);
      if (dom.btnCustomEmailPoolImport) dom.btnCustomEmailPoolImport.disabled = loading;
      if (dom.btnCustomEmailPoolRefresh) dom.btnCustomEmailPoolRefresh.disabled = loading;
      if (dom.btnCustomEmailPoolClearUsed) dom.btnCustomEmailPoolClearUsed.disabled = loading;
      if (dom.btnCustomEmailPoolDeleteAll) dom.btnCustomEmailPoolDeleteAll.disabled = loading;
      if (dom.inputCustomEmailPoolImport) dom.inputCustomEmailPoolImport.disabled = loading;

      if (summary && dom.customEmailPoolSummary) {
        dom.customEmailPoolSummary.textContent = summary;
      }

      updateBulkUi(getFilteredEntries());
    }

    function renderCustomEmailPoolEntries(entries = state.getEntries?.()) {
      if (!dom.customEmailPoolList || !dom.customEmailPoolSummary) {
        return;
      }

      renderedEntries = normalizeEntries(entries);
      pruneSelection(renderedEntries);
      dom.customEmailPoolList.innerHTML = '';

      if (!renderedEntries.length) {
        selectedEntryIds.clear();
        dom.customEmailPoolList.innerHTML = '<div class="luckmail-empty">Chưa có email tuỳ chỉnh, hãy nhập một lô email trước khi bắt đầu.</div>';
        dom.customEmailPoolSummary.textContent = 'Nhập các email đăng ký bạn đã chuẩn bị sẵn, mỗi dòng một địa chỉ email.';
        if (dom.btnCustomEmailPoolClearUsed) dom.btnCustomEmailPoolClearUsed.disabled = true;
        if (dom.btnCustomEmailPoolDeleteAll) dom.btnCustomEmailPoolDeleteAll.disabled = true;
        updateBulkUi([]);
        return;
      }

      const entriesWithCurrent = withCurrentFlag(renderedEntries);
      const usedCount = entriesWithCurrent.filter((entry) => entry.used).length;
      const enabledCount = entriesWithCurrent.filter((entry) => entry.enabled).length;
      dom.customEmailPoolSummary.textContent = `已加载 ${entriesWithCurrent.length} 个邮箱，其中 ${enabledCount} 个Bật，${usedCount} 个已Đánh dấu là đã dùng。`;
      if (dom.btnCustomEmailPoolClearUsed) dom.btnCustomEmailPoolClearUsed.disabled = loading || usedCount === 0;
      if (dom.btnCustomEmailPoolDeleteAll) dom.btnCustomEmailPoolDeleteAll.disabled = loading || entriesWithCurrent.length === 0;

      const visibleEntries = getFilteredEntries(entriesWithCurrent);
      if (!visibleEntries.length) {
        dom.customEmailPoolList.innerHTML = '<div class="luckmail-empty">Không có email nào khớp bộ lọc hiện tại.</div>';
        updateBulkUi([]);
        return;
      }

      for (const entry of visibleEntries) {
        const entryId = String(entry.id);
        const item = document.createElement('div');
        item.className = `luckmail-item${entry.current ? ' is-current' : ''}`;
        item.innerHTML = `
          <input class="luckmail-item-check" type="checkbox" data-action="select" ${selectedEntryIds.has(entryId) ? 'checked' : ''} />
          <div class="luckmail-item-main">
            <div class="luckmail-item-email-row">
              <div class="luckmail-item-email">${helpers.escapeHtml(entry.email || '(Email không xác định)')}</div>
              <button
                class="hotmail-copy-btn"
                type="button"
                data-action="copy-email"
                title="Sao chép email"
                aria-label="Sao chép email ${helpers.escapeHtml(entry.email || '')}"
              >${copyIcon}</button>
            </div>
            <div class="luckmail-item-meta">
              ${entry.current ? '<span class="luckmail-tag current">Hiện tại</span>' : ''}
              ${entry.used ? '<span class="luckmail-tag used">Đã dùng</span>' : '<span class="luckmail-tag active">Chưa dùng</span>'}
              ${entry.enabled ? '<span class="luckmail-tag active">Bật</span>' : '<span class="luckmail-tag disabled">Ngừng dùng</span>'}
              ${entry.note ? `<span class="luckmail-tag">${helpers.escapeHtml(entry.note)}</span>` : ''}
            </div>
          </div>
          <div class="luckmail-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="use">使用此邮箱</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-used">${helpers.escapeHtml(entry.used ? 'Đánh dấu chưa dùng' : 'Đánh dấu đã dùng')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-enabled">${helpers.escapeHtml(entry.enabled ? 'Dừng用' : 'Bật')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">Xoá</button>
          </div>
        `;

        item.querySelector('[data-action="select"]').addEventListener('change', (event) => {
          if (event.target.checked) {
            selectedEntryIds.add(entryId);
          } else {
            selectedEntryIds.delete(entryId);
          }
          updateBulkUi(visibleEntries);
        });

        item.querySelector('[data-action="copy-email"]').addEventListener('click', async () => {
          await helpers.copyTextToClipboard(entry.email || '');
          helpers.showToast('Đã sao chép email', 'success', 1600);
        });

        item.querySelector('[data-action="use"]').addEventListener('click', async () => {
          try {
            setLoadingState(true, 'Đang chuyển email hiện tại...');
            await actions.setRuntimeEmail?.(entry.email);
            helpers.showToast(`已切换到 ${entry.email}`, 'success', 1800);
            queueCustomEmailPoolRefresh();
          } catch (error) {
            helpers.showToast(`切换邮箱Thất bại：${error.message}`, 'error');
          } finally {
            setLoadingState(false);
          }
        });

        item.querySelector('[data-action="toggle-used"]').addEventListener('click', async () => {
          await patchEntries((entriesList) => entriesList.map((candidate) => (
            String(candidate.id) === entryId
              ? {
                  ...candidate,
                  used: !entry.used,
                  lastUsedAt: !entry.used ? Date.now() : candidate.lastUsedAt,
                }
              : candidate
          )));
        });

        item.querySelector('[data-action="toggle-enabled"]').addEventListener('click', async () => {
          await patchEntries((entriesList) => entriesList.map((candidate) => (
            String(candidate.id) === entryId
              ? { ...candidate, enabled: !entry.enabled }
              : candidate
          )));
        });

        item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          await deleteEntries({
            ids: [entry.id],
          }, `Xác nhận xoá ${entry.email} 吗？此操作不可撤销。`);
        });

        dom.customEmailPoolList.appendChild(item);
      }

      updateBulkUi(visibleEntries);
    }

    async function patchEntries(mutator) {
      const previousEntries = normalizeEntries(state.getEntries?.() || []);
      const nextEntries = normalizeEntries(mutator(previousEntries.map((entry) => ({ ...entry }))));

      setLoadingState(true, 'Đang cập nhật pool email tuỳ chỉnh...');
      state.setEntries?.(nextEntries);
      renderCustomEmailPoolEntries(nextEntries);

      try {
        await actions.persistEntries?.();
      } catch (error) {
        state.setEntries?.(previousEntries);
        renderCustomEmailPoolEntries(previousEntries);
        helpers.showToast(`更新自定义邮箱池Thất bại：${error.message}`, 'error');
      } finally {
        setLoadingState(false);
      }
    }

    async function deleteEntries(payload = {}, confirmMessage = '') {
      const confirmed = await helpers.openConfirmModal({
        title: 'Xoá邮箱',
        message: confirmMessage || 'Xác nhận xoá选中的邮箱吗？此操作不可撤销。',
        confirmLabel: 'Xác nhận xoá',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      const mode = String(payload.mode || '').trim().toLowerCase();

      await patchEntries((entriesList) => {
        if (mode === 'all') {
          selectedEntryIds.clear();
          return [];
        }
        if (mode === 'used') {
          const usedIds = new Set(entriesList.filter((entry) => entry.used).map((entry) => String(entry.id)));
          usedIds.forEach((id) => selectedEntryIds.delete(id));
          return entriesList.filter((entry) => !entry.used);
        }

        const targetIds = new Set(ids);
        ids.forEach((id) => selectedEntryIds.delete(id));
        return entriesList.filter((entry) => !targetIds.has(String(entry.id)));
      });
    }

    async function importEntriesFromTextarea() {
      const text = String(dom.inputCustomEmailPoolImport?.value || '');
      if (!text.trim()) {
        helpers.showToast('Hãy dán trước danh sách email, mỗi dòng một email.', 'warn');
        return;
      }

      const previousEntries = normalizeEntries(state.getEntries?.() || []);
      const knownEmails = new Set(previousEntries.map((entry) => entry.email));
      const importedEntries = [];
      let skippedCount = 0;

      for (const line of String(text || '').split(/[\r\n,，;；]+/)) {
        const email = normalizeEmail(line);
        if (!email) {
          continue;
        }
        if (!isValidEmail(email) || knownEmails.has(email)) {
          skippedCount += 1;
          continue;
        }

        knownEmails.add(email);
        importedEntries.push({
          id: createEntryId(),
          email,
          enabled: true,
          used: false,
          note: '',
          lastUsedAt: 0,
        });
      }

      if (!importedEntries.length && skippedCount > 0) {
        helpers.showToast('Không có email mới nào để nhập (có thể đều bị trùng hoặc không hợp lệ).', 'warn');
        return;
      }

      const nextEntries = normalizeEntries([...previousEntries, ...importedEntries]);
      setLoadingState(true, 'Đang nhập email...');
      state.setEntries?.(nextEntries);
      renderCustomEmailPoolEntries(nextEntries);

      try {
        await actions.persistEntries?.();
        if (dom.inputCustomEmailPoolImport) {
          dom.inputCustomEmailPoolImport.value = '';
        }
        helpers.showToast(
          skippedCount > 0
            ? `已导入 ${importedEntries.length} 个邮箱，跳过 ${skippedCount} 条无效或重复数据。`
            : `已导入 ${importedEntries.length} 个邮箱。`,
          importedEntries.length > 0 ? 'success' : 'warn',
          2400
        );
      } catch (error) {
        state.setEntries?.(previousEntries);
        renderCustomEmailPoolEntries(previousEntries);
        helpers.showToast(`导入邮箱Thất bại：${error.message}`, 'error');
      } finally {
        setLoadingState(false);
      }
    }

    async function refreshCustomEmailPoolEntries(options = {}) {
      const { silent = false } = options;
      if (state.isVisible && !state.isVisible()) {
        return;
      }

      if (!silent) {
        setLoadingState(true, 'Đang làm mới pool email tuỳ chỉnh...');
      }
      renderCustomEmailPoolEntries(state.getEntries?.());
      if (!silent) {
        setLoadingState(false);
      }
    }

    function queueCustomEmailPoolRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => {
        refreshQueued = false;
        refreshCustomEmailPoolEntries({ silent: true });
      }, 120);
    }

    function reset() {
      selectedEntryIds.clear();
      searchTerm = '';
      filterMode = 'all';
      if (dom.inputCustomEmailPoolSearch) dom.inputCustomEmailPoolSearch.value = '';
      if (dom.selectCustomEmailPoolFilter) dom.selectCustomEmailPoolFilter.value = 'all';
      if (dom.customEmailPoolList) {
        dom.customEmailPoolList.innerHTML = '';
      }
      if (dom.customEmailPoolSummary) {
        dom.customEmailPoolSummary.textContent = 'Nhập các email đăng ký bạn đã chuẩn bị sẵn, mỗi dòng một địa chỉ email.';
      }
      updateBulkUi([]);
    }

    function bindEvents() {
      dom.btnCustomEmailPoolRefresh?.addEventListener('click', async () => {
        await refreshCustomEmailPoolEntries();
      });

      dom.btnCustomEmailPoolImport?.addEventListener('click', async () => {
        await importEntriesFromTextarea();
      });

      dom.inputCustomEmailPoolImport?.addEventListener('keydown', async (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          await importEntriesFromTextarea();
        }
      });

      dom.inputCustomEmailPoolSearch?.addEventListener('input', (event) => {
        searchTerm = normalizeSearchText(event.target.value);
        renderCustomEmailPoolEntries(renderedEntries);
      });

      dom.selectCustomEmailPoolFilter?.addEventListener('change', (event) => {
        filterMode = String(event.target.value || 'all');
        renderCustomEmailPoolEntries(renderedEntries);
      });

      dom.checkboxCustomEmailPoolSelectAll?.addEventListener('change', (event) => {
        const visibleEntries = getFilteredEntries(renderedEntries);
        const visibleIds = visibleEntries.map((entry) => String(entry.id));
        if (event.target.checked) {
          visibleIds.forEach((id) => selectedEntryIds.add(id));
        } else {
          visibleIds.forEach((id) => selectedEntryIds.delete(id));
        }
        renderCustomEmailPoolEntries(renderedEntries);
      });

      dom.btnCustomEmailPoolBulkUsed?.addEventListener('click', async () => {
        const targetIds = new Set([...selectedEntryIds]);
        await patchEntries((entriesList) => entriesList.map((entry) => (
          targetIds.has(String(entry.id))
            ? { ...entry, used: true, lastUsedAt: entry.lastUsedAt || Date.now() }
            : entry
        )));
      });

      dom.btnCustomEmailPoolBulkUnused?.addEventListener('click', async () => {
        const targetIds = new Set([...selectedEntryIds]);
        await patchEntries((entriesList) => entriesList.map((entry) => (
          targetIds.has(String(entry.id))
            ? { ...entry, used: false }
            : entry
        )));
      });

      dom.btnCustomEmailPoolBulkEnable?.addEventListener('click', async () => {
        const targetIds = new Set([...selectedEntryIds]);
        await patchEntries((entriesList) => entriesList.map((entry) => (
          targetIds.has(String(entry.id))
            ? { ...entry, enabled: true }
            : entry
        )));
      });

      dom.btnCustomEmailPoolBulkDisable?.addEventListener('click', async () => {
        const targetIds = new Set([...selectedEntryIds]);
        await patchEntries((entriesList) => entriesList.map((entry) => (
          targetIds.has(String(entry.id))
            ? { ...entry, enabled: false }
            : entry
        )));
      });

      dom.btnCustomEmailPoolBulkDelete?.addEventListener('click', async () => {
        await deleteEntries({
          ids: [...selectedEntryIds],
        }, `Xác nhận xoá当前选中的 ${selectedEntryIds.size} 个邮箱吗？此操作不可撤销。`);
      });

      dom.btnCustomEmailPoolClearUsed?.addEventListener('click', async () => {
        await deleteEntries({
          mode: 'used',
        }, 'Xác nhận xoá当前所有Đã dùng邮箱吗？此操作不可撤销。');
      });

      dom.btnCustomEmailPoolDeleteAll?.addEventListener('click', async () => {
        await deleteEntries({
          mode: 'all',
        }, 'Xác nhận xoá toàn bộ email hiện tại? Thao tác này không thể hoàn tác.');
      });
    }

    return {
      bindEvents,
      queueCustomEmailPoolRefresh,
      refreshCustomEmailPoolEntries,
      renderCustomEmailPoolEntries,
      reset,
    };
  }

  globalScope.SidepanelCustomEmailPoolManager = {
    createCustomEmailPoolManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
