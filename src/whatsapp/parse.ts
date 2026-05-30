export type WhatsAppExportFormat = 'ios' | 'android'

export type WhatsAppAttachment = {
  filename: string
}

export type WhatsAppMessage = {
  id: string
  sender: string
  timestampRaw: string
  timestamp: Date | null
  text: string
  attachments: WhatsAppAttachment[]
  rawLines: string[]
}

// iOS / newer export: [M/D/YY, H:MM:SS AM/PM] Sender: message
const messageStartReBracket =
  /^\u200e?\[(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*([^\]]+)\]\s*([^:]+):\s?(.*)$/

// Android / older export: DD/MM/YYYY, H:MM am/pm - Sender: message
const messageStartReDash =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*([^-]+?)\s*-\s*(.*)$/

type ParsedLine = {
  mm: number
  dd: number
  yy2: number
  timeRaw: string
  sender: string
  rest: string
}

function parseIosMessageStartLine(line: string): ParsedLine | null {
  const bracket = messageStartReBracket.exec(line)
  if (!bracket) return null
  return {
    mm: Number(bracket[1]),
    dd: Number(bracket[2]),
    yy2: Number(bracket[3]),
    timeRaw: bracket[4].trim(),
    sender: bracket[5].trim(),
    rest: bracket[6] ?? '',
  }
}

function parseAndroidMessageStartLine(line: string): ParsedLine | null {
  const dash = messageStartReDash.exec(line)
  if (!dash) return null

  const dd = Number(dash[1])
  const mm = Number(dash[2])
  const yyyy = Number(dash[3])
  const timeRaw = dash[4].trim()
  const tail = dash[5]
  const senderMatch = /^([^:]+):\s?(.*)$/.exec(tail)
  if (senderMatch) {
    return {
      mm,
      dd,
      yy2: yyyy - 2000,
      timeRaw,
      sender: senderMatch[1].trim(),
      rest: senderMatch[2] ?? '',
    }
  }

  return { mm, dd, yy2: yyyy - 2000, timeRaw, sender: 'System', rest: tail }
}

function parseMessageStartLine(line: string, format: WhatsAppExportFormat): ParsedLine | null {
  return format === 'ios' ? parseIosMessageStartLine(line) : parseAndroidMessageStartLine(line)
}

export function detectWhatsAppExportFormat(rawText: string): WhatsAppExportFormat | null {
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let ios = 0
  let android = 0

  for (const line of lines) {
    if (!line.trim()) continue
    if (parseIosMessageStartLine(line)) ios++
    else if (parseAndroidMessageStartLine(line)) android++
    if (ios + android >= 20) break
  }

  if (ios === 0 && android === 0) return null
  return ios >= android ? 'ios' : 'android'
}

function parseTimeTo24h(timeRaw: string): { h: number; m: number; s: number } | null {
  // WhatsApp exports sometimes use narrow no-break space before AM/PM
  const t = timeRaw.replace(/\u202f/g, ' ').trim()
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(t)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const sec = m[3] ? Number(m[3]) : 0
  const ampm = m[4]?.toUpperCase()

  if (ampm) {
    if (h === 12) h = 0
    if (ampm === 'PM') h += 12
  }
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null
  return { h, m: min, s: sec }
}

function parseDateToJsDate(mm: number, dd: number, yy2: number, timeRaw: string): Date | null {
  const t = parseTimeTo24h(timeRaw)
  if (!t) return null
  const year = 2000 + yy2
  const d = new Date(year, mm - 1, dd, t.h, t.m, t.s, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function extractAttachments(text: string): { cleaned: string; attachments: WhatsAppAttachment[] } {
  const attachments: WhatsAppAttachment[] = []
  let cleaned = text.replace(/<attached:\s*([^>]+)>/gi, (_, filename: string) => {
    attachments.push({ filename: filename.trim() })
    return ''
  })
  cleaned = cleaned.replace(/([^\n(]+?)\s*\(file attached\)/gi, (_, filename: string) => {
    attachments.push({ filename: filename.trim() })
    return ''
  })
  return { cleaned: cleaned.replace(/\s+/g, ' ').trim(), attachments }
}

export function parseWhatsAppExport(rawText: string, format: WhatsAppExportFormat): WhatsAppMessage[] {
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const messages: WhatsAppMessage[] = []

  let cur:
    | {
        mm: number
        dd: number
        yy2: number
        timeRaw: string
        sender: string
        textParts: string[]
        rawLines: string[]
      }
    | undefined

  const flush = () => {
    if (!cur) return
    const joined = cur.textParts.join('\n').trimEnd()
    const { cleaned, attachments } = extractAttachments(joined)
    const timestamp = parseDateToJsDate(cur.mm, cur.dd, cur.yy2, cur.timeRaw)
    const tsRaw = `${cur.mm}/${cur.dd}/${cur.yy2}, ${cur.timeRaw}`
    const id = `${messages.length + 1}:${cur.mm}/${cur.dd}/${cur.yy2}:${cur.timeRaw}:${cur.sender}`
    messages.push({
      id,
      sender: cur.sender,
      timestampRaw: tsRaw,
      timestamp,
      text: cleaned,
      attachments,
      rawLines: cur.rawLines,
    })
    cur = undefined
  }

  for (const line of lines) {
    const parsed = parseMessageStartLine(line, format)
    if (parsed) {
      flush()
      cur = {
        mm: parsed.mm,
        dd: parsed.dd,
        yy2: parsed.yy2,
        timeRaw: parsed.timeRaw,
        sender: parsed.sender,
        textParts: [parsed.rest],
        rawLines: [line],
      }
      continue
    }

    // Continuation line (multi-line message)
    if (!cur) continue
    cur.textParts.push(line)
    cur.rawLines.push(line)
  }

  flush()
  return messages
}

export function uniqueSortedSenders(messages: WhatsAppMessage[]): string[] {
  const set = new Set<string>()
  for (const m of messages) set.add(m.sender)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

