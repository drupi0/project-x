const STRUCTURAL_WORDS = new Set([
  'json', 'think', 'reply', 'intake', 'profile', 'categories', 'details', 'status', 'value',
  'preferredName', 'legalName', 'countryOfOrigin', 'currentCountry', 'existingCase',
  'organizationOrRepresentative', 'caseReference', 'caseStatus', 'safeContactMethod',
  'identity_location', 'reason_for_fleeing', 'current_safety', 'available_evidence',
  'assistance_needed', 'keyEvents', 'approximateDates', 'locations', 'peopleInvolved',
  'harmOrThreats', 'whyTargeted', 'fearOfReturn', 'evidenceOrWitnessDetails',
  'currentProtectionConcerns', 'urgentSafetyConcern', 'skipIntake', 'finishRequested',
  'pauseRequested', 'summaryStatus', 'not_asked', 'answered', 'declined', 'unknown',
  'not_offered', 'offered', 'accepted', 'confirmed', 'true', 'false', 'null'
]);

/** Keep JSON shape and schema labels visible, but mask every other word/number and all names. */
export function redactRawModelOutput(content: string): string {
  return content.replace(/[\p{L}\p{N}_-]+/gu, token =>
    STRUCTURAL_WORDS.has(token) ? token : 'x'.repeat(token.length)
  );
}
