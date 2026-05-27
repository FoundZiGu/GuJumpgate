(function attachPhoneAuthModule(root, factory) {
  root.MultiPagePhoneAuth = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createPhoneAuthModule() {
  function createPhoneAuthHelpers(deps = {}) {
    const {
      fillInput,
      getActionText,
      getPageTextSnapshot,
      getVerificationErrorText,
      humanPause,
      isActionEnabled,
      isAddPhonePageReady,
      isConsentReady,
      isPhoneVerificationPageReady,
      isVisibleElement,
      performOperationWithDelay: injectedPerformOperationWithDelay,
      simulateClick,
      sleep,
      throwIfStopped,
      waitForElement,
    } = deps;
    const PHONE_RESEND_THROTTLED_ERROR_PREFIX = 'PHONE_RESEND_THROTTLED::';
    const PHONE_RESEND_BANNED_NUMBER_ERROR_PREFIX = 'PHONE_RESEND_BANNED_NUMBER::';
    const PHONE_RESEND_SERVER_ERROR_PREFIX = 'PHONE_RESEND_SERVER_ERROR::';
    const STEP9_WHATSAPP_PAGE_RESTART_ERROR_PREFIX = 'STEP9_WHATSAPP_PAGE_RESTART::';
    const PHONE_MAX_USAGE_EXCEEDED_PATTERN = /phone_max_usage_exceeded/i;
    const PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX = 'PHONE_ROUTE_405_RECOVERY_FAILED::';
    const PHONE_ROUTE_405_RECOVERY_COOLDOWN_MS = 6000;
    const PHONE_RESEND_ROUTE_405_MAX_RECOVERIES = 2;
    const PHONE_RESEND_ROUTE_405_MAX_RECOVERY_TOTAL_MS = 12000;
    const PHONE_RESEND_THROTTLED_PATTERN = /tried\s+to\s+resend\s+too\s+many\s+times|please\s+try\s+again\s+later|too\s+many\s+resend|resend\s+too\s+many|发送.*过于频繁|稍后再试|重试次数过多/i;
    const PHONE_RESEND_BANNED_NUMBER_PATTERN = /无法向此电话号码发送短信|无法向此手机号发送短信|无法发送短信到此电话号码|无法发送短信到此手机号|can(?:not|'t)\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number|unable\s+to\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number/i;
    const PHONE_RESEND_SERVER_ERROR_PATTERN = /this\s+page\s+isn['’]?t\s+working|currently\s+unable\s+to\s+handle\s+this\s+request|http\s+error\s+500|500\s+internal\s+server\s+error/i;
    const PHONE_ROUTE_405_PATTERN = /405\s+method\s+not\s+allowed|route\s+error.*405|did\s+not\s+provide\s+an?\s+[`'"]?action|post\s+request\s+to\s+["']?\/phone-verification/i;
    const PHONE_ROUTE_405_MAX_RECOVERY_CLICKS = 3;
    const rootScope = typeof self !== 'undefined' ? self : globalThis;
    const phoneCountryUtils = rootScope?.MultiPagePhoneCountryUtils || globalThis?.MultiPagePhoneCountryUtils || {};
    let lastPhoneRoute405RecoveryFailedAt = 0;
    let activePhoneResendPromise = null;

    async function performOperationWithDelay(metadata, operation) {
      const gate = injectedPerformOperationWithDelay || rootScope?.CodexOperationDelay?.performOperationWithDelay;
      return typeof gate === 'function' ? gate(metadata, operation) : operation();
    }

    function dispatchInputEvents(element) {
      if (!element) return;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function normalizePhoneDigits(value) {
      if (typeof phoneCountryUtils.normalizePhoneDigits === 'function') {
        return phoneCountryUtils.normalizePhoneDigits(value);
      }
      let digits = String(value || '').replace(/\D+/g, '');
      if (digits.startsWith('00')) {
        digits = digits.slice(2);
      }
      return digits;
    }

    function isExplicitInternationalPhoneInput(value) {
      return /^\s*(?:\+|00)\s*\d/.test(String(value || '').trim());
    }

    function normalizeCountryLabel(value) {
      if (typeof phoneCountryUtils.normalizeCountryLabel === 'function') {
        return phoneCountryUtils.normalizeCountryLabel(value);
      }
      return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function getOptionLabel(option) {
      if (typeof phoneCountryUtils.getOptionLabel === 'function') {
        return phoneCountryUtils.getOptionLabel(option);
      }
      return String(option?.textContent || option?.label || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function normalizeCountryOptionValue(value) {
      if (typeof phoneCountryUtils.normalizeCountryOptionValue === 'function') {
        return phoneCountryUtils.normalizeCountryOptionValue(value);
      }
      return String(value || '').trim().toUpperCase();
    }

    function getRegionDisplayName(regionCode, locale) {
      if (typeof phoneCountryUtils.getRegionDisplayName === 'function') {
        return phoneCountryUtils.getRegionDisplayName(regionCode, locale);
      }
      const normalizedRegionCode = normalizeCountryOptionValue(regionCode);
      const normalizedLocale = String(locale || '').trim();
      if (!/^[A-Z]{2}$/.test(normalizedRegionCode) || !normalizedLocale || typeof Intl?.DisplayNames !== 'function') {
        return '';
      }
      try {
        return String(
          new Intl.DisplayNames([normalizedLocale], { type: 'region' }).of(normalizedRegionCode) || ''
        ).trim();
      } catch {
        return '';
      }
    }

    function getCountryOptionMatchLabels(option) {
      if (typeof phoneCountryUtils.getOptionMatchLabels === 'function') {
        return phoneCountryUtils.getOptionMatchLabels(option, {
          document: typeof document !== 'undefined' ? document : null,
          navigator: rootScope?.navigator || globalThis?.navigator || null,
          getOptionLabel,
        });
      }

      const labels = new Set();
      const pushLabel = (value) => {
        const label = String(value || '').replace(/\s+/g, ' ').trim();
        if (label) {
          labels.add(label);
        }
      };

      pushLabel(getOptionLabel(option));

      const regionCode = normalizeCountryOptionValue(option?.value);
      if (/^[A-Z]{2}$/.test(regionCode)) {
        pushLabel(regionCode);
        pushLabel(getRegionDisplayName(regionCode, 'en'));

        const pageLocale = String(
          document?.documentElement?.lang
          || document?.documentElement?.getAttribute?.('lang')
          || self?.navigator?.language
          || ''
        ).trim();
        if (pageLocale && !/^en(?:[-_]|$)/i.test(pageLocale)) {
          pushLabel(getRegionDisplayName(regionCode, pageLocale));
        }
      }

      return Array.from(labels);
    }

    function isSameCountryOption(left, right) {
      if (!left || !right) {
        return false;
      }

      const leftValue = normalizeCountryOptionValue(left.value);
      const rightValue = normalizeCountryOptionValue(right.value);
      if (leftValue && rightValue) {
        return leftValue === rightValue;
      }

      return normalizeCountryLabel(getOptionLabel(left)) === normalizeCountryLabel(getOptionLabel(right));
    }

    function extractDialCodeFromText(value) {
      if (typeof phoneCountryUtils.extractDialCodeFromText === 'function') {
        return phoneCountryUtils.extractDialCodeFromText(value);
      }
      const match = String(value || '').match(/\(\+\s*(\d{1,4})\s*\)|\+\s*\(\s*(\d{1,4})\s*\)|\+\s*(\d{1,4})\b/);
      return String(match?.[1] || match?.[2] || match?.[3] || '').trim();
    }

    function getCountryButtonText() {
      const form = getAddPhoneForm();
      if (!form) return '';
      const button = form.querySelector('button[aria-haspopup="listbox"]');
      if (!button) return '';
      const valueNode = button.querySelector('.react-aria-SelectValue');
      return String(valueNode?.textContent || button.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getDisplayedDialCode() {
      const buttonDialCode = extractDialCodeFromText(getCountryButtonText());
      if (buttonDialCode) {
        return buttonDialCode;
      }

      const phoneInput = getPhoneInput();
      const fieldRoot = phoneInput?.closest('fieldset') || phoneInput?.closest('form') || getAddPhoneForm();
      if (!fieldRoot) {
        return '';
      }

      const visibleSpan = Array.from(fieldRoot.querySelectorAll('span'))
        .find((element) => isVisibleElement(element) && /^\d{1,4}$/.test(String(element.textContent || '').trim()));
      return String(visibleSpan?.textContent || '').trim();
    }

    function toNationalPhoneNumber(value, dialCode) {
      const digits = normalizePhoneDigits(value);
      const normalizedDialCode = normalizePhoneDigits(dialCode);
      const isExplicitInternational = isExplicitInternationalPhoneInput(value);
      if (!digits) {
        return '';
      }
      if (normalizedDialCode && digits.startsWith(normalizedDialCode) && digits.length > normalizedDialCode.length) {
        return digits.slice(normalizedDialCode.length);
      }
      if (isExplicitInternational) {
        return digits;
      }
      return digits;
    }

    function toE164PhoneNumber(value, dialCode) {
      const digits = normalizePhoneDigits(value);
      const normalizedDialCode = normalizePhoneDigits(dialCode);
      const isExplicitInternational = isExplicitInternationalPhoneInput(value);
      if (!digits) {
        return '';
      }
      if (isExplicitInternational) {
        return `+${digits}`;
      }
      if (!normalizedDialCode) {
        return `+${digits}`;
      }
      if (digits.startsWith(normalizedDialCode)) {
        return `+${digits}`;
      }
      if (digits.startsWith('0')) {
        return `+${normalizedDialCode}${digits.slice(1)}`;
      }
      return `+${normalizedDialCode}${digits}`;
    }

    function getAddPhoneForm() {
      return document.querySelector('form[action*="/add-phone" i]');
    }

    function getPhoneVerificationForm() {
      return document.querySelector('form[action*="/phone-verification" i]');
    }

    function getPhoneInput() {
      const form = getAddPhoneForm();
      if (!form) return null;
      const input = form.querySelector(
        'input[type="tel"], input[name="__reservedForPhoneNumberInput_tel"], input[autocomplete="tel"]'
      );
      return input && isVisibleElement(input) ? input : null;
    }

    function getHiddenPhoneNumberInput() {
      const form = getAddPhoneForm();
      if (!form) return null;
      return form.querySelector('input[name="phoneNumber"]');
    }

    function getCountrySelect() {
      const form = getAddPhoneForm();
      if (!form) return null;
      return form.querySelector('select');
    }

    function getSelectedCountryOption() {
      const select = getCountrySelect();
      if (!select || select.selectedIndex < 0) {
        return null;
      }
      return select.options[select.selectedIndex] || null;
    }

    function findCountryOptionByLabel(countryLabel) {
      const select = getCountrySelect();
      if (!select) {
        return null;
      }
      if (typeof phoneCountryUtils.findOptionByCountryLabel === 'function') {
        return phoneCountryUtils.findOptionByCountryLabel(select.options, countryLabel, {
          document: typeof document !== 'undefined' ? document : null,
          navigator: rootScope?.navigator || globalThis?.navigator || null,
          getOptionLabel,
        });
      }
      const normalizedTarget = normalizeCountryLabel(countryLabel);
      if (!normalizedTarget) {
        return null;
      }

      const options = Array.from(select.options);
      return options.find((option) => (
        getCountryOptionMatchLabels(option).some((label) => normalizeCountryLabel(label) === normalizedTarget)
      ))
        || options.find((option) => {
          const normalizedLabels = getCountryOptionMatchLabels(option)
            .map((label) => normalizeCountryLabel(label))
            .filter(Boolean);
          return normalizedLabels.some((optionLabel) => (
            optionLabel.length > 2
            && normalizedTarget.length > 2
            && (optionLabel.includes(normalizedTarget) || normalizedTarget.includes(optionLabel))
          ));
        })
        || null;
    }

    function findCountryOptionByPhoneNumber(phoneNumber) {
      const select = getCountrySelect();
      if (!select) {
        return null;
      }
      if (typeof phoneCountryUtils.findOptionByPhoneNumber === 'function') {
        return phoneCountryUtils.findOptionByPhoneNumber(select.options, phoneNumber, { getOptionLabel });
      }
      const digits = normalizePhoneDigits(phoneNumber);
      if (!digits) {
        return null;
      }

      let bestMatch = null;
      let bestDialCodeLength = 0;
      for (const option of Array.from(select.options || [])) {
        const dialCode = normalizePhoneDigits(extractDialCodeFromText(getOptionLabel(option)));
        if (!dialCode || !digits.startsWith(dialCode)) {
          continue;
        }
        if (dialCode.length > bestDialCodeLength) {
          bestMatch = option;
          bestDialCodeLength = dialCode.length;
        }
      }
      return bestMatch;
    }

    async function trySelectCountryOption(select, targetOption) {
      if (!select || !targetOption) {
        return false;
      }
      const selectedOption = getSelectedCountryOption();
      if (selectedOption && isSameCountryOption(selectedOption, targetOption)) {
        await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'select', label: 'phone-country-select' }, async () => {
          dispatchInputEvents(select);
        });
        return true;
      }
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'select', label: 'phone-country-select' }, async () => {
        select.value = String(targetOption.value || '');
        dispatchInputEvents(select);
      });
      await sleep(250);
      const nextSelectedOption = getSelectedCountryOption();
      return Boolean(nextSelectedOption && isSameCountryOption(nextSelectedOption, targetOption));
    }

    async function ensureCountrySelected(countryLabel, phoneNumber = '') {
      const select = getCountrySelect();
      if (!select) {
        return false;
      }

      const byLabel = findCountryOptionByLabel(countryLabel);
      if (await trySelectCountryOption(select, byLabel)) {
        return true;
      }

      const byPhoneNumber = findCountryOptionByPhoneNumber(phoneNumber);
      if (await trySelectCountryOption(select, byPhoneNumber)) {
        return true;
      }

      return Boolean(getSelectedCountryOption());
    }

    function normalizeInlineText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isSmsChannelText(value) {
      const text = normalizeInlineText(value);
      if (!text) {
        return false;
      }
      return /(?:^|\b)(?:sms|text\s*message)(?:\b|$)|短信/i.test(text);
    }

    function isWhatsAppChannelText(value) {
      return /whats\s*app/i.test(normalizeInlineText(value));
    }

    function getAddPhoneChannelInput() {
      const form = getAddPhoneForm();
      if (!form) {
        return null;
      }
      return form.querySelector('input[name="channel"]');
    }

    function getChannelOptionText(option) {
      if (!option) {
        return '';
      }
      const input = option.matches?.('input') ? option : option.querySelector?.('input[type="radio"]');
      const label = option.matches?.('label') ? option : option.closest?.('label');
      return normalizeInlineText([
        option.getAttribute?.('aria-label'),
        option.getAttribute?.('title'),
        input?.value,
        label?.textContent,
        option.textContent,
      ].filter(Boolean).join(' '));
    }

    function getAddPhoneChannelOptions() {
      const form = getAddPhoneForm();
      if (!form) {
        return [];
      }
      const radioInputs = Array.from(form.querySelectorAll('input[type="radio"]'));
      return radioInputs.map((input) => {
        const label = input.closest?.('label') || null;
        const optionRoot = label || input.closest?.('[role="radio"], [data-state], [class*="option"]') || input;
        const text = getChannelOptionText(optionRoot);
        const normalizedValue = String(input.value || '').trim().toLowerCase();
        const hiddenChannelInput = getAddPhoneChannelInput();
        const hiddenValue = String(hiddenChannelInput?.value || '').trim().toLowerCase();
        const dataState = String(label?.getAttribute?.('data-state') || optionRoot?.getAttribute?.('data-state') || '').trim().toLowerCase();
        const channel = normalizedValue === 'sms' || isSmsChannelText(text)
          ? 'sms'
          : (normalizedValue === 'whatsapp' || isWhatsAppChannelText(text) ? 'whatsapp' : '');
        const checked = Boolean(
          input.checked
          || dataState === 'on'
          || (hiddenValue && channel && hiddenValue === channel)
        );
        return {
          input,
          label,
          optionRoot,
          channel,
          text,
          checked,
        };
      }).filter((entry) => entry.channel || entry.text);
    }

    async function clickSmsChannelOption(option) {
      if (!option) {
        return false;
      }
      const target = option.label || option.optionRoot || option.input;
      if (!target || !isVisibleElement(target)) {
        return false;
      }
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'click', label: 'phone-channel-sms' }, async () => {
        simulateClick(target);
      });
      return true;
    }

    async function forceSmsChannelState(option) {
      if (!option?.input) {
        return false;
      }
      const hiddenChannelInput = getAddPhoneChannelInput();
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'hidden-sync', label: 'phone-channel-hidden-sync' }, async () => {
        getAddPhoneChannelOptions().forEach((entry) => {
          if (!entry?.input) {
            return;
          }
          entry.input.checked = entry.input === option.input;
          if (entry.label?.setAttribute) {
            entry.label.setAttribute('data-state', entry.input.checked ? 'on' : 'off');
          }
          if (entry.optionRoot?.setAttribute && entry.optionRoot !== entry.label) {
            entry.optionRoot.setAttribute('data-state', entry.input.checked ? 'on' : 'off');
          }
        });
        option.input.checked = true;
        option.input.setAttribute?.('checked', '');
        option.input.dispatchEvent?.(new Event('input', { bubbles: true }));
        option.input.dispatchEvent?.(new Event('change', { bubbles: true }));
        if (hiddenChannelInput) {
          hiddenChannelInput.value = 'sms';
          dispatchInputEvents(hiddenChannelInput);
        }
      });
      return true;
    }

    function getCurrentAddPhoneChannel() {
      const hiddenValue = String(getAddPhoneChannelInput()?.value || '').trim().toLowerCase();
      if (hiddenValue === 'sms' || hiddenValue === 'whatsapp') {
        return hiddenValue;
      }
      const options = getAddPhoneChannelOptions();
      const checkedOption = options.find((entry) => entry.checked);
      return checkedOption?.channel || '';
    }

    async function ensureSmsChannelSelected() {
      const options = getAddPhoneChannelOptions();
      if (!options.length) {
        return {
          present: false,
          changed: false,
          channel: getCurrentAddPhoneChannel(),
        };
      }

      const smsOption = options.find((entry) => entry.channel === 'sms');
      if (!smsOption) {
        throw new Error('Add-phone page shows "Send code via" but no Text Message / SMS option is available.');
      }

      const currentChannel = getCurrentAddPhoneChannel();
      if (currentChannel === 'sms' && smsOption.checked) {
        return {
          present: true,
          changed: false,
          channel: 'sms',
        };
      }

      let changed = false;
      if (await clickSmsChannelOption(smsOption)) {
        changed = true;
      }
      await sleep(150);

      if (getCurrentAddPhoneChannel() !== 'sms' || !smsOption.input.checked) {
        await forceSmsChannelState(smsOption);
        changed = true;
        await sleep(50);
      }

      const finalChannel = getCurrentAddPhoneChannel();
      const refreshedSmsOption = getAddPhoneChannelOptions().find((entry) => entry.channel === 'sms');
      if (finalChannel !== 'sms' || !refreshedSmsOption?.input?.checked) {
        throw new Error('Failed to force Text Message / SMS on the add-phone page.');
      }

      return {
        present: true,
        changed,
        channel: 'sms',
      };
    }

    function getAddPhoneSubmitButton() {
      const form = getAddPhoneForm();
      if (!form) return null;
      const buttons = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
      return buttons.find((button) => isVisibleElement(button) && isActionEnabled(button))
        || buttons.find((button) => isVisibleElement(button))
        || null;
    }

    function collectAddPhoneDeliveryTextCandidates() {
      const form = getAddPhoneForm();
      if (!form) {
        return [];
      }
      const candidates = [];
      const seen = new Set();
      const pushCandidate = (value) => {
        const text = normalizeInlineText(value);
        if (!text) {
          return;
        }
        const key = text.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        candidates.push(text);
      };
      const pushKeywordSegments = (value) => {
        String(value || '')
          .split(/[。！？!?\n\r]+/)
          .map((segment) => normalizeInlineText(segment))
          .filter(Boolean)
          .forEach((segment) => {
            if (segment.length > 160) {
              return;
            }
            if (!/(?:whats\s*app|sms|text\s*message|一次性验证码|验证码|verification\s+code|one[-\s]*time\s+code)/i.test(segment)) {
              return;
            }
            pushCandidate(segment);
          });
      };

      const formLabelIds = String(form.getAttribute?.('aria-labelledby') || '').trim();
      if (formLabelIds) {
        formLabelIds.split(/\s+/).filter(Boolean).forEach((id) => {
          const element = document.getElementById(id);
          pushCandidate(element?.innerText || element?.textContent || '');
        });
      }

      const container = form.parentElement?.parentElement || form.parentElement || form;
      if (container?.querySelectorAll) {
        Array.from(container.querySelectorAll('span, p, div'))
          .forEach((element) => {
            const text = normalizeInlineText(element?.innerText || element?.textContent || '');
            if (!text) {
              return;
            }
            if (text.length > 160) {
              return;
            }
            if (!/(?:whats\s*app|sms|text\s*message|一次性验证码|验证码|verification\s+code|one[-\s]*time\s+code)/i.test(text)) {
              return;
            }
            pushCandidate(text);
          });
      }
      pushKeywordSegments(container?.innerText || container?.textContent || '');
      return candidates;
    }

    function getAddPhoneDeliveryInfo() {
      const candidates = collectAddPhoneDeliveryTextCandidates();
      const combinedText = normalizeInlineText(candidates.join(' '));
      const pageLevelWhatsAppText = candidates.find((text) => (
        /whats\s*app/i.test(text)
        && /(?:verification\s+code|one[-\s]*time\s+code|验证码|一次性验证码)/i.test(text)
      )) || '';
      const smsDeliveryText = candidates.find((text) => (
        /(?:sms|text\s*message|短信)/i.test(text)
        && /(?:verification\s+code|one[-\s]*time\s+code|验证码|一次性验证码)/i.test(text)
      )) || '';
      const conciseText = pageLevelWhatsAppText
        || smsDeliveryText
        || candidates.find((text) => /(verification\s+code|one[-\s]*time\s+code|验证码|一次性验证码)/i.test(text))
        || combinedText;
      if (pageLevelWhatsAppText) {
        return {
          channel: 'whatsapp',
          text: conciseText,
          candidates,
        };
      }
      if (smsDeliveryText) {
        return {
          channel: 'sms',
          text: conciseText,
          candidates,
        };
      }
      return {
        channel: '',
        text: conciseText,
        candidates,
      };
    }

    function getPhoneVerificationCodeInput() {
      const form = getPhoneVerificationForm();
      if (!form) return null;
      const input = form.querySelector(
        'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]'
      );
      return input && isVisibleElement(input) ? input : null;
    }

    function getPhoneVerificationSubmitButton() {
      const form = getPhoneVerificationForm();
      if (!form) return null;
      const buttons = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
      return buttons.find((button) => {
        if (!isVisibleElement(button) || !isActionEnabled(button)) return false;
        const intent = String(button.getAttribute('value') || '').trim().toLowerCase();
        if (intent === 'resend') return false;
        return true;
      }) || buttons.find((button) => isVisibleElement(button));
    }

    function getPhoneVerificationResendActionText(button) {
      if (!button) return '';
      return [
        button.getAttribute?.('value'),
        button.getAttribute?.('aria-label'),
        button.getAttribute?.('title'),
        getActionText(button),
        button.textContent,
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    function isWhatsAppResendText(value) {
      return /whats\s*app/i.test(String(value || ''));
    }

    function getPhoneVerificationResendActionInfo(button) {
      const text = getPhoneVerificationResendActionText(button);
      const channel = isWhatsAppResendText(text)
        ? 'whatsapp'
        : (/(?:sms|text\s+message|短信)/i.test(text) ? 'sms' : '');
      return {
        channel,
        channelText: text,
        text,
      };
    }

    function getPhoneVerificationResendButton(options = {}) {
      const { allowDisabled = false } = options;
      const form = getPhoneVerificationForm();
      if (!form) return null;
      const buttons = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"]'));
      return buttons.find((button) => {
        if (!isVisibleElement(button)) return false;
        if (!allowDisabled && !isActionEnabled(button)) return false;
        const intent = String(button.getAttribute('value') || '').trim().toLowerCase();
        if (intent === 'resend') return true;
        return /resend|重新发送|再次发送|whats\s*app/i.test(getPhoneVerificationResendActionText(button));
      }) || null;
    }

    function getPhoneVerificationDisplayedPhone() {
      const text = getPageTextSnapshot();
      const matches = text.match(/\+\d[\d\s-]{6,}\d/g);
      return matches?.[0] ? matches[0].replace(/\s+/g, ' ').trim() : '';
    }

    function collectPhoneVerificationDeliveryTextCandidates() {
      const form = getPhoneVerificationForm();
      if (!form) {
        return [];
      }
      const candidates = [];
      const seen = new Set();
      const pushCandidate = (value) => {
        const text = normalizeInlineText(value);
        if (!text) {
          return;
        }
        const key = text.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        candidates.push(text);
      };
      const pushElementText = (element, options = {}) => {
        const { skipVisibilityCheck = false } = options;
        if (!element) {
          return;
        }
        if (!skipVisibilityCheck && !isVisibleElement(element)) {
          return;
        }
        pushCandidate(element.innerText || element.textContent || '');
      };
      const pushElementsByIds = (rawIds = '', options = {}) => {
        String(rawIds || '')
          .split(/\s+/)
          .map((id) => id.trim())
          .filter(Boolean)
          .forEach((id) => {
            pushElementText(document.getElementById(id), options);
          });
      };

      const codeInput = getPhoneVerificationCodeInput();
      pushElementsByIds(codeInput?.getAttribute?.('aria-describedby'), { skipVisibilityCheck: true });
      pushElementsByIds(form.getAttribute?.('aria-describedby'), { skipVisibilityCheck: true });
      pushElementsByIds(form.getAttribute?.('aria-labelledby'), { skipVisibilityCheck: true });

      const formContainer = form.parentElement?.parentElement || form.parentElement || form;
      const labeledNodes = formContainer?.querySelectorAll?.('[id]');
      if (labeledNodes?.length) {
        Array.from(labeledNodes).forEach((element) => {
          if (form.contains(element)) {
            return;
          }
          if (element.matches?.('button, input, textarea, select, label')) {
            return;
          }
          pushElementText(element, { skipVisibilityCheck: true });
        });
      }

      return candidates;
    }

    function getPhoneVerificationDeliveryInfo() {
      const candidates = collectPhoneVerificationDeliveryTextCandidates();
      const combinedText = normalizeInlineText(candidates.join(' '));
      if (/whats\s*app/i.test(combinedText)) {
        return {
          channel: 'whatsapp',
          text: combinedText,
          candidates,
        };
      }
      if (/(?:^|\b)(?:sms|text\s*message)(?:\b|$)|短信/i.test(combinedText)) {
        return {
          channel: 'sms',
          text: combinedText,
          candidates,
        };
      }
      return {
        channel: '',
        text: combinedText,
        candidates,
      };
    }

    function getAddPhoneErrorText() {
      const form = getAddPhoneForm();
      if (!form) {
        return '';
      }

      const messages = [];
      const selectors = [
        '.react-aria-FieldError',
        '[slot="errorMessage"]',
        '[id$="-error"]',
        '[data-invalid="true"] + *',
        '[aria-invalid="true"] + *',
        '[class*="error"]',
      ];
      for (const selector of selectors) {
        form.querySelectorAll(selector).forEach((el) => {
          const text = String(el?.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) {
            messages.push(text);
          }
        });
      }

      const invalidInput = form.querySelector('input[aria-invalid="true"], input[data-invalid="true"]');
      if (invalidInput) {
        const wrapper = invalidInput.closest('form, [data-rac], div');
        const text = String(wrapper?.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
          messages.push(text);
        }
      }

      const preferred = messages.find((text) => (
        /already|used|linked|eligible|invalid|phone|号码|手机号|错误|失败|try\s+again/i.test(text)
      ));
      return preferred || messages[0] || '';
    }

    function getPhoneVerificationInlineMessages() {
      const form = getPhoneVerificationForm();
      if (!form) {
        return [];
      }
      const messages = [];
      const selectors = [
        '.react-aria-FieldError',
        '[slot="errorMessage"]',
        '[id$="-error"]',
        '[data-invalid="true"] + *',
        '[aria-invalid="true"] + *',
        '[class*="error"]',
      ];
      for (const selector of selectors) {
        form.querySelectorAll(selector).forEach((element) => {
          const text = String(element?.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) {
            messages.push(text);
          }
        });
      }
      const verificationError = String(getVerificationErrorText?.() || '').trim();
      if (verificationError) {
        messages.push(verificationError);
      }
      return messages;
    }

    function getPhoneResendThrottleText() {
      const inlineMatch = getPhoneVerificationInlineMessages()
        .find((text) => PHONE_RESEND_THROTTLED_PATTERN.test(text));
      if (inlineMatch) {
        return inlineMatch;
      }
      const pageSnapshot = String(getPageTextSnapshot?.() || '').replace(/\s+/g, ' ').trim();
      if (pageSnapshot && PHONE_RESEND_THROTTLED_PATTERN.test(pageSnapshot)) {
        const concise = pageSnapshot.match(
          /tried\s+to\s+resend\s+too\s+many\s+times[^.。!?]*[.。!?]?|please\s+try\s+again\s+later[^.。!?]*[.。!?]?|发送.*过于频繁[^。!?]*[。!?]?|稍后再试[^。!?]*[。!?]?/i
        );
        return String(concise?.[0] || pageSnapshot).trim();
      }
      return '';
    }

    function getPhoneResendBannedNumberText() {
      const inlineMatch = getPhoneVerificationInlineMessages()
        .find((text) => PHONE_RESEND_BANNED_NUMBER_PATTERN.test(text));
      if (inlineMatch) {
        return inlineMatch;
      }
      const pageSnapshot = String(getPageTextSnapshot?.() || '').replace(/\s+/g, ' ').trim();
      if (pageSnapshot && PHONE_RESEND_BANNED_NUMBER_PATTERN.test(pageSnapshot)) {
        const concise = pageSnapshot.match(
          /无法向此电话号码发送短信|无法向此手机号发送短信|无法发送短信到此电话号码|无法发送短信到此手机号|can(?:not|'t)\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number[^.。!?]*[.。!?]?|unable\s+to\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number[^.。!?]*[.。!?]?/i
        );
        return String(concise?.[0] || pageSnapshot).trim();
      }
      return '';
    }

    function getPhoneResendServerErrorText() {
      const path = String(location?.pathname || '');
      if (!/\/contact-verification(?:[/?#]|$)/i.test(path)) {
        return '';
      }
      const text = String(getPageTextSnapshot?.() || '').replace(/\s+/g, ' ').trim();
      const title = String(document?.title || '').replace(/\s+/g, ' ').trim();
      const combined = `${title} ${text}`.trim();
      if (!PHONE_RESEND_SERVER_ERROR_PATTERN.test(combined)) {
        return '';
      }
      return combined || 'OpenAI contact-verification page returned HTTP ERROR 500 after resend.';
    }

    function checkPhoneResendError() {
      const maxUsageText = getAddPhoneErrorText();
      if (maxUsageText && PHONE_MAX_USAGE_EXCEEDED_PATTERN.test(maxUsageText)) {
        return {
          hasError: true,
          reason: 'phone_max_usage_exceeded',
          message: maxUsageText,
          url: location.href,
        };
      }

      const bannedNumberText = getPhoneResendBannedNumberText();
      if (bannedNumberText) {
        return {
          hasError: true,
          reason: 'resend_phone_banned',
          prefix: PHONE_RESEND_BANNED_NUMBER_ERROR_PREFIX,
          message: bannedNumberText,
          url: location.href,
        };
      }

      const throttledText = getPhoneResendThrottleText();
      if (throttledText) {
        return {
          hasError: true,
          reason: 'resend_throttled',
          prefix: PHONE_RESEND_THROTTLED_ERROR_PREFIX,
          message: throttledText,
          url: location.href,
        };
      }

      const serverErrorText = getPhoneResendServerErrorText();
      if (serverErrorText) {
        return {
          hasError: true,
          reason: 'resend_server_error',
          prefix: PHONE_RESEND_SERVER_ERROR_PREFIX,
          message: serverErrorText,
          url: location.href,
        };
      }

      return {
        hasError: false,
        reason: '',
        message: '',
        url: location.href,
      };
    }

    function getAuthRetryButton(options = {}) {
      const { allowDisabled = false } = options;
      const direct = document.querySelector('button[data-dd-action-name="Try again"]');
      if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
        return direct;
      }

      const candidates = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
      return Array.from(candidates).find((element) => {
        if (!isVisibleElement(element) || (!allowDisabled && !isActionEnabled(element))) {
          return false;
        }
        const text = String(getActionText?.(element) || '').trim();
        return /重试|try\s+again/i.test(text);
      }) || null;
    }

    function is405MethodNotAllowedPage() {
      const path = String(location?.pathname || '');
      if (!/\/phone-verification(?:[/?#]|$)/i.test(path) && !/\/add-phone(?:[/?#]|$)/i.test(path)) {
        return false;
      }
      const text = String(getPageTextSnapshot?.() || '').replace(/\s+/g, ' ').trim();
      const title = String(document?.title || '');
      const matched = PHONE_ROUTE_405_PATTERN.test(text) || PHONE_ROUTE_405_PATTERN.test(title);
      if (!matched) {
        return false;
      }
      return Boolean(getAuthRetryButton({ allowDisabled: true }));
    }

    async function recoverPhoneRoute405(timeout = 12000, options = {}) {
      const now = Date.now();
      if (
        lastPhoneRoute405RecoveryFailedAt > 0
        && now - lastPhoneRoute405RecoveryFailedAt < PHONE_ROUTE_405_RECOVERY_COOLDOWN_MS
      ) {
        throw new Error(
          `${PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX}Phone verification route is still in 405 recovery cooldown (${Math.ceil((PHONE_ROUTE_405_RECOVERY_COOLDOWN_MS - (now - lastPhoneRoute405RecoveryFailedAt)) / 1000)}s left). URL: ${location.href}`
        );
      }

      const startedAt = Date.now();
      let clicked = 0;
      const maxRetryClicks = Math.max(
        1,
        Math.floor(Number(options?.maxRetryClicks) || PHONE_ROUTE_405_MAX_RECOVERY_CLICKS)
      );
      while (Date.now() - startedAt < timeout) {
        throwIfStopped();
        if (!is405MethodNotAllowedPage()) {
          return;
        }
        const retryButton = getAuthRetryButton({ allowDisabled: true });
        if (retryButton && isActionEnabled(retryButton)) {
          if (clicked >= maxRetryClicks) {
            lastPhoneRoute405RecoveryFailedAt = Date.now();
            throw new Error(
              `${PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX}Phone verification route stayed on 405 after ${clicked} retry click(s). URL: ${location.href}`
            );
          }
          clicked += 1;
          await humanPause(200, 500);
          await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'click', label: 'phone-route-retry' }, async () => {
            simulateClick(retryButton);
          });
          await sleep(1000);
          continue;
        }
        await sleep(250);
      }
      lastPhoneRoute405RecoveryFailedAt = Date.now();
      throw new Error(
        `${PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX}Phone verification route 405 recovery timed out after ${clicked} retry click(s). URL: ${location.href}`
      );
    }

    async function waitForAddPhoneReady(timeout = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        throwIfStopped();
        if (isAddPhonePageReady()) {
          return true;
        }
        await sleep(150);
      }
      throw new Error('Timed out waiting for add-phone page.');
    }

    async function waitForPhoneVerificationReady(timeout = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        throwIfStopped();
        if (is405MethodNotAllowedPage()) {
          await recoverPhoneRoute405(Math.min(12000, Math.max(1000, timeout - (Date.now() - start))));
          continue;
        }
        if (isPhoneVerificationPageReady()) {
          const deliveryInfo = getPhoneVerificationDeliveryInfo();
          return {
            phoneVerificationPage: true,
            displayedPhone: getPhoneVerificationDisplayedPhone(),
            phoneVerificationDeliveryChannel: deliveryInfo.channel || '',
            phoneVerificationDeliveryText: deliveryInfo.text || '',
            phoneVerificationWhatsApp: deliveryInfo.channel === 'whatsapp',
            phoneVerificationDeliveryCandidates: Array.isArray(deliveryInfo.candidates)
              ? deliveryInfo.candidates
              : [],
            url: location.href,
          };
        }
        if (isAddPhonePageReady()) {
          const errorText = getAddPhoneErrorText();
          if (errorText) {
            return {
              addPhoneRejected: true,
              errorText,
              url: location.href,
            };
          }
        }
        await sleep(150);
      }
      if (isAddPhonePageReady()) {
        const errorText = getAddPhoneErrorText();
        if (errorText) {
          return {
            addPhoneRejected: true,
            errorText,
            url: location.href,
          };
        }
      }
      throw new Error('Timed out waiting for phone verification page.');
    }

    async function submitPhoneNumber(payload = {}) {
      const countryLabel = String(payload.countryLabel || '').trim();
      const isExplicitInternational = isExplicitInternationalPhoneInput(payload.phoneNumber);
      await waitForAddPhoneReady();
      await ensureSmsChannelSelected();
      const countrySelected = await ensureCountrySelected(countryLabel, payload.phoneNumber);
      if (!countrySelected) {
        throw new Error(`Failed to select "${countryLabel || 'target country'}" on the add-phone page.`);
      }

      const addPhoneDeliveryInfo = getAddPhoneDeliveryInfo();
      if (addPhoneDeliveryInfo.channel === 'whatsapp') {
        throw new Error(
          `${STEP9_WHATSAPP_PAGE_RESTART_ERROR_PREFIX}步骤 9：当前添加手机号页面显示将通过 WhatsApp 发送验证码，需释放当前号码并从 open-chatgpt 重开自动流程。页面文案：${addPhoneDeliveryInfo.text || 'WhatsApp'}；URL: ${location.href}`
        );
      }

      const dialCode = getDisplayedDialCode();
      if (!dialCode && !isExplicitInternational) {
        throw new Error(`Could not determine the dial code for "${countryLabel}" on the add-phone page.`);
      }

      const phoneNumber = toE164PhoneNumber(payload.phoneNumber, dialCode);
      const nationalPhoneNumber = toNationalPhoneNumber(payload.phoneNumber, dialCode);
      if (!phoneNumber || !nationalPhoneNumber) {
        throw new Error('Missing phone number for add-phone submission.');
      }

      const phoneInput = getPhoneInput() || await waitForElement(
        'input[type="tel"], input[name="__reservedForPhoneNumberInput_tel"], input[autocomplete="tel"]',
        10000
      );
      const hiddenPhoneNumberInput = getHiddenPhoneNumberInput();
      const submitButton = getAddPhoneSubmitButton();

      if (!phoneInput) {
        throw new Error('Add-phone page is missing the phone number input.');
      }
      if (!submitButton) {
        throw new Error('Add-phone page is missing the submit button.');
      }

      await humanPause(250, 700);
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'fill', label: 'phone-number' }, async () => {
        fillInput(phoneInput, nationalPhoneNumber);
      });
      if (hiddenPhoneNumberInput) {
        await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'hidden-sync', label: 'phone-number-hidden-sync' }, async () => {
          hiddenPhoneNumberInput.value = phoneNumber;
          dispatchInputEvents(hiddenPhoneNumberInput);
        });
      }
      await ensureSmsChannelSelected();
      await sleep(250);
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'submit', label: 'phone-number-submit' }, async () => {
        simulateClick(submitButton);
      });
      return waitForPhoneVerificationReady();
    }

    async function waitForPhoneVerificationOutcome(timeout = 30000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        throwIfStopped();
        if (is405MethodNotAllowedPage()) {
          await recoverPhoneRoute405(Math.min(12000, Math.max(1000, timeout - (Date.now() - start))));
          continue;
        }

        const errorText = getVerificationErrorText();
        if (errorText) {
          return {
            invalidCode: true,
            errorText,
            url: location.href,
          };
        }

        if (isConsentReady()) {
          return {
            success: true,
            consentReady: true,
            url: location.href,
          };
        }

        if (isAddPhonePageReady()) {
          return {
            returnedToAddPhone: true,
            url: location.href,
          };
        }

        await sleep(150);
      }

      if (isPhoneVerificationPageReady()) {
        return {
          invalidCode: true,
          errorText: getVerificationErrorText() || 'Phone verification page stayed in place after code submission.',
          url: location.href,
        };
      }

      return {
        success: true,
        assumed: true,
        url: location.href,
      };
    }

    async function submitPhoneVerificationCode(payload = {}) {
      const code = String(payload.code || '').trim();
      if (!code) {
        throw new Error('Missing phone verification code.');
      }

      await waitForPhoneVerificationReady();
      const codeInput = getPhoneVerificationCodeInput() || await waitForElement(
        'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
        10000
      );
      const submitButton = getPhoneVerificationSubmitButton();

      if (!codeInput) {
        throw new Error('Phone verification page is missing the code input.');
      }
      if (!submitButton) {
        throw new Error('Phone verification page is missing the submit button.');
      }

      await humanPause(250, 700);
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'fill', label: 'phone-verification-code' }, async () => {
        fillInput(codeInput, code);
      });
      await sleep(250);
      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'submit', label: 'phone-verification-submit' }, async () => {
        simulateClick(submitButton);
      });
      if (is405MethodNotAllowedPage()) {
        await recoverPhoneRoute405(12000);
      }
      return waitForPhoneVerificationOutcome();
    }

    async function resendPhoneVerificationCode(timeout = 45000, options = {}) {
      if (activePhoneResendPromise) {
        return activePhoneResendPromise;
      }

      activePhoneResendPromise = (async () => {
        const start = Date.now();
        const route405RecoveryStart = Date.now();
        let route405RecoveryCount = 0;
        const recoverRoute405WithinResend = async () => {
          route405RecoveryCount += 1;
          if (route405RecoveryCount > PHONE_RESEND_ROUTE_405_MAX_RECOVERIES) {
            throw new Error(
              `${PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX}Phone verification resend stayed on route-405 page after ${PHONE_RESEND_ROUTE_405_MAX_RECOVERIES} recovery round(s). URL: ${location.href}`
            );
          }
          const recoveryBudgetLeft = PHONE_RESEND_ROUTE_405_MAX_RECOVERY_TOTAL_MS - (Date.now() - route405RecoveryStart);
          if (recoveryBudgetLeft <= 0) {
            throw new Error(
              `${PHONE_ROUTE_405_RECOVERY_FAILED_ERROR_PREFIX}Phone verification resend exceeded route-405 recovery budget (${PHONE_RESEND_ROUTE_405_MAX_RECOVERY_TOTAL_MS}ms). URL: ${location.href}`
            );
          }
          const remainingTimeout = Math.max(1000, timeout - (Date.now() - start));
          const recoveryTimeout = Math.max(1000, Math.min(12000, recoveryBudgetLeft, remainingTimeout));
          await recoverPhoneRoute405(recoveryTimeout);
        };

        while (Date.now() - start < timeout) {
          throwIfStopped();
          if (is405MethodNotAllowedPage()) {
            await recoverRoute405WithinResend();
            continue;
          }
          const bannedNumberText = getPhoneResendBannedNumberText();
          if (bannedNumberText) {
            throw new Error(`${PHONE_RESEND_BANNED_NUMBER_ERROR_PREFIX}${bannedNumberText}`);
          }
          const throttledText = getPhoneResendThrottleText();
          if (throttledText) {
            throw new Error(`${PHONE_RESEND_THROTTLED_ERROR_PREFIX}${throttledText}`);
          }
          const serverErrorText = getPhoneResendServerErrorText();
          if (serverErrorText) {
            throw new Error(`${PHONE_RESEND_SERVER_ERROR_PREFIX}${serverErrorText}`);
          }
          const resendButton = getPhoneVerificationResendButton({ allowDisabled: true });
          if (resendButton && isActionEnabled(resendButton)) {
            const resendInfo = getPhoneVerificationResendActionInfo(resendButton);
            if (resendInfo.channel === 'whatsapp') {
              return {
                resent: false,
                channel: 'whatsapp',
                channelText: resendInfo.channelText,
                text: resendInfo.text,
                url: location.href,
              };
            }
            if (options?.probeOnly) {
              return {
                resent: false,
                probed: true,
                channel: resendInfo.channel || 'unknown',
                channelText: resendInfo.channelText,
                text: resendInfo.text,
                url: location.href,
              };
            }
            await humanPause(250, 700);
            await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'click', label: 'phone-verification-resend' }, async () => {
              simulateClick(resendButton);
            });
            await sleep(1000);
            if (is405MethodNotAllowedPage()) {
              await recoverRoute405WithinResend();
              continue;
            }
            const afterClickBannedNumberText = getPhoneResendBannedNumberText();
            if (afterClickBannedNumberText) {
              throw new Error(`${PHONE_RESEND_BANNED_NUMBER_ERROR_PREFIX}${afterClickBannedNumberText}`);
            }
            const afterClickThrottleText = getPhoneResendThrottleText();
            if (afterClickThrottleText) {
              throw new Error(`${PHONE_RESEND_THROTTLED_ERROR_PREFIX}${afterClickThrottleText}`);
            }
            const afterClickServerErrorText = getPhoneResendServerErrorText();
            if (afterClickServerErrorText) {
              throw new Error(`${PHONE_RESEND_SERVER_ERROR_PREFIX}${afterClickServerErrorText}`);
            }
            return {
              resent: true,
              channel: resendInfo.channel || 'sms',
              channelText: resendInfo.channelText,
              text: resendInfo.text,
              url: location.href,
            };
          }
          await sleep(250);
        }

        const timeoutBannedNumberText = getPhoneResendBannedNumberText();
        if (timeoutBannedNumberText) {
          throw new Error(`${PHONE_RESEND_BANNED_NUMBER_ERROR_PREFIX}${timeoutBannedNumberText}`);
        }

        const timeoutThrottleText = getPhoneResendThrottleText();
        if (timeoutThrottleText) {
          throw new Error(`${PHONE_RESEND_THROTTLED_ERROR_PREFIX}${timeoutThrottleText}`);
        }

        const timeoutServerErrorText = getPhoneResendServerErrorText();
        if (timeoutServerErrorText) {
          throw new Error(`${PHONE_RESEND_SERVER_ERROR_PREFIX}${timeoutServerErrorText}`);
        }

        throw new Error('Timed out waiting for the phone verification resend button.');
      })().finally(() => {
        activePhoneResendPromise = null;
      });

      return activePhoneResendPromise;
    }

    async function returnToAddPhone(timeout = 20000) {
      if (isAddPhonePageReady()) {
        return {
          addPhonePage: true,
          url: location.href,
        };
      }

      if (!isPhoneVerificationPageReady()) {
        throw new Error('The auth page is not currently on phone verification or add-phone page.');
      }

      await performOperationWithDelay({ stepKey: 'phone-auth', kind: 'navigation', label: 'phone-return-add-phone' }, async () => {
        location.assign('/add-phone');
      });
      await waitForAddPhoneReady(timeout);
      return {
        addPhonePage: true,
        url: location.href,
      };
    }

    return {
      getAddPhoneDeliveryInfo,
      getPhoneVerificationDeliveryInfo,
      getPhoneVerificationDisplayedPhone,
      checkPhoneResendError,
      isPhoneVerificationPageReady,
      resendPhoneVerificationCode,
      returnToAddPhone,
      submitPhoneNumber,
      submitPhoneVerificationCode,
      toE164PhoneNumber,
    };
  }

  return {
    createPhoneAuthHelpers,
  };
});
