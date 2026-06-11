import 'dotenv/config';

function headers(): HeadersInit {
  const token = process.env.AEM_API_TOKEN;
  if (!token) throw new Error('AEM_API_TOKEN is not set in .env');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function base(): string {
  return process.env.AEM_CLOUD_BASE_URL ?? 'https://api.solace.cloud';
}

export async function epGet(path: string): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

export async function epPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function epPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base()}${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function epDelete(path: string): Promise<void> {
  const res = await fetch(`${base()}${path}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${path} → ${res.status}: ${text}`);
  }
}
