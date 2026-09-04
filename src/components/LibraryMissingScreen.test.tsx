import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryMissingScreen } from './LibraryMissingScreen'

describe('LibraryMissingScreen', () => {
  afterEach(() => cleanup())

  it('explains the write lock and lets the author recheck after restoring the local file', async () => {
    const retry = vi.fn()
    render(<LibraryMissingScreen reason="资料库文件已从本机移除" onRetry={retry} />)

    expect(screen.getByRole('heading', { name: '本地稿件库文件不见了' })).toBeInTheDocument()
    expect(screen.getByText('资料库文件已从本机移除')).toBeInTheDocument()
    expect(screen.getByText('当前服务已经阻止所有写入。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
