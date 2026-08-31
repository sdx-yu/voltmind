import { useEffect, useId, useState, type FormEvent } from 'react'
import type { Project } from '../../shared/types'
import { api } from '../lib/api'
import { Button, TextareaField, TextField } from '../ui'
import { Modal } from './Modal'

interface Props {
  project: Project
  onClose: () => void
  onSaved: (project: Project) => void | Promise<void>
  notify: (type: 'success' | 'error', message: string) => void
}

export function ProjectDetailsDialog({ project, onClose, onSaved, notify }: Props) {
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const trimmedTitle = title.trim()
  const unchanged = trimmedTitle === project.title && description.trim() === project.description

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const input = document.getElementById(titleId)
      if (input instanceof HTMLInputElement) { input.focus(); input.select() }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [titleId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedTitle || busy) return
    setBusy(true)
    try {
      const updated = await api.updateProject(project.id, { title: trimmedTitle, description: description.trim() })
      await onSaved(updated)
      notify('success', '作品信息已更新')
      onClose()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '作品信息保存失败')
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="编辑作品信息" onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <TextField id={titleId} label="书名" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} description="会同步用于书架、工作区标题和导出文件名。" />
      <TextareaField label="作品简介" rows={4} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话概括故事，也可以暂时留空" />
      <div className="modal-actions">
        <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!trimmedTitle || unchanged}>保存修改</Button>
      </div>
    </form>
  </Modal>
}
