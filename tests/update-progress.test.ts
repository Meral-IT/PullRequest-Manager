import assert from 'node:assert/strict'
import test from 'node:test'
import { getDownloadProgress } from '../app/components/update-notification/update-progress'

test('download metrics use readable units and estimate remaining time', () => {
  const progress = getDownloadProgress({
    percent: 25,
    total: 80_000_000,
    transferred: 20_000_000,
    bytesPerSecond: 2_000_000,
    delta: 0,
  })
  assert.equal(progress.percent, 25)
  assert.equal(progress.size, '20 MB of 80 MB')
  assert.equal(progress.speed, '2 MB/s')
  assert.equal(progress.remaining, 'About 30 sec left')
  assert.equal(progress.finishing, false)
})

test('unknown totals remain indeterminate and stopped transfers have no estimate', () => {
  assert.equal(getDownloadProgress().percent, undefined)
  const progress = getDownloadProgress({ percent: 0, total: 0, transferred: 2000, bytesPerSecond: 0, delta: 0 })
  assert.equal(progress.percent, undefined)
  assert.equal(progress.size, '2 kB downloaded')
  assert.equal(progress.speed, undefined)
  assert.equal(progress.remaining, undefined)
})

test('invalid metrics never produce invalid values and completion stays distinct from readiness', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const progress = getDownloadProgress({
      percent: invalid,
      total: invalid,
      transferred: invalid,
      bytesPerSecond: invalid,
      delta: 0,
    })
    assert.equal(progress.percent, undefined)
    assert.doesNotMatch(JSON.stringify(progress), /NaN|Infinity/)
  }
  const complete = getDownloadProgress({ percent: 130, total: 100, transferred: 200, bytesPerSecond: 10, delta: 0 })
  assert.equal(complete.percent, 100)
  assert.equal(complete.size, '100 B of 100 B')
  assert.equal(complete.finishing, true)
  assert.equal(complete.remaining, undefined)
  assert.equal(
    getDownloadProgress({ percent: -5, total: 100, transferred: -10, bytesPerSecond: -1, delta: 0 }).percent,
    0
  )
})
