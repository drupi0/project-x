const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Accept the common equivalent loopback names used to open the local app. */
export function isAllowedRequestOrigin(origin: string, requestUrl: string): boolean {
  try {
    const source = new URL(origin);
    const target = new URL(requestUrl);
    if (source.origin === target.origin) return true;

    const sourcePort = source.port || (source.protocol === 'https:' ? '443' : '80');
    const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
    return source.protocol === target.protocol && sourcePort === targetPort &&
      loopbackHosts.has(source.hostname) && loopbackHosts.has(target.hostname) &&
      !source.username && !source.password;
  } catch {
    return false;
  }
}
