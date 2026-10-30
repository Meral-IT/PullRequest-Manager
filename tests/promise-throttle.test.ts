import assert from 'node:assert/strict'
import test from 'node:test'
import { throttleAll } from '../lib/tools/promise-throttle'

test('throttleAll preserves input order and bounds concurrent work', async () => {
  let active = 0
  let maximum = 0
  const result = await throttleAll(
    4,
    Array.from({ length: 1000 }, (_, index) => async () => {
      maximum = Math.max(maximum, ++active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active--
      return index
    })
  )
  assert.equal(maximum, 4)
  assert.deepEqual(
    result,
    Array.from({ length: 1000 }, (_, index) => index)
  )
  assert.deepEqual(await throttleAll(4, []), [])
  assert.deepEqual(await throttleAll(10_000_000, [async () => 1]), [1])
})

test('throttleAll stops queued tasks after rejection while allowing active work to finish', async () => {
  const first = Promise.withResolvers<number>()
  const second = Promise.withResolvers<number>()
  const started: number[] = []
  const result = throttleAll(2, [
    () => {
      started.push(0)
      return first.promise
    },
    () => {
      started.push(1)
      return second.promise
    },
    async () => {
      started.push(2)
      return 2
    },
  ])
  const rejected = assert.rejects(result, /failed/)
  await Promise.resolve()
  first.reject(new Error('failed'))
  await rejected
  second.resolve(1)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(started, [0, 1])
})

test('throttleAll catches synchronous throws from queued tasks', async () => {
  let started = 0
  await assert.rejects(
    throttleAll(1, [
      async () => 1,
      () => {
        started++
        throw new Error('synchronous failure')
      },
      async () => {
        started++
        return 3
      },
    ]),
    /synchronous failure/
  )
  assert.equal(started, 1)
})

test('throttleAll validates its arguments', () => {
  for (const limit of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => throttleAll(limit, []), TypeError)
  assert.throws(() => throttleAll(1, [null] as never), TypeError)
})
