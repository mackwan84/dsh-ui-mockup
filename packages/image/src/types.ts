/** 草图精度：线框图确认布局与信息架构；高保真确认视觉风格。 */
export type ImageFidelity = 'wireframe' | 'high-fidelity'

/** 目标平台，决定默认画幅方向。 */
export type ImagePlatform = 'web' | 'mobile'

/** 一次文生图/图生图的完整请求。 */
export interface ImageGenerateSpec {
  /** 正向提示词：期望生成的界面内容、风格与构图。 */
  readonly prompt: string
  /** 草图精度（用户选择）。 */
  readonly fidelity: ImageFidelity
  /** 目标平台。 */
  readonly platform: ImagePlatform
  /** 视觉风格描述（高保真时使用）。 */
  readonly style?: string
  /** 输出画幅，形如 "1280*720"。缺省由实现按平台选择。 */
  readonly size?: string
  /** 输出图片数量（1-4，实现负责钳制）。 */
  readonly n?: number
  /** 显式覆盖模型；缺省由实现按 fidelity 分层选择。 */
  readonly model?: string
  /** 参考图路径（相对 cwd），图生图模式保持风格一致；缺省为纯文生图。 */
  readonly reference?: string
  /** 解析 reference 的工作目录。 */
  readonly cwd?: string
}

/** 图像编辑请求（局部/整体修改）。 */
export interface ImageEditSpec {
  /** 编辑指令：期望的修改内容。 */
  readonly prompt: string
  /** 待编辑的基准图路径（相对 cwd）。 */
  readonly baseImage: string
  /** 掩码图路径（相对 cwd），支持掩码局部重绘时生效。 */
  readonly mask?: string
  /** 目标平台。 */
  readonly platform: ImagePlatform
  /** 输出画幅。 */
  readonly size?: string
  /** 显式覆盖模型。 */
  readonly model?: string
  /** 解析路径的工作目录。 */
  readonly cwd?: string
}

/** 单张生成结果。 */
export interface GeneratedImage {
  /** 图片 URL（有效期由提供方决定，调用方须及时下载）。 */
  readonly url: string
  /** 媒体类型（提供方已知时给出）。 */
  readonly mediaType?: string
}

/** 一次生成/编辑的完整结果。 */
export interface ImageGenerateResult {
  /** 实际使用的模型。 */
  readonly model: string
  /** 生成图片列表，顺序与请求一致。 */
  readonly images: readonly GeneratedImage[]
}

/** Provider 错误码：调用方据此区分可重试、限流、凭据与参数问题。 */
export type ImageProviderErrorCode =
  | 'MISSING_CREDENTIAL'
  | 'INVALID_PARAMETER'
  | 'RATE_LIMITED'
  | 'TASK_FAILED'
  | 'TIMEOUT'
  | 'NOT_IMPLEMENTED'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE'

/** 图像服务统一错误：携带机器可读错误码与面向用户的消息。 */
export class ImageProviderError extends Error {
  constructor(
    readonly code: ImageProviderErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ImageProviderError'
  }
}
