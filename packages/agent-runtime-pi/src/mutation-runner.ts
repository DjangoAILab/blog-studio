export type SiteToolMutationRunner = <T>(input: {
  readonly toolCallId: string;
  readonly toolName:
    | 'write'
    | 'edit'
    | 'delete_path'
    | 'move_path'
    | 'import_attachment'
    | 'git_restore_path'
    | 'git_revert_agent_path';
  readonly paths: readonly string[];
  readonly operation: () => Promise<T>;
}) => Promise<T>;
