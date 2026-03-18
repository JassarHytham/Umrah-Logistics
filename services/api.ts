
const API_BASE = '/api';

export const api = {
  async request(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem('umrah_auth_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (response.status === 401) {
      localStorage.removeItem('umrah_auth_token');
      window.location.reload();
      throw new Error('Unauthorized');
    }
    
    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}...`);
    }

    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  auth: {
    async login(credentials: any) {
      const data = await api.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('umrah_auth_token', data.token);
      return data.user;
    },
    async register(credentials: any) {
      const data = await api.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('umrah_auth_token', data.token);
      return data.user;
    },
    logout() {
      localStorage.removeItem('umrah_auth_token');
      window.location.reload();
    }
  },

  data: {
    async fetchRows() {
      return api.request('/data');
    },
    async syncRows(rows: any[]) {
      return api.request('/data/sync', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
    }
  },

  settings: {
    async fetch() {
      return api.request('/settings');
    },
    async save(settings: any) {
      return api.request('/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      });
    }
  }
};
