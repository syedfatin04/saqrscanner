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

const messageStartRe =
  /^\u200e?\[(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*([^\]]+)\]\s*([^:]+):\s?(.*)$/

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
  const cleaned = text.replace(/<attached:\s*([^>]+)>/gi, (_, filename: string) => {
    attachments.push({ filename: filename.trim() })
    return ''
  })
  return { cleaned: cleaned.replace(/\s+/g, ' ').trim(), attachments }
}

export function parseWhatsAppExport(rawText: string): WhatsAppMessage[] {
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
    const m = messageStartRe.exec(line)
    if (m) {
      flush()
      const mm = Number(m[1])
      const dd = Number(m[2])
      const yy2 = Number(m[3])
      const timeRaw = m[4].trim()
      const sender = m[5].trim()
      const rest = m[6] ?? ''
      cur = { mm, dd, yy2, timeRaw, sender, textParts: [rest], rawLines: [line] }
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

