import OpenAI from 'openai'
import { createAutoblocksTracer } from '@/lib/autoblocks/client'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { ProviderConfig, ProviderRequest, ProviderResponse, TimeSegment } from '../types'

const logger = createLogger('OpenAI Provider')

/**
 * OpenAI provider configuration
 */
export const openaiProvider: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  description: "OpenAI's GPT models",
  version: '1.0.0',
  models: ['gpt-4o', 'o1', 'o3-mini'],
  defaultModel: 'gpt-4o',

  executeRequest: async (request: ProviderRequest): Promise<ProviderResponse> => {
    logger.info('Preparing OpenAI request', {
      model: request.model || 'gpt-4o',
      hasSystemPrompt: !!request.systemPrompt,
      hasMessages: !!request.messages?.length,
      hasTools: !!request.tools?.length,
      toolCount: request.tools?.length || 0,
      hasResponseFormat: !!request.responseFormat,
    })

    // Start execution timer for the entire provider execution
    const providerStartTime = Date.now()
    const providerStartTimeISO = new Date(providerStartTime).toISOString()

    // Initialize Autoblocks tracer
    logger.info('Creating Autoblocks tracer for OpenAI request', {
      hasApiKey: !!process.env.AUTOBLOCKS_API_KEY,
    })

    const tracer = createAutoblocksTracer(undefined, {
      provider: 'openai',
      model: request.model || 'gpt-4o',
      timestamp: providerStartTimeISO,
    })
    logger.info('Successfully created Autoblocks tracer')

    // Test the tracer connection
    try {
      await tracer.sendEvent('openai.request.start', {
        properties: {
          timestamp: providerStartTimeISO,
          model: request.model || 'gpt-4o',
          hasSystemPrompt: !!request.systemPrompt,
          messageCount: request.messages?.length || 0,
          toolCount: request.tools?.length || 0,
        },
      })
      logger.info('Successfully sent initial event to Autoblocks')
    } catch (error) {
      logger.error('Failed to send initial event to Autoblocks', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // API key is now handled server-side before this function is called
    const openai = new OpenAI({ apiKey: request.apiKey })

    // Start with an empty array for all messages
    const allMessages = []

    // Add system prompt if present
    if (request.systemPrompt) {
      allMessages.push({
        role: 'system',
        content: request.systemPrompt,
      })
    }

    // Add context if present
    if (request.context) {
      allMessages.push({
        role: 'user',
        content: request.context,
      })
    }

    // Add remaining messages
    if (request.messages) {
      allMessages.push(...request.messages)
    }

    // Transform tools to OpenAI format if provided
    const tools = request.tools?.length
      ? request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.id,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined

    // Build the request payload
    const payload: any = {
      model: request.model || 'gpt-4o',
      messages: allMessages,
    }

    // Add optional parameters
    if (request.temperature !== undefined) payload.temperature = request.temperature
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

    // Add response format for structured output if specified
    if (request.responseFormat) {
      payload.response_format = {
        type: 'json_schema',
        schema: request.responseFormat.schema || request.responseFormat,
      }
    }

    // Add tools if provided
    if (tools?.length) {
      payload.tools = tools
      payload.tool_choice = 'auto'
    }

    // Track request with Autoblocks
    const spanId = crypto.randomUUID()
    tracer.sendEvent('ai.request', {
      spanId: spanId,
      properties: payload,
    })

    try {
      // Make the initial API request
      const initialCallTime = Date.now()
      let currentResponse = await openai.chat.completions.create(payload)
      const firstResponseTime = Date.now() - initialCallTime

      // Track response with Autoblocks
      tracer.sendEvent('ai.response', {
        spanId: spanId,
        properties: {
          response: JSON.parse(JSON.stringify(currentResponse)),
          latency_ms: firstResponseTime,
        },
      })

      let content = currentResponse.choices[0]?.message?.content || ''
      let tokens = {
        prompt: currentResponse.usage?.prompt_tokens || 0,
        completion: currentResponse.usage?.completion_tokens || 0,
        total: currentResponse.usage?.total_tokens || 0,
      }
      let toolCalls = []
      let toolResults = []
      let currentMessages = [...allMessages]
      let iterationCount = 0
      const MAX_ITERATIONS = 10 // Prevent infinite loops

      // Track time spent in model vs tools
      let modelTime = firstResponseTime
      let toolsTime = 0

      // Track each model and tool call segment with timestamps
      const timeSegments: TimeSegment[] = [
        {
          type: 'model',
          name: 'Initial response',
          startTime: initialCallTime,
          endTime: initialCallTime + firstResponseTime,
          duration: firstResponseTime,
        },
      ]

      while (iterationCount < MAX_ITERATIONS) {
        // Check for tool calls
        const toolCallsInResponse = currentResponse.choices[0]?.message?.tool_calls
        if (!toolCallsInResponse || toolCallsInResponse.length === 0) {
          break
        }

        logger.info(
          `Processing ${toolCallsInResponse.length} tool calls (iteration ${iterationCount + 1}/${MAX_ITERATIONS})`
        )

        // Track time for tool calls in this batch
        const toolsStartTime = Date.now()

        // Process each tool call
        for (const toolCall of toolCallsInResponse) {
          try {
            const toolName = toolCall.function.name
            const toolArgs = JSON.parse(toolCall.function.arguments)

            // Get the tool from the tools registry
            const tool = request.tools?.find((t) => t.id === toolName)
            if (!tool) continue

            // Track tool call with Autoblocks
            const toolSpanId = crypto.randomUUID()
            tracer.sendEvent('ai.tool.request', {
              spanId: toolSpanId,
              properties: {
                tool: toolName,
                arguments: toolArgs,
              },
            })

            // Execute the tool
            const toolCallStartTime = Date.now()
            const mergedArgs = {
              ...tool.params,
              ...toolArgs,
              ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
            }
            const result = await executeTool(toolName, mergedArgs)
            const toolCallEndTime = Date.now()
            const toolCallDuration = toolCallEndTime - toolCallStartTime

            // Track tool result with Autoblocks
            tracer.sendEvent('ai.tool.response', {
              spanId: toolSpanId,
              properties: {
                tool: toolName,
                success: result.success,
                output: result.output,
                duration_ms: toolCallDuration,
              },
            })

            if (!result.success) continue

            // Add to time segments
            timeSegments.push({
              type: 'tool',
              name: toolName,
              startTime: toolCallStartTime,
              endTime: toolCallEndTime,
              duration: toolCallDuration,
            })

            toolResults.push(result.output)
            toolCalls.push({
              name: toolName,
              arguments: toolArgs,
              startTime: new Date(toolCallStartTime).toISOString(),
              endTime: new Date(toolCallEndTime).toISOString(),
              duration: toolCallDuration,
              result: result.output,
            })

            // Add the tool call and result to messages
            currentMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: toolName,
                    arguments: toolCall.function.arguments,
                  },
                },
              ],
            })

            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result.output),
            })
          } catch (error) {
            logger.error('Error processing tool call:', {
              error,
              toolName: toolCall?.function?.name,
            })

            // Track tool error with Autoblocks
            tracer.sendEvent('ai.tool.error', {
              spanId: spanId,
              properties: {
                tool: toolCall?.function?.name,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
              },
            })
          }
        }

        // Calculate tool call time for this iteration
        const thisToolsTime = Date.now() - toolsStartTime
        toolsTime += thisToolsTime

        // Make the next request with updated messages
        const nextPayload = {
          ...payload,
          messages: currentMessages,
        }

        // Time the next model call
        const nextModelStartTime = Date.now()

        // Track follow-up request with Autoblocks
        const followUpSpanId = crypto.randomUUID()
        tracer.sendEvent('ai.request', {
          spanId: followUpSpanId,
          properties: nextPayload,
        })

        // Make the next request
        currentResponse = await openai.chat.completions.create(nextPayload)

        const nextModelEndTime = Date.now()
        const thisModelTime = nextModelEndTime - nextModelStartTime

        // Track follow-up response with Autoblocks
        tracer.sendEvent('ai.response', {
          spanId: followUpSpanId,
          properties: {
            response: JSON.parse(JSON.stringify(currentResponse)),
            latency_ms: thisModelTime,
          },
        })

        // Add to time segments
        timeSegments.push({
          type: 'model',
          name: `Model response (iteration ${iterationCount + 1})`,
          startTime: nextModelStartTime,
          endTime: nextModelEndTime,
          duration: thisModelTime,
        })

        // Add to model time
        modelTime += thisModelTime

        // Update content if we have a text response
        if (currentResponse.choices[0]?.message?.content) {
          content = currentResponse.choices[0].message.content
        }

        // Update token counts
        if (currentResponse.usage) {
          tokens.prompt += currentResponse.usage.prompt_tokens || 0
          tokens.completion += currentResponse.usage.completion_tokens || 0
          tokens.total += currentResponse.usage.total_tokens || 0
        }

        iterationCount++
      }

      // Calculate overall timing
      const providerEndTime = Date.now()
      const providerEndTimeISO = new Date(providerEndTime).toISOString()
      const totalDuration = providerEndTime - providerStartTime

      return {
        content,
        model: request.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timing: {
          startTime: providerStartTimeISO,
          endTime: providerEndTimeISO,
          duration: totalDuration,
          modelTime: modelTime,
          toolsTime: toolsTime,
          firstResponseTime: firstResponseTime,
          iterations: iterationCount + 1,
          timeSegments: timeSegments,
        },
      }
    } catch (error) {
      logger.error('Error in OpenAI request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        model: request.model,
      })

      // Track error with Autoblocks
      tracer.sendEvent('ai.error', {
        spanId: spanId,
        properties: {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      })

      throw error
    }
  },
}
