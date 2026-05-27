(function attachSidepanelHostedSmsPoolManager(globalScope) {
  const SEPARATOR = '----';

  function createHostedSmsPoolManager(context = {}) {
    const {
      dom = {},
      helpers = {},
      state = {},
      actions = {},
      constants = {},
      labels = {},
      normalizers = {},
    } = context;

    const copyIcon = constants.copyIcon || '';
    const poolLabel = String(labels.poolLabel || 'PayPal 接码池').trim() || 'PayPal 接码池';
    const importSubject = String(labels.importSubject || `${poolLabel}号码`).trim() || `${poolLabel}号码`;
    const numberNoun = String(labels.numberNoun || '号码').trim() || '号码';
    const localPhonePrefix = String(labels.localPhonePrefix || 'PayPal 填').trim();
    const emptySummary = String(
      labels.emptySummary || `导入 ${importSubject}，每行一个号码和验证码接口。`
    ).trim() || `导入 ${importSubject}，每行一个号码和验证码接口。`;
    const emptyListText = String(
      labels.emptyListText || `还没有 ${poolLabel}号码，先导入一批号码再开始。`
    ).trim() || `还没有 ${poolLabel}号码，先导入一批号码再开始。`;
    const noMatchText = String(
      labels.noMatchText || `没有匹配当前筛选条件的${numberNoun}。`
    ).trim() || `没有匹配当前筛选条件的${numberNoun}。`;
    const refreshLoadingText = String(
      labels.refreshLoadingText || `正在刷新${poolLabel}...`
    ).trim() || `正在刷新${poolLabel}...`;
    const updateLoadingText = String(
      labels.updateLoadingText || `正在更新${poolLabel}...`
    ).trim() || `正在更新${poolLabel}...`;
    const updateFailedPrefix = String(
      labels.updateFailedPrefix || `更新${poolLabel}失败`
    ).trim() || `更新${poolLabel}失败`;
    const copySuccessText = String(labels.copySuccessText || '号码已复制').trim() || '号码已复制';
    const importEmptyWarning = String(
      labels.importEmptyWarning || `请先粘贴${importSubject}，每行一个号码和验证码接口。`
    ).trim() || `请先粘贴${importSubject}，每行一个号码和验证码接口。`;
    const deleteTitle = String(labels.deleteTitle || `删除${poolLabel}号码`).trim() || `删除${poolLabel}号码`;
    const clearUsageTitle = String(labels.clearUsageTitle || '清空使用次数').trim() || '清空使用次数';
    const clearUsageMessage = String(
      labels.clearUsageMessage || `确认清空${poolLabel}的使用次数吗？号码本身会保留。`
    ).trim() || `确认清空${poolLabel}的使用次数吗？号码本身会保留。`;
    const deleteAllTitle = String(labels.deleteAllTitle || `删除${poolLabel}`).trim() || `删除${poolLabel}`;
    const deleteAllMessage = String(
      labels.deleteAllMessage || `确认删除当前全部${importSubject}吗？此操作不可撤销。`
    ).trim() || `确认删除当前全部${importSubject}吗？此操作不可撤销。`;
    const normalizePoolPhoneValue = typeof normalizers.normalizePhone === 'function'
      ? normalizers.normalizePhone
      : normalizeUsHostedPhoneDigits;
    const formatLocalPhoneValue = typeof normalizers.formatLocalPhone === 'function'
      ? normalizers.formatLocalPhone
      : normalizeUsHostedPhoneDigits;
    const usageLimitRaw = Number(constants.usageLimit);
    const usageLimit = Number.isFinite(usageLimitRaw) && usageLimitRaw > 0
      ? Math.max(1, Math.floor(usageLimitRaw))
      : 0;
    let renderedEntries = [];
    let searchTerm = '';
    let filterMode = 'all';
    let loading = false;
    let refreshQueued = false;

    function normalizeText(value = '') {
      return String(value || '').trim();
    }

    function normalizePoolText(value = '') {
      return String(value || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
    }

    function normalizeUsHostedPhoneDigits(value = '') {
      const rawValue = normalizeText(value);
      const digits = rawValue.replace(/\D+/g, '');
      if (digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
      }
      return digits || rawValue;
    }

    function normalizePoolPhone(value = '') {
      return normalizePoolPhoneValue(value);
    }

    function normalizePoolUrl(value = '') {
      const rawValue = normalizeText(value);
      if (!rawValue) {
        return '';
      }
      try {
        const parsed = new URL(rawValue);
        parsed.searchParams.delete('t');
        return parsed.toString();
      } catch {
        return rawValue
          .replace(/([?&])t=\d+(?=(&|$))/i, '$1')
          .replace(/[?&]$/g, '');
      }
    }

    function formatLocalPhone(value = '') {
      return formatLocalPhoneValue(value);
    }

    function buildKey(phone = '', verificationUrl = '') {
      const normalizedPhone = normalizePoolPhone(phone);
      const normalizedUrl = normalizePoolUrl(verificationUrl);
      return normalizedPhone && normalizedUrl ? `${normalizedPhone}${SEPARATOR}${normalizedUrl}` : '';
    }

    function parseEntries(text = '') {
      const lines = normalizePoolText(text).split('\n').filter(Boolean);
      const seen = new Set();
      const entries = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const separatorIndex = line.indexOf(SEPARATOR);
        const hasSeparator = separatorIndex > 0;
        const phone = hasSeparator
          ? normalizePoolPhone(line.slice(0, separatorIndex))
          : normalizePoolPhone(line);
        const verificationUrl = hasSeparator
          ? normalizePoolUrl(line.slice(separatorIndex + SEPARATOR.length))
          : normalizePoolUrl(lines[index + 1] || '');
        if (!hasSeparator && verificationUrl) {
          index += 1;
        }
        const key = buildKey(phone, verificationUrl);
        if (!phone || !verificationUrl || !key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push({
          index,
          key,
          phone,
          verificationUrl,
        });
      }
      return entries;
    }

    function entriesToText(entries = []) {
      return parseEntries(entries.map((entry) => `${entry.phone}${SEPARATOR}${entry.verificationUrl}`).join('\n'))
        .map((entry) => `${entry.phone}${SEPARATOR}${entry.verificationUrl}`)
        .join('\n');
    }

    function normalizeUsage(value = {}) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        const usage = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        const legacyUsedCount = Number(usage.usedAt) > 0 ? 1 : 0;
        const useCount = Math.max(0, Math.floor(Number(usage.useCount ?? usage.usageCount ?? legacyUsedCount) || 0));
        return [normalizeText(key), {
          useCount,
          usedAt: Math.max(0, Number(usage.usedAt) || 0),
          lastAttemptAt: Math.max(0, Number(usage.lastAttemptAt) || 0),
          lastError: normalizeText(usage.lastError),
          enabled: usage.enabled !== false,
          disabledReason: normalizeText(usage.disabledReason),
          disabledAt: Math.max(0, Number(usage.disabledAt) || 0),
          failureCount: Math.max(0, Math.floor(Number(usage.failureCount) || 0)),
        }];
      }).filter(([key]) => Boolean(key)));
    }

    function getCurrentKey() {
      const current = state.getCurrentEntry?.() || null;
      return normalizeText(current?.key || buildKey(current?.phone, current?.verificationUrl));
    }

    function getEntriesWithState(entries = renderedEntries) {
      const usage = normalizeUsage(state.getUsage?.());
      const currentKey = getCurrentKey();
      return parseEntries(entriesToText(entries)).map((entry) => {
        const itemUsage = usage[entry.key] || {};
        return {
          ...entry,
          current: Boolean(currentKey && entry.key === currentKey),
          useCount: Math.max(0, Math.floor(Number(itemUsage.useCount) || 0)),
          used: Math.max(0, Math.floor(Number(itemUsage.useCount) || 0)) > 0,
          exhausted: usageLimit > 0 && Math.max(0, Math.floor(Number(itemUsage.useCount) || 0)) >= usageLimit,
          lastAttemptAt: Math.max(0, Number(itemUsage.lastAttemptAt) || 0),
          lastError: normalizeText(itemUsage.lastError),
          enabled: itemUsage.enabled !== false,
          disabledReason: normalizeText(itemUsage.disabledReason),
          disabledAt: Math.max(0, Number(itemUsage.disabledAt) || 0),
          failureCount: Math.max(0, Math.floor(Number(itemUsage.failureCount) || 0)),
        };
      });
    }

    function getFilteredEntries(entries = renderedEntries) {
      const normalizedSearch = normalizeText(searchTerm).toLowerCase();
      return getEntriesWithState(entries).filter((entry) => {
        const matchesFilter = (() => {
          switch (filterMode) {
            case 'enabled': return Boolean(entry.enabled);
            case 'disabled': return !entry.enabled;
            case 'current': return Boolean(entry.current);
            case 'used': return Boolean(entry.used);
            case 'unused': return !entry.used;
            case 'error': return Boolean(entry.lastError);
            default: return true;
          }
        })();
        if (!matchesFilter) {
          return false;
        }
        if (!normalizedSearch) {
          return true;
        }
        return [
          entry.phone,
          entry.verificationUrl,
          entry.enabled ? 'enabled 启用' : 'disabled 禁用',
          entry.current ? 'current 当前' : '',
          entry.used ? 'used 已用' : 'unused 未用',
          entry.exhausted ? 'exhausted 已达上限' : '',
          entry.disabledReason ? `disabledReason ${entry.disabledReason}` : '',
          entry.lastError ? `error 异常 ${entry.lastError}` : '',
        ].join(' ').toLowerCase().includes(normalizedSearch);
      });
    }

    function setLoading(nextLoading, summary = '') {
      loading = Boolean(nextLoading);
      [
        dom.btnHostedSmsPoolRefresh,
        dom.btnHostedSmsPoolClearUsed,
        dom.btnHostedSmsPoolDeleteAll,
        dom.btnHostedSmsPoolImport,
      ].forEach((button) => {
        if (button) button.disabled = loading;
      });
      if (dom.inputHostedSmsPoolImport) {
        dom.inputHostedSmsPoolImport.disabled = loading;
      }
      if (summary && dom.hostedSmsPoolSummary) {
        dom.hostedSmsPoolSummary.textContent = summary;
      }
    }

    function updateControls(entries = renderedEntries) {
      const entriesWithState = getEntriesWithState(entries);
      const usedCount = entriesWithState.filter((entry) => entry.useCount > 0).length;
      const disabledCount = entriesWithState.filter((entry) => !entry.enabled).length;
      if (dom.btnHostedSmsPoolClearUsed) {
        dom.btnHostedSmsPoolClearUsed.disabled = loading || (usedCount === 0 && disabledCount === 0);
      }
      if (dom.btnHostedSmsPoolDeleteAll) {
        dom.btnHostedSmsPoolDeleteAll.disabled = loading || entriesWithState.length === 0;
      }
    }

    function render(entries = parseEntries(state.getText?.())) {
      if (!dom.hostedSmsPoolList || !dom.hostedSmsPoolSummary) {
        return;
      }
      renderedEntries = parseEntries(entriesToText(entries));
      dom.hostedSmsPoolList.innerHTML = '';

      const entriesWithState = getEntriesWithState(renderedEntries);
      if (!entriesWithState.length) {
        dom.hostedSmsPoolList.innerHTML = `<div class="luckmail-empty">${helpers.escapeHtml?.(emptyListText) || emptyListText}</div>`;
        dom.hostedSmsPoolSummary.textContent = emptySummary;
        updateControls([]);
        return;
      }

      const usedCount = entriesWithState.filter((entry) => entry.useCount > 0).length;
      const disabledCount = entriesWithState.filter((entry) => !entry.enabled).length;
      const totalUseCount = entriesWithState.reduce((sum, entry) => sum + Math.max(0, Number(entry.useCount) || 0), 0);
      const exhaustedCount = usageLimit > 0
        ? entriesWithState.filter((entry) => entry.exhausted).length
        : 0;
      dom.hostedSmsPoolSummary.textContent = usageLimit > 0
        ? `已加载 ${entriesWithState.length} 个号码，${usedCount} 个有使用记录，${exhaustedCount} 个已达上限，${disabledCount} 个已禁用，累计使用 ${totalUseCount} 次。`
        : `已加载 ${entriesWithState.length} 个号码，${usedCount} 个有使用记录，${disabledCount} 个已禁用，累计使用 ${totalUseCount} 次。`;

      const visibleEntries = getFilteredEntries(renderedEntries);
      if (!visibleEntries.length) {
        dom.hostedSmsPoolList.innerHTML = `<div class="luckmail-empty">${helpers.escapeHtml?.(noMatchText) || noMatchText}</div>`;
        updateControls(renderedEntries);
        return;
      }

      for (const entry of visibleEntries) {
        const item = document.createElement('div');
        item.className = `luckmail-item${entry.current ? ' is-current' : ''}${entry.enabled ? '' : ' is-disabled'}`;
        const localPhone = formatLocalPhone(entry.phone);
        const useCount = Math.max(0, Number(entry.useCount) || 0);
        const usageText = usageLimit > 0
          ? `当前使用次数：${Math.min(useCount, usageLimit)}/${usageLimit}`
          : `使用 ${useCount} 次`;
        item.innerHTML = `
          <div class="luckmail-item-main">
            <div class="luckmail-item-email-row">
              <div class="luckmail-item-email hosted-sms-pool-phone">
                <span>${helpers.escapeHtml?.(entry.phone) || entry.phone}</span>
                ${entry.current ? '<span class="hosted-sms-pool-current-label">当前</span>' : ''}
                ${localPhonePrefix && localPhone && localPhone !== entry.phone ? `<span class="hosted-sms-pool-phone-local">${helpers.escapeHtml?.(localPhonePrefix) || localPhonePrefix} ${helpers.escapeHtml?.(localPhone) || localPhone}</span>` : ''}
              </div>
              <button
                class="hotmail-copy-btn"
                type="button"
                data-action="copy-phone"
                title="复制号码"
                aria-label="复制号码 ${helpers.escapeHtml?.(entry.phone) || entry.phone}"
              >${copyIcon}</button>
            </div>
            <div class="luckmail-item-details mono">${helpers.escapeHtml?.(entry.verificationUrl) || entry.verificationUrl}</div>
            <div class="luckmail-item-meta">
              ${entry.current ? '<span class="luckmail-tag current">当前</span>' : ''}
              ${entry.enabled ? '<span class="luckmail-tag active">启用中</span>' : '<span class="luckmail-tag disabled">已禁用</span>'}
              <span class="luckmail-tag active">${helpers.escapeHtml?.(usageText) || usageText}</span>
              ${entry.exhausted ? '<span class="luckmail-tag disabled">已达上限</span>' : ''}
              ${entry.failureCount > 0 ? `<span class="luckmail-tag used">失败 ${Math.max(0, Number(entry.failureCount) || 0)} 次</span>` : ''}
            </div>
            ${entry.disabledReason ? `<div class="hosted-sms-pool-disabled-reason">${helpers.escapeHtml?.(entry.disabledReason) || entry.disabledReason}</div>` : ''}
          </div>
          <div class="luckmail-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="${entry.enabled ? 'disable' : 'enable'}">${entry.enabled ? '禁用' : '启用'}</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="increment-usage">次数 +1</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="reset-usage">清零</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">删除</button>
          </div>
        `;

        item.querySelector('[data-action="copy-phone"]')?.addEventListener('click', async () => {
          await helpers.copyTextToClipboard?.(entry.phone || '');
          helpers.showToast?.(copySuccessText, 'success', 1600);
        });

        item.querySelector('[data-action="disable"]')?.addEventListener('click', async () => {
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            nextUsage[entry.key] = {
              ...(nextUsage[entry.key] || {}),
              useCount: Math.max(0, Number(nextUsage[entry.key]?.useCount) || 0),
              usedAt: Math.max(0, Number(nextUsage[entry.key]?.usedAt) || 0),
              lastAttemptAt: Math.max(0, Number(nextUsage[entry.key]?.lastAttemptAt) || 0),
              lastError: normalizeText(nextUsage[entry.key]?.lastError),
              enabled: false,
              disabledReason: '手动禁用',
              disabledAt: Date.now(),
              failureCount: Math.max(0, Math.floor(Number(nextUsage[entry.key]?.failureCount) || 0)),
            };
            return { entries: entriesList, usage: nextUsage };
          });
        });

        item.querySelector('[data-action="enable"]')?.addEventListener('click', async () => {
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            nextUsage[entry.key] = {
              ...(nextUsage[entry.key] || {}),
              useCount: Math.max(0, Number(nextUsage[entry.key]?.useCount) || 0),
              usedAt: Math.max(0, Number(nextUsage[entry.key]?.usedAt) || 0),
              lastAttemptAt: Math.max(0, Number(nextUsage[entry.key]?.lastAttemptAt) || 0),
              lastError: normalizeText(nextUsage[entry.key]?.lastError),
              enabled: true,
              disabledReason: '',
              disabledAt: 0,
              failureCount: 0,
            };
            return { entries: entriesList, usage: nextUsage };
          });
        });

        item.querySelector('[data-action="increment-usage"]')?.addEventListener('click', async () => {
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            nextUsage[entry.key] = {
              ...(nextUsage[entry.key] || {}),
              useCount: usageLimit > 0
                ? Math.min(usageLimit, Math.max(0, Number(nextUsage[entry.key]?.useCount) || 0) + 1)
                : Math.max(0, Number(nextUsage[entry.key]?.useCount) || 0) + 1,
              usedAt: Date.now(),
              lastAttemptAt: Math.max(0, Number(nextUsage[entry.key]?.lastAttemptAt) || 0),
              lastError: normalizeText(nextUsage[entry.key]?.lastError),
              enabled: nextUsage[entry.key]?.enabled !== false,
              disabledReason: normalizeText(nextUsage[entry.key]?.disabledReason),
              disabledAt: Math.max(0, Number(nextUsage[entry.key]?.disabledAt) || 0),
              failureCount: Math.max(0, Math.floor(Number(nextUsage[entry.key]?.failureCount) || 0)),
            };
            return { entries: entriesList, usage: nextUsage };
          });
        });

        item.querySelector('[data-action="reset-usage"]')?.addEventListener('click', async () => {
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            nextUsage[entry.key] = {
              ...(nextUsage[entry.key] || {}),
              useCount: 0,
              usedAt: 0,
              lastError: '',
              lastAttemptAt: 0,
              enabled: nextUsage[entry.key]?.enabled !== false,
              disabledReason: normalizeText(nextUsage[entry.key]?.disabledReason),
              disabledAt: Math.max(0, Number(nextUsage[entry.key]?.disabledAt) || 0),
              failureCount: 0,
            };
            return { entries: entriesList, usage: nextUsage };
          });
        });

        item.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
          const confirmed = await helpers.openConfirmModal?.({
            title: deleteTitle,
            message: `确认删除 ${entry.phone} 吗？此操作不可撤销。`,
            confirmLabel: '确认删除',
            confirmVariant: 'btn-danger',
          });
          if (!confirmed) return;
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            delete nextUsage[entry.key];
            return {
              entries: entriesList.filter((candidate) => candidate.key !== entry.key),
              usage: nextUsage,
            };
          });
        });

        if (usageLimit > 0 && useCount >= usageLimit) {
          const incrementButton = item.querySelector('[data-action="increment-usage"]');
          if (incrementButton) {
            incrementButton.disabled = true;
            incrementButton.title = `已达到上限 ${usageLimit} 次`;
          }
        }

        dom.hostedSmsPoolList.appendChild(item);
      }

      updateControls(renderedEntries);
    }

    async function patchPool(mutator) {
      const previousText = normalizePoolText(state.getText?.());
      const previousUsage = normalizeUsage(state.getUsage?.());
      const previousEntries = parseEntries(previousText);
      const result = mutator({
        entries: previousEntries.map((entry) => ({ ...entry })),
        usage: { ...previousUsage },
      }) || {};
      const nextEntries = parseEntries(entriesToText(result.entries || previousEntries));
      const nextUsage = normalizeUsage(result.usage || previousUsage);
      const nextText = entriesToText(nextEntries);

      setLoading(true, updateLoadingText);
      state.setText?.(nextText);
      state.setUsage?.(nextUsage);
      render(nextEntries);
      try {
        await actions.persistPool?.();
        return true;
      } catch (error) {
        state.setText?.(previousText);
        state.setUsage?.(previousUsage);
        render(previousEntries);
        helpers.showToast?.(`${updateFailedPrefix}：${error.message}`, 'error');
        return false;
      } finally {
        setLoading(false);
      }
    }

    async function importEntries() {
      const text = normalizePoolText(dom.inputHostedSmsPoolImport?.value || '');
      if (!text) {
        helpers.showToast?.(importEmptyWarning, 'warn');
        return;
      }

      const previousEntries = parseEntries(state.getText?.());
      const knownKeys = new Set(previousEntries.map((entry) => entry.key));
      const imported = [];
      let skippedCount = 0;
      for (const entry of parseEntries(text)) {
        if (knownKeys.has(entry.key)) {
          skippedCount += 1;
          continue;
        }
        knownKeys.add(entry.key);
        imported.push(entry);
      }
      if (!imported.length) {
        helpers.showToast?.(skippedCount > 0 ? '没有可导入的新号码（可能都重复或格式无效）。' : '没有识别到有效号码。', 'warn');
        return;
      }

      const persisted = await patchPool(({ entries, usage }) => ({
        entries: [...entries, ...imported],
        usage,
      }));
      if (!persisted) {
        return;
      }
      if (dom.inputHostedSmsPoolImport) {
        dom.inputHostedSmsPoolImport.value = '';
      }
      helpers.showToast?.(
        skippedCount > 0
          ? `已导入 ${imported.length} 个号码，跳过 ${skippedCount} 条重复数据。`
          : `已导入 ${imported.length} 个号码。`,
        'success',
        2200
      );
    }

    async function clearUsedState() {
      const confirmed = await helpers.openConfirmModal?.({
        title: clearUsageTitle,
        message: clearUsageMessage,
        confirmLabel: '清空次数',
      });
      if (!confirmed) return;
      await patchPool(({ entries, usage }) => ({
        entries,
        usage: Object.fromEntries(Object.entries(normalizeUsage(usage)).map(([key, item]) => [key, {
          enabled: item.enabled !== false,
          disabledReason: normalizeText(item.disabledReason),
          disabledAt: Math.max(0, Number(item.disabledAt) || 0),
          useCount: 0,
          usedAt: 0,
          lastAttemptAt: 0,
          lastError: '',
          failureCount: 0,
        }])),
      }));
    }

    async function deleteAll() {
      const confirmed = await helpers.openConfirmModal?.({
        title: deleteAllTitle,
        message: deleteAllMessage,
        confirmLabel: '确认删除',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) return;
      await patchPool(() => ({ entries: [], usage: {} }));
    }

    function refresh(options = {}) {
      const { silent = false } = options;
      if (state.isVisible && !state.isVisible()) {
        return;
      }
      if (!silent) setLoading(true, refreshLoadingText);
      render(parseEntries(state.getText?.()));
      if (!silent) setLoading(false);
    }

    function queueRefresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => {
        refreshQueued = false;
        refresh({ silent: true });
      }, 120);
    }

    function bindEvents() {
      dom.btnHostedSmsPoolRefresh?.addEventListener('click', () => refresh());
      dom.btnHostedSmsPoolImport?.addEventListener('click', () => {
        void importEntries();
      });
      dom.inputHostedSmsPoolImport?.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void importEntries();
        }
      });
      dom.inputHostedSmsPoolSearch?.addEventListener('input', (event) => {
        searchTerm = normalizeText(event.target.value);
        render(renderedEntries);
      });
      dom.selectHostedSmsPoolFilter?.addEventListener('change', (event) => {
        filterMode = normalizeText(event.target.value) || 'all';
        render(renderedEntries);
      });
      dom.btnHostedSmsPoolClearUsed?.addEventListener('click', () => {
        void clearUsedState();
      });
      dom.btnHostedSmsPoolDeleteAll?.addEventListener('click', () => {
        void deleteAll();
      });
    }

    function reset() {
      searchTerm = '';
      filterMode = 'all';
      if (dom.inputHostedSmsPoolSearch) dom.inputHostedSmsPoolSearch.value = '';
      if (dom.selectHostedSmsPoolFilter) dom.selectHostedSmsPoolFilter.value = 'all';
      if (dom.hostedSmsPoolList) dom.hostedSmsPoolList.innerHTML = '';
      if (dom.hostedSmsPoolSummary) {
        dom.hostedSmsPoolSummary.textContent = emptySummary;
      }
      updateControls([]);
    }

    return {
      bindEvents,
      queueRefresh,
      refresh,
      render,
      reset,
    };
  }

  globalScope.SidepanelHostedSmsPoolManager = {
    createHostedSmsPoolManager,
  };
})(typeof window !== 'undefined' ? window : globalThis);
