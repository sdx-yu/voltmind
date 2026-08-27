import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MobileInboxAction, MobileInboxItem } from '../../shared/types'
import { clearMobileStoreForTests, listLocalMobileItems, mergeLocalMobileItems, putLocalMobileAction, putLocalMobileItem } from './mobileStore'

describe('mobile IndexedDB store', () => {
  beforeEach(async () => clearMobileStoreForTests())
  afterEach(async () => clearMobileStoreForTests())

  it('retains twenty offline notes across reopen and rejects immutable ID collisions', async () => {
    for (let index = 0; index < 20; index += 1) await putLocalMobileItem(item(`item-${index.toString().padStart(4, '0')}`, `离线灵感 ${index}`))
    expect(await listLocalMobileItems()).toHaveLength(20)
    expect((await listLocalMobileItems()).map((entry) => entry.content)).toContain('离线灵感 0')
    await expect(putLocalMobileItem(item('item-0000', '被篡改'))).rejects.toThrow(/collision/i)
  })

  it('folds duplicate and out-of-order append-only actions deterministically', async () => {
    const record = item('item-action', '判断这一段节奏'); await putLocalMobileItem(record)
    const later: MobileInboxAction = { id: 'action-zzzz', itemId: record.id, action: 'approved', note: '', createdAt: '2026-08-27T10:00:00.000Z' }
    const earlier: MobileInboxAction = { id: 'action-aaaa', itemId: record.id, action: 'revisit', note: '', createdAt: '2026-08-27T09:00:00.000Z' }
    await putLocalMobileAction(later); await putLocalMobileAction(earlier); await putLocalMobileAction(later)
    expect((await listLocalMobileItems())[0]).toMatchObject({ currentAction: 'approved', actions: [earlier, later] })
  })

  it('merges remote union without removing local-only events', async () => {
    await putLocalMobileItem(item('item-local', '本机记录'))
    const remote: MobileInboxItem = { ...item('item-remote', '远端记录'), actions: [{ id: 'remote-action', itemId: 'item-remote', action: 'filed', note: '', createdAt: '2026-08-27T12:00:00.000Z' }], currentAction: 'filed' }
    await mergeLocalMobileItems([remote, remote])
    expect(await listLocalMobileItems()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'item-local' }), expect.objectContaining({ id: 'item-remote', currentAction: 'filed' })]))
  })
})

function item(id: string, content: string) { return { id, projectId: null, targetNodeId: null, kind: 'inspiration' as const, content, originDeviceId: 'device-test', createdAt: '2026-08-27T08:00:00.000Z' } }
