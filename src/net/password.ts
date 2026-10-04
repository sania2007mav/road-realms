/** SHA-256 of the room password. An empty password leaves the room open. The lobby stores only this hash. */
export async function passwordLock(password: string): Promise<string> {
  const text = password.normalize('NFKC').trim();
  if (!text) return '';
  const data = new TextEncoder().encode(`kraya:${text}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
