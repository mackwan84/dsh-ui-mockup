import { Service, type Context } from '@deepseek-ai/cordis'
import type { ImageEditSpec, ImageGenerateResult, ImageGenerateSpec } from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    image: ImageGenerationService
  }
}

/**
 * 图像生成 capability 的抽象契约：为 UI 草图生成/编辑提供跨提供方的统一入口。
 * 实现类加载为插件即注册为 `ctx.image`（一个实现 per context，重复加载是配置错误）。
 *
 * 语义约定：
 * - `generate` 仅因基础设施失败 reject；参数/凭据/限流/任务失败以 {@link ImageProviderError} 携带错误码。
 * - 返回的图片 URL 有有效期，Consumer 须立即下载保存。
 * - 实现必须尊重传入的 `signal` 取消（中断进行中的请求与轮询）。
 */
export abstract class ImageGenerationService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'image')
  }

  /** 按 spec 生成 1-N 张图片。 */
  abstract generate(spec: ImageGenerateSpec, signal?: AbortSignal): Promise<ImageGenerateResult>

  /** 基于基准图编辑（支持掩码时局部重绘，否则整体重绘）。 */
  abstract edit(spec: ImageEditSpec, signal?: AbortSignal): Promise<ImageGenerateResult>
}

export {
  ImageProviderError,
  type GeneratedImage,
  type ImageEditSpec,
  type ImageFidelity,
  type ImageGenerateResult,
  type ImageGenerateSpec,
  type ImagePlatform,
  type ImageProviderErrorCode,
} from './types.js'

export default ImageGenerationService
