const statuses = ['not_asked', 'answered', 'declined', 'unknown'];
const intakeCategories = [
  'identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence', 'assistance_needed'
];
const statementDetails = [
  'keyEvents', 'approximateDates', 'locations', 'peopleInvolved', 'harmOrThreats',
  'whyTargeted', 'fearOfReturn', 'evidenceOrWitnessDetails', 'currentProtectionConcerns'
];
const profileFields = [
  'preferredName', 'legalName', 'countryOfOrigin', 'currentCountry', 'existingCase',
  'organizationOrRepresentative', 'caseReference', 'caseStatus', 'safeContactMethod'
];
const answerSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: statuses },
    value: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  },
  required: ['status', 'value'],
  additionalProperties: false
};
const profileProperties = Object.fromEntries(profileFields.map(field => [field, answerSchema]));
const categoryProperties = Object.fromEntries(intakeCategories.map(field => [field, { type: 'string', enum: statuses }]));
const detailProperties = Object.fromEntries(statementDetails.map(field => [field, { type: 'string', enum: statuses }]));

/** Claude constrained-output schema; semantic and cross-field checks remain in validateIntakeState. */
export const CLAUDE_INTERVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    intake: {
      type: 'object',
      properties: {
        profile: { type: 'object', properties: profileProperties, required: profileFields, additionalProperties: false },
        categories: { type: 'object', properties: categoryProperties, required: intakeCategories, additionalProperties: false },
        details: { type: 'object', properties: detailProperties, required: statementDetails, additionalProperties: false },
        urgentSafetyConcern: { type: 'boolean' },
        skipIntake: { type: 'boolean' },
        finishRequested: { type: 'boolean' },
        pauseRequested: { type: 'boolean' },
        summaryStatus: { type: 'string', enum: ['not_offered', 'offered', 'accepted', 'confirmed', 'declined'] }
      },
      required: [
        'profile', 'categories', 'details', 'urgentSafetyConcern', 'skipIntake',
        'finishRequested', 'pauseRequested', 'summaryStatus'
      ],
      additionalProperties: false
    }
  },
  required: ['reply', 'intake'],
  additionalProperties: false
} as const;
