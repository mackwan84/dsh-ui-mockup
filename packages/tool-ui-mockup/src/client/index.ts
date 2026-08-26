/** ui_mockup 工具卡片的客户端半区：注册 keyed toolview + 双语字典。 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { UiMockupToolview } from './toolview.js'
import { en, NS, zh } from './locales.js'

/** 客户端半区硬依赖：卡片槽位注册与语言切换。 */
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mockup: dictionaries')

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'ui_mockup', locale: NS },
      UiMockupToolview,
    ),
  )
}
