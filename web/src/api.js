export async function getJson(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`接口 ${path} 返回 ${res.status}`)
  return res.json()
}
