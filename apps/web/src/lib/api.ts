import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

// ---- Phiên đăng nhập (docs/10 §7: access token chỉ trong bộ nhớ, refresh qua cookie httpOnly) ----
interface SessionState {
  accessToken: string | null;
  orgId: number | null;
}

export const sessionSlice = createSlice({
  name: 'session',
  initialState: { accessToken: null, orgId: null } as SessionState,
  reducers: {
    tokenReceived: (s, a: PayloadAction<string>) => {
      s.accessToken = a.payload;
    },
    orgSelected: (s, a: PayloadAction<number>) => {
      s.orgId = a.payload;
    },
    loggedOut: (s) => {
      s.accessToken = null;
    },
  },
});
export const { tokenReceived, orgSelected, loggedOut } = sessionSlice.actions;

type RootLike = { session: SessionState };

function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)qah_csrf=([^;]+)/)?.[1] ?? '';
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api/v1',
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    const { accessToken, orgId } = (getState() as RootLike).session;
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (orgId) headers.set('X-Organization-Id', String(orgId));
    return headers;
  },
});

// Một request refresh tại một thời điểm: server xoay vòng token, refresh song song sẽ bị coi là dùng lại
let refreshing: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken() },
  })
    .then(async (res) =>
      res.ok ? ((await res.json()) as { accessToken: string }).accessToken : null,
    )
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extra,
) => {
  let result = await rawBaseQuery(args, api, extra);
  if (result.error?.status === 401 && (api.getState() as RootLike).session.accessToken) {
    const token = await refreshAccessToken();
    if (token) {
      api.dispatch(tokenReceived(token));
      result = await rawBaseQuery(args, api, extra);
    } else {
      api.dispatch(loggedOut());
    }
  }
  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: [
    'Me',
    'Org',
    'Member',
    'ServiceAccount',
    'Project',
    'ProjectMember',
    'Environment',
    'Variable',
    'Credential',
    'Secret',
    'Target',
    'Audit',
  ],
  endpoints: () => ({}),
});

// ---- Lỗi theo định dạng docs/05 §1.1 ----
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<Record<string, unknown>>;
    requestId?: string;
  };
}

export function apiError(err: unknown): ApiErrorBody['error'] | null {
  const data = (err as { data?: unknown })?.data as ApiErrorBody | undefined;
  return data?.error ?? null;
}
