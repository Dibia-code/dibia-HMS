import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import './feedback.css'

const categories = ['Bug', 'Improvement', 'Question', 'Works well']
const priorities = ['Blocking', 'Normal', 'Minor']
const statuses = ['Open', 'In progress', 'Partially addressed', 'Ready to retest', 'Resolved', 'Reopened']
const openStatuses = new Set(['Open', 'In progress', 'Partially addressed', 'Ready to retest', 'Reopened'])
const appBuild = import.meta.env.VITE_APP_BUILD || import.meta.env.VITE_COMMIT_SHA || 'Local build'

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function uid() {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `FB-${value.toUpperCase()}`
}

function cleanRoute(path) {
  return String(path || '/').split(/[?#]/, 1)[0]
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id')
    .replace(/\/(?:\d{5,}|[A-Za-z0-9_-]{24,})(?=\/|$)/g, '/:id')
}

function safeLabel(value, max = 70) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > max || /@|\b\+?\d[\d\s()-]{6,}\b/.test(text)) return ''
  return text
}

function safeIdentifier(value) {
  const text = String(value || '')
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(text)) return ''
  return text
}

function elementReference(element) {
  const explicit = safeIdentifier(element?.getAttribute('data-feedback-id'))
  if (explicit) return `[data-feedback-id="${explicit}"]`
  const id = safeIdentifier(element?.id)
  if (id) return `#${id}`
  const path = []
  let node = element
  while (node && node !== document.body && path.length < 5) {
    const tag = node.tagName?.toLowerCase()
    if (!tag) break
    const classes = [...(node.classList || [])].filter((name) => /^[A-Za-z_-][A-Za-z0-9_-]{0,30}$/.test(name)).slice(0, 2)
    const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.tagName === node.tagName) : []
    const index = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''
    path.unshift(`${tag}${classes.length ? `.${classes.join('.')}` : ''}${index}`)
    node = node.parentElement
  }
  return path.join(' > ') || 'page element'
}

function safeElementLabel(element) {
  const direct = safeLabel(element.getAttribute('data-feedback-label') || '')
  if (direct) return direct
  if (element.matches('input,textarea,select')) {
    const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null
    return safeLabel(label?.textContent || element.getAttribute('placeholder')) || 'Form field'
  }
  if (element.matches('button,[role="button"],[role="tab"]')) {
    const label = safeLabel(element.textContent)
    const action = /^(add|save|cancel|submit|delete|edit|search|filter|next|previous|back|login|sign in|register|forgot password|send|update|approve|reject|copy|export|close|view|open)(\s+(staff|patient|hospital|account|device|role|branch|item|product|invoice|report|changes|link|feedback|password|code|access|record|settings|new|all|page|notes))?$/i
    return action.test(label) ? label : 'Interactive control'
  }
  if (element.matches('table,[role="table"]')) return 'Data table'
  if (element.matches('[role="dialog"]')) return 'Dialog'
  if (element.matches('section,main,article')) return safeLabel(element.getAttribute('aria-label')) || 'Page section'
  return 'Page element'
}

function sectionLabel(element) {
  const explicit = safeLabel(element.closest('[data-feedback-section]')?.getAttribute('data-feedback-section'))
  if (explicit) return explicit
  const dialog = element.closest('[role="dialog"]')
  return dialog ? 'Dialog' : ''
}

function describeElement(element) {
  const role = element.getAttribute('role')
  return {
    label: safeElementLabel(element),
    type: safeLabel(role || element.tagName.toLowerCase(), 30),
    section: sectionLabel(element),
    identifier: elementReference(element),
  }
}

function captureContext({ app, path, title, user, workspace, role }) {
  return {
    app,
    date: new Date().toISOString(),
    page: safeLabel(title || document.title, 100) || 'Application page',
    route: cleanRoute(path),
    section: '',
    dialog: '',
    role: safeLabel(role || user?.roles?.join(', ') || 'Not signed in', 100),
    workspace: safeLabel(workspace || user?.hospitalName || 'Not selected', 100),
    build: safeLabel(appBuild, 80),
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    element: null,
  }
}

function contextKey(context) {
  return [context.app, context.route, context.page, context.section, context.role, context.workspace, context.element?.identifier || ''].join('|').toLowerCase()
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function similarity(left, right) {
  const a = new Set(normalize(left).split(' ').filter((word) => word.length > 2))
  const b = new Set(normalize(right).split(' ').filter((word) => word.length > 2))
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / (a.size + b.size - shared)
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) } catch { return 'Unknown date' }
}

function markdownReport(notes, draft, includeHistory) {
  const selected = includeHistory ? notes : notes.filter((note) => openStatuses.has(note.status))
  const groups = new Map()
  for (const note of selected) {
    const key = `${note.context?.app || 'Application'} / ${note.context?.page || note.context?.route || 'Unknown page'}`
    groups.set(key, [...(groups.get(key) || []), note])
  }
  const lines = [
    '# Dibia HMS feedback report',
    '',
    `Exported: ${formatDate(new Date().toISOString())}`,
    `Included: ${includeHistory ? 'full history' : 'outstanding and reopened feedback'}`,
    `Count: ${selected.length} saved note${selected.length === 1 ? '' : 's'}`,
    '',
  ]
  for (const [group, items] of groups) {
    lines.push(`## ${group}`, '')
    for (const note of items) {
      const context = note.context || {}
      lines.push(`### ${note.id} · ${note.status}`)
      lines.push(`- Date: ${formatDate(note.createdAt)}`)
      lines.push(`- Category / priority: ${note.category} / ${note.priority}`)
      lines.push(`- Role / workspace: ${context.role || 'Unknown'} / ${context.workspace || 'Unknown'}`)
      if (context.section || context.dialog) lines.push(`- Section / dialog: ${context.dialog || context.section}`)
      lines.push(`- Route: ${context.route || 'Unknown'}`)
      lines.push(`- Build / viewport: ${context.build || 'Unknown'} / ${context.viewport || 'Unknown'}`)
      if (context.element) lines.push(`- Selected: ${context.element.label} (${context.element.type}; ${context.element.identifier})`)
      lines.push('', note.text, '')
      for (const detail of note.additionalInfo || []) lines.push(`- Follow-up (${formatDate(detail.createdAt)}): ${detail.text}`)
      for (const update of note.updates || []) lines.push(`- Developer update (${formatDate(update.createdAt)}${update.build ? `, ${update.build}` : ''}): ${update.text || update.status}`)
      lines.push('')
    }
  }
  if (draft?.text?.trim()) {
    lines.push('## Unsaved draft', '', `- Category / priority: ${draft.category} / ${draft.priority}`, `- Route: ${draft.context?.route || 'Unknown'}`, '', draft.text.trim(), '')
  }
  return lines.join('\n')
}

function downloadFile(content, name) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function NoteCard({ note, onOpen }) {
  return (
    <button type="button" className="feedback-note-card" onClick={() => onOpen(note)}>
      <span className="feedback-note-head"><strong>{note.id}</strong><span className={`feedback-status status-${note.status.toLowerCase().replaceAll(' ', '-')}`}>{note.status}</span></span>
      <span className="feedback-note-title">{note.text}</span>
      <span className="feedback-note-meta">{note.category} · {note.priority} · {note.context?.page || note.context?.route}</span>
    </button>
  )
}

export default function FeedbackNotebook({ app, user, workspace, role, scopeKey, enabled = true, reviewerMode = false, api = null }) {
  const location = useLocation()
  const rootRef = useRef(null)
  const blockClickRef = useRef(false)
  const notesKey = `dibia.feedback.v1.${app}.${scopeKey || (reviewerMode ? 'shared-reviewer' : 'local-reviewer')}`
  const draftKey = `${notesKey}.draft`
  const reviewKey = `${notesKey}.reviewedUpdates`
  const [notes, setNotes] = useState(() => readJson(notesKey, []))
  const [draft, setDraft] = useState(() => readJson(draftKey, null))
  const [panelOpen, setPanelOpen] = useState(false)
  const [tab, setTab] = useState('write')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('Outstanding')
  const [selectionMode, setSelectionMode] = useState(false)
  const [duplicate, setDuplicate] = useState(null)
  const [openNote, setOpenNote] = useState(null)
  const [storageError, setStorageError] = useState('')
  const [copyText, setCopyText] = useState('')
  const [includeHistory, setIncludeHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [remoteNotes, setRemoteNotes] = useState([])
  const [messages, setMessages] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [messageRecipient, setMessageRecipient] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const incomingMessages = messages.filter((message) => message.recipientHospitalId === user?.hospitalId)
  const outgoingMessages = messages.filter((message) => message.senderHospitalId === user?.hospitalId)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [retestText, setRetestText] = useState('')
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [reviewedUpdates, setReviewedUpdates] = useState(() => readJson(reviewKey, {}))
  const [developerStatus, setDeveloperStatus] = useState('In progress')
  const [developerBuild, setDeveloperBuild] = useState('')
  const title = useMemo(() => document.title, [location.pathname])
  const current = useMemo(() => captureContext({ app, path: location.pathname, title, user, workspace, role }), [app, location.pathname, title, user?.userId, user?.email, user?.roles?.join(','), workspace, role])
  const mergedNotes = useMemo(() => {
    const byId = new Map(notes.map((note) => [note.id, note]))
    for (const note of remoteNotes) byId.set(note.id, { ...byId.get(note.id), ...note })
    return [...byId.values()].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
  }, [notes, remoteNotes])
  const matchingNotes = useMemo(() => {
    const query = normalize(search)
    return mergedNotes.filter((note) => {
      const statusMatches = filter === 'All' || (filter === 'Outstanding' ? openStatuses.has(note.status) : note.status === filter)
      const searchMatches = !query || normalize([note.id, note.text, note.context?.page, note.context?.route, note.context?.role, note.context?.workspace, note.context?.element?.label].join(' ')).includes(query)
      return statusMatches && searchMatches
    })
  }, [mergedNotes, filter, search])
  const unseenUpdates = useMemo(() => mergedNotes.flatMap((note) => (note.updates || []).filter((update) => update.createdAt && new Date(update.createdAt) > new Date(reviewedUpdates[note.id] || 0)).map((update) => ({ note, update }))), [mergedNotes, reviewedUpdates])

  useEffect(() => {
    setNotes(readJson(notesKey, []))
    setDraft(readJson(draftKey, null))
    setRemoteNotes([])
    setReviewedUpdates(readJson(reviewKey, {}))
  }, [notesKey, draftKey, reviewKey])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    const update = () => {
      document.documentElement.style.setProperty('--feedback-vv-height', `${viewport.height}px`)
      document.documentElement.style.setProperty('--feedback-vv-offset', `${viewport.offsetTop}px`)
      setKeyboardOpen(viewport.height < window.innerHeight * 0.78)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    if (!panelOpen || !api?.list) return undefined
    let active = true
    api.list().then((items) => { if (active) { setRemoteNotes(items || []); setSyncError('') } }).catch(() => { if (active) setSyncError('Shared feedback could not be refreshed. Your saved notes are still available here.') })
    return () => { active = false }
  }, [panelOpen, api])

  useEffect(() => {
    if (!panelOpen || !api?.messages) return undefined
    let active = true
    const loadMessages = () => api.messages().then((items) => { if (active) setMessages(items || []) }).catch(() => { if (active) setSyncError('Hospital messages could not be loaded. Check your connection and try again.') })
    loadMessages()
    const timer = window.setInterval(loadMessages, 20_000)
    window.addEventListener('focus', loadMessages)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', loadMessages)
    }
  }, [panelOpen, api])

  useEffect(() => {
    if (!panelOpen || app !== 'Console' || !api?.listHospitals) return undefined
    let active = true
    api.listHospitals().then((items) => { if (active) { setHospitals(items); if (!messageRecipient && items[0]) setMessageRecipient(items[0].id) } }).catch(() => { if (active) setSyncError('Hospital list could not be loaded.') })
    return () => { active = false }
  }, [panelOpen, app, api])

  useEffect(() => {
    if (!panelOpen || app !== 'HMS' || !api?.recipients) return undefined
    let active = true
    api.recipients().then((items) => { if (active) { setHospitals(items); if (!messageRecipient && items[0]) setMessageRecipient(items[0].id) } }).catch(() => { if (active) setSyncError('Recipient hospitals could not be loaded.') })
    return () => { active = false }
  }, [panelOpen, app, api])

  useEffect(() => {
    const click = (event) => {
      if (!blockClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      blockClickRef.current = false
    }
    document.addEventListener('click', click, true)
    return () => document.removeEventListener('click', click, true)
  }, [])

  function persistDraft(next) {
    setDraft(next)
    try {
      if (next) localStorage.setItem(draftKey, JSON.stringify(next))
      else localStorage.removeItem(draftKey)
      setStorageError('')
    } catch {
      setStorageError('Your draft could not be saved. Download or copy it before closing this page.')
    }
  }

  function persistNotes(next) {
    try {
      localStorage.setItem(notesKey, JSON.stringify(next))
      setNotes(next)
      setStorageError('')
      return true
    } catch {
      setStorageError('Your notes could not be saved. Your current text is still on screen; download or copy it before leaving.')
      return false
    }
  }

  function startNote() {
    if (!draft) persistDraft({ id: uid(), text: '', category: 'Bug', priority: 'Normal', context: current, startedAt: new Date().toISOString() })
    setOpenNote(null)
    setDuplicate(null)
    setTab('write')
    setPanelOpen(true)
  }

  async function refreshRemote() {
    if (!api?.list) return
    try { setRemoteNotes(await api.list()); setSyncError('') } catch { setSyncError('Shared feedback could not be refreshed. Your saved notes are still available here.') }
  }

  async function refreshMessages() {
    if (!api?.messages) return
    try { setMessages(await api.messages()); setSyncError('') } catch { setSyncError('Hospital messages could not be loaded. Check your connection and try again.') }
  }

  async function sendHospitalMessage() {
    if (!api?.sendMessage || !messageRecipient || !messageDraft.trim()) return
    setBusy(true)
    try {
      const message = await api.sendMessage(messageRecipient, messageDraft.trim())
      if (message) setMessages((items) => [message, ...items])
      setMessageDraft('')
      setSyncError('Message sent to the selected hospital. Staff can see it in their Feedback notebook.')
    } catch (error) { setSyncError(error.message || 'The hospital message could not be sent.') }
    finally { setBusy(false) }
  }

  function updateDraft(field, value) {
    persistDraft({ ...(draft || { id: uid(), text: '', category: 'Bug', priority: 'Normal', context: current, startedAt: new Date().toISOString() }), [field]: value })
  }

  function newDraftWithCurrentPage() {
    persistDraft({ ...(draft || { id: uid(), text: '', category: 'Bug', priority: 'Normal', startedAt: new Date().toISOString() }), context: current })
  }

  async function saveNote(allowDuplicate = false, duplicateOf = null) {
    const text = String(draft?.text || '').trim()
    if (!text) return
    const fingerprint = contextKey(draft.context || current)
    const exact = mergedNotes.find((note) => note.id !== draft.id && normalize(note.text) === normalize(text) && contextKey(note.context || {}) === fingerprint)
    if (exact && !allowDuplicate) {
      setDuplicate({ kind: 'exact', note: exact })
      return
    }
    const similar = !exact && mergedNotes.find((note) => note.id !== draft.id && contextKey(note.context || {}) === fingerprint && similarity(note.text, text) >= 0.72)
    if (similar && !allowDuplicate) {
      setDuplicate({ kind: 'similar', note: similar })
      return
    }
    const previous = notes.find((note) => note.id === draft.id)
    const note = {
      ...(previous || {}),
      id: previous?.id || draft.id || uid(),
      text,
      category: draft.category || 'Bug',
      priority: draft.priority || 'Normal',
      context: previous?.context || draft.context || current,
      status: previous?.status || 'Open',
      createdAt: previous?.createdAt || draft.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(duplicateOf ? { duplicateOf } : {}),
      additionalInfo: previous?.additionalInfo || [],
      updates: previous?.updates || [],
    }
    const next = previous ? notes.map((item) => item.id === note.id ? note : item) : [note, ...notes]
    if (!persistNotes(next)) return
    persistDraft(null)
    setDuplicate(null)
    setOpenNote(note)
    setTab('notes')
    return note
  }

  async function sendNote(note) {
    if (!api?.send) {
      setSyncError('Sharing is unavailable right now. This note is saved on this device.')
      return
    }
    setBusy(true)
    setSyncError('')
    try {
      const response = await api.send(note)
      const shared = response?.feedback || response
      const local = { ...note, ...shared, sent: true, sentAt: new Date().toISOString() }
      persistNotes([local, ...notes.filter((item) => item.id !== local.id)])
      setRemoteNotes((items) => [local, ...items.filter((item) => item.id !== local.id)])
      setOpenNote(local)
      setTab('write')
    } catch (error) {
      setSyncError(error?.message || 'Feedback could not be sent. Your saved local note is preserved.')
      setOpenNote(note)
      setTab('write')
    } finally { setBusy(false) }
  }

  async function addMoreInfo(note, text) {
    const entry = { text: text.trim(), createdAt: new Date().toISOString() }
    const nextNote = { ...note, additionalInfo: [...(note.additionalInfo || []), entry], updatedAt: new Date().toISOString() }
    if (!persistNotes([nextNote, ...notes.filter((item) => item.id !== note.id)])) return
    setOpenNote(nextNote)
    setRetestText('')
    if (note.sent && api?.addInfo) {
      try { await api.addInfo(note.id, entry); await refreshRemote() } catch (error) { setSyncError(error.message || 'The local update was saved, but the shared update failed.') }
    }
  }

  async function updateStatus(note, status, text = '') {
    const update = { id: uid(), status, text: text.trim(), build: app === 'Console' ? developerBuild : current.build, createdAt: new Date().toISOString() }
    if (note.sent && api?.update) {
      setBusy(true)
      try {
        const result = await api.update(note.id, { status, text: update.text, build: update.build })
        const shared = result?.feedback || result
        const merged = { ...note, ...shared }
        persistNotes([merged, ...notes.filter((item) => item.id !== note.id)])
        setRemoteNotes((items) => [merged, ...items.filter((item) => item.id !== note.id)])
        setOpenNote(merged)
        setRetestText('')
        setSyncError('')
      } catch (error) {
        setSyncError(error.message || 'The shared status update failed. The report status was not changed.')
      } finally { setBusy(false) }
      return
    }
    const nextNote = { ...note, status, updates: [...(note.updates || []), update], updatedAt: update.createdAt }
    if (!persistNotes([nextNote, ...notes.filter((item) => item.id !== note.id)])) return
    setOpenNote(nextNote)
    setRetestText('')
  }

  async function removeNote(note) {
    const next = notes.filter((item) => item.id !== note.id)
    if (!persistNotes(next)) return
    setOpenNote(null)
    if (note.sent && api?.remove) {
      try { await api.remove(note.id); await refreshRemote() } catch (error) { setSyncError(error.message || 'The local note was deleted, but the shared report could not be deleted.') }
    }
  }

  async function exportReport(copy = false) {
    const selected = includeHistory ? mergedNotes : mergedNotes.filter((note) => openStatuses.has(note.status))
    const content = markdownReport(selected, draft, includeHistory)
    if (!copy) {
      downloadFile(content, `dibia-feedback-${new Date().toISOString().slice(0, 10)}.md`)
      return
    }
    try {
      await navigator.clipboard.writeText(content)
      setCopyText('')
      setSyncError('Feedback report copied.')
    } catch {
      setCopyText(content)
      setSyncError('Clipboard access failed. Copy the report from the text box below.')
    }
  }

  useEffect(() => {
    if (!selectionMode) return undefined
    const pointerDown = (event) => {
      const element = event.target instanceof Element ? event.target : null
      if (!element || rootRef.current?.contains(element)) return
      const target = element.closest('[data-feedback-id],button,input,textarea,select,table,[role="button"],[role="tab"],[role="dialog"],.card,.stat-card,section,article,main') || element
      if (target === document.body || target === document.documentElement) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      blockClickRef.current = true
      window.setTimeout(() => { blockClickRef.current = false }, 500)
      const selected = describeElement(target)
      const dialog = target.closest('[role="dialog"]')
      const nextContext = { ...(draft?.context || current), element: selected, section: selected.section, dialog: dialog ? selected.section || 'Dialog' : '' }
      persistDraft({ ...(draft || { id: uid(), text: '', category: 'Bug', priority: 'Normal', startedAt: new Date().toISOString() }), context: nextContext })
      setSelectionMode(false)
      setPanelOpen(true)
      target.classList.add('feedback-target-highlight')
      window.setTimeout(() => target.classList.remove('feedback-target-highlight'), 1400)
    }
    const keyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectionMode(false)
        setPanelOpen(true)
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && !rootRef.current?.contains(event.target)) {
        const target = event.target.closest('[data-feedback-id],button,input,textarea,select,table,[role="button"],[role="tab"],[role="dialog"],.card,.stat-card,section,article,main') || event.target
        if (target === document.body || target === document.documentElement) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        blockClickRef.current = true
        window.setTimeout(() => { blockClickRef.current = false }, 500)
        const selected = describeElement(target)
        const dialog = target.closest('[role="dialog"]')
        persistDraft({ ...(draft || { id: uid(), text: '', category: 'Bug', priority: 'Normal', startedAt: new Date().toISOString() }), context: { ...(draft?.context || current), element: selected, section: selected.section, dialog: dialog ? selected.section || 'Dialog' : '' } })
        setSelectionMode(false)
        setPanelOpen(true)
        target.classList.add('feedback-target-highlight')
        window.setTimeout(() => target.classList.remove('feedback-target-highlight'), 1400)
      }
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('keydown', keyDown, true)
    document.body.classList.add('feedback-selecting')
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('keydown', keyDown, true)
      document.body.classList.remove('feedback-selecting')
    }
  }, [selectionMode, draft, current])

  if (!enabled) return null

  return (
    <div className="feedback-root" ref={rootRef}>
      {!panelOpen && !selectionMode && <button className="feedback-fab" type="button" onClick={startNote} aria-label="Open feedback notebook"><span className="feedback-fab-mark" aria-hidden="true">F</span><span>Feedback</span>{mergedNotes.filter((note) => openStatuses.has(note.status)).length > 0 && <span className="feedback-count">{mergedNotes.filter((note) => openStatuses.has(note.status)).length}</span>}</button>}
      {selectionMode && <div className="feedback-select-banner" role="status"><span>Select an element or section. Its action will not run.</span><button type="button" onClick={() => { setSelectionMode(false); setPanelOpen(true) }}>Cancel</button></div>}
      {panelOpen && <>
        <button className="feedback-dismiss-layer" type="button" aria-label="Close feedback notebook" onClick={() => { setPanelOpen(false); setSelectionMode(false) }} />
        <section className={`feedback-panel${keyboardOpen ? ' keyboard-open' : ''}`} role="dialog" aria-modal="true" aria-label="Feedback notebook">
          <header className="feedback-header">
            <div><span className="feedback-eyebrow">DIBIA HMS REVIEW</span><h2>Feedback notebook</h2><p>Your notes stay on this device unless you send them. They will not automatically appear on your other devices.</p></div>
            <button type="button" className="feedback-icon-btn" aria-label="Close feedback notebook" onClick={() => { setPanelOpen(false); setSelectionMode(false) }}>×</button>
          </header>
          <nav className="feedback-tabs" aria-label="Feedback notebook sections">
            <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => { setTab('write'); setOpenNote(null) }}>Write feedback</button>
            <button type="button" className={tab === 'notes' ? 'active' : ''} onClick={() => { setTab('notes'); setOpenNote(null); refreshRemote(); refreshMessages() }}>Inbox &amp; notebook <span>{messages.length || mergedNotes.length}</span></button>
          </nav>
          <div className="feedback-body">
            {storageError && <div className="feedback-message error" role="alert">{storageError}<button type="button" onClick={() => exportReport(false)}>Download a copy</button></div>}
            {syncError && <div className="feedback-message" role="status">{syncError}</div>}
            {tab === 'write' && !openNote && <div className="feedback-write">
              <div className="feedback-prompt"><span className="feedback-avatar">You</span><p>What did you notice while testing?</p></div>
              <div className="feedback-context">
                <div className="feedback-context-head"><strong>Captured context</strong><button type="button" onClick={newDraftWithCurrentPage}>Use current page</button></div>
                <dl>
                  <div><dt>Date / time</dt><dd>{formatDate(draft?.context?.date || draft?.startedAt || new Date().toISOString())}</dd></div>
                  <div><dt>Page</dt><dd>{draft?.context?.page || current.page} <span>{draft?.context?.route || current.route}</span></dd></div>
                  {(draft?.context?.section || draft?.context?.dialog) && <div><dt>Section</dt><dd>{draft.context.dialog || draft.context.section}</dd></div>}
                  <div><dt>Role / workspace</dt><dd>{draft?.context?.role || current.role} · {draft?.context?.workspace || current.workspace}</dd></div>
                  <div><dt>Build / viewport</dt><dd>{draft?.context?.build || current.build} · {draft?.context?.viewport || current.viewport}</dd></div>
                  {draft?.context?.element && <div><dt>Selected</dt><dd>{draft.context.element.label} · {draft.context.element.type}<code>{draft.context.element.identifier}</code></dd></div>}
                </dl>
              </div>
              <div className="feedback-pick-row"><button type="button" className="feedback-pick" onClick={() => { setSelectionMode(true); setPanelOpen(false) }}>Select something on this page</button><button type="button" className={!draft?.context?.element ? 'selected' : ''} onClick={() => updateDraft('context', { ...(draft?.context || current), element: null, section: '', dialog: '' })}>Whole page</button></div>
              {selectionMode && <div className="feedback-select-hint" role="status">Select a visible control or section. Its normal action will be blocked. Press Escape to cancel.</div>}
              {duplicate && <div className="feedback-duplicate" role="alert">
                <strong>{duplicate.kind === 'exact' ? `This feedback is already recorded as ${duplicate.note.id}. Current status: ${duplicate.note.status}.` : `Possible match: ${duplicate.note.id} (${duplicate.note.status}). Review it before creating a separate report.`}</strong>
                <div className="feedback-duplicate-actions">
                  <button type="button" onClick={() => { setOpenNote(duplicate.note); setTab('write'); setDuplicate(null) }}>View existing note</button>
                  {duplicate.kind === 'exact' && <button type="button" disabled={!draft?.text?.trim()} onClick={async () => { const match = duplicate.note; const text = draft.text; await addMoreInfo(match, text); persistDraft(null); setDuplicate(null); setTab('write') }}>Add more information</button>}
                  <button type="button" onClick={async () => { const match = duplicate.note; const saved = await saveNote(true, match.id); if (saved) setDuplicate(null) }}>{duplicate.kind === 'exact' ? 'Report separately / still happening' : 'Create separate report'}</button>
                  <button type="button" onClick={() => setDuplicate(null)}>Keep editing</button>
                </div>
              </div>}
              <label className="feedback-field-label" htmlFor="feedback-note">Your feedback</label>
              <textarea id="feedback-note" className="feedback-textarea" value={draft?.text || ''} onChange={(event) => updateDraft('text', event.target.value)} placeholder="Write naturally. What happened, and what did you expect?" rows={5} />
              <small>Only interface context is captured automatically. Do not include patient information, passwords, or credentials in your note.</small>
              <div className="feedback-options">
                <label>Category<select value={draft?.category || 'Bug'} onChange={(event) => updateDraft('category', event.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Priority<select value={draft?.priority || 'Normal'} onChange={(event) => updateDraft('priority', event.target.value)}>{priorities.map((value) => <option key={value}>{value}</option>)}</select></label>
              </div>
              <div className="feedback-save-state" aria-live="polite">{draft ? 'Draft saved on this device' : 'Start a note to capture this page'}</div>
              <div className="feedback-actions"><button type="button" className="feedback-button secondary" onClick={() => exportReport(false)}>Download feedback</button><button type="button" className="feedback-button primary" disabled={!draft?.text?.trim()} onClick={() => saveNote(false)}>Save on this device</button></div>
              <button type="button" className="feedback-button primary full" disabled={!draft?.text?.trim() || !api?.send || busy} onClick={async () => { const saved = await saveNote(false); if (saved) await sendNote(saved) }}>{busy ? 'Sending…' : api?.send ? 'Save and share with the Dibia team' : 'Sharing is unavailable right now'}</button>
              {!draft?.text?.trim() && <small className="feedback-action-hint">Write your feedback above to enable saving and sharing.</small>}
              {draft?.text?.trim() && !api?.send && <small className="feedback-action-hint">Sign in to your hospital account to share this note with the Dibia team. You can still save it on this device.</small>}
            </div>}
            {tab === 'write' && !openNote && api?.sendMessage && <div className="feedback-hospital-message"><strong>{app === 'Console' ? 'Send a message to a hospital' : 'Share a message with another hospital'}</strong><label>Recipient<select value={messageRecipient} onChange={(event) => setMessageRecipient(event.target.value)}><option value="">Choose a hospital</option>{hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}</select></label><label>Message<textarea className="feedback-textarea compact" rows={3} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Write a message for this hospital's staff" /></label><small>Only the selected hospital can read this message. Do not include patient information or credentials.</small><button type="button" className="feedback-button primary" disabled={!messageDraft.trim() || !messageRecipient || busy} onClick={sendHospitalMessage}>Send to hospital staff</button></div>}
            {tab === 'write' && openNote && <div className="feedback-detail">
              <button type="button" className="feedback-back" onClick={() => setOpenNote(null)}>← Notebook</button>
              <div className="feedback-detail-title"><strong>{openNote.id}</strong><span className={`feedback-status status-${openNote.status.toLowerCase().replaceAll(' ', '-')}`}>{openNote.status}</span></div>
              <textarea className="feedback-textarea" rows={5} value={openNote.text} onChange={(event) => setOpenNote({ ...openNote, text: event.target.value })} aria-label="Edit feedback note" />
              <div className="feedback-detail-meta">{openNote.category} · {openNote.priority} · {openNote.context?.route}</div>
              {app === 'Console' && openNote.sent && <div className="feedback-developer-update"><strong>Developer update</strong><label>Status<select value={developerStatus} onChange={(event) => setDeveloperStatus(event.target.value)}>{statuses.filter((value) => value !== 'Reopened').map((value) => <option key={value}>{value}</option>)}</select></label><label>Build available to reviewer<input value={developerBuild} onChange={(event) => setDeveloperBuild(event.target.value)} placeholder={openNote.context?.build || 'Build identifier'} /></label><label>What changed<textarea className="feedback-textarea compact" rows={3} value={retestText} onChange={(event) => setRetestText(event.target.value)} placeholder="Describe the fix or status change" /></label><button type="button" className="feedback-button primary" disabled={!retestText.trim() || (developerStatus === 'Ready to retest' && developerBuild !== openNote.context?.build)} onClick={() => updateStatus(openNote, developerStatus, retestText)}>{developerStatus === 'Ready to retest' && developerBuild !== openNote.context?.build ? 'Build must match reviewer context' : 'Save developer update'}</button></div>}
              <div className="feedback-actions">{!openNote.sent && <button type="button" className="feedback-button secondary" onClick={() => removeNote(openNote)}>Delete note</button>}{!openNote.sent && <button type="button" className="feedback-button primary" onClick={() => { const next = { ...openNote, updatedAt: new Date().toISOString() }; if (persistNotes([next, ...notes.filter((item) => item.id !== next.id)])) setOpenNote(next) }}>Save changes</button>}</div>
              <label className="feedback-field-label" htmlFor="feedback-more-info">Add information</label><textarea id="feedback-more-info" className="feedback-textarea compact" rows={3} value={retestText} onChange={(event) => setRetestText(event.target.value)} placeholder="Add details or retest evidence" />
              <button type="button" className="feedback-button secondary full" disabled={!retestText.trim()} onClick={() => addMoreInfo(openNote, retestText)}>Add more information</button>
              {openNote.status === 'Ready to retest' && app !== 'Console' && <div className="feedback-actions"><button type="button" className="feedback-button primary" onClick={() => updateStatus(openNote, 'Resolved', 'Reviewer confirmed the fix.')}>Fixed</button><button type="button" className="feedback-button secondary" disabled={!retestText.trim()} onClick={() => updateStatus(openNote, 'Reopened', retestText)}>Still happening</button></div>}
              {(openNote.additionalInfo || []).map((item, index) => <article className="feedback-update" key={`${item.createdAt}-${index}`}><strong>Additional information · {formatDate(item.createdAt)}</strong><p>{item.text}</p></article>)}
              {(openNote.updates || []).map((item, index) => <article className="feedback-update" key={item.id || `${item.createdAt}-${index}`}><strong>{item.status} · {formatDate(item.createdAt)}{item.build ? ` · ${item.build}` : ''}</strong><p>{item.text}</p></article>)}
              {openNote.sent ? <span className="feedback-shared-tag">Sent to Dibia · {formatDate(openNote.sentAt || openNote.createdAt)}</span> : <button type="button" className="feedback-send-link" disabled={!api?.send || busy} onClick={() => sendNote(openNote)}>Send to the Dibia team</button>}
            </div>}
            {tab === 'notes' && <div className="feedback-list">
              {app === 'HMS' && <section className="feedback-hospital-inbox"><div className="feedback-detail-title"><strong>Messages · {incomingMessages.length} received</strong><button type="button" className="feedback-send-link" onClick={refreshMessages}>Refresh inbox</button></div><strong>Received</strong>{incomingMessages.length ? incomingMessages.map((message) => <article key={message.id}><time>{message.senderHospital || 'Dibia Console'} · {formatDate(message.sentAt)}</time><p>{message.body}</p></article>) : <div className="feedback-empty">No messages have arrived for this hospital yet.</div>}<strong>Sent</strong>{outgoingMessages.length ? outgoingMessages.map((message) => <article key={message.id}><time>To {message.recipientHospital || 'Dibia Console'} · {formatDate(message.sentAt)}</time><p>{message.body}</p></article>) : <div className="feedback-empty">No messages sent from this hospital yet.</div>}</section>}
              {unseenUpdates.length > 0 && <section className="feedback-unseen"><strong>Updates since your last review</strong>{unseenUpdates.map(({ note, update }) => <button type="button" key={update.id} onClick={() => { setOpenNote(note); setTab('write'); const next = { ...reviewedUpdates, [note.id]: new Date().toISOString() }; setReviewedUpdates(next); try { localStorage.setItem(reviewKey, JSON.stringify(next)) } catch { setStorageError('Could not save that you reviewed this update.') } }}><b>{note.id} · {update.status || update.kind}</b><span>{update.text}</span></button>)}</section>}
              <div className="feedback-list-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search feedback" aria-label="Search feedback" /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter feedback">{['Outstanding', 'All', ...statuses].map((value) => <option key={value}>{value}</option>)}</select></div>
              <label className="feedback-history-toggle"><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} /> Include full history in exports</label>
              <div className="feedback-export-actions"><button type="button" className="feedback-button secondary" onClick={() => exportReport(true)}>Copy feedback</button><button type="button" className="feedback-button secondary" onClick={() => exportReport(false)}>Download feedback</button>{notes.length > 0 && <button type="button" className="feedback-button quiet" onClick={() => setDeleteConfirm(true)}>Delete all notes</button>}</div>
              {copyText && <div className="feedback-copy-fallback"><label htmlFor="feedback-copy-fallback">Select and copy the report</label><textarea id="feedback-copy-fallback" value={copyText} readOnly onFocus={(event) => event.target.select()} /></div>}
              {deleteConfirm && <div className="feedback-confirm" role="alertdialog" aria-label="Confirm bulk deletion"><p>Delete all notes and drafts saved on this device? Sent reports remain in the Dibia team inbox.</p><button type="button" className="feedback-button quiet" onClick={() => setDeleteConfirm(false)}>Cancel</button><button type="button" className="feedback-button danger" onClick={() => { if (persistNotes([])) { persistDraft(null); setDeleteConfirm(false) } }}>Delete all notes</button></div>}
              {matchingNotes.length ? matchingNotes.map((note) => <NoteCard key={note.id} note={note} onOpen={(item) => { setOpenNote(item); setTab('write'); const next = { ...reviewedUpdates, [item.id]: new Date().toISOString() }; setReviewedUpdates(next); try { localStorage.setItem(reviewKey, JSON.stringify(next)) } catch { setStorageError('Could not save that you reviewed this update.') } }} />) : <div className="feedback-empty">No notes match this view.</div>}
              <div className="feedback-storage-note">Unsent notes stay on this device and will not automatically appear on your other devices. Send a report to share it with the Dibia team.</div>
            </div>}
          </div>
        </section>
      </>}
    </div>
  )
}
