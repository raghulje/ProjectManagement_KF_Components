import {
  KF_API_ORIGIN,
  buildKissflowAccessKeyHeaders,
  getTenantAccessKeys,
} from './kfAccessKeys.js';

const DEV_KISSFLOW_ORIGIN = 'https://development-refexgroup.kissflow.com';
const LIVE_KISSFLOW_ORIGIN = 'https://refexgroup.kissflow.com';

/** Default page_size for Kissflow admin / report list endpoints (tasks, subtasks, CRs). */
export const KF_ADMIN_PAGE_SIZE = 500;

const SESSION_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

/** Origin for direct fetch/API calls. Uses tenant when SDK is available. */
export function resolveKissflowApiOrigin(kfInstance) {
  if (kfInstance) {
    const tenant = getTenantAccessKeys(kfInstance);
    if (tenant.apiOrigin) return tenant.apiOrigin;
  }
  return KF_API_ORIGIN || DEV_KISSFLOW_ORIGIN;
}

export function resolveKissflowOrigin(kfInstance) {
  if (kfInstance) {
    const tenant = getTenantAccessKeys(kfInstance);
    if (tenant.apiOrigin) return tenant.apiOrigin;
  }

  const origin = typeof window !== 'undefined' && window?.location?.origin ? String(window.location.origin) : '';
  if (origin && origin.includes('kissflow.com')) return origin;

  const isDev =
    (typeof import.meta !== 'undefined' && import.meta?.env?.DEV) ||
    (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development');

  return isDev ? DEV_KISSFLOW_ORIGIN : LIVE_KISSFLOW_ORIGIN;
}

export function resolveKissflowAccountId(kfInstance, fallbackAccountId = '') {
  const sdkAccountId = String(kfInstance?.account?._id || '').trim();
  if (sdkAccountId) return sdkAccountId;

  const tenantFallback = kfInstance
    ? getTenantAccessKeys(kfInstance).defaultAccountId
    : fallbackAccountId;

  const candidates = [];
  const safePush = (v) => {
    if (v) candidates.push(String(v));
  };

  safePush(typeof window !== 'undefined' ? window?.location?.href : '');
  safePush(typeof window !== 'undefined' ? window?.location?.pathname : '');
  safePush(typeof document !== 'undefined' ? document?.referrer : '');

  try {
    safePush(typeof window !== 'undefined' ? window?.top?.location?.href : '');
    safePush(typeof window !== 'undefined' ? window?.top?.location?.pathname : '');
    safePush(typeof window !== 'undefined' ? window?.parent?.location?.href : '');
    safePush(typeof window !== 'undefined' ? window?.parent?.location?.pathname : '');
  } catch {
    // Cross-origin/sandboxed frames: ignore.
  }

  const re = /\/(?:flow|case|metadata|process)\/2\/([^/]+)/i;
  for (const raw of candidates) {
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  }

  return tenantFallback || fallbackAccountId;
}

export async function kfGetJson(kfInstance, path, _legacyAbsoluteUrl) {
  if (!kfInstance?.api) {
    throw new Error('Kissflow SDK not ready — open this page inside Kissflow.');
  }
  const resp = await kfInstance.api(path, { method: 'GET', headers: { Accept: 'application/json' } });
  return resp?.data ?? resp ?? null;
}

/** Run async work over items with a concurrency cap (avoids flooding Kissflow with N parallel calls). */
export async function runWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, list.length));
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) break;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, runWorker));
  return results;
}

function parseKfApiError(data, status) {
  if (data?.status === 'error' || data?.error_code) {
    return data.en_message || data.message || 'Kissflow request failed';
  }
  if (status && status >= 400) {
    return data?.en_message || data?.message || `HTTP ${status}`;
  }
  return '';
}

function isAuthError(errorOrMessage) {
  const message = String(errorOrMessage?.message || errorOrMessage || '').toLowerCase();
  return (
    message.includes('authorized') ||
    message.includes('authorisation') ||
    message.includes('forbidden') ||
    message.includes('401') ||
    message.includes('403')
  );
}

export async function kfMutateJson(
  kfInstance,
  path,
  {
    method = 'POST',
    body,
    accessKeyId,
    accessKeySecret,
    useAccessKeys,
    allowSdkFallback = true,
    preferSessionAuth = false,
  } = {},
) {
  const tenantKeys = getTenantAccessKeys(kfInstance);
  const keyId = String(accessKeyId || tenantKeys.accessKeyId || '').trim();
  const keySecret = String(accessKeySecret || tenantKeys.accessKeySecret || '').trim();
  const hasAccessKeys = Boolean(keyId && keySecret);
  const fetchBody = body !== undefined ? JSON.stringify(body) : undefined;
  const origin = resolveKissflowApiOrigin(kfInstance);

  async function mutateWithKfApi(headers) {
    if (!kfInstance?.api) {
      throw new Error('Kissflow SDK not available — open this page inside Kissflow.');
    }
    const resp = await kfInstance.api(path, {
      method,
      headers,
      body: fetchBody,
    });
    const data = resp?.data ?? resp ?? null;
    const err = parseKfApiError(data);
    if (err) throw new Error(err);
    return data;
  }

  async function mutateWithAccessKeysFetch() {
    const headers = buildKissflowAccessKeyHeaders(keyId, keySecret, kfInstance);
    const res = await fetch(`${origin}${path}`, {
      method,
      credentials: 'omit',
      headers,
      body: fetchBody,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = parseKfApiError(data, res.status);
      throw new Error(err || `HTTP ${res.status}`);
    }
    const err = parseKfApiError(data, res.status);
    if (err) throw new Error(err);
    return data;
  }

  async function mutateWithTenantAccessKeys() {
    if (!hasAccessKeys) {
      throw new Error(
        `Missing Kissflow access keys for ${tenantKeys.tenant} tenant. Set VITE_KF${tenantKeys.tenant === 'live' ? '_LIVE' : ''}_ACCESS_KEY_ID and VITE_KF${tenantKeys.tenant === 'live' ? '_LIVE' : ''}_ACCESS_KEY_SECRET, then rebuild.`,
      );
    }

    const accessHeaders = buildKissflowAccessKeyHeaders(keyId, keySecret, kfInstance);

    if (kfInstance?.api) {
      try {
        return await mutateWithKfApi(accessHeaders);
      } catch (error) {
        if (!allowSdkFallback) throw error;
        const message = String(error?.message || error);
        if (!message.toLowerCase().includes('failed to fetch')) throw error;
      }
    }

    try {
      return await mutateWithAccessKeysFetch();
    } catch (error) {
      if (kfInstance?.api && allowSdkFallback) {
        return mutateWithKfApi(accessHeaders);
      }
      throw error;
    }
  }

  // Embedded component: logged-in session first (IT dashboard pattern).
  if (preferSessionAuth && kfInstance?.api) {
    try {
      return await mutateWithKfApi(SESSION_HEADERS);
    } catch (sessionError) {
      if (!isAuthError(sessionError) || !hasAccessKeys) throw sessionError;
      return mutateWithTenantAccessKeys();
    }
  }

  if (useAccessKeys === false) {
    if (kfInstance?.api) {
      return mutateWithKfApi(SESSION_HEADERS);
    }
    throw new Error('Kissflow SDK not available — open this page inside Kissflow.');
  }

  if (useAccessKeys === true || (useAccessKeys == null && hasAccessKeys)) {
    return mutateWithTenantAccessKeys();
  }

  if (kfInstance?.api) {
    return mutateWithKfApi(SESSION_HEADERS);
  }

  throw new Error('Kissflow SDK not available — open this page inside Kissflow.');
}
