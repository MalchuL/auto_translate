// Never pass clipboard contents or translator URLs to these functions.
function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function info(message: string): void {
  console.log(`[cto ${stamp()}] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[cto ${stamp()}] WARN ${message}`);
}

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, name, message } = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof code === 'string') return code;
    if (typeof name === 'string') return name;
    if (typeof message === 'string') return message;
  }
  return 'unknown';
}
