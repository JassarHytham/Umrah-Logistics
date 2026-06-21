
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

    if (!response.ok) {
      const error: any = new Error(data.error || 'Request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  auth: {
    async login(credentials: any) {
      const data = await api.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('umrah_auth_token', data.token);
      localStorage.setItem('umrah_user', JSON.stringify(data.user));
      return data.user;
    },
    async register(credentials: any) {
      const data = await api.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      localStorage.setItem('umrah_auth_token', data.token);
      localStorage.setItem('umrah_user', JSON.stringify(data.user));
      return data.user;
    },
    logout() {
      localStorage.removeItem('umrah_auth_token');
      localStorage.removeItem('umrah_user');
      window.location.reload();
    }
  },

  data: {
    async fetchRows() {
      return api.request('/data');
    },
    async fetchDeletedRows() {
      return api.request('/data/deleted');
    },
    async syncRows(rows: any[]) {
      return api.request('/data/sync', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
    },
    async updateRow(id: string, updates: any, baseVersion?: number) {
      return api.request(`/data/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ updates, ...(baseVersion !== undefined ? { baseVersion } : {}) }),
      });
    },
    async deleteRow(id: string) {
      return api.request(`/data/${id}/delete`, {
        method: 'POST',
      });
    },
    async permanentlyDeleteRow(id: string) {
      return api.request(`/data/${id}`, {
        method: 'DELETE',
      });
    },
    async clearDeletedRows() {
      return api.request('/data/deleted', {
        method: 'DELETE',
      });
    },
    async restoreRow(id: string) {
      return api.request(`/data/${id}/restore`, {
        method: 'POST',
      });
    }
  },

  shares: {
    async fetchInvitations() {
      return api.request('/shares/invitations');
    },
    async createInvitation(payload: any) {
      return api.request('/shares/invitations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    async acceptInvitation(id: number) {
      return api.request(`/shares/invitations/${id}/accept`, {
        method: 'POST',
      });
    },
    async declineInvitation(id: number) {
      return api.request(`/shares/invitations/${id}/decline`, {
        method: 'POST',
      });
    },
    async fetchAccess() {
      return api.request('/shares/access');
    },
    async updateAccessRole(payload: any) {
      return api.request('/shares/access', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    async revokeAccess(payload: any) {
      return api.request('/shares/access', {
        method: 'DELETE',
        body: JSON.stringify(payload),
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
