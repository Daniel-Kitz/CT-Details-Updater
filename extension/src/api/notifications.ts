export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export function showNotification(
  message: string,
  type: NotificationType = 'info',
): void {
  const detail = { message, type, duration: 5000 };

  // Current extension hosts bridge CustomEvents to the typed
  // `notification:show` extension-point emit. postMessage keeps compatibility
  // with iframe-based hosts while the inline UI always shows the same result.
  window.dispatchEvent(
    new CustomEvent('churchtools:emit', {
      detail: { event: 'notification:show', data: detail },
    }),
  );

  if (window.parent !== window) {
    window.parent.postMessage(
      { source: 'churchtools-extension', event: 'notification:show', data: detail },
      window.location.origin,
    );
  }
}
