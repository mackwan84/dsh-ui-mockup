/**
 * ui_mockup 客户端半区：keyed 工具卡片 + 设置面板（M3）+ 双语字典。
 * 面板注册进 DSH 设置窗口的 settings.section 列表槽；偏好经 settings
 * 命名空间镜像读写，历史/锚点/测试连接走 /ui-mockup 私有 RPC 通道。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionFace, SettingsScopeBinderFace } from './shared.js'
import { UiMockupToolview } from './toolview.js'
import { UiMockupSection, type PanelPrefs, type UiMockupPanelInjected } from './settings-panel.js'
import { en, NS, zh } from './locales.js'

/**
 * 客户端半区硬依赖：卡片与设置槽注册、语言切换、connection 通道与设置域服务。
 * sessions 为可选运行时面（仅用于历史页 cwd），缺席时退化为宿主进程 fallback 根。
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mockup: dictionaries')

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'ui_mockup', locale: NS },
      UiMockupToolview,
    ),
  )

  // bind 在本插件 fiber 上登记镜像订阅：插件卸载时随之销毁
  const prefs = (ctx.get('settingsScope') as SettingsScopeBinderFace).bind<PanelPrefs>({
    namespace: 'ui-mockup',
  })
  const connection = ctx.get('connection') as ConnectionFace

  const panelInjected = (): UiMockupPanelInjected => ({ prefs, connection })

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'ui-mockup',
        order: 100,
        label: () => ctx.locale.bind(NS)('panel.nav'),
        locale: NS,
        inject: panelInjected,
      },
      UiMockupSection,
    ),
  )
}
