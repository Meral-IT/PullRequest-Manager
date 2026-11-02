export async function stopProfilePolling(integrations) {
  integrations.stop()
  await Promise.all([...integrations.services.values()].map(({ service }) => service.refresh?.promise))
}

export function initialPrReadiness(count) {
  const rendered = count
    ? `document.querySelectorAll('[role="row"]').length === ${Math.min(count, 100) + 1}`
    : `document.body.innerText.includes('Currently, no pull requests')`
  return `(async () => {
    const data = await globalThis.api.invoke('get-pr-data')
    return !data.error && data.items.length === ${count} && (${rendered})
  })()`
}
