export type AgentApprovalMode = 'approval' | 'yolo';

export interface AgentApprovalPreferences {
  global: AgentApprovalMode;
  site?: AgentApprovalMode;
  session?: AgentApprovalMode;
}

export function resolveAgentApprovalMode(
  preferences: AgentApprovalPreferences,
): AgentApprovalMode {
  return preferences.session ?? preferences.site ?? preferences.global;
}
