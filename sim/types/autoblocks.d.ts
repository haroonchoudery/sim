declare module '@autoblocks/client' {
  export class AutoblocksTracer {
    constructor(
      // apiKey: string,
      options?: {
        traceId?: string
        properties?: Record<string, any>
      }
    )

    sendEvent(
      eventName: string,
      args: {
        spanId?: string
        properties?: Record<string, any>
      }
    ): Promise<void>
  }
}
