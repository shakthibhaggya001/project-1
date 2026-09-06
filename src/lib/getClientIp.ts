const IP_SERVICE_URL = 'https://api.ipify.org?format=json';

type IpifyResponse = { ip?: string };

export async function getClientIp(timeoutMs = 4000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(IP_SERVICE_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as IpifyResponse;
    return typeof body.ip === 'string' && body.ip.trim() ? body.ip.trim() : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}