import { AutoblocksTracer } from '@autoblocks/client'

// Initialize the Autoblocks tracer with environment variables
export const createAutoblocksTracer = (
  traceId?: string,
  additionalProperties?: Record<string, any>
) => {
  const apiKey = process.env.AUTOBLOCKS_INGESTION_KEY
  if (!apiKey) {
    console.warn('AUTOBLOCKS_INGESTION_KEY not found - tracing will be disabled')
    return {
      sendEvent: async () => {
        console.log('No-op tracer called')
      },
    }
  }

  try {
    // Create tracer instance exactly as shown in docs
    return new AutoblocksTracer({
      traceId: traceId || `trace-${Date.now()}`,
      properties: {
        environment: process.env.NODE_ENV || 'development',
        ...additionalProperties,
      },
    })
  } catch (error) {
    console.error('Failed to create Autoblocks tracer:', error)
    return {
      sendEvent: async () => {
        console.log('Error tracer called')
      },
    }
  }
}
