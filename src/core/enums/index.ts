export enum AgentMode {
  Ask = 'ask',
  Agent = 'agent',
}

export enum FileOperationAction {
  CreateFile = 'CREATE_FILE',
  EditFile = 'EDIT_FILE',
  DeleteFile = 'DELETE_FILE',
  RenameFile = 'RENAME_FILE',
  CreateFolder = 'CREATE_FOLDER',
  RunTool = 'RUN_TOOL',
  RunCommand = 'RUN_COMMAND',
}
