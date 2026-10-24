import { MEMORY_FIELDS } from './memory-types';
/** Return changes, not a second complete snapshot. The larger duplicated schema
 * exceeded Claude's grammar compilation limit in a live development test.
 * All fields/enums remain constrained here and validated again by the application. */
export const CLAUDE_INTERVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    updates: {
      type: 'array', items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: MEMORY_FIELDS },
          status: { type: 'string', enum: ['answered', 'declined', 'unknown'] },
          value: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          quote: { type: 'string' }, uncertain: { type: 'boolean' }, correction: { type: 'boolean' }
        },
        required: ['field', 'status', 'value', 'quote', 'uncertain', 'correction'], additionalProperties: false
      }
    },
    question: { anyOf: [{ type: 'null' }, {
      type: 'object', properties: {
        field: { type: 'string', enum: [...MEMORY_FIELDS, 'review'] },
        intent: { type: 'string', enum: ['ask', 'clarify', 'confirm'] },
        candidate: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }, required: ['field', 'intent', 'candidate'], additionalProperties: false
    }] },
    intake: {
      type: 'object',
      properties: {
        urgentSafetyConcern: { type: 'boolean' },
        skipIntake: { type: 'boolean' },
        finishRequested: { type: 'boolean' },
        pauseRequested: { type: 'boolean' },
        summaryStatus: { type: 'string', enum: ['not_offered', 'offered', 'accepted', 'confirmed', 'declined'] }
      },
      required: [
        'urgentSafetyConcern', 'skipIntake',
        'finishRequested', 'pauseRequested', 'summaryStatus'
      ],
      additionalProperties: false
    }
  },
  required: ['reply', 'intake', 'updates', 'question'],
  additionalProperties: false
} as const;
