'use strict';

// Lightweight API client + shared client state.
const API = (() => {
  const TOKEN_KEY = 'tm_token';
  let token = localStorage.getItem(TOKEN_KEY) || null;

  function setToken(t) {
    token = t;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function request(method, path, body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    del: (p) => request('DELETE', p),
    setToken,
    hasToken: () => !!token,

    login: (username, password) => request('POST', '/login', { username, password }),
    bootstrap: () => request('GET', '/bootstrap'),
  };
})();
