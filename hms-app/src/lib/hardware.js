const CONFIG_KEY = 'dibia.hardware.connections'
const activeUsb = new Map()
const activeHid = new Map()

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') } catch { return {} }
}

function saveConfig(value) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(value))
}

function usbKey(device) {
  return `usb:${device.vendorId}:${device.productId}:${device.serialNumber || device.productName || ''}`
}

function hidKey(device) {
  return `hid:${device.vendorId}:${device.productId}:${device.productName || ''}`
}

function listenScanner(device) {
  const previous = activeHid.get('scanner')
  if (previous?.device === device) return
  if (previous) previous.device.removeEventListener('inputreport', previous.onReport)
  let buffer = ''
  const onReport = (event) => {
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
    if (bytes.length < 3) return
    const shifted = !!(bytes[0] & 0x22)
    for (const code of bytes.slice(2)) {
      if (!code) continue
      if (code === 0x28) {
        if (buffer) window.dispatchEvent(new CustomEvent('dibia:barcode', { detail: { value: buffer } }))
        buffer = ''
      } else if (code >= 0x04 && code <= 0x1d) {
        const letter = String.fromCharCode(65 + code - 0x04)
        buffer += shifted ? letter : letter.toLowerCase()
      } else if (code >= 0x1e && code <= 0x27) {
        const numbers = shifted ? '!@#$%^&*()' : '1234567890'
        buffer += numbers[code - 0x1e]
      } else if (code === 0x2c) buffer += ' '
      else if (code === 0x2d) buffer += shifted ? '_' : '-'
      else if (code === 0x2e) buffer += shifted ? '+' : '='
      else if (code === 0x36) buffer += shifted ? '<' : ','
      else if (code === 0x37) buffer += shifted ? '>' : '.'
      else if (code === 0x38) buffer += shifted ? '?' : '/'
    }
  }
  device.addEventListener('inputreport', onReport)
  activeHid.set('scanner', { device, onReport })
}

function supported(api) {
  if (!window.isSecureContext || !navigator[api]) {
    throw new Error('Direct device connection requires a supported browser on HTTPS or localhost.')
  }
}

async function openUsb(device) {
  if (!device.opened) await device.open()
  if (!device.configuration) {
    const configuration = device.configurations?.[0]?.configurationValue || 1
    await device.selectConfiguration(configuration)
  }
  for (const iface of device.configuration.interfaces) {
    const alternate = iface.alternates[0]
    const endpoint = alternate?.endpoints.find((item) => item.direction === 'out' && ['bulk', 'interrupt'].includes(item.type))
    if (!endpoint) continue
    try {
      if (!iface.claimed) await device.claimInterface(iface.interfaceNumber)
      if (alternate.alternateSetting !== 0) await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting)
      return { device, interfaceNumber: iface.interfaceNumber, endpointNumber: endpoint.endpointNumber }
    } catch { /* Try the next interface exposed by the printer. */ }
  }
  if (device.opened) await device.close().catch(() => {})
  throw new Error('This USB device has no browser-accessible print interface. Check its driver or connection mode.')
}

export async function connectUsb(slot) {
  supported('usb')
  const [device] = await navigator.usb.requestDevice({ acceptAllDevices: true })
  if (!device) throw new Error('No USB device was selected.')
  const connection = await openUsb(device)
  activeUsb.set(slot, connection)
  const config = loadConfig()
  config[slot] = { kind: 'usb', key: usbKey(device), name: device.productName || 'USB printer' }
  saveConfig(config)
  return config[slot]
}

export async function connectScanner() {
  supported('hid')
  const [device] = await navigator.hid.requestDevice({ acceptAllDevices: true })
  if (!device) throw new Error('No HID scanner was selected.')
  await device.open()
  listenScanner(device)
  const config = loadConfig()
  config.scanner = { kind: 'hid', key: hidKey(device), name: device.productName || 'HID scanner' }
  saveConfig(config)
  return config.scanner
}

export function getHardwareConfig() { return loadConfig() }

export function setLabelProtocol(protocol) {
  const config = loadConfig()
  config.labelProtocol = protocol
  saveConfig(config)
  return config
}

export async function restoreHardwareConnections() {
  const config = loadConfig()
  if (navigator.usb && window.isSecureContext) {
    const devices = await navigator.usb.getDevices().catch(() => [])
    for (const [slot, saved] of Object.entries(config)) {
      if (saved.kind !== 'usb') continue
      if (activeUsb.has(slot)) continue
      const device = devices.find((item) => usbKey(item) === saved.key)
      if (device) {
        try { activeUsb.set(slot, await openUsb(device)) } catch { /* Let the user reconnect from Settings. */ }
      }
    }
  }
  if (navigator.hid && window.isSecureContext && config.scanner?.kind === 'hid') {
    if (activeHid.has('scanner')) return { ...config, connected: Object.fromEntries([...activeUsb.keys(), ...activeHid.keys()].map((slot) => [slot, true])) }
    const devices = await navigator.hid.getDevices().catch(() => [])
    const device = devices.find((item) => hidKey(item) === config.scanner.key)
    if (device) {
      try {
        await device.open()
        listenScanner(device)
      } catch { /* Let the user reconnect from Settings. */ }
    }
  }
  return { ...config, connected: Object.fromEntries([...activeUsb.keys(), ...activeHid.keys()].map((slot) => [slot, true])) }
}

export function isHardwareConnected(slot) { return activeUsb.has(slot) || activeHid.has(slot) }

export async function disconnectHardware(slot) {
  const usb = activeUsb.get(slot)
  if (usb) {
    try { await usb.device.releaseInterface(usb.interfaceNumber) } catch { /* Ignore an already-closed interface. */ }
    try { await usb.device.close() } catch { /* Ignore an already-closed device. */ }
    activeUsb.delete(slot)
  }
  const hid = activeHid.get(slot)
  if (hid) {
    hid.device.removeEventListener('inputreport', hid.onReport)
    try { await hid.device.close() } catch { /* Ignore an already-closed device. */ }
    activeHid.delete(slot)
  }
  const config = loadConfig()
  delete config[slot]
  saveConfig(config)
}

function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

function ascii(value) {
  return new TextEncoder().encode(String(value).replace(/\u20a6/g, 'NGN ').normalize('NFKD').replace(/[^\x20-\x7E\r\n\t]/g, '?'))
}

async function sendUsb(slot, bytes) {
  let connection = activeUsb.get(slot)
  if (!connection) {
    const config = loadConfig()
    const saved = config[slot]
    if (!saved || !navigator.usb) throw new Error(`Connect a ${slot} USB device in Settings first.`)
    const device = (await navigator.usb.getDevices()).find((item) => usbKey(item) === saved.key)
    if (!device) throw new Error(`Reconnect the ${slot} in Settings.`)
    connection = await openUsb(device)
    activeUsb.set(slot, connection)
  }
  const result = await connection.device.transferOut(connection.endpointNumber, bytes)
  if (result.status !== 'ok') throw new Error(`The ${slot} did not accept the print data.`)
}

export async function printReceiptToUsb(text) {
  await sendUsb('printer', concatBytes([
    new Uint8Array([0x1b, 0x40]), ascii(text), ascii('\n\n'), new Uint8Array([0x1d, 0x56, 0x00]),
  ]))
}

export async function openCashDrawer() {
  await sendUsb('printer', new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]))
}

function cleanPrinterText(value) {
  return String(value || '').replace(/["\\\r\n]/g, ' ').slice(0, 80)
}

export async function printBarcodeLabels(products, protocol = 'TSPL') {
  if (!products.length) throw new Error('Add products with barcodes before printing labels.')
  if (protocol === 'TSPL') {
    const commands = products.map((product) => [
      'SIZE 50 mm,30 mm', 'GAP 2 mm,0', 'CLS',
      `TEXT 20,20,"3",0,1,1,"${cleanPrinterText(product.name)}"`,
      `BARCODE 20,65,"128",64,1,0,2,2,"${cleanPrinterText(product.barcode)}"`,
      `TEXT 20,140,"2",0,1,1,"${cleanPrinterText(product.barcode)}"`, 'PRINT 1,1', '',
    ].join('\r\n')).join('\r\n')
    await sendUsb('label', ascii(commands))
    return
  }
  if (protocol === 'ZPL') {
    const command = products.map((product) => `^XA^FO30,25^A0N,28,28^FD${cleanPrinterText(product.name)}^FS^FO30,70^BCN,70,Y,N,N^FD${cleanPrinterText(product.barcode)}^FS^XZ`).join('\r\n')
    await sendUsb('label', ascii(command))
    return
  }
  const commands = products.map((product) => concatBytes([
    new Uint8Array([0x1b, 0x40, 0x1b, 0x21, 0x08]), ascii(cleanPrinterText(product.name)),
    new Uint8Array([0x0a]), ascii(cleanPrinterText(product.barcode)), new Uint8Array([0x0a, 0x0a]),
  ]))
  await sendUsb('label', concatBytes(commands))
}
