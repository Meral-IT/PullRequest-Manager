export async function stopProfilePolling(integrations) {
  integrations.stop()
  await Promise.all([...integrations.services.values()].map(({ service }) => service.refresh?.promise))
}
