import { useContext, useEffect, useMemo, useState } from 'react';
import { KissflowSDKContext } from '../sdk/index.js';
import { getApiBase } from '../apiBase.js';
import { buildPmProcessApiPaths } from './kfPmMyItemsPaths.js';
import { TASKS_ENTITY } from './pmMyItemsEntities.js';

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function stringifyKfRole(abc) {
  if (!abc) return '';
  if (typeof abc === 'string') return abc.trim();
  if (Array.isArray(abc)) {
    for (const x of abc) {
      const s = stringifyKfRole(x);
      if (s) return s;
    }
    return '';
  }
  if (typeof abc === 'object') {
    const n = abc.Name ?? abc.name ?? abc._name ?? abc.Title ?? abc.title ?? abc.Role ?? abc.role ?? '';
    return String(n || '').trim();
  }
  return '';
}

/** Shared logged-in user session for User Hub pages (LeadsManagementHubPage pattern). */
export function useUserHubSession() {
  const { kf: kfFromContext, sdkReady } = useContext(KissflowSDKContext);
  const kfInstance = kfFromContext ?? (typeof window !== 'undefined' ? window.kf : null);
  const taskPaths = useMemo(() => buildPmProcessApiPaths(kfInstance, TASKS_ENTITY), [kfInstance]);

  const [user, setUser] = useState(null);
  const [roleName, setRoleName] = useState('');
  const [greeting, setGreeting] = useState(getTimeGreeting);

  useEffect(() => {
    const t = setInterval(() => setGreeting(getTimeGreeting()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const u = kfInstance?.user;
    if (!u?.Email && !u?.email) return;
    setUser((prev) => ({
      ...(prev || {}),
      _id: prev?._id || u._id,
      Name: prev?.Name || u.Name,
      FirstName: prev?.FirstName || u.FirstName || (u.Name && u.Name.split(' ')[0]) || 'User',
      Email: u.Email || u.email || prev?.Email || '',
    }));
  }, [kfInstance]);

  useEffect(() => {
    const sdk = kfInstance;
    if (!sdk?.user) return;
    const abc = sdk.user?.Role || sdk.context?.user?.Role || sdk.user?.Roles?.[0] || sdk.context?.user?.Roles?.[0] || null;
    const roleFromSdk = stringifyKfRole(abc);
    const resolved = String(abc?.Name || roleFromSdk || '').trim();
    if (resolved) setRoleName(resolved);
  }, [kfInstance]);

  useEffect(() => {
    if (!taskPaths) return;
    const kf = kfInstance;
    const userId = kf?.user?._id || kf?.context?.user?._id;
    if (!userId) {
      if (kf?.user?.Name) {
        const u = kf.user;
        setUser({
          _id: u._id,
          Name: u.Name,
          FirstName: u.FirstName || (u.Name && u.Name.split(' ')[0]) || 'User',
          Email: u.Email || u.email || '',
        });
      }
      return;
    }
    const path = taskPaths.userPathPrefix + userId + taskPaths.userPathSuffix;
    let cancelled = false;
    async function run() {
      try {
        let response;
        if (kf?.api) {
          const resp = await kf.api(path, { method: 'GET', headers: { Accept: 'application/json' } });
          response = resp?.data ?? resp ?? null;
        } else {
          const res = await fetch(getApiBase() + path, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) return;
          response = await res.json();
        }
        if (!cancelled && response && (response._id || response.Name)) setUser(response);
      } catch (e) {
        if (!cancelled) console.warn('UserHub user fetch failed:', e?.message || e);
      }
      if (!cancelled && !user && kf?.user?.Name) {
        const u = kf.user;
        setUser({
          _id: u._id,
          Name: u.Name,
          FirstName: u.FirstName || (u.Name && u.Name.split(' ')[0]) || 'User',
          Email: u.Email || u.email || '',
        });
      }
    }
    run();
    return () => { cancelled = true; };
  }, [sdkReady, taskPaths, kfInstance]);

  const scopeUser = useMemo(() => {
    if (user?._id || user?.Name) return user;
    const u = kfInstance?.user;
    if (!u) return null;
    return {
      _id: u._id,
      Name: u.Name,
      FirstName: u.FirstName || (u.Name && u.Name.split(' ')[0]) || 'User',
      Email: u.Email || u.email || '',
      Role: u.Role || u.Roles?.[0],
    };
  }, [user, kfInstance]);

  const firstName = user?.FirstName || user?.Name?.split(' ')[0] || kfInstance?.user?.FirstName || 'User';
  const displayRole =
    roleName
    || user?.Role?.Name?.trim()
    || kfInstance?.user?._user_type
    || kfInstance?.user?.Groups?.[0]?.Name
    || kfInstance?.user?.Roles?.[0]?.Name
    || 'User';

  return {
    kfInstance,
    scopeUser,
    firstName,
    displayRole,
    greeting,
  };
}
