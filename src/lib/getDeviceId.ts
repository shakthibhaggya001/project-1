import FingerprintJS from '@fingerprintjs/fingerprintjs';

const FALLBACK_KEY = 'exam_device_id';

export async function getDeviceId(): Promise<string> {
  try {
    const fingerprint = await FingerprintJS.load();
    const result = await fingerprint.get();
    if (result.visitorId) return result.visitorId;
  } catch {
    // Continue with the persistent browser identifier when fingerprinting is unavailable.
  }

  try {
    const storedId = window.localStorage.getItem(FALLBACK_KEY);
    if (storedId) return storedId;

    const generatedId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(FALLBACK_KEY, generatedId);
    return generatedId;
  } catch {
    return `temporary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}