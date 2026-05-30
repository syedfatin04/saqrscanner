import { useEffect, useMemo, useRef, useState } from 'react'
import {
  detectWhatsAppExportFormat,
  parseWhatsAppExport,
  uniqueSortedSenders,
  type WhatsAppExportFormat,
  type WhatsAppMessage,
} from './whatsapp/parse'

type FileMap = Map<string, File>

function toIsoDate(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function endOfMonth(year: number, month1to12: number) {
  // day 0 of next month = last day of requested month
  return new Date(year, month1to12, 0, 23, 59, 59, 999)
}

function formatDateTime(d: Date | null): string {
  if (!d) return ''
  try {
    return d.toLocaleString()
  } catch {
    return d.toString()
  }
}

function isImageFilename(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)
}

function isVideoFilename(name: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(name)
}

function isAudioFilename(name: string) {
  return /\.(mp3|wav|m4a|aac|ogg|opus)$/i.test(name)
}

function isPdfFilename(name: string) {
  return /\.pdf$/i.test(name)
}

function normalizeFileKey(name: string) {
  return name.trim()
}

function useObjectUrl(file: File | undefined) {
  const [url, setUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!file) {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  return url
}

type LightboxItem = { filename: string; file: File }
type ViewMode = 'messages' | 'attachments'
type AttachmentKind = 'images' | 'pdfs' | 'audio' | 'video' | 'other'

function attachmentKind(filename: string): AttachmentKind {
  if (isImageFilename(filename)) return 'images'
  if (isPdfFilename(filename)) return 'pdfs'
  if (isAudioFilename(filename)) return 'audio'
  if (isVideoFilename(filename)) return 'video'
  return 'other'
}

function csvEscape(value: string) {
  const v = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function DirectoryPicker(props: { onFiles: (files: FileMap) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // Enable folder picking in Chromium-based browsers.
    inputRef.current?.setAttribute('webkitdirectory', '')
    inputRef.current?.setAttribute('directory', '')
  }, [])

  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      onChange={(e) => {
        const list = e.target.files
        if (!list) return
        const m: FileMap = new Map()
        for (const f of Array.from(list)) {
          m.set(normalizeFileKey(f.name), f)
        }
        props.onFiles(m)
      }}
    />
  )
}

function AttachmentView(props: {
  filename: string
  file?: File
  onOpenImage?: (filename: string) => void
}) {
  const { filename, file, onOpenImage } = props
  const url = useObjectUrl(file)

  if (!file || !url) {
    return (
      <div className="attachment missing">
        <div className="attachmentName">{filename}</div>
        <div className="attachmentMeta">Not found in selected folder</div>
      </div>
    )
  }

  if (isImageFilename(filename)) {
    return (
      <button
        type="button"
        className="attachment image"
        onClick={() => onOpenImage?.(filename)}
        title="Click to enlarge"
      >
        <img src={url} alt={filename} loading="lazy" />
        <div className="attachmentName">{filename}</div>
      </button>
    )
  }

  if (isVideoFilename(filename)) {
    return (
      <div className="attachment media">
        <video controls src={url} />
        <a className="attachmentName" href={url} target="_blank" rel="noreferrer">
          {filename}
        </a>
      </div>
    )
  }

  if (isAudioFilename(filename)) {
    return (
      <div className="attachment media">
        <audio controls src={url} />
        <a className="attachmentName" href={url} target="_blank" rel="noreferrer">
          {filename}
        </a>
      </div>
    )
  }

  if (isPdfFilename(filename)) {
    return (
      <a className="attachment file" href={url} target="_blank" rel="noreferrer">
        <div className="attachmentName">{filename}</div>
        <div className="attachmentMeta">PDF</div>
      </a>
    )
  }

  return (
    <a className="attachment file" href={url} target="_blank" rel="noreferrer">
      <div className="attachmentName">{filename}</div>
      <div className="attachmentMeta">{file.type || 'file'}</div>
    </a>
  )
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('messages')
  const [exportFormat, setExportFormat] = useState<WhatsAppExportFormat>('ios')
  const [chatFileName, setChatFileName] = useState<string>('')
  const [rawText, setRawText] = useState<string>('')
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [fileMap, setFileMap] = useState<FileMap | null>(null)

  const senders = useMemo(() => uniqueSortedSenders(messages), [messages])

  const [sender, setSender] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const [onlyWithAttachments, setOnlyWithAttachments] = useState(false)
  const [dateFrom, setDateFrom] = useState<string>('') // YYYY-MM-DD
  const [dateTo, setDateTo] = useState<string>('') // YYYY-MM-DD
  const [yearPreset, setYearPreset] = useState<string>('') // '' = All
  const [monthPreset, setMonthPreset] = useState<string>('') // '' = All, otherwise 1..12
  const [attKinds, setAttKinds] = useState<Record<AttachmentKind, boolean>>({
    images: true,
    pdfs: true,
    audio: true,
    video: true,
    other: true,
  })

  useEffect(() => {
    if (!rawText.trim()) {
      setMessages([])
      return
    }
    const parsed = parseWhatsAppExport(rawText, exportFormat)
    setMessages(parsed)
  }, [rawText, exportFormat])

  useEffect(() => {
    // Keep empty sender as "All names" by default (more useful for browsing).
    // If the current sender disappears after re-loading, reset to All.
    if (sender && senders.length && !senders.includes(sender)) setSender('')
  }, [sender, senders])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const m of messages) {
      if (!m.timestamp) continue
      set.add(m.timestamp.getFullYear())
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [messages])

  // If user uses year/month presets, auto-fill the date range.
  useEffect(() => {
    if (!yearPreset) return
    const y = Number(yearPreset)
    if (!Number.isFinite(y)) return

    if (!monthPreset) {
      const from = new Date(y, 0, 1, 0, 0, 0, 0)
      const to = new Date(y, 11, 31, 23, 59, 59, 999)
      setDateFrom(toIsoDate(from))
      setDateTo(toIsoDate(to))
      return
    }

    const mo = Number(monthPreset)
    if (!Number.isFinite(mo) || mo < 1 || mo > 12) return
    const from = new Date(y, mo - 1, 1, 0, 0, 0, 0)
    const to = endOfMonth(y, mo)
    setDateFrom(toIsoDate(from))
    setDateTo(toIsoDate(to))
  }, [yearPreset, monthPreset])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null

    return messages.filter((m) => {
      if (sender && m.sender !== sender) return false
      if (onlyWithAttachments && m.attachments.length === 0) return false

      if (from || to) {
        if (!m.timestamp) return false
        if (from && m.timestamp < from) return false
        if (to && m.timestamp > to) return false
      }

      if (q) {
        const hay = `${m.sender}\n${m.text}\n${m.attachments.map((a) => a.filename).join('\n')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }

      return true
    })
  }, [messages, sender, onlyWithAttachments, query, dateFrom, dateTo])

  const stats = useMemo(() => {
    const total = messages.length
    const withAtt = messages.reduce((n, m) => n + (m.attachments.length ? 1 : 0), 0)
    const files = fileMap?.size ?? 0
    return { total, withAtt, files }
  }, [messages, fileMap])

  const filteredAttachments = useMemo(() => {
    const out: { filename: string; file?: File; kind: AttachmentKind; msgId: string }[] = []
    for (const m of filtered) {
      for (const a of m.attachments) {
        const kind = attachmentKind(a.filename)
        if (!attKinds[kind]) continue
        out.push({
          filename: a.filename,
          file: fileMap?.get(normalizeFileKey(a.filename)),
          kind,
          msgId: m.id,
        })
      }
    }
    return out
  }, [filtered, fileMap, attKinds])

  const imageItems = useMemo<LightboxItem[]>(() => {
    if (!fileMap) return []
    const out: LightboxItem[] = []
    for (const a of filteredAttachments) {
      if (a.kind !== 'images') continue
      if (a.file) out.push({ filename: a.filename, file: a.file })
    }
    return out
  }, [filteredAttachments, fileMap])

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const activeLightbox = lightboxIndex == null ? null : imageItems[lightboxIndex] ?? null
  const activeLightboxUrl = useObjectUrl(activeLightbox?.file)

  useEffect(() => {
    if (lightboxIndex == null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null)
      if (e.key === 'ArrowRight') setLightboxIndex((i) => (i == null ? i : Math.min(i + 1, imageItems.length - 1)))
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => (i == null ? i : Math.max(i - 1, 0)))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxIndex, imageItems.length])

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="title">WhatsApp Chat Viewer</div>
          <div className="subtitle">
            {chatFileName ? (
              <>
                Loaded <b>{chatFileName}</b> • {stats.total.toLocaleString()} messages •{' '}
                {stats.withAtt.toLocaleString()} with attachments
              </>
            ) : (
              <>Load your exported chat `.txt` and pick the export folder for attachments.</>
            )}
          </div>
        </div>
        <div className="topStats">
          <div className="segmented" title="Choose the export format that matches your chat file">
            <button
              type="button"
              className={`segBtn ${exportFormat === 'ios' ? 'active' : ''}`}
              onClick={() => setExportFormat('ios')}
            >
              iOS
            </button>
            <button
              type="button"
              className={`segBtn ${exportFormat === 'android' ? 'active' : ''}`}
              onClick={() => setExportFormat('android')}
            >
              Android
            </button>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={`segBtn ${viewMode === 'messages' ? 'active' : ''}`}
              onClick={() => setViewMode('messages')}
            >
              Messages
            </button>
            <button
              type="button"
              className={`segBtn ${viewMode === 'attachments' ? 'active' : ''}`}
              onClick={() => setViewMode('attachments')}
            >
              Attachments
            </button>
          </div>
          <button type="button" className="iconBtn" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? 'Hide filters' : 'Show filters'}
          </button>
          <div className="pill">
            <b>Files</b> {stats.files.toLocaleString()}
          </div>
        </div>
      </header>

      <div className={`layout ${sidebarOpen ? 'sidebarOpen' : 'sidebarClosed'}`}>
        <aside className="sidebar" aria-hidden={!sidebarOpen}>
          <div className="card">
            <div className="cardTitle">1) Load chat</div>
            <input
              type="file"
              accept=".txt"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setChatFileName(f.name)
                const text = await f.text()
                const detected = detectWhatsAppExportFormat(text)
                if (detected) setExportFormat(detected)
                setRawText(text)
              }}
            />
            <div className="help">
              {exportFormat === 'ios' ? (
                <>
                  iOS mode: use `_chat.txt` with lines like{' '}
                  <code>[1/24/22, 6:28 PM] Name: message</code>
                </>
              ) : (
                <>
                  Android mode: use `WhatsApp Chat with ….txt` with lines like{' '}
                  <code>24/01/2022, 6:28 pm - Name: message</code>
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="cardTitle">2) Pick export folder (attachments)</div>
            <DirectoryPicker onFiles={setFileMap} />
            <div className="help">
              {exportFormat === 'ios' ? (
                <>
                  Select the folder with files like <code>00011941-PHOTO-….jpg</code> so images/PDFs show.
                </>
              ) : (
                <>
                  Select the folder with files like <code>IMG-20220124-WA0050.jpg</code> so images/PDFs show.
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="cardTitle">Filters</div>
            <label className="field">
              <div className="fieldLabel">Name</div>
              <select value={sender} onChange={(e) => setSender(e.target.value)} disabled={!senders.length}>
                <option value="">All names</option>
                {senders.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <div className="fieldLabel">Search</div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="type and filter instantly (text / filename / number)…"
              />
            </label>

            <label className="field row">
              <input
                type="checkbox"
                checked={onlyWithAttachments}
                onChange={(e) => setOnlyWithAttachments(e.target.checked)}
              />
              <span>Only messages with attachments</span>
            </label>

            <div className="cardSubTitle">Attachment types</div>
            <div className="chipRow">
              {(['images', 'pdfs', 'audio', 'video', 'other'] as AttachmentKind[]).map((k) => (
                <label key={k} className={`chip ${attKinds[k] ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={attKinds[k]}
                    onChange={(e) => setAttKinds((s) => ({ ...s, [k]: e.target.checked }))}
                  />
                  <span>{k}</span>
                </label>
              ))}
            </div>

            <div className="grid2">
              <label className="field">
                <div className="fieldLabel">Year</div>
                <select
                  value={yearPreset}
                  onChange={(e) => {
                    const v = e.target.value
                    setYearPreset(v)
                    if (!v) setMonthPreset('')
                  }}
                  disabled={!years.length}
                >
                  <option value="">All years</option>
                  {years.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <div className="fieldLabel">Month</div>
                <select
                  value={monthPreset}
                  onChange={(e) => setMonthPreset(e.target.value)}
                  disabled={!yearPreset}
                >
                  <option value="">All months</option>
                  <option value="1">Jan</option>
                  <option value="2">Feb</option>
                  <option value="3">Mar</option>
                  <option value="4">Apr</option>
                  <option value="5">May</option>
                  <option value="6">Jun</option>
                  <option value="7">Jul</option>
                  <option value="8">Aug</option>
                  <option value="9">Sep</option>
                  <option value="10">Oct</option>
                  <option value="11">Nov</option>
                  <option value="12">Dec</option>
                </select>
              </label>
            </div>

            <div className="grid2">
              <label className="field">
                <div className="fieldLabel">From</div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value)
                    setYearPreset('')
                    setMonthPreset('')
                  }}
                />
              </label>
              <label className="field">
                <div className="fieldLabel">To</div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value)
                    setYearPreset('')
                    setMonthPreset('')
                  }}
                />
              </label>
            </div>

            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery('')
                setOnlyWithAttachments(false)
                setAttKinds({ images: true, pdfs: true, audio: true, video: true, other: true })
                setYearPreset('')
                setMonthPreset('')
                setDateFrom('')
                setDateTo('')
              }}
            >
              Clear filters
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => {
                const rows = filtered.map((m) => {
                  const ts = m.timestamp ? m.timestamp.toISOString() : m.timestampRaw
                  const atts = m.attachments.map((a) => a.filename).join(' | ')
                  return [ts, m.sender, m.text, atts].map((x) => csvEscape(String(x ?? ''))).join(',')
                })
                const header = ['timestamp', 'sender', 'text', 'attachments'].join(',')
                const csv = [header, ...rows].join('\n')
                downloadTextFile('whatsapp_filtered.csv', csv, 'text/csv;charset=utf-8')
              }}
              disabled={!filtered.length}
            >
              Export filtered (CSV)
            </button>

            <div className="help">
              Showing <b>{filtered.length.toLocaleString()}</b> messages • <b>{filteredAttachments.length.toLocaleString()}</b>{' '}
              attachments
            </div>
          </div>
        </aside>

        <main className="content">
          {!messages.length ? (
            <div className="empty">
              <div className="emptyTitle">
                {rawText.trim()
                  ? `No messages parsed in ${exportFormat === 'ios' ? 'iOS' : 'Android'} mode`
                  : 'Load a chat `.txt` to start'}
              </div>
              <div className="emptyBody">
                {rawText.trim() ? (
                  <>
                    The file may be from the other platform. Switch to{' '}
                    <b>{exportFormat === 'ios' ? 'Android' : 'iOS'}</b> at the top and try again.
                  </>
                ) : (
                  <>
                    Pick <b>iOS</b> for `_chat.txt` or <b>Android</b> for `WhatsApp Chat with ….txt`, then load the
                    file and choose the export folder for attachments.
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {viewMode === 'messages' ? (
                <div className="messageList">
                  {filtered.slice(0, 2000).map((m) => (
                    <div key={m.id} className="msgWrap">
                      <div className="msg">
                        <div className="msgHeader">
                          <div className="msgSender">{m.sender}</div>
                          <div className="msgTime">{m.timestamp ? formatDateTime(m.timestamp) : m.timestampRaw}</div>
                        </div>
                        {m.text ? <pre className="msgText">{m.text}</pre> : null}
                        {m.attachments.length ? (
                          <div className="attachments">
                            {m.attachments
                              .filter((a) => attKinds[attachmentKind(a.filename)])
                              .map((a) => (
                                <AttachmentView
                                  key={a.filename}
                                  filename={a.filename}
                                  file={fileMap?.get(normalizeFileKey(a.filename))}
                                  onOpenImage={(filename) => {
                                    const idx = imageItems.findIndex((x) => x.filename === filename)
                                    if (idx >= 0) setLightboxIndex(idx)
                                  }}
                                />
                              ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {filtered.length > 2000 ? (
                    <div className="help" style={{ padding: 12 }}>
                      Display capped at 2,000 messages for performance. Use filters/search to narrow down.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="gallery">
                  {filteredAttachments.slice(0, 4000).map((a, idx) => (
                    <div key={`${a.msgId}:${a.filename}:${idx}`} className="galleryItem">
                      <AttachmentView
                        filename={a.filename}
                        file={a.file}
                        onOpenImage={(filename) => {
                          const i = imageItems.findIndex((x) => x.filename === filename)
                          if (i >= 0) setLightboxIndex(i)
                        }}
                      />
                    </div>
                  ))}
                  {filteredAttachments.length > 4000 ? (
                    <div className="help" style={{ padding: 12 }}>
                      Attachment gallery capped at 4,000 items for performance. Use filters/search/type filters.
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {activeLightbox && activeLightboxUrl ? (
        <div
          className="lightboxOverlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLightboxIndex(null)
          }}
        >
          <div className="lightbox">
            <div className="lightboxTop">
              <div className="lightboxTitle">{activeLightbox.filename}</div>
              <div className="lightboxActions">
                <a className="iconBtn" href={activeLightboxUrl} download={activeLightbox.filename}>
                  Download
                </a>
                <button type="button" className="iconBtn" onClick={() => setLightboxIndex(null)}>
                  Close
                </button>
              </div>
            </div>

            <div className="lightboxBody">
              <button
                type="button"
                className="navBtn"
                onClick={() => setLightboxIndex((i) => (i == null ? i : Math.max(i - 1, 0)))}
                disabled={lightboxIndex === 0}
                aria-label="Previous image"
              >
                ‹
              </button>
              <img className="lightboxImg" src={activeLightboxUrl} alt={activeLightbox.filename} />
              <button
                type="button"
                className="navBtn"
                onClick={() =>
                  setLightboxIndex((i) => (i == null ? i : Math.min(i + 1, imageItems.length - 1)))
                }
                disabled={lightboxIndex === imageItems.length - 1}
                aria-label="Next image"
              >
                ›
              </button>
            </div>

            <div className="lightboxHint">ESC to close • ← / → to navigate • click outside to close</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

