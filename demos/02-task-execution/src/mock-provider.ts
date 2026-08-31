import type { FastifyInstance } from 'fastify'

export function registerMockProvider(app: FastifyInstance): void {
  app.post('/mock/v1/chat/completions', async (_request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    const content = process.env.MOCK_RESPONSE ?? 'task-ok'
    const chunks = [
      {
        choices: [
          {
            delta: { role: 'assistant', content },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      },
    ]

    for (const chunk of chunks) {
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
    reply.raw.end('data: [DONE]\n\n')
  })
}
