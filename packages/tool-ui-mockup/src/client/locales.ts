/** ui_mockup 工具卡片的客户端 UI 文案（双语，跟随 DSH 语言切换）。 */

export const NS = 'ui-mockup'

/** 简体中文 UI 文案。 */
export const zh = {
  'card.generating': '生成中…',
  'card.confirm': '确认采用这版',
  'card.select': '选用第 {n} 版',
  'card.selectPlaceholder': '选用某一版…',
  'card.openOriginal': '打开原图',
  'card.feedback': '提交修改意见',
  'card.feedbackPlaceholder': '描述要修改的地方…',
  'card.feedbackSubmit': '提交并重新生成',
  'card.feedbackCancel': '取消',
  'card.confirmMessage': '确认采用这版设计（文件：{name}）',
  'card.selectMessage': '选用第 {n} 版（文件：{name}）',
  'card.feedbackMessage': '{opinion}（基于文件：{name}，请按此意见重新生成）',
} satisfies Record<string, string>

/** 卡片命名空间的字典键联合。 */
export type UiMockupKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** ui_mockup 工具卡片文案。 */
    'ui-mockup': UiMockupKey
  }
}

/** English UI copy. */
export const en = {
  'card.generating': 'Generating…',
  'card.confirm': 'Confirm this version',
  'card.select': 'Use version {n}',
  'card.selectPlaceholder': 'Pick a version…',
  'card.openOriginal': 'Open original',
  'card.feedback': 'Submit feedback',
  'card.feedbackPlaceholder': 'Describe what to change…',
  'card.feedbackSubmit': 'Submit & regenerate',
  'card.feedbackCancel': 'Cancel',
  'card.confirmMessage': 'Confirm this design (file: {name})',
  'card.selectMessage': 'Use version {n} (file: {name})',
  'card.feedbackMessage': '{opinion} (based on file: {name}, regenerate accordingly)',
} satisfies Record<UiMockupKey, string>
