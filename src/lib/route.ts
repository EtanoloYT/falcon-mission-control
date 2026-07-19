export async function readRouteId(
  context: { params?: Promise<Record<string, string>> | Record<string, string> },
  key = "id"
) {
  const params = await context.params;
  return Number(params?.[key]);
}
