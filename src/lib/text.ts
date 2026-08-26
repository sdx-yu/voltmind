export function countWords(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}

export function textToTiptap(text: string): Record<string, unknown> {
  const paragraphs = text.split(/\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined }))
  return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
}

export interface ImportedChapter { title: string; text: string }

export function splitChapters(text: string): ImportedChapter[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  const heading = /^\s*(第[〇零一二三四五六七八九十百千万两0-9]+[章节卷回部篇]|Chapter\s+\d+)\s*[^\n]*$/i
  const chapters: ImportedChapter[] = []
  let title = '正文'
  let body: string[] = []
  const flush = () => {
    const textBody = body.join('\n').trim()
    if (textBody || chapters.length === 0) chapters.push({ title, text: textBody })
    body = []
  }
  for (const line of lines) {
    if (heading.test(line)) {
      if (body.length || chapters.length) flush()
      title = line.trim()
    } else body.push(line)
  }
  flush()
  return chapters.filter((chapter, index) => chapter.text || index === 0)
}

export async function readWritingFile(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value
  }
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

export function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime()
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return new Date(value).toLocaleDateString('zh-CN')
}
