/** 工具卡片与设置面板共享的客户端最小面：图片路由 URL 与 RPC 调用折叠。 */

/** 图片文件名 → webServer 路由 URL（host 半区 /ui-mockup/images 服务资产库图片）。 */
export function imageUrl(name: string, cwd?: string): string {
  const base = `/ui-mockup/images/${encodeURIComponent(name)}`
  return cwd !== undefined && cwd !== '' ? `${base}?cwd=${encodeURIComponent(cwd)}` : base
}

/** connection 服务的客户端结构面（本包只用 rpc.call 与 isLoopback）。 */
export interface ConnectionFace {
  readonly isLoopback: boolean
  readonly rpc: {
    call(
      channel: string,
      endpoint: string,
      payload?: unknown,
      signal?: AbortSignal,
    ): Promise<RpcResultLike<unknown>>
  }
}

/** 与宿主半区同构的 RPC 结果形状。 */
export type RpcResultLike<T> =
  { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * 把 RPC 结果折叠成「值或抛错」：错误信息面向用户可读，
 * 错误码保留在消息前缀便于排障。
 * 注意：宿主信封校验要求 payload 必填（clientRequestSchema 的 payload 为
 * z.unknown() 非可选），JSON.stringify 会丢弃值为 undefined 的字段，因此
 * 无参端点（overview / test-connection）也必须发送一个 {}。
 */
export async function callPanel<T>(
  connection: ConnectionFace,
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const result = await connection.rpc.call('/ui-mockup', endpoint, payload ?? {})
  if (!result.ok) throw new Error(`[${result.error.code}] ${result.error.message}`)
  return result.value as T
}

/**
 * settings 域的客户端结构面（bind 由 ui-settings 插件在运行时提供）；
 * 面板经由它把同名命名空间镜像绑到本插件 fiber。
 */
export interface SettingsScopeBinderFace {
  bind<T>(spec: { namespace: string }): PrefScope<T>
}

export interface ScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  user: unknown
  base: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

export interface PrefScope<T> {
  getSnapshot(): ScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}
