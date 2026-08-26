import { useMemo, useState } from 'react'
import type { ManuscriptNode, SceneDocument } from '../../shared/types'
import { Modal } from './Modal'

export function SplitSceneDialog({
  node,
  document,
  busy = false,
  onClose,
  onSplit,
}: {
  node: ManuscriptNode
  document: SceneDocument
  busy?: boolean
  onClose: () => void
  onSplit: (offset: number) => void
}) {
  const length = document.plainText.length
  const [offset, setOffset] = useState(Math.max(1, Math.floor(length / 2)))
  const clamped = Math.min(length, Math.max(1, offset))
  const preview = useMemo(() => {
    const before = document.plainText.slice(0, clamped)
    const after = document.plainText.slice(clamped)
    return { before: clip(before, true), after: clip(after, false) }
  }, [clamped, document.plainText])

  return <Modal title={`拆分场景 · ${node.title}`} onClose={onClose} wide>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (clamped > 0 && clamped < length) onSplit(clamped) }}>
      <p className="form-hint">原场景会保留版本记录。后半段成为同章下一场景，不会覆盖已有正文。</p>
      <label>在第几个字符后拆分（共 {length.toLocaleString('zh-CN')} 字）
        <input type="number" min={1} max={Math.max(1, length - 1)} value={clamped} onChange={(event) => setOffset(Number(event.target.value))} />
      </label>
      <div className="split-preview">
        <article><small>拆分前保留</small><p>{preview.before || '（空）'}</p></article>
        <article><small>拆出为新场景</small><p>{preview.after || '（空）'}</p></article>
      </div>
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>取消</button>
        <button className="button primary" disabled={busy || clamped <= 0 || clamped >= length}>{busy ? '正在拆分…' : '拆分场景'}</button>
      </div>
    </form>
  </Modal>
}

function clip(value: string, tail: boolean) {
  if (value.length <= 160) return value
  return tail ? `…${value.slice(-160)}` : `${value.slice(0, 160)}…`
}
