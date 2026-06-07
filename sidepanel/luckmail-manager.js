(function attachSidepanelLuckmailManager(globalScope) {
  function createLuckmailManager(context = {}) {
    const {
      dom,
      helpers,
      runtime,
      constants = {},
    } = context;

    const copyIcon = constants.copyIcon || '';

    let renderedPurchases = [];
    let selectedPurchaseIds = new Set();
    let searchTerm = '';
    let filterMode = 'all';
    let refreshQueued = false;

    function normalizeLuckmailSearchText(value) {
      return String(value || '').trim().toLowerCase();
    }

    function getFilteredLuckmailPurchases(purchases = renderedPurchases) {
      const normalizedSearchTerm = normalizeLuckmailSearchText(searchTerm);
      return (Array.isArray(purchases) ? purchases : []).filter((purchase) => {
        const matchesFilter = (() => {
          switch (filterMode) {
            case 'reusable': return Boolean(purchase.reusable);
            case 'used': return Boolean(purchase.used);
            case 'unused': return !purchase.used;
            case 'preserved': return Boolean(purchase.preserved);
            case 'disabled': return Boolean(purchase.disabled);
            default: return true;
          }
        })();

        if (!matchesFilter) return false;
        if (!normalizedSearchTerm) return true;

        const haystack = [
          purchase.email_address,
          purchase.project_name,
          purchase.tag_name,
          purchase.used ? 'Đã dùng used' : 'chưa dùng unused',
          purchase.preserved ? 'Giữ lại preserved' : '',
          purchase.disabled ? '已Tắt disabled' : '',
          purchase.reusable ? 'có thể tái dùng reusable' : '',
        ].join(' ').toLowerCase();

        return haystack.includes(normalizedSearchTerm);
      });
    }

    function pruneLuckmailSelection(purchases = renderedPurchases) {
      const existingIds = new Set((Array.isArray(purchases) ? purchases : []).map((purchase) => String(purchase.id)));
      selectedPurchaseIds = new Set([...selectedPurchaseIds].filter((id) => existingIds.has(id)));
    }

    function updateLuckmailBulkUI(visiblePurchases = getFilteredLuckmailPurchases()) {
      if (!dom.checkboxLuckmailSelectAll || !dom.luckmailSelectionSummary) {
        return;
      }

      const visibleIds = visiblePurchases.map((purchase) => String(purchase.id));
      const selectedVisibleCount = visibleIds.filter((id) => selectedPurchaseIds.has(id)).length;
      const hasVisible = visibleIds.length > 0;
      const hasSelection = selectedPurchaseIds.size > 0;

      dom.checkboxLuckmailSelectAll.checked = hasVisible && selectedVisibleCount === visibleIds.length;
      dom.checkboxLuckmailSelectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
      dom.checkboxLuckmailSelectAll.disabled = !hasVisible;
      dom.luckmailSelectionSummary.textContent = `已选 ${selectedPurchaseIds.size} 个（当前显示 ${visibleIds.length} 个）`;

      if (dom.btnLuckmailBulkUsed) dom.btnLuckmailBulkUsed.disabled = !hasSelection;
      if (dom.btnLuckmailBulkUnused) dom.btnLuckmailBulkUnused.disabled = !hasSelection;
      if (dom.btnLuckmailBulkPreserve) dom.btnLuckmailBulkPreserve.disabled = !hasSelection;
      if (dom.btnLuckmailBulkUnpreserve) dom.btnLuckmailBulkUnpreserve.disabled = !hasSelection;
      if (dom.btnLuckmailBulkDisable) dom.btnLuckmailBulkDisable.disabled = !hasSelection;
      if (dom.btnLuckmailBulkEnable) dom.btnLuckmailBulkEnable.disabled = !hasSelection;
    }

    function setLuckmailLoadingState(loading, summary = '') {
      if (dom.btnLuckmailRefresh) dom.btnLuckmailRefresh.disabled = loading;
      if (dom.btnLuckmailDisableUsed) dom.btnLuckmailDisableUsed.disabled = loading;
      if (dom.inputLuckmailSearch) dom.inputLuckmailSearch.disabled = loading;
      if (dom.selectLuckmailFilter) dom.selectLuckmailFilter.disabled = loading;
      if (dom.checkboxLuckmailSelectAll) dom.checkboxLuckmailSelectAll.disabled = loading || getFilteredLuckmailPurchases().length === 0;
      if (dom.btnLuckmailBulkUsed) dom.btnLuckmailBulkUsed.disabled = loading || selectedPurchaseIds.size === 0;
      if (dom.btnLuckmailBulkUnused) dom.btnLuckmailBulkUnused.disabled = loading || selectedPurchaseIds.size === 0;
      if (dom.btnLuckmailBulkPreserve) dom.btnLuckmailBulkPreserve.disabled = loading || selectedPurchaseIds.size === 0;
      if (dom.btnLuckmailBulkUnpreserve) dom.btnLuckmailBulkUnpreserve.disabled = loading || selectedPurchaseIds.size === 0;
      if (dom.btnLuckmailBulkDisable) dom.btnLuckmailBulkDisable.disabled = loading || selectedPurchaseIds.size === 0;
      if (dom.btnLuckmailBulkEnable) dom.btnLuckmailBulkEnable.disabled = loading || selectedPurchaseIds.size === 0;
      if (summary && dom.luckmailSummary) {
        dom.luckmailSummary.textContent = summary;
      }
    }

    function renderLuckmailPurchases(purchases = renderedPurchases) {
      if (!dom.luckmailList || !dom.luckmailSummary) return;

      renderedPurchases = Array.isArray(purchases) ? purchases : [];
      pruneLuckmailSelection(renderedPurchases);
      dom.luckmailList.innerHTML = '';

      if (!renderedPurchases.length) {
        selectedPurchaseIds.clear();
        dom.luckmailList.innerHTML = '<div class="luckmail-empty">Không tìm thấy email LuckMail của dự án OpenAI.</div>';
        dom.luckmailSummary.textContent = 'Sau khi tải email đã mua, bạn có thể quản lý email LuckMail của dự án OpenAI tại đây.';
        if (dom.btnLuckmailDisableUsed) dom.btnLuckmailDisableUsed.disabled = true;
        updateLuckmailBulkUI([]);
        return;
      }

      const usedCount = renderedPurchases.filter((purchase) => purchase.used).length;
      const reusableCount = renderedPurchases.filter((purchase) => purchase.reusable).length;
      const disableUsedCount = renderedPurchases.filter((purchase) => purchase.used && !purchase.preserved && !purchase.disabled).length;
      dom.luckmailSummary.textContent = `已加载 ${renderedPurchases.length} 个 openai 邮箱，其中 ${reusableCount} 个可复用，${usedCount} 个已本地Đánh dấu là đã dùng。`;
      if (dom.btnLuckmailDisableUsed) {
        dom.btnLuckmailDisableUsed.textContent = `TắtĐã dùng${disableUsedCount > 0 ? `（${disableUsedCount}）` : ''}`;
        dom.btnLuckmailDisableUsed.disabled = disableUsedCount === 0;
      }

      const visiblePurchases = getFilteredLuckmailPurchases(renderedPurchases);
      if (!visiblePurchases.length) {
        dom.luckmailList.innerHTML = '<div class="luckmail-empty">Không có email LuckMail nào khớp bộ lọc hiện tại.</div>';
        updateLuckmailBulkUI([]);
        return;
      }

      for (const purchase of visiblePurchases) {
        const purchaseId = String(purchase.id);
        const item = document.createElement('div');
        item.className = `luckmail-item${purchase.current ? ' is-current' : ''}`;
        item.innerHTML = `
          <input class="luckmail-item-check" type="checkbox" data-action="select" ${selectedPurchaseIds.has(purchaseId) ? 'checked' : ''} />
          <div class="luckmail-item-main">
            <div class="luckmail-item-email-row">
              <div class="luckmail-item-email">${helpers.escapeHtml(purchase.email_address || '(Email không xác định)')}</div>
              <button
                class="hotmail-copy-btn"
                type="button"
                data-action="copy-email"
                title="Sao chép email"
                aria-label="Sao chép email ${helpers.escapeHtml(purchase.email_address || '')}"
              >${copyIcon}</button>
            </div>
            <div class="luckmail-item-meta">
              <span class="luckmail-tag">${helpers.escapeHtml(helpers.normalizeLuckmailProjectName(purchase.project_name) || 'openai')}</span>
              ${purchase.reusable ? '<span class="luckmail-tag active">Có thể tái dùng</span>' : ''}
              ${purchase.current ? '<span class="luckmail-tag current">Hiện tại</span>' : ''}
              ${purchase.used ? '<span class="luckmail-tag used">Đã dùng</span>' : ''}
              ${purchase.preserved ? '<span class="luckmail-tag">Giữ lại</span>' : ''}
              ${purchase.disabled ? '<span class="luckmail-tag disabled">已Tắt</span>' : ''}
              ${purchase.tag_name && normalizeLuckmailSearchText(purchase.tag_name) !== normalizeLuckmailSearchText(helpers.getLuckmailPreserveTagName())
                ? `<span class="luckmail-tag">${helpers.escapeHtml(purchase.tag_name)}</span>`
                : ''}
            </div>
            <div class="luckmail-item-details">
              <span>ID：${helpers.escapeHtml(String(purchase.id || ''))}</span>
              <span>保修至：${helpers.escapeHtml(helpers.formatLuckmailDateTime(purchase.warranty_until))}</span>
            </div>
          </div>
          <div class="luckmail-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="use">使用此邮箱</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-used">${helpers.escapeHtml(purchase.used ? 'Đánh dấu chưa dùng' : 'Đánh dấu đã dùng')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-preserved">${helpers.escapeHtml(purchase.preserved ? 'Bỏ giữ lại' : 'Giữ lại')}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="toggle-disabled">${helpers.escapeHtml(purchase.disabled ? 'Bật' : 'Tắt')}</button>
          </div>
        `;

        item.querySelector('[data-action="select"]').addEventListener('change', (event) => {
          if (event.target.checked) {
            selectedPurchaseIds.add(purchaseId);
          } else {
            selectedPurchaseIds.delete(purchaseId);
          }
          updateLuckmailBulkUI(visiblePurchases);
        });
        item.querySelector('[data-action="copy-email"]').addEventListener('click', async () => {
          await helpers.copyTextToClipboard(purchase.email_address || '');
          helpers.showToast('Đã sao chép email', 'success', 1600);
        });
        item.querySelector('[data-action="use"]').addEventListener('click', async () => {
          await selectSingleLuckmailPurchase(purchase);
        });
        item.querySelector('[data-action="toggle-used"]').addEventListener('click', async () => {
          await setSingleLuckmailPurchaseUsedState(purchase, !purchase.used);
        });
        item.querySelector('[data-action="toggle-preserved"]').addEventListener('click', async () => {
          await setSingleLuckmailPurchasePreservedState(purchase, !purchase.preserved);
        });
        item.querySelector('[data-action="toggle-disabled"]').addEventListener('click', async () => {
          await setSingleLuckmailPurchaseDisabledState(purchase, !purchase.disabled);
        });
        dom.luckmailList.appendChild(item);
      }

      updateLuckmailBulkUI(visiblePurchases);
    }

    async function refreshLuckmailPurchases(options = {}) {
      const { silent = false } = options;
      if (!dom.luckmailSection || dom.luckmailSection.style.display === 'none') {
        return;
      }

      if (!silent) setLuckmailLoadingState(true, 'Đang tải email LuckMail OpenAI...');
      try {
        const response = await runtime.sendMessage({
          type: 'LIST_LUCKMAIL_PURCHASES',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) throw new Error(response.error);
        renderLuckmailPurchases(response?.purchases || []);
      } catch (err) {
        selectedPurchaseIds.clear();
        if (dom.luckmailList) {
          dom.luckmailList.innerHTML = '<div class="luckmail-empty">Không thể tải danh sách email LuckMail.</div>';
        }
        if (dom.luckmailSummary) {
          dom.luckmailSummary.textContent = err.message;
        }
        updateLuckmailBulkUI([]);
        if (!silent) {
          helpers.showToast(`LuckMail 邮箱列表加载Thất bại：${err.message}`, 'error');
        }
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    function queueLuckmailPurchaseRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(async () => {
        refreshQueued = false;
        await refreshLuckmailPurchases({ silent: true });
      }, 150);
    }

    async function selectSingleLuckmailPurchase(purchase) {
      setLuckmailLoadingState(true, `正在切换到 ${purchase.email_address} ...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SELECT_LUCKMAIL_PURCHASE',
          source: 'sidepanel',
          payload: { purchaseId: purchase.id },
        });
        if (response?.error) throw new Error(response.error);
        dom.inputEmail.value = response?.purchase?.email_address || purchase.email_address || '';
        helpers.showToast(`已切换当前 LuckMail 邮箱为 ${purchase.email_address}`, 'success', 2200);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`切换 LuckMail 邮箱Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    async function setSingleLuckmailPurchaseUsedState(purchase, used) {
      setLuckmailLoadingState(true, `正在更新 ${purchase.email_address} 的Đã dùng状态...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_LUCKMAIL_PURCHASE_USED_STATE',
          source: 'sidepanel',
          payload: { purchaseId: purchase.id, used },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`${purchase.email_address} 已${used ? 'Đánh dấu là đã dùng' : 'Khôi phục về chưa dùng'}`, 'success', 2200);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`更新 LuckMail Đã dùng状态Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    async function setSingleLuckmailPurchasePreservedState(purchase, preserved) {
      setLuckmailLoadingState(true, `正在更新 ${purchase.email_address} 的Giữ lại状态...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_LUCKMAIL_PURCHASE_PRESERVED_STATE',
          source: 'sidepanel',
          payload: { purchaseId: purchase.id, preserved },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`${purchase.email_address} 已${preserved ? '设为Giữ lại' : 'Bỏ giữ lại'}`, 'success', 2200);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`更新 LuckMail Giữ lại状态Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    async function setSingleLuckmailPurchaseDisabledState(purchase, disabled) {
      setLuckmailLoadingState(true, `正在${disabled ? 'Tắt' : 'Bật'} ${purchase.email_address} ...`);
      try {
        const response = await runtime.sendMessage({
          type: 'SET_LUCKMAIL_PURCHASE_DISABLED_STATE',
          source: 'sidepanel',
          payload: { purchaseId: purchase.id, disabled },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`${purchase.email_address} 已${disabled ? 'Tắt' : 'Bật'}`, 'success', 2200);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`更新 LuckMail Tắt状态Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    async function runBulkLuckmailAction(action) {
      const selectedIds = renderedPurchases
        .filter((purchase) => selectedPurchaseIds.has(String(purchase.id)))
        .map((purchase) => purchase.id);
      if (!selectedIds.length) {
        updateLuckmailBulkUI();
        return;
      }

      const actionLabelMap = {
        used: 'Đánh dấu đã dùng',
        unused: 'Đánh dấu chưa dùng',
        preserve: 'Giữ lại',
        unpreserve: 'Bỏ giữ lại',
        disable: 'Tắt',
        enable: 'Bật',
      };

      setLuckmailLoadingState(true, `正在批量${actionLabelMap[action] || 'Xử lý'} LuckMail 邮箱...`);
      try {
        const response = await runtime.sendMessage({
          type: 'BATCH_UPDATE_LUCKMAIL_PURCHASES',
          source: 'sidepanel',
          payload: { action, ids: selectedIds },
        });
        if (response?.error) throw new Error(response.error);
        helpers.showToast(`已批量${actionLabelMap[action] || 'Xử lý'} ${selectedIds.length} 个 LuckMail 邮箱`, 'success', 2400);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`批量Xử lý LuckMail 邮箱Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
        updateLuckmailBulkUI();
      }
    }

    async function disableUsedLuckmailPurchases() {
      const confirmed = await helpers.openConfirmModal({
        title: 'TắtĐã dùng LuckMail 邮箱',
        message: '确认Tắt所有本地Đã dùng且未Giữ lại的 openai LuckMail 邮箱吗？',
        confirmLabel: '确认Tắt',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      setLuckmailLoadingState(true, '正在TắtĐã dùng LuckMail 邮箱...');
      try {
        const response = await runtime.sendMessage({
          type: 'DISABLE_USED_LUCKMAIL_PURCHASES',
          source: 'sidepanel',
          payload: {},
        });
        if (response?.error) throw new Error(response.error);
        const disabledCount = Array.isArray(response?.disabledIds) ? response.disabledIds.length : 0;
        helpers.showToast(`已Tắt ${disabledCount} 个 LuckMail 邮箱`, disabledCount > 0 ? 'success' : 'info', 2400);
        await refreshLuckmailPurchases({ silent: true });
      } catch (err) {
        if (dom.luckmailSummary) dom.luckmailSummary.textContent = err.message;
        helpers.showToast(`TắtĐã dùng LuckMail 邮箱Thất bại：${err.message}`, 'error');
      } finally {
        setLuckmailLoadingState(false);
      }
    }

    function reset() {
      renderedPurchases = [];
      selectedPurchaseIds.clear();
      searchTerm = '';
      filterMode = 'all';
      refreshQueued = false;
      if (dom.inputLuckmailSearch) dom.inputLuckmailSearch.value = '';
      if (dom.selectLuckmailFilter) dom.selectLuckmailFilter.value = 'all';
      if (dom.luckmailList) dom.luckmailList.innerHTML = '';
      if (dom.luckmailSummary) dom.luckmailSummary.textContent = 'Sau khi tải email đã mua, bạn có thể quản lý email LuckMail của dự án OpenAI tại đây.';
      if (dom.btnLuckmailDisableUsed) dom.btnLuckmailDisableUsed.disabled = true;
      updateLuckmailBulkUI([]);
    }

    function bindLuckmailEvents() {
      dom.inputLuckmailSearch?.addEventListener('input', (event) => {
        searchTerm = event.target.value || '';
        renderLuckmailPurchases(renderedPurchases);
      });

      dom.selectLuckmailFilter?.addEventListener('change', (event) => {
        filterMode = String(event.target.value || 'all').trim() || 'all';
        renderLuckmailPurchases(renderedPurchases);
      });

      dom.checkboxLuckmailSelectAll?.addEventListener('change', () => {
        const visiblePurchases = getFilteredLuckmailPurchases();
        if (dom.checkboxLuckmailSelectAll.checked) {
          visiblePurchases.forEach((purchase) => selectedPurchaseIds.add(String(purchase.id)));
        } else {
          visiblePurchases.forEach((purchase) => selectedPurchaseIds.delete(String(purchase.id)));
        }
        renderLuckmailPurchases(renderedPurchases);
      });

      dom.btnLuckmailRefresh?.addEventListener('click', async () => {
        await refreshLuckmailPurchases();
      });

      dom.btnLuckmailDisableUsed?.addEventListener('click', async () => {
        await disableUsedLuckmailPurchases();
      });

      dom.btnLuckmailBulkUsed?.addEventListener('click', async () => {
        await runBulkLuckmailAction('used');
      });

      dom.btnLuckmailBulkUnused?.addEventListener('click', async () => {
        await runBulkLuckmailAction('unused');
      });

      dom.btnLuckmailBulkPreserve?.addEventListener('click', async () => {
        await runBulkLuckmailAction('preserve');
      });

      dom.btnLuckmailBulkUnpreserve?.addEventListener('click', async () => {
        await runBulkLuckmailAction('unpreserve');
      });

      dom.btnLuckmailBulkDisable?.addEventListener('click', async () => {
        await runBulkLuckmailAction('disable');
      });

      dom.btnLuckmailBulkEnable?.addEventListener('click', async () => {
        await runBulkLuckmailAction('enable');
      });
    }

    return {
      bindLuckmailEvents,
      disableUsedLuckmailPurchases,
      queueLuckmailPurchaseRefresh,
      refreshLuckmailPurchases,
      renderLuckmailPurchases,
      reset,
    };
  }

  globalScope.SidepanelLuckmailManager = {
    createLuckmailManager,
  };
})(window);
