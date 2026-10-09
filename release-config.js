/* Public settings only. Never put the bridge secret or VAPID private key here. */
window.IDROCLIMA_RELEASE = Object.freeze({
  enabled: true,
  apiUrl: '', // New portal Apps Script /exec deployment. Required before publishing.
  technicalAppId: '', // Existing ID_APP of the Cruscotto in WEB_APPS.
  technicalUrl: '', // New Cruscotto Apps Script /exec deployment.
  version: '2026.10-procedure-rc1'
});
