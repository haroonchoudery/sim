import { AutoblocksTracer } from '@autoblocks/client'
import crypto from 'crypto'
import dotenv from 'dotenv'

dotenv.config()

async function testTracer() {
  const apiKey = process.env.AUTOBLOCKS_API_KEY
  if (!apiKey) {
    console.error('AUTOBLOCKS_API_KEY not found')
    process.exit(1)
  }

  console.log('API Key:', apiKey)
  console.log('\nTesting with client library...')

  try {
    // Create tracer with trace ID and properties only
    const tracer = new AutoblocksTracer({
      traceId: crypto.randomUUID(),
      properties: {
        provider: 'openai',
      },
    })

    // Use crypto.randomUUID() for span ID
    const spanId = crypto.randomUUID()
    console.log('Using span ID:', spanId)

    const params = {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant.',
        },
        {
          role: 'user',
          content: 'How do I sign up?',
        },
      ],
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      n: 1,
    }

    // Send request event
    await tracer.sendEvent('ai.request', {
      spanId,
      properties: params,
    })

    // Simulate processing time and response
    const startTime = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Send response event with correct property names
    await tracer.sendEvent('ai.response', {
      spanId,
      properties: {
        response: {
          choices: [
            {
              message: {
                content: 'This is a test response',
                role: 'assistant',
              },
            },
          ],
        },
        latencyMs: Date.now() - startTime, // Changed from latency_ms to latencyMs
      },
    })

    // Send user feedback event
    await tracer.sendEvent('user.feedback', {
      properties: {
        feedback: 'good',
      },
    })

    console.log('Events sent successfully!')
  } catch (error) {
    console.error('Test failed:', error)
    process.exit(1)
  }
}

testTracer()
