function deviceStorageKey(deviceId) {
  return `dibia.deviceKey.${deviceId}`
}

export function getDeviceCredential(deviceId = localStorage.getItem('dibia.deviceId')) {
  if (!deviceId) return ''
  return localStorage.getItem(deviceStorageKey(deviceId)) || ''
}

export function createDeviceCredential(deviceId) {
  const current = getDeviceCredential(deviceId)
  if (current) return current
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  localStorage.setItem(deviceStorageKey(deviceId), value)
  return value
}

export function rememberDevice(deviceId, credential) {
  localStorage.setItem(deviceStorageKey(deviceId), credential)
  localStorage.setItem('dibia.deviceId', deviceId)
}

export function activeDeviceHeaders() {
  const credential = getDeviceCredential()
  return credential ? { 'X-Dibia-Device-Key': credential } : {}
}
