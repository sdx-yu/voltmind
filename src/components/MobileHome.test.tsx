import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileHome } from './MobileHome'
import { api } from '../lib/api'
import { listLocalMobileItems, putLocalMobileItem, resetMobileStore } from '../lib/mobileStore'

vi.mock('../lib/api', () => ({ api: { createMobileInboxItem: vi.fn(), createMobileInboxAction: vi.fn(), listMobileInbox: vi.fn(), getMobileLibrary: vi.fn() } }))
vi.mock('../lib/mobileStore', () => ({
  getMobileDeviceId: () => 'device-mobile', getMobileLibrary: vi.fn().mockResolvedValue({ projects: [], scenes: [], cachedAt: '' }),
  listLocalMobileItems: vi.fn().mockResolvedValue([]), mergeLocalMobileItems: vi.fn().mockResolvedValue(undefined),
  putLocalMobileAction: vi.fn().mockResolvedValue(undefined), putLocalMobileItem: vi.fn().mockResolvedValue(undefined), resetMobileStore: vi.fn().mockResolvedValue(undefined), saveMobileLibrary: vi.fn().mockResolvedValue(undefined),
}))

describe('MobileHome', () => {
  beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }) })
  afterEach(cleanup)

  it('captures locally while offline and keeps the homepage scope narrow', async () => {
    render(<MobileHome/>)
    expect(await screen.findByText('离线可用')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '雨落在旧车站的铁轨上' } })
    fireEvent.click(screen.getByRole('button', { name: /存入收集箱/ }))
    await waitFor(() => expect(putLocalMobileItem).toHaveBeenCalledWith(expect.objectContaining({ content: '雨落在旧车站的铁轨上', kind: 'inspiration', originDeviceId: 'device-mobile' })))
    expect(screen.getByText(/联网后自动回流/)).toBeInTheDocument()
    expect(api.createMobileInboxItem).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /生成|改写|正典/ })).not.toBeInTheDocument()
  })

  it('keeps capture, reading and pending primary while exposing sprint results read-only', async () => {
    render(<MobileHome/>); await screen.findByText('离线可用')
    expect(screen.getByRole('heading', { name: '此刻想到什么？' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '继续阅读' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /待处理/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '最近冲刺' })).toBeInTheDocument()
  })

  it('never claims a low-storage write succeeded and offers explicit cache recovery', async () => {
    vi.mocked(putLocalMobileItem).mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    render(<MobileHome/>); await screen.findByText('离线可用')
    fireEvent.change(screen.getByLabelText('记录内容'), { target: { value: '空间不足时的记录' } }); fireEvent.click(screen.getByRole('button', { name: /存入收集箱/ }))
    expect(await screen.findByText(/这条记录尚未保存/)).toBeInTheDocument(); cleanup()

    vi.mocked(listLocalMobileItems).mockRejectedValueOnce(new Error('corrupt'))
    render(<MobileHome/>); expect(await screen.findByText(/本地缓存异常/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重建缓存' }))
    await waitFor(() => expect(resetMobileStore).toHaveBeenCalled())
  })
})
