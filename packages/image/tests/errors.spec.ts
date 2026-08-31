import { describe, expect, it } from 'vitest'
import { ImageProviderError } from '../src/index.js'

describe('ImageProviderError', () => {
  it('carries the machine-readable code and message', () => {
    const err = new ImageProviderError('RATE_LIMITED', 'requests rate limit exceeded')
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.message).toBe('requests rate limit exceeded')
    expect(err.name).toBe('ImageProviderError')
    expect(err).toBeInstanceOf(Error)
  })
})
