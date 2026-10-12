export const COOKIE_PREFERENCES_EVENT = 'dibia:open-cookie-preferences'

export function openCookiePreferences() {
  window.dispatchEvent(new Event(COOKIE_PREFERENCES_EVENT))
}
