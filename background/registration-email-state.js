(function attachBackgroundRegistrationEmailState(root, factory) {
  root.MultiPageRegistrationEmailState = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundRegistrationEmailStateModule() {
  const DEFAULT_REGISTRATION_EMAIL_STATE = Object.freeze({
    current: '',
    previous: '',
    source: '',
    updatedAt: 0,
  });

  function createRegistrationEmailStateHelpers() {
    function normalizeEmailValue(value) {
      return String(value || '').trim();
    }

    function cloneDefaultRegistrationEmailState() {
      return {
        current: DEFAULT_REGISTRATION_EMAIL_STATE.current,
        previous: DEFAULT_REGISTRATION_EMAIL_STATE.previous,
        source: DEFAULT_REGISTRATION_EMAIL_STATE.source,
        updatedAt: DEFAULT_REGISTRATION_EMAIL_STATE.updatedAt,
      };
    }

    function normalizeRegistrationEmailState(value, fallbackEmail = '') {
      const fallback = normalizeEmailValue(fallbackEmail);
      const candidate = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
      const current = normalizeEmailValue(candidate?.current || fallback);
      const previous = normalizeEmailValue(candidate?.previous || current || fallback);
      const source = String(candidate?.source || '').trim();
      const updatedAt = Number(candidate?.updatedAt) || 0;
      return {
        current,
        previous,
        source,
        updatedAt: updatedAt > 0 ? updatedAt : 0,
      };
    }

    function getRegistrationEmailState(state = {}) {
      return normalizeRegistrationEmailState(state?.registrationEmailState, state?.email);
    }

    function buildRegistrationEmailStateUpdates(state = {}, options = {}) {
      const currentState = getRegistrationEmailState(state);
      const currentEmail = normalizeEmailValue(options.currentEmail);
      const preservePrevious = Boolean(options.preservePrevious);
      const source = String(options.source || '').trim();
      const nextState = cloneDefaultRegistrationEmailState();

      nextState.current = currentEmail;
      nextState.previous = currentEmail || (preservePrevious ? currentState.previous : '');
      nextState.source = currentEmail
        ? (source || currentState.source)
        : (preservePrevious ? currentState.source : '');
      nextState.updatedAt = currentEmail || (preservePrevious && currentState.previous)
        ? Date.now()
        : 0;

      return {
        email: currentEmail || null,
        registrationEmailState: nextState,
      };
    }

    function getPreservedPhoneIdentity(state = {}) {
      const accountIdentifierType = String(state?.accountIdentifierType || '').trim().toLowerCase();
      const signupPhoneNumber = normalizeEmailValue(
        state?.signupPhoneNumber
        || (accountIdentifierType === 'phone' ? state?.accountIdentifier : '')
        || state?.signupPhoneCompletedActivation?.phoneNumber
        || state?.signupPhoneActivation?.phoneNumber
        || ''
      );
      if (accountIdentifierType !== 'phone' && !signupPhoneNumber) {
        return null;
      }
      return {
        accountIdentifierType: 'phone',
        accountIdentifier: signupPhoneNumber || normalizeEmailValue(state?.accountIdentifier),
        signupPhoneNumber,
        signupPhoneActivation: state?.signupPhoneActivation || null,
        signupPhoneCompletedActivation: state?.signupPhoneCompletedActivation || null,
        signupPhoneVerificationRequestedAt: state?.signupPhoneVerificationRequestedAt ?? null,
        signupPhoneVerificationPurpose: String(state?.signupPhoneVerificationPurpose || '').trim(),
      };
    }

    function buildFlowRegistrationEmailStateUpdates(state = {}, options = {}) {
      const registrationEmailUpdates = buildRegistrationEmailStateUpdates(state, options);
      if (!Boolean(options?.preserveAccountIdentity)) {
        return registrationEmailUpdates;
      }
      const preservedPhoneIdentity = getPreservedPhoneIdentity(state);
      if (!preservedPhoneIdentity) {
        return registrationEmailUpdates;
      }
      return {
        ...registrationEmailUpdates,
        phoneNumber: '',
        ...preservedPhoneIdentity,
      };
    }

    function buildClearedRegistrationEmailStateUpdates(state = {}, options = {}) {
      const preservePrevious = options.preservePrevious !== false;
      const preserveAccountIdentity = Boolean(options?.preserveAccountIdentity);
      return buildFlowRegistrationEmailStateUpdates(state, {
        currentEmail: '',
        preservePrevious,
        preserveAccountIdentity,
        source: String(options?.source || '').trim(),
      });
    }

    function getRegistrationEmailBaseline(state = {}, options = {}) {
      const currentState = getRegistrationEmailState(state);
      const preferredEmail = normalizeEmailValue(options.preferredEmail);
      const fallbackEmail = normalizeEmailValue(options.fallbackEmail);
      return preferredEmail || currentState.current || currentState.previous || fallbackEmail || '';
    }

    return {
      buildClearedRegistrationEmailStateUpdates,
      DEFAULT_REGISTRATION_EMAIL_STATE: cloneDefaultRegistrationEmailState(),
      buildFlowRegistrationEmailStateUpdates,
      buildRegistrationEmailStateUpdates,
      getRegistrationEmailBaseline,
      getRegistrationEmailState,
      getPreservedPhoneIdentity,
      normalizeRegistrationEmailState,
    };
  }

  return {
    createRegistrationEmailStateHelpers,
  };
});
