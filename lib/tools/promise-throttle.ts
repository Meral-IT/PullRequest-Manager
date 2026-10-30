export type Task<T> = () => Promise<T>

export const throttleAll = <T>(limit: number, tasks: Task<T>[]): Promise<T[]> => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError(`Expected \`limit\` to be a finite number > 0, got \`${limit}\` (${typeof limit})`)
  }

  if (!Array.isArray(tasks) || !tasks.every((task) => typeof task === `function`)) {
    throw new TypeError(`Expected \`tasks\` to be a list of functions returning a promise`)
  }

  return new Promise<T[]>((resolve, reject) => {
    const result: T[] = new Array(tasks.length)
    let index = 0
    let remaining = tasks.length
    let failed = false
    if (remaining === 0) resolve(result)
    const next = () => {
      if (failed || index === tasks.length) return
      const current = index++
      Promise.resolve()
        .then(tasks[current])
        .then(
          (value) => {
            result[current] = value
            if (--remaining === 0) resolve(result)
            else next()
          },
          (error) => {
            failed = true
            reject(error)
          }
        )
    }
    for (let worker = 0; worker < Math.min(limit, tasks.length); worker++) next()
  })
}
