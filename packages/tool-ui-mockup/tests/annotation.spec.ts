import { describe, expect, it } from 'vitest'
import {
  badgeAnchor,
  backingSize,
  buildAnnotationFeedbackMessage,
  displaySize,
  formatAnnotationTimestamp,
  markBounds,
  numberLabel,
  pointerToImage,
  projectMark,
  projectMarks,
  type AnnotationMark,
} from '../src/annotation.js'

// 几何测试统一用整数坐标与整数图像尺寸：整数除法按 IEEE 正确舍入，
// 断言里的十进制字面量即精确结果，避免不可表示小数带来的偶发失败。
const W = 2000
const H = 1000

describe('markBounds', () => {
  it('normalizes a rect into [0,1]', () => {
    const box = markBounds({ tool: 'rect', x: 200, y: 100, w: 400, h: 200 }, W, H)
    expect(box).toEqual({ x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 })
  })

  it('uses the brush stroke outer hull', () => {
    const box = markBounds(
      {
        tool: 'brush',
        points: [
          [100, 200],
          [300, 50],
          [200, 400],
        ],
      },
      400,
      400,
    )
    expect(box).toEqual({ x0: 0.25, y0: 0.125, x1: 0.75, y1: 1 })
  })

  it('uses arrow endpoints regardless of direction', () => {
    const box = markBounds({ tool: 'arrow', from: [300, 300], to: [100, 100] }, 400, 400)
    expect(box).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 })
  })

  it('clamps out-of-bounds coordinates into the image region', () => {
    const box = markBounds({ tool: 'rect', x: -100, y: -100, w: 1000, h: 1000 }, 400, 400)
    expect(box).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })

  it('rejects degenerate marks and invalid image sizes', () => {
    expect(markBounds({ tool: 'brush', points: [] }, W, H)).toBeNull()
    expect(markBounds({ tool: 'rect', x: 0, y: 0, w: 10, h: 10 }, 0, H)).toBeNull()
    expect(markBounds({ tool: 'rect', x: 0, y: 0, w: 10, h: 10 }, W, Number.NaN)).toBeNull()
  })
})

describe('numberLabel', () => {
  it('maps 1..20 to circled digits and falls back beyond', () => {
    expect(numberLabel(1)).toBe('①')
    expect(numberLabel(3)).toBe('③')
    expect(numberLabel(20)).toBe('⑳')
    expect(numberLabel(21)).toBe('(21)')
    expect(numberLabel(0)).toBe('(0)')
  })
})

describe('projectMark / projectMarks', () => {
  it('projects rect as numbered region with two-decimal coordinates', () => {
    const mark: AnnotationMark = { tool: 'rect', x: 240, y: 50, w: 520, h: 140 }
    expect(projectMark(1, mark, W, H)).toBe('①区域 x:[0.12,0.38] y:[0.05,0.19]')
  })

  it('projects arrow as from/to points', () => {
    const mark: AnnotationMark = { tool: 'arrow', from: [400, 310], to: [1240, 310] }
    expect(projectMark(2, mark, W, H)).toBe('②箭头 从(0.20,0.31) 指向(0.62,0.31)')
  })

  it('projects brush as outer-hull box', () => {
    const mark: AnnotationMark = {
      tool: 'brush',
      points: [
        [800, 600],
        [1100, 720],
      ],
    }
    expect(projectMark(3, mark, W, H)).toBe('③笔迹 外接框 x:[0.40,0.55] y:[0.60,0.72]')
  })

  it('keeps numbering positions when a degenerate mark is skipped', () => {
    const projections = projectMarks(
      [
        { tool: 'brush', points: [] },
        { tool: 'rect', x: 0, y: 0, w: W, h: H },
      ],
      W,
      H,
    )
    expect(projections).toEqual(['②区域 x:[0.00,1.00] y:[0.00,1.00]'])
  })
})

describe('display mapping', () => {
  it('scales display size by zoom level', () => {
    expect(displaySize(1024, 576, 1)).toEqual({ width: 1024, height: 576 })
    expect(displaySize(1024, 576, 2)).toEqual({ width: 2048, height: 1152 })
  })

  it('backs the canvas store with device pixels, rounded up', () => {
    expect(backingSize(800, 450, 2)).toEqual({ width: 1600, height: 900 })
    expect(backingSize(800, 450, 1.25)).toEqual({ width: 1000, height: 563 })
    // 异常 DPR 回退 1，不产生 0 或 NaN 尺寸
    expect(backingSize(800, 450, 0)).toEqual({ width: 800, height: 450 })
    expect(backingSize(800, 450, Number.NaN)).toEqual({ width: 800, height: 450 })
  })

  it('maps pointer to image coordinates for both zoom levels and clamps', () => {
    expect(pointerToImage(200, 100, 1, 1024, 576)).toEqual({ x: 200, y: 100 })
    expect(pointerToImage(400, 200, 2, 1024, 576)).toEqual({ x: 200, y: 100 })
    // 负值与越界钳在图像内
    expect(pointerToImage(-50, -50, 1, 1024, 576)).toEqual({ x: 0, y: 0 })
    expect(pointerToImage(9999, 9999, 2, 1024, 576)).toEqual({ x: 1024, y: 576 })
  })
})

describe('badgeAnchor', () => {
  it('places the badge at the box top-left', () => {
    const anchor = badgeAnchor({ x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 }, W, H)
    expect(anchor.x).toBe(0.5 * W)
    expect(anchor.y).toBe(0.5 * H)
    expect(anchor.radius).toBeGreaterThanOrEqual(10)
  })

  it('pulls the badge back inside near image edges', () => {
    const anchor = badgeAnchor({ x0: 0, y0: 0, x1: 0.1, y1: 0.1 }, W, H)
    expect(anchor.x).toBe(anchor.radius)
    expect(anchor.y).toBe(anchor.radius)
    const corner = badgeAnchor({ x0: 1, y0: 1, x1: 1, y1: 1 }, W, H)
    expect(corner.x).toBe(W - corner.radius)
    expect(corner.y).toBe(H - corner.radius)
  })
})

describe('annotation feedback message', () => {
  const time = new Date('2026-09-04T15:20:33.000Z')

  it('formats the timestamp as fixed ISO 8601 UTC', () => {
    expect(formatAnnotationTimestamp(time)).toBe('2026-09-04T15:20:33.000Z')
  })

  it('builds the fixed-Chinese model-visible message', () => {
    const message = buildAnnotationFeedbackMessage({
      name: 'mockup-1788493763773-06915576-1.png',
      time,
      projections: ['①区域 x:[0.12,0.38] y:[0.05,0.19]', '②箭头 从(0.20,0.31) 指向(0.62,0.31)'],
      opinion: '红框改成下拉框',
    })
    expect(message).toBe(
      '对 design/images/mockup-1788493763773-06915576-1.png 的标注反馈' +
        '（2026-09-04T15:20:33.000Z）：编号区域（归一化坐标）：' +
        '①区域 x:[0.12,0.38] y:[0.05,0.19]；②箭头 从(0.20,0.31) 指向(0.62,0.31)。' +
        '意见：红框改成下拉框',
    )
  })

  it('preserves JavaScript replacement-pattern characters in the opinion', () => {
    // 回归 0.1.3 修复项：$& / $` / $' / $$ 在字符串替换语义下会被解释，
    // 函数式替换必须原样保留用户输入
    const opinion = "价格 $& $` $' 占位 $$100"
    const message = buildAnnotationFeedbackMessage({
      name: 'mockup-a.png',
      time,
      projections: ['①区域 x:[0.00,1.00] y:[0.00,1.00]'],
      opinion,
    })
    expect(message.endsWith(`意见：${opinion}`)).toBe(true)
  })

  it('trims surrounding whitespace from the opinion', () => {
    const message = buildAnnotationFeedbackMessage({
      name: 'mockup-a.png',
      time,
      projections: [],
      opinion: '  加个搜索框  ',
    })
    expect(message.endsWith('意见：加个搜索框')).toBe(true)
  })
})
