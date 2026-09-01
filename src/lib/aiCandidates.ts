export interface BrainstormDirection {
  title: string
  premise: string
  opportunity: string
  risk: string
  text: string
}

export function candidateUnits(taskType: string, value: string): string[] {
  if (taskType === 'brainstorm') {
    const directions = splitBrainstormDirections(value)
    return directions.length ? directions.map((direction) => direction.text) : splitSentenceCandidates(value)
  }
  return splitSentenceCandidates(value)
}

export function splitBrainstormDirections(value: string): BrainstormDirection[] {
  const normalized = value.replace(/\r/g, '').replace(/(?:方向|方案)\s*([一二三四五六七八九十\d]+)\s*([：:｜|、.－-])/g, '\n方向$1$2').trim()
  const groups: Array<{ title: string; lines: string[] }> = []
  for (const sourceLine of normalized.split('\n')) {
    const line = cleanLine(sourceLine)
    if (!line) continue
    const heading = line.match(/^(?:方向|方案)\s*([一二三四五六七八九十\d]+)\s*[：:｜|、.－-]\s*(.*)$/)
    if (heading) {
      groups.push({ title: `方向${heading[1]}`, lines: heading[2] ? [heading[2]] : [] })
      continue
    }
    if (groups.length && !/^(?:提醒|说明|注)[：:]/.test(line)) groups.at(-1)?.lines.push(line)
  }
  if (!groups.length) return []
  return groups.map(({ title, lines }) => buildDirection(title, lines.join('\n')))
}

export function splitSentenceCandidates(value: string): string[] {
  return value.match(/[^。！？!?\n]+[。！？!?]?|\n+/g)?.filter((segment) => segment.trim()) ?? [value]
}

function buildDirection(title: string, content: string): BrainstormDirection {
  const opportunity = labeledValue(content, '机会', '风险')
  const risk = labeledValue(content, '风险')
  const premise = content.split(/(?:机会|风险)\s*[：:]/, 1)[0].trim().replace(/[；;]\s*$/, '')
  const sections = [premise, opportunity && `机会：${opportunity}`, risk && `风险：${risk}`].filter(Boolean)
  return { title, premise, opportunity, risk, text: `${title}：${sections.join('\n')}` }
}

function labeledValue(content: string, label: string, stopLabel?: string): string {
  const stop = stopLabel ? `(?=${stopLabel}\\s*[：:]|$)` : '$'
  return content.match(new RegExp(`${label}\\s*[：:]\\s*([\\s\\S]*?)${stop}`))?.[1].trim().replace(/^[；;]|[；;]\s*$/g, '') ?? ''
}

function cleanLine(value: string): string {
  return value.trim().replace(/^#{1,6}\s*/, '').replace(/^(?:[-*+]\s+|\d+[.)、]\s*)/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim()
}
