(function attachSidepanelHostedSmsPoolManager(globalScope) {
  const SEPARATOR = '----';

  function createHostedSmsPoolManager(context = {}) {
    const {
      dom = {},
      helpers = {},
      state = {},
      actions = {},
      constants = {},
    } = context;

    const copyIcon = constants.copyIcon || '';
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

    function normalizePoolPhone(value = '') {
      return normalizeText(value);
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

    function formatPayPalLocalPhone(value = '') {
      const rawValue = normalizeText(value);
      const digits = rawValue.replace(/\D+/g, '');
      if (rawValue.startsWith('+1') && digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
      }
      return digits;
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
          lastAttemptAt: Math.max(0, Number(itemUsage.lastAttemptAt) || 0),
          lastError: normalizeText(itemUsage.lastError),
        };
      });
    }

    function getFilteredEntries(entries = renderedEntries) {
      const normalizedSearch = normalizeText(searchTerm).toLowerCase();
      return getEntriesWithState(entries).filter((entry) => {
        const matchesFilter = (() => {
          switch (filterMode) {
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
          entry.current ? 'current 当前' : '',
          entry.used ? 'used 已用' : 'unused 未用',
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
      if (dom.btnHostedSmsPoolClearUsed) {
        dom.btnHostedSmsPoolClearUsed.disabled = loading || usedCount === 0;
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
        dom.hostedSmsPoolList.innerHTML = '<div class="luckmail-empty">还没有 Hosted 号码，先导入一批号码再开始。</div>';
        dom.hostedSmsPoolSummary.textContent = '导入 PayPal Hosted 接码号码，每行一个号码和验证码接口。';
        updateControls([]);
        return;
      }

      const usedCount = entriesWithState.filter((entry) => entry.useCount > 0).length;
      const totalUseCount = entriesWithState.reduce((sum, entry) => sum + Math.max(0, Number(entry.useCount) || 0), 0);
      dom.hostedSmsPoolSummary.textContent = `已加载 ${entriesWithState.length} 个号码，${usedCount} 个有使用记录，累计使用 ${totalUseCount} 次。`;

      const visibleEntries = getFilteredEntries(renderedEntries);
      if (!visibleEntries.length) {
        dom.hostedSmsPoolList.innerHTML = '<div class="luckmail-empty">没有匹配当前筛选条件的号码。</div>';
        updateControls(renderedEntries);
        return;
      }

      for (const entry of visibleEntries) {
        const item = document.createElement('div');
        item.className = `luckmail-item${entry.current ? ' is-current' : ''}`;
        const localPhone = formatPayPalLocalPhone(entry.phone);
        item.innerHTML = `
          <div class="luckmail-item-main">
            <div class="luckmail-item-email-row">
              <div class="luckmail-item-email hosted-sms-pool-phone">
                <span>${helpers.escapeHtml?.(entry.phone) || entry.phone}</span>
                ${localPhone && localPhone !== entry.phone ? `<span class="hosted-sms-pool-phone-local">PayPal 填 ${helpers.escapeHtml?.(localPhone) || localPhone}</span>` : ''}
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
              <span class="luckmail-tag active">使用 ${Math.max(0, Number(entry.useCount) || 0)} 次</span>
            </div>
          </div>
          <div class="luckmail-item-actions">
            <button class="btn btn-outline btn-xs" type="button" data-action="increment-usage">次数 +1</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="reset-usage">清零</button>
            <button class="btn btn-outline btn-xs" type="button" data-action="delete">删除</button>
          </div>
        `;

        item.querySelector('[data-action="copy-phone"]')?.addEventListener('click', async () => {
          await helpers.copyTextToClipboard?.(entry.phone || '');
          helpers.showToast?.('号码已复制', 'success', 1600);
        });

        item.querySelector('[data-action="increment-usage"]')?.addEventListener('click', async () => {
          await patchPool(({ entries: entriesList, usage }) => {
            const nextUsage = { ...usage };
            nextUsage[entry.key] = {
              ...(nextUsage[entry.key] || {}),
              useCount: Math.max(0, Number(nextUsage[entry.key]?.useCount) || 0) + 1,
              usedAt: Date.now(),
              lastAttemptAt: Math.max(0, Number(nextUsage[entry.key]?.lastAttemptAt) || 0),
              lastError: normalizeText(nextUsage[entry.key]?.lastError),
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
            };
            return { entries: entriesList, usage: nextUsage };
          });
        });

        item.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
          const confirmed = await helpers.openConfirmModal?.({
            title: '删除 Hosted 号码',
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

      setLoading(true, '正在更新 Hosted 号池...');
      state.setText?.(nextText);
      state.setUsage?.(nextUsage);
      if (!nextText) {
        actions.clearFallback?.();
      }
      render(nextEntries);
      try {
        await actions.persistPool?.();
      } catch (error) {
        state.setText?.(previousText);
        state.setUsage?.(previousUsage);
        render(previousEntries);
        helpers.showToast?.(`更新 Hosted 号池失败：${error.message}`, 'error');
      } finally {
        setLoading(false);
      }
    }

    async function importEntries() {
      const text = normalizePoolText(dom.inputHostedSmsPoolImport?.value || '');
      if (!text) {
        helpers.showToast?.('请先粘贴 Hosted 号码，每行一个号码和验证码接口。', 'warn');
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

      await patchPool(({ entries, usage }) => ({
        entries: [...entries, ...imported],
        usage,
      }));
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
        title: '清空使用次数',
        message: '确认清空 Hosted 号池的使用次数吗？号码本身会保留。',
        confirmLabel: '清空次数',
      });
      if (!confirmed) return;
      await patchPool(({ entries }) => ({ entries, usage: {} }));
    }

    async function deleteAll() {
      const confirmed = await helpers.openConfirmModal?.({
        title: '删除 Hosted 号池',
        message: '确认删除当前全部 Hosted 号码吗？此操作不可撤销。',
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
      if (!silent) setLoading(true, '正在刷新 Hosted 号池...');
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
        dom.hostedSmsPoolSummary.textContent = '导入 PayPal Hosted 接码号码，每行一个号码和验证码接口。';
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
