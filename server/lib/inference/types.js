// server/lib/inference/types.js
// JSDoc type definitions for the @concord/inference module.

/**
 * @typedef {'conscious'|'subconscious'|'utility'|'repair'|'multimodal'} BrainRole
 */

/**
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [toolCallId]
 * @property {string} [scope] - 'user-private' prevents capture in tracer spans
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {string} name
 * @property {Object} args
 */

/**
 * @typedef {Object} StopCondition
 * @property {'text_contains'|'tool_called'|'max_tokens'} type
 * @property {string} [value]
 */

/**
 * @typedef {Object} InferRequest
 * @property {BrainRole} role
 * @property {string} intent
 * @property {string[]} [dtuRefs]
 * @property {Object} [lensContext]
 * @property {Message[]} [history]
 * @property {string[]} [toolScope]
 * @property {number} [toolBudget]
 * @property {StopCondition} [stopWhen]
 * @property {number} [maxSteps]
 * @property {boolean} [stream]
 * @property {AbortSignal} [signal]
 * @property {string} callerId
 * @property {string} [traceId]
 * @property {string} [brainOverride]
 * @property {number} [temperature]
 * @property {string} [userId]
 * @property {Buffer} [sessionKey]
 */

/**
 * @typedef {Object} InferStep
 * @property {'inference'|'tool_call'|'tool_result'} type
 * @property {number} startedAt
 * @property {number} duration
 * @property {Object} [response]
 * @property {ToolCall} [call]
 * @property {*} [result]
 */

/**
 * @typedef {Object} InferResponse
 * @property {string} inferenceId
 * @property {BrainRole} brainUsed
 * @property {string} modelUsed
 * @property {InferStep[]} steps
 * @property {string} [finalText]
 * @property {ToolCall[]} toolCalls
 * @property {Array<{dtuId: string, weight: number}>} dtuContributors
 * @property {number} tokensIn
 * @property {number} tokensOut
 * @property {number} latencyMs
 * @property {string[]} fallbacksUsed
 * @property {boolean} [terminated]
 */

/**
 * @typedef {Object} BrainHandle
 * @property {string} name
 * @property {string} model
 * @property {string} url
 * @property {number} priority
 * @property {Function} chat - async (messages, opts) => { ok, text, toolCalls, tokensIn, tokensOut }
 * @property {Function} [generate] - async (prompt, opts) => string|null — NPC/emergent path; routes through npc-prompt-coalescer
 * @property {string} [callerId]
 */
